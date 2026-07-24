# -*- coding: utf-8 -*-
"""
shot_geometry_nodes.py — ComfyUI 自定义节点：镜头几何分析层
================================================================
安装：把本文件放入 ComfyUI/custom_nodes/ 目录，重启 ComfyUI。
依赖：仅 opencv-python、numpy（ComfyUI 整合包/大多数环境已自带）。

提供三个节点（分类：镜头分析/）：
  1. 镜头几何分析 (LK+投影)      —— 输入帧序列，输出运镜数值 JSON + 流场可视化
  2. 主体运动残差 (需SAM遮罩)    —— 输入帧序列+SAM3遮罩，输出主体运动 JSON + 可视化
  3. 镜头JSON汇总落盘            —— 合并几何/语义/主体三路 JSON，写入磁盘

约定（JSON 字段说明见部署指南 §5）：
  cam_dx > 0  → 相机向右（pan right，画面内容左移）
  cam_dy > 0  → 相机向下（tilt down）
  zoom_px > 0 → 画面放大（前推 dolly-in 或变焦 zoom-in，2D 层不可区分，ambiguous=True）
"""

import json
import os
import re

import cv2
import numpy as np
import torch

try:
    import folder_paths  # ComfyUI 运行时可用
    _OUT_DIR = folder_paths.get_output_directory()
except Exception:  # 脱离 ComfyUI 调试时的兜底
    _OUT_DIR = os.getcwd()


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def _to_gray(t):
    """torch [H,W,C] float 0-1 → uint8 灰度图"""
    img = np.clip(t.detach().cpu().numpy() * 255.0, 0, 255).astype(np.uint8)
    if img.ndim == 3 and img.shape[-1] >= 3:
        return cv2.cvtColor(img[..., :3], cv2.COLOR_RGB2GRAY)
    return img[..., 0] if img.ndim == 3 else img


def _to_rgb(t):
    return np.clip(t.detach().cpu().numpy() * 255.0, 0, 255).astype(np.uint8)[..., :3]


def _grid_points(h, w, n, margin=0.06):
    xs = np.linspace(w * margin, w * (1 - margin), n)
    ys = np.linspace(h * margin, h * (1 - margin), n)
    xv, yv = np.meshgrid(xs, ys)
    pts = np.stack([xv.ravel(), yv.ravel()], axis=1).astype(np.float32)
    return pts.reshape(-1, 1, 2)


_LK = dict(winSize=(21, 21), maxLevel=3,
           criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))


def _pair_flow(g0, g1, grid):
    """相邻两帧的稀疏光流：返回有效跟踪点对 p0→p1"""
    p1, st, _ = cv2.calcOpticalFlowPyrLK(g0, g1, grid, None, **_LK)
    ok = st.reshape(-1) == 1
    return grid.reshape(-1, 2)[ok], p1.reshape(-1, 2)[ok]


def _motion_scalars(p0, p1, w, h):
    """
    把稀疏流场投影为可解释的运镜标量（每帧增量）。
    返回的是【相机】运动：特征点位移取反。
    """
    if len(p0) < 12:
        return None
    flow = p1 - p0
    med = np.median(flow, axis=0)                    # 画面整体位移
    cam_dx, cam_dy = -float(med[0]), -float(med[1])  # 相机 = 画面位移取反

    resid = flow - med                               # 去掉平移后的残差
    rel = p0 - np.array([w / 2.0, h / 2.0])
    r = np.linalg.norm(rel, axis=1) + 1e-6
    radial = rel / r[:, None]                        # 径向单位向量
    tangent = np.stack([-radial[:, 1], radial[:, 0]], axis=1)

    zoom_px = float(np.median(np.sum(resid * radial, axis=1)))   # >0 放大
    roll_px = float(np.median(np.sum(resid * tangent, axis=1)))  # >0 逆时针(画面)
    mean_r = float(np.mean(r))
    roll_deg = roll_px / max(mean_r, 1.0) * 180.0 / np.pi

    agree = float(np.mean(np.linalg.norm(flow - med, axis=1) < 2.0))  # 一致性
    return {"cam_dx": cam_dx, "cam_dy": cam_dy,
            "zoom_px": zoom_px, "roll_deg": roll_deg,
            "agree": agree, "n_pts": int(len(p0))}


