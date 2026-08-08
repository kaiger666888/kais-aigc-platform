#!/usr/bin/env python3
"""
gen_costume_tr.py — 用选定 b2 灰底 TR 作 image2image 参考，生成 13 张服化道 Turnaround。

dreamina 5.0Pro i2i（非 4.6）。9:16 / 2k。每张最多重试 3 次（querying 死锁容错）。
输出到 turnaround_sheets/，覆盖同名旧 PNG。写 manifest.json 供注册脚本消费。

用法:
    python3 gen_costume_tr.py                 # 跑全部 13 张
    python3 gen_costume_tr.py --only shenzhiyi_banquet,shenmu_formal
"""
import argparse, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJ = 1785508691757
FS_BASE = f"/data/workspace/kais-aigc-platform/data/oss/{PROJ}/p04/turnaround_sheets"
REF_DIR = f"{FS_BASE}/batch2"
OUT_DIR = FS_BASE
MODEL = "5.0Pro"
RATIO = "9:16"
WORKERS = 3
POLL_SEC = 300          # 单次 dreamina --poll 等待
CMD_TIMEOUT = POLL_SEC + 90
MAX_RETRY = 3
MANIFEST = os.path.join(OUT_DIR, "manifest_costume.json")

# cid -> 选定的 b2 参考文件
REF_FILE = {
    "shenzhiyi":     "base_turnaround_shenzhiyi_b2_3.png",
    "luyanzhou":     "base_turnaround_luyanzhou_b2_3.png",
    "shenzhiyao":    "base_turnaround_shenzhiyao_b2_3.png",
    "chengyu":       "base_turnaround_chengyu_b2_1.png",
    "shenzhengbang": "base_turnaround_shenzhengbang_b2_2.png",
    "guhongyuan":    "base_turnaround_guhongyuan_b2_3.png",
    "wangjianmin":   "base_turnaround_wangjianmin_b2_2.png",
    "zhoulin":       "base_turnaround_zhoulin_b2_3.png",
    "shenmiren":     "base_turnaround_shenmiren_b2_1.png",
    "shenmu":        "base_turnaround_shenmu_b2_1.png",
}

# cid -> 英文角色 brief
BRIEF = {
    "shenzhiyi":     "22-year-old East Asian woman, black long straight hair, almond eyes, slim face",
    "luyanzhou":     "26-year-old East Asian man, side-parted black hair, sharp facial features, tall ~185cm",
    "shenzhiyao":    "21-year-old East Asian woman, chestnut wavy long hair, round face, petite",
    "chengyu":       "25-year-old East Asian man, black short textured hair, angular face, lean ~180cm",
    "shenzhengbang": "58-year-old East Asian man, gray short hair, stern face, heavy build",
    "guhongyuan":    "62-year-old East Asian man, white hair, deep facial contours, sharp eagle eyes",
    "wangjianmin":   "50-year-old East Asian man, round face slightly chubby, deep smile lines",
    "zhoulin":       "40-year-old East Asian woman, black shoulder-length hair, elegant makeup",
    "shenmiren":     "35-year-old East Asian man, cold sharp features, short black messy hair",
    "shenmu":        "48-year-old East Asian woman, black hair in low bun, gentle face with fine wrinkles",
}

# 13 张服化道任务: key, cid, costume_cn, costume_en, out_file
TASKS = [
    ("shenzhiyi_banquet",     "shenzhiyi",     "宴会",  "silver-white mermaid gown, silver high heels, pearl earrings"),
    ("shenzhiyi_daily",       "shenzhiyi",     "日常",  "simple white blouse with black wide-leg trousers, light natural makeup"),
    ("luyanzhou_formal",      "luyanzhou",     "正装",  "dark navy custom three-piece suit, white dress shirt, dark patterned tie"),
    ("shenzhiyao_casual",     "shenzhiyao",    "休闲",  "light pink lace dress, nude 10cm stiletto heels"),
    ("shenzhengbang_formal",  "shenzhengbang", "正装",  "dark navy Zhongshan suit (Mao suit)"),
    ("chengyu_work",          "chengyu",       "职场",  "dark cotton shirt with khaki trousers"),
    ("chengyu_home_a",        "chengyu",       "居家A", "simple gray cotton loungewear"),
    ("chengyu_home_b",        "chengyu",       "居家B", "white T-shirt with dark blue sweatpants"),
    ("guhongyuan_formal",     "guhongyuan",    "正装",  "black custom suit, silver-gray tie"),
    ("wangjianmin_formal",    "wangjianmin",   "正装",  "dark gray business suit, white shirt"),
    ("zhoulin_formal",        "zhoulin",       "正装",  "dark blue professional suit dress"),
    ("shenmiren_formal",      "shenmiren",     "正装",  "black turtleneck sweater, black long trench coat, black leather gloves"),
    ("shenmu_formal",         "shenmu",        "正装",  "elegant dark gray qipao (cheongsam), pearl earrings, jade bracelet"),
]

