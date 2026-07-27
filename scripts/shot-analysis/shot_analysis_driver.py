#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
shot_analysis_driver.py — 逐镜头运镜解构 driver (原型 / P3 种子)
================================================================
读取 shots.json,对每个镜头在 ComfyUI 里跑【几何层(ShotGeometryLK)】
+ 可选【语义层(AILab_QwenVL_Advanced)】+ 可选【主体层(SAM3+SubjectMotionResidual)】,
经 ShotJSONMerge 汇总落盘。

用法:
  python3 shot_analysis_driver.py --shots shots.json --video <container-visible-clip> \
      [--shot-id-range 1 3] [--semantic] [--subject] [--grid-n 20] [--fps 24]

ComfyUI server 默认 http://localhost:8188。落盘到 <output>/shot_analysis/<shot_id>.json。
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

SERVER = os.environ.get("COMFYUI_URL", "http://localhost:8188")

# QwenVL prompt 模板(v2: 锐化景别定义 + 显式教"看背景判相机运动")
SEMANTIC_PROMPT = (
    "你是摄影指导分析助手。这是同一镜头的采样帧。判断步骤:先看【背景是否整体位移】判断相机运动,"
    "再看主体。只输出一个JSON对象,禁止任何其他文字:\n"
    '{"shot_scale":"远景(人很小,环境为主)|全景(人物全身+环境)|中景(人物膝盖/腰部以上)|'
    '近景(人物胸部以上)|特写(面部或局部)|大特写 之一,按人物在画面占比判断",'
    '"camera_primitive":"看背景:背景整体左右平移=pan_left/pan_right,上下平移=tilt_up/tilt_down,'
    '径向放大缩小=zoom_in/zoom_out/dolly_in/dolly_out,弧线移动=arc_left/arc_right;若【背景静止、只有主体在动】则=static;'
    '画面持续跟随移动主体=follow;手持微晃=handheld 之一",'
    '"camera_speed":"slow|medium|fast",'
    '"subject_motion":"主体自身运动方向与方式(已扣除相机),不超过15字",'
    '"lens_feel":"wide|normal|telephoto",'
    '"lighting":"不超过3个关键词"}\n'
    "无法判断的字段填null。只描述画面真实发生的,不要推测。"
)


def build_prompt(video, shot, shot_id, fps, grid_n, do_semantic, do_subject,
                 frame_count=16, qwen_model="Qwen3-VL-8B-Instruct", quant="8-bit (Balanced)",
                 save_dir="/mnt/agents/output/gpu1/shot_analysis"):
    """构建单镜头分析工作流 (ComfyUI API prompt dict)。

    save_dir 传**绝对容器路径** —— 节点用 os.path.join(_OUT_DIR, save_dir, ...)，
    绝对 save_dir 会覆盖默认 _OUT_DIR，使输出落到主机挂载的可见存储。
    """
    start, end = float(shot["start_sec"]), float(shot["end_sec"])
    skip = int(round(start * fps))
    cap = max(2, int(round((end - start) * fps)))

    nodes = {}
    nodes["load"] = {
        "class_type": "VHS_LoadVideoPath",
        "inputs": {
            "video": video, "force_rate": 0.0, "custom_width": 0, "custom_height": 0,
            "frame_load_cap": cap, "skip_first_frames": skip, "select_every_nth": 1,
        },
    }
    nodes["geo"] = {
        "class_type": "ShotGeometryLK",
        "inputs": {"images": ["load", 0], "grid_n": grid_n},
    }
    nodes["viz_geo"] = {"class_type": "PreviewImage", "inputs": {"images": ["geo", 1]}}

    merge_inputs = {
        "shot_id": shot_id, "save_dir": save_dir,
        "geometry_json": ["geo", 0],
    }

    if do_semantic:
        # AILab_QwenVL_Advanced: API prompt 必须显式提供全部 required 输入(UI 默认不自动填)
        nodes["qwen"] = {
            "class_type": "AILab_QwenVL_Advanced",
            "inputs": {
                "model_name": qwen_model, "quantization": quant,
                "attention_mode": "auto", "use_torch_compile": False, "device": "auto",
                "preset_prompt": "🖼️ Detailed Description",   # custom_prompt 会完全覆盖它
                "custom_prompt": SEMANTIC_PROMPT,
                "max_tokens": 400, "temperature": 0.1, "top_p": 0.9,
                "num_beams": 1, "repetition_penalty": 1.2,
                "frame_count": 16, "keep_model_loaded": True, "seed": 1,
                "video": ["load", 0],            # 帧序列作为 video 输入
            },
        }
        merge_inputs["semantic_json"] = ["qwen", 0]

    if do_subject:
        # 主体层:SAM3 文本提示分割(逐帧,无需外部 loader) → masks → SubjectMotionResidual
        # SAM3Segment 自带模型加载,prompt 填主体描述
        nodes["sam"] = {
            "class_type": "SAM3Segment",
            "inputs": {
                "image": ["load", 0],
                # 风格化动画:通用 "main subject" 不接地气,用更具体的概念词 + 降阈值
                "prompt": "character, person, creature, animal, or figure",
                "output_mode": "Merged", "confidence_threshold": 0.25,
                "device": "GPU",
            },
        }
        nodes["subj"] = {
            "class_type": "SubjectMotionResidual",
            "inputs": {"images": ["load", 0], "masks": ["sam", 1], "grid_n": grid_n},
        }
        nodes["viz_subj"] = {"class_type": "PreviewImage", "inputs": {"images": ["subj", 1]}}
        merge_inputs["subject_json"] = ["subj", 0]

    nodes["merge"] = {"class_type": "ShotJSONMerge", "inputs": merge_inputs}
    return nodes