def _speed_class(px_per_frame, diag):
    v = px_per_frame / diag
    if v < 0.0005:
        return "static"
    if v < 0.002:
        return "slow"
    if v < 0.006:
        return "medium"
    return "fast"


def _classify_camera(frames_s, w, h):
    """逐帧标量 → 镜头级运镜分类（多数表决 + 幅度统计）"""
    diag = float(np.hypot(w, h))
    k = diag / 2202.0  # 以 1080p 对角线为基准的自适应阈值
    T_MOVE, T_ZOOM, T_ROLL = 0.6 * k, 0.35 * k, 0.05  # px / px / 度

    dx = np.array([s["cam_dx"] for s in frames_s])
    dy = np.array([s["cam_dy"] for s in frames_s])
    zm = np.array([s["zoom_px"] for s in frames_s])
    rl = np.array([s["roll_deg"] for s in frames_s])
    agree = float(np.mean([s["agree"] for s in frames_s]))

    mdx, mdy, mzm, mrl = float(np.median(dx)), float(np.median(dy)), \
        float(np.median(zm)), float(np.median(rl))
    trans = float(np.hypot(mdx, mdy))

    primitive, ambiguous, note = "static", False, ""
    if trans < T_MOVE and abs(mzm) < T_ZOOM and abs(mrl) < T_ROLL:
        if agree < 0.55:
            primitive, note = "handheld_candidate", "平移量小但流场一致性差，疑似手持微晃"
    else:
        comps = {}
        if abs(mzm) >= T_ZOOM:
            comps["zoom"] = abs(mzm)
        if trans >= T_MOVE:
            comps["trans"] = trans
        if abs(mrl) >= T_ROLL:
            comps["roll"] = abs(mrl)
        main = max(comps, key=comps.get)
        if main == "zoom":
            primitive = "dolly_or_zoom_in" if mzm > 0 else "dolly_or_zoom_out"
            ambiguous = True
            note = "2D层无法区分前推(dolly)与变焦(zoom)，需语义层或焦距估计复核"
        elif main == "trans":
            if abs(mdx) >= abs(mdy):
                primitive = "pan_right" if mdx > 0 else "pan_left"
            else:
                primitive = "tilt_down" if mdy > 0 else "tilt_up"
            ambiguous = True
            note = "2D层无法区分摇镜(pan/tilt)与平移轨(truck/pedestal)，短镜头内观感近似"
        else:
            primitive = "roll_ccw" if mrl > 0 else "roll_cw"

    speed_mag = trans + abs(mzm)  # 平移+缩放合成速度
    return {
        "primitive": primitive,
        "ambiguous": ambiguous,
        "note": note,
        "camera": {
            "pan_px_per_frame": round(mdx, 3),
            "tilt_px_per_frame": round(mdy, 3),
            "zoom_px_per_frame": round(mzm, 3),
            "roll_deg_per_frame": round(mrl, 4),
        },
        "speed": _speed_class(speed_mag, diag),
        "flow_agreement": round(agree, 3),
    }