PROMPT_TPL = (
    "Character turnaround reference sheet, keep the same 2x2 four-panel grid layout "
    "as the reference image. Same person, same face, same body proportions. "
    "Change clothing to: {costume}. "
    "{brief}. Clean light gray background. "
    "Cinematic quality, photorealistic. "
    "Full body from head to toe, shoes visible."
)


def run(cmd, timeout):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "[timeout]"


def download(url, out_path):
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    # aria2c 静默覆盖
    code, out = run(["aria2c", url, "-d", os.path.dirname(out_path) or ".",
                     "-o", os.path.basename(out_path), "--auto-file-renaming=false",
                     "--allow-overwrite=true"], timeout=60)
    return os.path.exists(out_path) and os.path.getsize(out_path) > 20480


def gen_one(key, cid, costume_cn, costume_en):
    ref = os.path.join(REF_DIR, REF_FILE[cid])
    out_file = os.path.join(OUT_DIR, f"turnaround_{key}.png")
    brief = BRIEF[cid]
    prompt = PROMPT_TPL.format(costume=costume_en, brief=brief)

    if not os.path.exists(ref):
        return {"key": key, "status": "error", "error": f"ref missing: {ref}"}

    last_err = ""
    for attempt in range(1, MAX_RETRY + 1):
        print(f"[{key}] attempt {attempt}/{MAX_RETRY} submitting (5.0Pro i2i)...", flush=True)
        code, out = run([
            "dreamina", "image2image",
            f"--images={ref}",
            f"--prompt={prompt}",
            f"--ratio={RATIO}",
            "--resolution_type=2k",
            f"--model_version={MODEL}",
            f"--poll={POLL_SEC}",
        ], timeout=CMD_TIMEOUT)

        data = None
        try:
            data = json.loads(out.strip().splitlines()[-1] if out.strip() else "{}")
        except Exception:
            # 多行时尝试整体解析
            try:
                data = json.loads(out)
            except Exception:
                data = None

        if not data:
            last_err = f"non-json (rc={code}): {out[:200]}"
            print(f"[{key}]   -> {last_err}", flush=True)
            time.sleep(5)
            continue

        status = data.get("gen_status")
        if status == "success":
            imgs = data.get("result_json", {}).get("images", [])
            if not imgs:
                last_err = "success but no images"
                continue
            url = imgs[0].get("image_url", "")
            if not url:
                last_err = "no image_url"
                continue
            print(f"[{key}]   downloading...", flush=True)
            if download(url, out_file):
                sz = os.path.getsize(out_file)
                print(f"[{key}] OK {out_file} ({sz//1024}KB)", flush=True)
                return {"key": key, "status": "ok", "path": out_file, "size_kb": sz // 1024,
                        "prompt": prompt, "model": MODEL, "submit_id": data.get("submit_id")}
            last_err = "download failed"
            continue
        # 仍在 querying / queue 中
        last_err = f"gen_status={status}"
        print(f"[{key}]   -> {last_err}, retrying...", flush=True)
        time.sleep(8)

    print(f"[{key}] FAILED after {MAX_RETRY}: {last_err}", flush=True)
    return {"key": key, "status": "error", "error": last_err, "prompt": prompt}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma-separated keys to run (default: all)")
    ap.add_argument("--workers", type=int, default=WORKERS)
    args = ap.parse_args()

    tasks = TASKS
    if args.only:
        want = {s.strip() for s in args.only.split(",") if s.strip()}
        tasks = [t for t in TASKS if t[0] in want]
        if not tasks:
            print(f"no tasks match --only {args.only}"); sys.exit(1)

    print(f"Generating {len(tasks)} costume TRs, {args.workers} workers, model={MODEL}")
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(gen_one, *t): t[0] for t in tasks}
        for fut in as_completed(futs):
            try:
                results.append(fut.result())
            except Exception as e:
                results.append({"key": futs[fut], "status": "error", "error": str(e)})

    with open(MANIFEST, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    ok = sum(1 for r in results if r["status"] == "ok")
    fail = [r["key"] for r in results if r["status"] != "ok"]
    print(f"\n{'='*60}\nDone: {ok} ok, {len(fail)} failed{'' if not fail else f' -> {fail}'}")
    print(f"Manifest: {MANIFEST}")
    sys.exit(0 if not fail else 2)


if __name__ == "__main__":
    main()
