#!/usr/bin/env python3
"""Text-Guard PATROL 汇总: JSONL → patrol_report.md + fix_queue.csv.

可对已有 jsonl 单独重跑, 不必重巡:
  python3 scripts/textguard_patrol_report.py --jsonl patrol_out/patrol_results.jsonl

语义:
  - 同图多行 (断点续跑 error 行被后续 ok 行补跑覆盖) 取最后一次出现为准.
  - suspect 判层只按 sidecar 下发的 verdict (conf < SUSPECT_CONF=0.85),
    本脚本不做语义判读; ok 但语义可疑的内容归人工/vision 后续批.
  - fix_queue.csv 仅含 suspect 条目, 是后续 /fix 的直接输入:
    expect_text (期望正字) 需 operator/vision 定夺后补齐再调 /fix.
"""
import argparse
import csv
import json
import os
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
DEFAULT_JSONL = os.path.join(REPO_ROOT, "patrol_out", "patrol_results.jsonl")
REPORT_NAME = "patrol_report.md"
QUEUE_NAME = "fix_queue.csv"
TOP_N = 20


def load_latest(jsonl_path):
    """→ (latest_by_image{path: rec}, n_lines, n_malformed). 同图取最后一行."""
    latest, n_lines, n_bad = {}, 0, 0
    with open(jsonl_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            n_lines += 1
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                n_bad += 1
                continue
            path = rec.get("image_path")
            if path:
                latest[path] = rec
    return latest, n_lines, n_bad


def rel_oss(path):
    for prefix in ("/data/workspace/kais-aigc-platform/data/oss/",
                   "/data/workspace/kais-aigc-platform/data/oss"):
        if path.startswith(prefix):
            return path[len(prefix):]
    return path


def _box(b):
    return "[" + ",".join(str(int(v)) for v in b) + "]" if b else "-"


def build_report(jsonl_path, out_dir):
    """生成 md + csv, → (md_path, csv_path). 供本脚本 main 与巡检脚本复用."""
    latest, n_lines, n_bad = load_latest(jsonl_path)
    recs = sorted(latest.values(), key=lambda r: r.get("image_path") or "")

    ok_recs = [r for r in recs if r.get("status") == "ok"]
    err_recs = [r for r in recs if r.get("status") != "ok"]
    sus_imgs = [r for r in ok_recs if r.get("suspect_count", 0) > 0]
    total_sus = sum(r.get("suspect_count", 0) for r in ok_recs)
    total_findings = sum(r.get("findings_count", 0) for r in ok_recs)
    elapsed = sum(r.get("elapsed_s") or 0 for r in ok_recs)

    # ---- fix_queue.csv (suspect 全量, /fix 队列直接输入)
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, QUEUE_NAME)
    with open(csv_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["image_path", "box", "text", "conf"])
        for r in ok_recs:
            for s in sorted(r.get("suspects") or [], key=lambda x: x.get("conf", 0)):
                w.writerow([r["image_path"], _box(s.get("box")),
                            s.get("text", ""), s.get("conf", 0)])

    # ---- patrol_report.md
    md_path = os.path.join(out_dir, REPORT_NAME)
    L = []
    L.append("# Text-Guard PATROL 巡检报告\n")
    L.append(f"- 生成时间: {datetime.now().isoformat(timespec='seconds')}")
    L.append(f"- 数据源: `{jsonl_path}` ({n_lines} 行, 坏行 {n_bad}, 去重后 {len(recs)} 图)")
    L.append("- 判层口径: sidecar verdict (conf < 0.85 = suspect); 语义判读不在自动巡检范围\n")
    L.append("## 概览\n")
    L.append("| 指标 | 值 |")
    L.append("| --- | --- |")
    L.append(f"| 已巡图 (ok) | {len(ok_recs)} |")
    L.append(f"| 巡检失败图 (error) | {len(err_recs)} |")
    L.append(f"| findings 总数 | {total_findings} |")
    L.append(f"| suspect 条目总数 | {total_sus} |")
    L.append(f"| 含 suspect 的图 | {len(sus_imgs)} |")
    L.append(f"| 全净图 (0 suspect) | {len(ok_recs) - len(sus_imgs)} |")
    L.append(f"| 累计 OCR 耗时 | {elapsed:.0f}s |\n")

    if sus_imgs:
        L.append("## Suspect 图 Top%d (按 suspect_count 降序)\n" % TOP_N)
        L.append("| # | 图 | sus | findings | 最可疑 top3 (text@conf) |")
        L.append("| --- | --- | --- | --- | --- |")
        top = sorted(sus_imgs, key=lambda r: (-r.get("suspect_count", 0),
                                              r.get("image_path") or ""))
        for i, r in enumerate(top[:TOP_N], 1):
            tops = " ; ".join(f"{s.get('text','')}@{s.get('conf',0):.2f}"
                              for s in (r.get("top_suspects") or [])) or "-"
            L.append(f"| {i} | `{rel_oss(r['image_path'])}` "
                     f"| {r.get('suspect_count',0)} | {r.get('findings_count',0)} | {tops} |")
        L.append("")

    if err_recs:
        L.append("## 巡检失败明细 (重跑自动补)\n")
        L.append("| 图 | 错误 |")
        L.append("| --- | --- |")
        for r in err_recs:
            L.append(f"| `{rel_oss(r.get('image_path') or '')}` | {r.get('error','')} |")
        L.append("")

    if total_sus:
        L.append("## 全 suspect 明细 (人工复核 / vision 批输入)\n")
        L.append("| 图 | box | text | conf |")
        L.append("| --- | --- | --- | --- |")
        for r in ok_recs:
            for s in sorted(r.get("suspects") or [], key=lambda x: x.get("conf", 0)):
                text = str(s.get("text", "")).replace("|", "\\|")
                L.append(f"| `{rel_oss(r['image_path'])}` | {_box(s.get('box'))} "
                         f"| {text} | {s.get('conf',0):.3f} |")
        L.append("")
        L.append(f"> fix_queue.csv 已落 `{csv_path}` "
                 f"({total_sus} 条) — 补齐 expect_text (期望正字, operator/vision 定夺) "
                 f"后逐条调 /fix.\n")
    elif ok_recs:
        L.append("## Suspect 明细\n\n(无 suspect 条目)\n")

    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    return md_path, csv_path


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--jsonl", default=DEFAULT_JSONL)
    ap.add_argument("--out-dir", default=None,
                    help="默认与 jsonl 同目录")
    args = ap.parse_args()
    if not os.path.isfile(args.jsonl):
        print(f"jsonl 不存在: {args.jsonl}", file=sys.stderr)
        return 2
    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.jsonl))
    md, csv_path = build_report(args.jsonl, out_dir)
    print(f"report: {md}")
    print(f"queue : {csv_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