def queue_prompt(prompt):
    data = json.dumps({"prompt": prompt}).encode()
    req = urllib.request.Request(SERVER + "/prompt", data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=15).read())["prompt_id"]
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"queue failed HTTP {e.code}: {body[:800]}") from None


def wait_for(pid, timeout=600):
    """轮询 /history,返回该 prompt 的执行记录(含 status/errors)。"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        with urllib.request.urlopen(SERVER + f"/history/{pid}", timeout=15) as r:
            hist = json.load(r)
        if pid in hist:
            return hist[pid]
        time.sleep(2)
    raise TimeoutError(f"timeout waiting for {pid}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", required=True, help="shots.json path")
    ap.add_argument("--video", required=True, help="video path VISIBLE TO THE CONTAINER")
    ap.add_argument("--shot-id-range", nargs=2, type=int, metavar=("LO", "HI"),
                    help="only process shot ids in [LO, HI]")
    ap.add_argument("--semantic", action="store_true", help="enable QwenVL semantic layer")
    ap.add_argument("--subject", action="store_true", help="enable SAM3 subject layer")
    ap.add_argument("--grid-n", type=int, default=20)
    ap.add_argument("--fps", type=float, default=24.0)
    ap.add_argument("--qwen-model", default="Qwen3-VL-8B-Instruct")
    ap.add_argument("--quant", default="8-bit (Balanced)")
    args = ap.parse_args()

    shots = json.load(open(args.shots, encoding="utf-8"))
    if args.shot_id_range:
        lo, hi = args.shot_id_range
        shots = [s for s in shots if lo <= s["id"] <= hi]
    print(f"[driver] {len(shots)} shot(s) to process | semantic={args.semantic} subject={args.subject}")

    for s in shots:
        sid = f"shot_{s['id']:03d}"
        prompt = build_prompt(args.video, s, sid, args.fps, args.grid_n,
                              args.semantic, args.subject, qwen_model=args.qwen_model, quant=args.quant)
        try:
            pid = queue_prompt(prompt)
        except Exception as e:
            print(f"[driver] {sid}: QUEUE FAILED → {e}")
            continue
        try:
            rec = wait_for(pid)
        except TimeoutError as e:
            print(f"[driver] {sid}: TIMEOUT → {e}")
            continue
        status = rec.get("status", {})
        ok = status.get("completed", False) and not status.get("status_str", "").endswith("error")
        if status.get("status_str") == "error" or status.get("messages"):
            # surface execution errors
            errs = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
            print(f"[driver] {sid}: {'OK' if ok else 'ERROR'} prompt_id={pid}")
            if errs:
                print(f"        execution_error: {json.dumps(errs[0][1], ensure_ascii=False)[:500]}")
        else:
            print(f"[driver] {sid}: OK prompt_id={pid}")
    print("[driver] done")


if __name__ == "__main__":
    main()
