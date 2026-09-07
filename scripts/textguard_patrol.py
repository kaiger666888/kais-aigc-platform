#!/usr/bin/env python3
"""Text-Guard PATROL: 存量资产批量 /check 巡检 (detect-only, 只读).

对 KAP OSS 存量 episode 的 P07 场景图 + P04 turnaround 批量调 text-guard
sidecar /check (无 expect 表 → findings = 图上实际读到的全部文字块),
结果落 JSONL 断点续跑, 汇总由 scripts/textguard_patrol_report.py 生成
(本脚本结束时也会自动触发一次汇总).

纪律:
  - 只调 /check + /health, 禁碰 /fix; 不改 OSS 任何文件, 不写 KAP DB.
  - sidecar /check 与 /fix 共享一把串行锁: /fix 长跑 (单轮可达 1800s) 期间
    本脚本的请求会在 ThreadingHTTPServer 排队, 客户端 120s 超时先到 →
    记失败 → 重试 1 次 → 仍败记 error 行继续下一张 (下次运行时 error 行
    不算已巡, 会自动补跑).
  - ocr=false 或 sidecar 不可达: 每 60s 轮询 /health, 单次等待上限 30min,
    超限中止留断点.

用法:
  python3 scripts/textguard_patrol.py                 # 全量巡检 (断点续跑)
  python3 scripts/textguard_patrol.py --smoke 3       # 冒烟: 主力集 p07/scene_refs 前 3 张
  python3 scripts/textguard_patrol.py --limit 20      # 只巡前 20 张 (调试)

冒烟语义: 忽略断点续跑, 每次真打 N 张 /check (自证端到端); 结果同样落 jsonl,
同图多行由汇总脚本取最后一次为准.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib import error as urlerror
from urllib import request as urlrequest

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)

DEFAULT_OSS_ROOT = "/data/workspace/kais-aigc-platform/data/oss"
DEFAULT_BASE_URL = "http://127.0.0.1:5120"
DEFAULT_OUT_DIR = os.path.join(REPO_ROOT, "patrol_out")
RESULTS_NAME = "patrol_results.jsonl"

PER_IMAGE_TIMEOUT_S = 120     # 单图 /check 超时 (含锁排队等待)
RETRY_AFTER_FAIL = 1          # 失败重试次数
RETRY_BACKOFF_S = 5           # 重试前静默 (避热循环)
HEALTH_POLL_INTERVAL_S = 60   # ocr=false 轮询周期
HEALTH_WAIT_CAP_S = 30 * 60   # 单次 health 等待上限 (超限中止留断点)
SCAN_MAX_DEPTH = 5            # p04/turnaround_sheets/batch*/ 文件在第 5 层
EPISODE_RE = re.compile(r"^178\d+$")   # 只取 178* episode 目录
SMOKE_SCOPE = ("1785508691757", "p07", "scene_refs")

EXIT_OK, EXIT_USAGE, EXIT_ABORTED = 0, 2, 3


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- sidecar IO

def _post(base_url, path, payload, timeout_s):
    req = urlrequest.Request(
        base_url.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlrequest.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read().decode("utf-8"))


def health(base_url, timeout_s=10):
    """→ (reachable, ocr). /health 免锁, 任何异常视为不可达."""
    try:
        req = urlrequest.Request(base_url.rstrip("/") + "/health", method="GET")
        with urlrequest.urlopen(req, timeout=timeout_s) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return True, bool((data.get("data") or {}).get("ocr"))
    except Exception:
        return False, False


def wait_for_ocr(base_url, cap_s, reason):
    """ocr=false / 不可达时轮询等待; 超限返回 False (调用方中止留断点)."""
    deadline = time.monotonic() + cap_s
    log(f"health 等待 ({reason}): 每 {HEALTH_POLL_INTERVAL_S}s 轮询, 上限 {cap_s // 60}min")
    while time.monotonic() < deadline:
        time.sleep(min(HEALTH_POLL_INTERVAL_S, max(1, deadline - time.monotonic())))
        ok, ocr = health(base_url)
        if ok and ocr:
            log("health 恢复 (ocr=true), 继续")
            return True
        log(f"  仍未就绪 (reachable={ok}, ocr={ocr}), 剩余 {int(deadline - time.monotonic())}s")
    return False


def check_image(base_url, image_path):
    """单次 /check (no-expect). → (data, None) 或 (None, error_msg)."""
    try:
        env = _post(base_url, "/check", {"image_path": image_path}, PER_IMAGE_TIMEOUT_S)
        if env.get("code") != 200:
            return None, f"code={env.get('code')} message={env.get('message')}"
        return env.get("data") or {}, None
    except urlerror.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
            msg = body.get("message") or ""
        except Exception:
            msg = ""
        return None, f"HTTP {exc.code} {msg}".strip()
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"


# ------------------------------------------------------------------- scanning

def scan_images(oss_root):
    """oss_root 下 178* episode 的 p07/p04 png, 深度 ≤5, 路径序确定.

    深度口径: 文件相对 oss_root ≤5 层 (ep/p04/turnaround_sheets/batch2/x.png
    恰为 5) — 工单盘点 385 张与此吻合; 字面 -maxdepth 4 会漏 51 张 batch 子目录.
    """
    hits = []
    root_depth = oss_root.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(oss_root):
        here = dirpath.rstrip(os.sep).count(os.sep) - root_depth   # 目录相对深度
        rel_dir = os.path.relpath(dirpath, oss_root).split(os.sep)
        at_root = rel_dir == ["."]
        if not at_root and here >= SCAN_MAX_DEPTH:   # 再下钻文件深度必 >5
            dirnames[:] = []
            continue
        # 子树准入: 根(放行下钻) / 178* episode 层 / episode 下 p07·p04 子树
        in_episode = (not at_root) and bool(EPISODE_RE.match(rel_dir[0]))
        under_phase = any(c in ("p07", "p04") for c in rel_dir[1:])
        if not (at_root or (in_episode and (len(rel_dir) == 1 or under_phase))):
            dirnames[:] = []
            continue
        if under_phase:   # 只收 p07/p04 之下的 png (episode 根散落 png 不算)
            hits.extend(os.path.join(dirpath, n) for n in filenames if n.endswith(".png"))
    return sorted(hits)


# -------------------------------------------------------------------- results

class Results:
    """JSONL append-only; 断点续跑状态即本文件."""

    def __init__(self, path):
        self.path = path
        self.done_ok = set()      # 已巡 (status=ok) — error 行不算, 会补跑
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if rec.get("status") == "ok" and rec.get("image_path"):
                        self.done_ok.add(rec["image_path"])
        self.fh = open(path, "a", encoding="utf-8")

    def append(self, record):
        self.fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.fh.flush()

    def close(self):
        self.fh.close()


# ---------------------------------------------------------------------- patrol

def log(msg):
    print(f"[patrol {datetime.now().strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def run_patrol(args, targets, results):
    """串行逐图 /check → jsonl. 返回 (n_ok, n_error)."""
    n_ok = n_err = 0
    t_start = time.monotonic()
    for i, image_path in enumerate(targets, 1):
        t0 = time.monotonic()
        data, err = check_image(args.base_url, image_path)
        if data is None:
            # 失败后先探 health: 侧车重启/ocr=false 时等恢复再补那一次重试,
            # 避免把整段 run 打成 error 行; 等待超限 → 中止留断点
            ok, ocr = health(args.base_url)
            if not (ok and ocr):
                if not wait_for_ocr(args.base_url, HEALTH_WAIT_CAP_S,
                                    f"图 {i}/{len(targets)} 首试失败后 health 未就绪"):
                    log("health 等待超限, 中止 (断点已留存, 重跑自动续)")
                    return n_ok, n_err, True
                data, err = check_image(args.base_url, image_path)
            else:
                time.sleep(RETRY_BACKOFF_S)
                data, err = check_image(args.base_url, image_path)

        if data is None:
            n_err += 1
            results.append({"status": "error", "image_path": image_path,
                            "error": err, "attempts": 1 + RETRY_AFTER_FAIL,
                            "checked_at": now_iso()})
            log(f"[{i}/{len(targets)}] ERROR {err} — {image_path}")
            continue

        findings = data.get("findings") or []
        suspects = sorted(
            ({"text": f.get("text", ""), "conf": round(float(f.get("conf", 0.0)), 4),
              "box": f.get("box"), "verdict": f.get("verdict")}
             for f in findings if f.get("verdict") == "suspect"),
            key=lambda s: s["conf"])
        n_ok += 1
        results.append({
            "status": "ok",
            "image_path": image_path,
            "elapsed_s": round(time.monotonic() - t0, 2),
            "findings_count": len(findings),
            "suspect_count": len(suspects),
            "top_suspects": suspects[:3],
            "suspects": suspects,
            "checked_at": now_iso(),
        })
        log(f"[{i}/{len(targets)}] ok f={len(findings)} sus={len(suspects)} "
            f"{round(time.monotonic() - t0, 2)}s — {image_path}")
    return n_ok, n_err, False


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--oss-root", default=DEFAULT_OSS_ROOT)
    ap.add_argument("--base-url", default=DEFAULT_BASE_URL)
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--limit", type=int, default=0, help="只巡前 N 张 (0=不限)")
    ap.add_argument("--smoke", type=int, default=0, metavar="N",
                    help=f"冒烟: 只查 {'/'.join(SMOKE_SCOPE)} 前 N 张, 结果打印 stdout")
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    results_path = os.path.join(args.out_dir, RESULTS_NAME)

    ok, ocr = health(args.base_url)
    if not (ok and ocr):
        if not wait_for_ocr(args.base_url, HEALTH_WAIT_CAP_S,
                            f"启动探活 reachable={ok} ocr={ocr}"):
            log("health 等待超限, 中止 (未开始新巡检)")
            return EXIT_ABORTED

    targets = scan_images(args.oss_root)
    if args.smoke:   # 截断必须在巡检前 — 过滤只影响清单, 巡检循环不再二次裁剪
        prefix = os.path.join(args.oss_root, *SMOKE_SCOPE)
        targets = [p for p in targets if p.startswith(prefix + os.sep)][:args.smoke]
    if args.limit:
        targets = targets[:args.limit]

    results = Results(results_path)
    # 冒烟忽略断点 (每次真打, 自证端到端); 全量模式按 image_path 跳过已巡
    todo = targets if args.smoke else [p for p in targets if p not in results.done_ok]
    log(f"候选 {len(targets)} | 已巡 {len(results.done_ok & set(targets))} | 待巡 {len(todo)}"
        f" → {results_path}")

    n_ok = n_err = 0
    aborted = False
    try:
        n_ok, n_err, aborted = run_patrol(args, todo, results)
    except KeyboardInterrupt:
        aborted = True
        log("Ctrl-C: 中止, 断点已留存 (已完成的图重跑自动跳过)")
    finally:
        results.close()

    # 跑完(或中止)即出汇总 — 实现复用 report 脚本, 不另起一套
    sys.path.insert(0, SCRIPT_DIR)
    import textguard_patrol_report as rpt
    md, csv_path = rpt.build_report(results_path, args.out_dir)
    log(f"汇总已生成: {md} + {csv_path} | 本次 ok={n_ok} err={n_err}"
        + (" (中止留断点)" if aborted else ""))

    if args.smoke:
        print_smoke(results_path, targets)
    return EXIT_ABORTED if aborted else EXIT_OK


def print_smoke(results_path, smoke_paths):
    """冒烟实录: 从 jsonl 取本次 3 张的记录, 人类可读打印到 stdout."""
    want = set(smoke_paths)
    recs = []
    with open(results_path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("image_path") in want:
                recs.append(rec)          # 同图多行取最后 (见下)
    last = {}
    for rec in recs:
        last[rec["image_path"]] = rec
    print("\n===== SMOKE 实录 =====")
    for path in smoke_paths:
        rec = last.get(path)
        print(f"\n# {path}")
        if rec is None:
            print("  (无记录)")
        elif rec["status"] == "error":
            print(f"  ERROR: {rec['error']}")
        else:
            print(f"  findings={rec['findings_count']} suspect={rec['suspect_count']}")
            for f in rec.get("suspects", []):
                print(f"    [SUSPECT] conf={f['conf']:.3f} box={f['box']} text={f['text']!r}")
    print("\n=======================")


if __name__ == "__main__":
    sys.exit(main())