def _draw_flow_viz(rgb, p0, p1, summary_lines, mask=None, subj_idx=None):
    vis = rgb.copy()
    if mask is not None:
        contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(vis, contours, -1, (255, 60, 60), 2)
    step = max(1, len(p0) // 120)
    for i in range(0, len(p0), step):
        color = (60, 220, 60)
        if subj_idx is not None and i in subj_idx:
            color = (60, 60, 255)
        a = tuple(p0[i].astype(int))
        b = tuple((p0[i] + (p1[i] - p0[i]) * 3).astype(int))
        cv2.arrowedLine(vis, a, b, color, 1, tipLength=0.3)
    y = 26
    for line in summary_lines:
        cv2.putText(vis, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (0, 0, 0), 3, cv2.LINE_AA)
        cv2.putText(vis, line, (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 1, cv2.LINE_AA)
        y += 28
    return torch.from_numpy(vis.astype(np.float32) / 255.0).unsqueeze(0)


_DIRS = ["east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast"]
_DIRS_CN = {"east": "向右", "northeast": "向右上", "north": "向上", "northwest": "向左上",
            "west": "向左", "southwest": "向左下", "south": "向下", "southeast": "向右下"}


def _dir8(dx, dy):
    if abs(dx) < 1e-6 and abs(dy) < 1e-6:
        return "static", "静止"
    ang = np.arctan2(-dy, dx)  # 图像坐标 y 向下 → 取反使"上"为正
    idx = int(np.round(ang / (np.pi / 4))) % 8
    return _DIRS[idx], _DIRS_CN[_DIRS[idx]]


# ---------------------------------------------------------------------------
# 节点 1：镜头几何分析
# ---------------------------------------------------------------------------

class ShotGeometryLK:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "grid_n": ("INT", {"default": 20, "min": 8, "max": 64,
                               "tooltip": "跟踪网格密度，20≈400个点"}),
        }}

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("geometry_json", "flow_viz")
    FUNCTION = "run"
    CATEGORY = "镜头分析"
    DESCRIPTION = "稀疏光流+径向/切向投影，输出相机运镜数值JSON（零token几何层）"

    def run(self, images, grid_n=20):
        n = images.shape[0]
        if n < 2:
            return (json.dumps({"error": "帧数不足(需≥2)"}, ensure_ascii=False),
                    images[:1])

        h, w = images.shape[1], images.shape[2]
        grid = _grid_points(h, w, grid_n)
        grays = [_to_gray(images[i]) for i in range(n)]

        series, last_p0, last_p1 = [], None, None
        for i in range(n - 1):
            p0, p1 = _pair_flow(grays[i], grays[i + 1], grid)
            s = _motion_scalars(p0, p1, w, h)
            if s is not None:
                s["pair"] = i
                series.append(s)
                last_p0, last_p1 = p0, p1

        if not series:
            return (json.dumps({"error": "光流跟踪失败(画面可能全黑/全白)"},
                               ensure_ascii=False), images[:1])

        result = _classify_camera(series, w, h)
        result["frames_analyzed"] = n
        result["resolution"] = [w, h]
        mid = n // 2
        viz = _draw_flow_viz(_to_rgb(images[mid]), last_p0, last_p1,
                             [f"primitive: {result['primitive']}",
                              f"speed: {result['speed']}",
                              f"agree: {result['flow_agreement']}"])
        return (json.dumps(result, ensure_ascii=False, indent=2), viz)


# ---------------------------------------------------------------------------
# 节点 2：主体运动残差
# ---------------------------------------------------------------------------

class SubjectMotionResidual:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",),
            "masks": ("MASK",),  # SAM3 输出的遮罩序列 [B,H,W]
            "grid_n": ("INT", {"default": 20, "min": 8, "max": 64}),
        }}

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("subject_json", "subject_viz")
    FUNCTION = "run"
    CATEGORY = "镜头分析"
    DESCRIPTION = "遮罩内光流减去全局相机运动，输出主体自身运动（残差法）"

    def run(self, images, masks, grid_n=20):
        n = min(images.shape[0], masks.shape[0])
        if n < 2:
            return (json.dumps({"error": "帧数不足(需≥2)"}, ensure_ascii=False),
                    images[:1])

        h, w = images.shape[1], images.shape[2]
        diag = float(np.hypot(w, h))
        grid = _grid_points(h, w, grid_n).reshape(-1, 2)

        mask_np = []
        for i in range(n):
            m = masks[i].detach().cpu().numpy().astype(np.float32)
            if m.shape != (h, w):
                m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
            mask_np.append(m)

        res_vecs, viz_data = [], None
        for i in range(n - 1):
            g0 = _to_gray(images[i])
            g1 = _to_gray(images[i + 1])
            p0, p1 = _pair_flow(g0, g1, grid.reshape(-1, 1, 2))
            if len(p0) < 12:
                continue
            in_m = mask_np[i][p0[:, 1].astype(int).clip(0, h - 1),
                              p0[:, 0].astype(int).clip(0, w - 1)] > 0.5
            flow = p1 - p0
            if in_m.sum() < 6 or (~in_m).sum() < 12:
                continue
            bg = np.median(flow[~in_m], axis=0)       # 背景=相机运动
            subj = np.median(flow[in_m], axis=0)      # 主体表观运动
            res_vecs.append(subj - bg)                # 残差=主体自身运动
            if i == n // 2:
                viz_data = (i, p0, p1, set(np.where(in_m)[0]))

        if not res_vecs:
            return (json.dumps({"error": "遮罩内有效跟踪点不足(主体可能过小/被遮挡)"},
                               ensure_ascii=False), images[:1])

        v = np.median(np.stack(res_vecs), axis=0)
        mag = float(np.linalg.norm(v))
        if mag < 0.4 * diag / 2202.0:
            direction, direction_cn, spd = "static", "基本静止", "static"
        else:
            direction, direction_cn = _dir8(float(v[0]), float(v[1]))
            spd = _speed_class(mag, diag)

        result = {
            "subject_motion_px_per_frame": [round(float(v[0]), 3), round(float(v[1]), 3)],
            "magnitude_px_per_frame": round(mag, 3),
            "direction": direction,
            "direction_cn": direction_cn,
            "speed": spd,
            "pairs_used": len(res_vecs),
            "note": "已扣除全局相机运动；值为正表示主体向画面右/下方移动",
        }
        if viz_data is not None:
            i, p0, p1, sidx = viz_data
            viz = _draw_flow_viz(_to_rgb(images[i]), p0, p1,
                                 [f"subject: {direction_cn} {spd}",
                                  f"|v|: {mag:.2f} px/f"],
                                 mask=mask_np[i], subj_idx=sidx)
        else:
            viz = images[:1]
        return (json.dumps(result, ensure_ascii=False, indent=2), viz)


