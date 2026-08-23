#!/usr/bin/env python3
"""
gen_storyboard_sheets.py — 白模分镜板（clay-render maquette storyboard）整图生成。

按场景（scene）分组 shot-list，每个场景拆成 ≤ max-panels 格的 sheet，用 dreamina
4.6 image2image 生成「灰色泥塑白模」风格的多格分镜板整图。参考图三件套：
  1. Pillow 生成的网格模板（布局/格数/编号）
  2. 场景 front 图（环境）
  3. 角色 turnaround 图（外貌）

prompt 从 shot-list 的 start_frame_description 简化（只留景别+位置+动作/道具），
结构遵循 v5 验证通过的模板（开头风格 → 逐图 REFERENCE 说明 → 逐格 Panel → 统一约束）。

幂等：每张 sheet 的 source_hash（shot_id+景别+blocking+场景图+turnaround）落 manifest，
未变则跳过。degrade-tolerant：dreamina 不可用 / 失败 → warn + 写空 slot + 不阻塞。

用法:
    python3 gen_storyboard_sheets.py --episode-dir <episode_root>
    python3 gen_storyboard_sheets.py --episode-dir <root> --only 1,4,7      # 只跑场景 1/4/7
    python3 gen_storyboard_sheets.py --episode-dir <root> --force            # 忽略 hash 重跑

输入（episode_dir 下）:
    .pipeline-assets/shot-list.json   # {schema_version, value:[shot,...]}
    assets/S07/S{NN}_front.png        # 场景图（shot.scene_ref 直接给路径）
    assets/turnaround_sheets/*.png    # 角色 turnaround（character_refs.turnaround_path）

输出:
    {out_dir}/storyboard_sheet_S{NN}_{idx}.png   # 每张白模分镜板整图
    {out_dir}/manifest_storyboard.json           # 供 P09c phase / 注册脚本消费
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile, time
from concurrent.futures import ThreadPoolExecutor, as_completed

MODEL = "4.6"  # i2i 一律 4.6（Kai 08-06 规定）；2026-08-19 起全管线取消 5.0Pro
RATIO = "9:16"
RESOLUTION = "2k"          # 1440×2560 portrait
WORKERS = 2
MAX_PANELS = 6
POLL_SEC = 300             # 单次 dreamina --poll 等待
CMD_TIMEOUT = POLL_SEC + 90
MAX_RETRY = 3
MAX_TURNAROUND_REFS = 3    # --images 上限：模板 + 场景 + ≤3 turnaround，避免 prompt 过载
SHEET_W, SHEET_H = 1440, 2560   # 与 v5 验证图一致（9:16 / 2k）

# 英文景别 → 面板内可读描述
SHOT_SCALE = {
    "WS": "wide shot", "FS": "full shot", "MS": "medium shot",
    "MCU": "medium close-up", "CU": "close-up", "BCU": "big close-up",
    "INSERT": "insert shot",
}

POS_LABELS = {   # 2 列网格的位置命名（行×列）
    (0, 0): "top-left", (0, 1): "top-right",
    (1, 0): "middle-left", (1, 1): "middle-right",
    (2, 0): "bottom-left", (2, 1): "bottom-right",
}


def scene_ordinal(val):
    """与 p09_shot_breakdown 一致的场景序号抽取：S01/S1/S10/s01 → 1/1/10。"""
    m = re.search(r"S0*(\d+)", str(val or ""), re.IGNORECASE)
    return int(m.group(1)) if m else None


def grid_layout(n):
    """n 格 → (cols, rows)。≤6 格统一用 2 列。"""
    if n <= 1:
        return 1, 1
    cols = 2
    rows = (n + cols - 1) // cols
    return cols, rows


def pos_name(idx, cols):
    """第 idx 格（0-base）在 cols 列网格里的英文位置名。"""
    r, c = divmod(idx, cols)
    return POS_LABELS.get((r, c)) or f"row {r + 1} col {c + 1}"


def simplify_blocking(desc):
    """从 start_frame_description 抽简洁 blocking：首句 + 截断 + 去符号噪音。"""
    if not desc:
        return "establishing frame"
    s = str(desc).strip()
    # 取首个断句（中英文标点）
    for sep in ("。", "；", "，", ". ", "; ", ", "):
        if sep in s:
            s = s.split(sep, 1)[0]
            break
    s = re.sub(r"[\s]+", " ", s).strip(" ，,。；;.:：")
    return (s[:120] + "…") if len(s) > 120 else s


# ── Pillow 网格模板 ──────────────────────────────────────────────────────────
def render_grid_template(shots, out_path):
    """生成 9:16 网格占位模板：N 个带编号/shot_id/景别的灰色单元格。"""
    from PIL import Image, ImageDraw, ImageFont

    n = len(shots)
    cols, rows = grid_layout(n)
    margin = 40
    gap = 24
    cell_w = (SHEET_W - margin * 2 - gap * (cols - 1)) // cols
    cell_h = (SHEET_H - margin * 2 - gap * (rows - 1)) // rows

    img = Image.new("RGB", (SHEET_W, SHEET_H), (245, 245, 245))
    draw = ImageDraw.Draw(img)
    try:
        font_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
    except Exception:
        font_lg = ImageFont.load_default()
        font_sm = ImageFont.load_default()

    for i, sh in enumerate(shots):
        r, c = divmod(i, cols)
        x0 = margin + c * (cell_w + gap)
        y0 = margin + r * (cell_h + gap)
        x1, y1 = x0 + cell_w, y0 + cell_h
        draw.rectangle([x0, y0, x1, y1], fill=(220, 220, 220), outline=(90, 90, 90), width=4)
        sid = str(sh.get("shot_id", f"P{i + 1}"))
        scale = SHOT_SCALE.get(str(sh.get("shot_type", "")).upper(), "shot")
        draw.text((x0 + 24, y0 + 20), f"{i + 1}", fill=(60, 60, 60), font=font_lg)
        draw.text((x0 + 24, y0 + 90), sid, fill=(40, 40, 40), font=font_sm)
        draw.text((x0 + 24, y0 + 130), scale, fill=(80, 80, 80), font=font_sm)

    img.save(out_path)
    return out_path


# ── prompt 构建（v5 验证模板） ────────────────────────────────────────────────
def build_prompt(sheet, scene_ref_name, turnaround_names, cols, rows):
    """v5 结构：风格 → REFERENCE 逐图 → 逐格 Panel → 统一约束。"""
    shots = sheet["shots"]
    parts = []
    parts.append(
        "Clay render maquette storyboard sheet. Gray clay / plasticine maquette figures, "
        "soft diffused studio lighting, smooth matte neutral light-gray background, "
        "minimalist toy-diorama aesthetic, no fine facial details, no textures. "
        f"A {rows}x{cols} grid of {len(shots)} sequential storyboard panels, same scene, 9:16 portrait."
    )

    parts.append("REFERENCE IMAGES (input order):")
    parts.append(
        "- Layout template: follow this exact grid layout, panel count, and numbering. "
        "Keep each panel a clean rectangle with thin separators."
    )
    if scene_ref_name:
        parts.append(
            f"- Scene reference ({scene_ref_name}): the environment / setting. "
            "Recreate this location and atmosphere as a clay diorama. Do NOT copy characters from it."
        )
    if turnaround_names:
        for tn in turnaround_names:
            parts.append(
                f"- Character turnaround ({tn}): the figure(s)' body proportions, hairstyle, "
                "and costume silhouette. Render them as simplified clay maquettes — no photo detail."
            )

    parts.append("PANELS (numbered, left-to-right top-to-bottom):")
    for i, sh in enumerate(shots):
        scale = SHOT_SCALE.get(str(sh.get("shot_type", "")).upper(), "shot")
        pos = pos_name(i, cols)
        blocking = simplify_blocking(sh.get("start_frame_description"))
        chars = ", ".join(c.get("name", "") for c in sh.get("character_refs", []) if c.get("name"))
        char_clause = f" featuring {chars}" if chars else ""
        parts.append(f"- Panel {i + 1} ({pos}): {scale}{char_clause}; {blocking}.")

    parts.append(
        "CONSTRAINT: ALL panels share the SAME scene/environment, consistent clay-maquette style, "
        "uniform gray material, and consistent character silhouettes & screen direction. "
        "Storyboard layout, not a single illustration."
    )
    return "\n".join(parts)


# ── dreamina 子进程（镜像 gen_costume_tr.py） ────────────────────────────────
def _sh(cmd, timeout):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError:
        # dreamina CLI 不在 PATH —— degrade-tolerant 的核心信号
        return 127, "[dreamina not found]"
    except subprocess.TimeoutExpired:
        return 124, "[timeout]"


def download(url, out_path):
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    code, _ = _sh([
        "aria2c", url, "-d", os.path.dirname(out_path) or ".",
        "-o", os.path.basename(out_path), "--auto-file-renaming=false",
        "--allow-overwrite=true",
    ], timeout=60)
    return os.path.exists(out_path) and os.path.getsize(out_path) > 20480


def dreamina_i2i(images, prompt, out_file):
    """单张 sheet 生成；返回 (ok: bool, info: dict)。"""
    if not images:
        return False, {"error": "no reference images"}
    last_err = ""
    for attempt in range(1, MAX_RETRY + 1):
        print(f"  attempt {attempt}/{MAX_RETRY} submitting ({MODEL} i2i, {len(images)} refs)...", flush=True)
        cmd = ["dreamina", "image2image",
               f"--prompt={prompt}",
               f"--ratio={RATIO}",
               f"--resolution_type={RESOLUTION}",
               f"--model_version={MODEL}",
               f"--poll={POLL_SEC}"]
        for im in images:
            cmd.append(f"--images={im}")

        code, out = _sh(cmd, timeout=CMD_TIMEOUT)
        data = None
        try:
            data = json.loads(out.strip().splitlines()[-1] if out.strip() else "{}")
        except Exception:
            try:
                data = json.loads(out)
            except Exception:
                data = None

        if data is None:
            # dreamina 不可用（code 127）→ 直接放弃重试，degrade
            if code == 127:
                return False, {"error": "dreamina CLI not found", "fatal": True}
            last_err = f"non-json (rc={code}): {out[:160]}"
            time.sleep(5)
            continue

        if data.get("gen_status") == "success":
            imgs = data.get("result_json", {}).get("images", [])
            if imgs and imgs[0].get("image_url"):
                if download(imgs[0]["image_url"], out_file):
                    return True, {"path": out_file, "size_kb": os.path.getsize(out_file) // 1024,
                                  "submit_id": data.get("submit_id")}
            last_err = "success but no usable image"
            continue
        last_err = f"gen_status={data.get('gen_status')}"
        time.sleep(8)

    return False, {"error": last_err}


# ── 主流程 ────────────────────────────────────────────────────────────────────
def load_shot_list(path):
    with open(path) as f:
        raw = json.load(f)
    shots = raw["value"] if isinstance(raw, dict) and isinstance(raw.get("value"), list) else raw
    if not isinstance(shots, list):
        raise SystemExit(f"shot-list has no .value array: {path}")
    return shots


def group_by_scene(shots):
    """按 scene_ordinal(shot_id) 分组，场景内保持原顺序；无 scene 的归到 None。"""
    groups = {}
    order = []   # 保序的场景键
    for sh in shots:
        ord_ = scene_ordinal(sh.get("shot_id")) or scene_ordinal(sh.get("scene_ref"))
        key = ord_ if ord_ is not None else 0   # 0 = 兜底未分组
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(sh)
    return [(k, groups[k]) for k in sorted(order)]


def collect_refs(scene_shots, episode_dir):
    """选场景 front 图（优先含 front 的 scene_ref）+ 去重 turnaround 路径。"""
    front = None
    for sh in scene_shots:
        sr = sh.get("scene_ref")
        if not sr:
            continue
        cand = os.path.join(episode_dir, sr)
        if os.path.isfile(cand) and (front is None or "front" in sr.lower()):
            front = cand
            if "front" in sr.lower():
                break

    tn_seen, turnarounds = set(), []
    for sh in scene_shots:
        for c in sh.get("character_refs", []) or []:
            tp = c.get("turnaround_path")
            if not tp:
                continue
            cand = os.path.join(episode_dir, tp)
            if os.path.isfile(cand) and tp not in tn_seen:
                tn_seen.add(tp)
                turnarounds.append(cand)
    return front, turnarounds[:MAX_TURNAROUND_REFS]


def source_hash(sheet, front, turnarounds):
    h = hashlib.sha1()
    for sh in sheet["shots"]:
        h.update(str(sh.get("shot_id", "")).encode())
        h.update(b"|")
        h.update(str(sh.get("shot_type", "")).encode())
        h.update(b"|")
        h.update(str(sh.get("start_frame_description", "")).encode())
        h.update(b"\n")
    h.update((front or "").encode())
    for tn in turnarounds:
        try:
            h.update(str(os.path.getmtime(tn)).encode())
        except OSError:
            pass
    return h.hexdigest()[:16]


def gen_sheet(sheet, episode_dir, out_dir, manifest_by_key, force):
    """生成一张 sheet；degrade-tolerant：失败写 degraded 条目，永不抛。"""
    scene_key = sheet["scene_key"]
    tag = f"S{sheet['scene_label']}_p{sheet['page']}"
    out_file = os.path.join(out_dir, f"storyboard_sheet_{tag}.png")

    front, turnarounds = collect_refs(sheet["shots"], episode_dir)
    sh = source_hash(sheet, front, turnarounds)

    prev = manifest_by_key.get(tag)
    if not force and prev and prev.get("source_hash") == sh and os.path.isfile(out_file):
        print(f"[{tag}] skip (source_hash unchanged)")
        return {**prev, "status": "skip"}

    cols, rows = grid_layout(len(sheet["shots"]))
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False, dir=out_dir)
    tmp.close()
    try:
        render_grid_template(sheet["shots"], tmp.name)
        prompt = build_prompt(
            sheet,
            scene_ref_name=os.path.basename(front) if front else None,
            turnaround_names=[os.path.basename(t) for t in turnarounds],
            cols=cols, rows=rows,
        )
        images = [tmp.name] + ([front] if front else []) + turnarounds
        ok, info = dreamina_i2i(images, prompt, out_file)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass

    entry = {
        "sheet": tag, "scene_key": scene_key, "page": sheet["page"],
        "panel_count": len(sheet["shots"]), "shot_ids": [s.get("shot_id") for s in sheet["shots"]],
        "source_hash": sh, "model": MODEL, "ratio": RATIO,
        "prompt": prompt if (ok or not force) else (info.get("error") and prompt),
    }
    if ok:
        entry.update({"status": "ok", "path": info["path"], "size_kb": info.get("size_kb"),
                      "submit_id": info.get("submit_id")})
        print(f"[{tag}] OK {out_file} ({entry['size_kb']}KB)")
    else:
        # degrade-tolerant：写空 slot，不阻塞
        entry.update({"status": "degraded", "path": None, "error": info.get("error")})
        flag = " (fatal — dreamina absent, aborting remaining retries)" if info.get("fatal") else ""
        print(f"[{tag}] DEGRADED: {info.get('error')}{flag}", flush=True)
    entry["_fatal"] = bool(info.get("fatal"))
    return entry


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--episode-dir", required=True, help="episode root (含 .pipeline-assets/ 与 assets/)")
    ap.add_argument("--shot-list", default="", help="覆盖 shot-list 路径（默认 {episode-dir}/.pipeline-assets/shot-list.json）")
    ap.add_argument("--out-dir", default="", help="输出目录（默认 {episode-dir}/assets/storyboard_sheets）")
    ap.add_argument("--only", default="", help="只跑这些场景序号（逗号分隔，如 1,4,7）")
    ap.add_argument("--max-panels", type=int, default=MAX_PANELS)
    ap.add_argument("--workers", type=int, default=WORKERS)
    ap.add_argument("--force", action="store_true", help="忽略 source_hash 强制重跑")
    args = ap.parse_args()

    episode_dir = os.path.abspath(args.episode_dir)
    shot_list_path = args.shot_list or os.path.join(episode_dir, ".pipeline-assets", "shot-list.json")
    out_dir = os.path.abspath(args.out_dir or os.path.join(episode_dir, "assets", "storyboard_sheets"))
    os.makedirs(out_dir, exist_ok=True)
    manifest_path = os.path.join(out_dir, "manifest_storyboard.json")

    if not os.path.isfile(shot_list_path):
        print(f"shot-list not found: {shot_list_path}", file=sys.stderr)
        sys.exit(1)

    shots = load_shot_list(shot_list_path)
    scenes = group_by_scene(shots)
    if args.only:
        want = {int(x) for x in re.findall(r"\d+", args.only)}
        scenes = [(k, v) for k, v in scenes if k in want]

    # 拆 sheet：每个场景 ≤ max-panels 格
    sheets = []
    for scene_key, scene_shots in scenes:
        label = f"{scene_key:02d}" if scene_key else "00"
        for page, i in enumerate(range(0, len(scene_shots), args.max_panels), start=1):
            chunk = scene_shots[i:i + args.max_panels]
            sheets.append({"scene_key": scene_key, "scene_label": label, "page": page,
                           "shots": chunk})

    # 载入旧 manifest 做幂等
    manifest_by_key = {}
    if os.path.isfile(manifest_path):
        try:
            with open(manifest_path) as f:
                for e in json.load(f):
                    if isinstance(e, dict) and e.get("sheet"):
                        manifest_by_key[e["sheet"]] = e
        except (OSError, ValueError):
            pass

    print(f"Generating {len(sheets)} storyboard sheet(s) from {len(shots)} shots "
          f"({len(scenes)} scenes), {args.workers} workers, model={MODEL}")
    results = []
    fatal_seen = False
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(gen_sheet, s, episode_dir, out_dir, manifest_by_key, args.force): s for s in sheets}
        for fut in as_completed(futs):
            s = futs[fut]
            try:
                entry = fut.result()
            except Exception as e:   # 任何意外都降级，不阻塞
                tag = f"S{s['scene_label']}_p{s['page']}"
                entry = {"sheet": tag, "status": "degraded", "path": None,
                         "error": f"exception: {e}", "source_hash": None}
                print(f"[{tag}] DEGRADED (exception): {e}", file=sys.stderr)
            results.append(entry)
            if entry.get("_fatal"):
                fatal_seen = True

    # 排序 + 落 manifest（去掉内部 _fatal 标记）
    results.sort(key=lambda e: (e.get("sheet") or ""))
    for e in results:
        e.pop("_fatal", None)
    with open(manifest_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    ok = sum(1 for r in results if r["status"] == "ok")
    skip = sum(1 for r in results if r["status"] == "skip")
    degraded = [r["sheet"] for r in results if r["status"] == "degraded"]
    print(f"\n{'=' * 60}\nDone: {ok} ok, {skip} skipped, {len(degraded)} degraded"
          f"{'' if not degraded else f' -> {degraded}'}")
    print(f"Manifest: {manifest_path}")
    if fatal_seen:
        print("NOTE: dreamina CLI was absent — all sheets degraded. Install dreamina to generate.")
    # degrade-tolerant：degraded 不算失败（exit 0），只有 shot-list 缺失才 exit 1（上面已处理）
    sys.exit(0)


if __name__ == "__main__":
    main()