# ---------------------------------------------------------------------------
# 节点 3：JSON 汇总落盘
# ---------------------------------------------------------------------------

def _parse_json_loose(s):
    """容忍 VLM 输出的 ```json 围栏和前后杂文本"""
    if not s or not s.strip():
        return None
    s = re.sub(r"```(?:json)?", "", s)
    m = re.search(r"\{.*\}", s, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


class ShotJSONMerge:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "shot_id": ("STRING", {"default": "shot_001"}),
                "save_dir": ("STRING", {"default": "shot_analysis"}),
            },
            "optional": {
                "geometry_json": ("STRING", {"forceInput": True}),
                "semantic_json": ("STRING", {"forceInput": True}),  # QwenVL 节点输出
                "subject_json": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("merged_json", "saved_path")
    FUNCTION = "run"
    CATEGORY = "镜头分析"
    OUTPUT_NODE = True  # 有写文件副作用 + 产出终端数据；设为 output 节点确保即使输出未被下游消费也会执行
    DESCRIPTION = "合并几何/语义/主体三路JSON，写入 ComfyUI output/save_dir/"

    def run(self, shot_id, save_dir, geometry_json=None, semantic_json=None,
            subject_json=None):
        merged = {"shot_id": shot_id}
        for key, raw in (("geometry", geometry_json),
                         ("semantic", semantic_json),
                         ("subject", subject_json)):
            parsed = _parse_json_loose(raw) if raw else None
            if parsed is not None:
                merged[key] = parsed

        # 冲突检测：几何层 vs 语义层的运镜结论
        geo = merged.get("geometry", {})
        sem = merged.get("semantic", {})
        gp, sp = geo.get("primitive"), sem.get("camera_primitive")
        conflicts = []
        if gp and sp:
            g_zoom = "zoom" in gp or "dolly" in gp
            s_zoom = sp in ("zoom_in", "zoom_out", "dolly_in", "dolly_out")
            if g_zoom != s_zoom and gp != "static" and sp != "static":
                conflicts.append(f"geometry={gp} vs semantic={sp}")
        merged["conflict"] = conflicts
        merged["need_api_review"] = len(conflicts) > 0 or bool(geo.get("ambiguous"))

        out_dir = os.path.join(_OUT_DIR, save_dir)
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{shot_id}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        return (json.dumps(merged, ensure_ascii=False, indent=2), path)


NODE_CLASS_MAPPINGS = {
    "ShotGeometryLK": ShotGeometryLK,
    "SubjectMotionResidual": SubjectMotionResidual,
    "ShotJSONMerge": ShotJSONMerge,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "ShotGeometryLK": "镜头几何分析 (LK+投影)",
    "SubjectMotionResidual": "主体运动残差 (需SAM遮罩)",
    "ShotJSONMerge": "镜头JSON汇总落盘",
}
