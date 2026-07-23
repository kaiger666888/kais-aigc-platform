#!/usr/bin/env python3
"""
[DEPRECATED — Phase 47 archive, 2026-07-16]
This script was a one-shot repair for the 2026-07-12 empty-shell
asset nodes. Phase 42 hardened the source-side contract; Phase 44
hardened the receiver-side import; re-running this on data that now
satisfies the contract is unnecessary and risks overwriting newer
descriptions with synthesized ones.

Phase 47 (2026-07-16) ran this against /data/workspace/kais-aigc-platform/data/db2.sqlite:
- 591 asset nodes repaired (328 description→prompt + 257 synthesize + 6 params.* flatten)
- 160 unrepairable (only `label` present; no signal to synthesize from)
- Pre-apply backup: data/db2-backup-pre-phase-47.sqlite (gitignored, 328MB)
- Audit trail: .planning/phases/47-historical-backfill-archival/{baseline-snapshot,apply-log,post-run-verify}.txt

Kept for audit/reproducibility. Do NOT add to cron. Do NOT run
against production data without explicit approval + DB backup.

See scripts/oneoffs/README.md for the one-off script convention.

---

backfill-asset-descriptions.py — one-shot repair for empty asset node details.

Background:
  689 asset nodes in canvas_nodes had data with only `label + assetType`.
  Root causes (now fixed in code):
    - import-from-dir didn't flatten item.params.* into data
    - import-from-dir didn't read .txt sidecars
    - Python manifest writer (sibling repo) didn't emit prompt/description
  This script mints usable prompt/description for legacy rows using
  whatever signals are present.

Operations per asset node (in priority order):
  1. If data.params exists, flatten scalars into data top-level (no overwrite).
  2. If data.prompt is empty but data.description is non-empty, mirror
     description → prompt.
  3. If data.description is empty but data.prompt is non-empty, mirror
     prompt → description.
  4. If both are empty, synthesize a description from the most useful
     provenance field (filename, name, output_key, archetype+role, scene_id).

USAGE:
  python3 scripts/backfill-asset-descriptions.py            # dry-run, prints stats
  python3 scripts/backfill-asset-descriptions.py --apply     # write to canvas_nodes

Does NOT touch non-asset nodes. Does NOT touch rows that already have both
prompt and description.
Archived to scripts/oneoffs/ during scripts-layer refactor, 2026-07-22.

"""
import argparse
import json
import sqlite3
import sys

DB_PATH = "/data/workspace/kais-aigc-platform/data/db2.sqlite"


def mint_description(data: dict) -> str | None:
    """Build a fallback description from whatever provenance fields exist."""
    parts = []
    archetype = data.get("archetype")
    role = data.get("role")
    if archetype and role:
        parts.append(f"{role}（{archetype}）")
    elif role:
        parts.append(str(role))
    elif archetype:
        parts.append(str(archetype))

    scene_id = data.get("scene_id")
    if scene_id:
        parts.append(f"场景 {scene_id}")

    filename = data.get("filename") or data.get("name")
    if filename:
        parts.append(str(filename))

    output_key = data.get("output_key")
    if output_key:
        parts.append(f"来源: {output_key}")

    return " · ".join(parts) if parts else None


def backfill_node(data: dict) -> tuple[dict, list[str]]:
    """Return (new_data, actions_taken). Mutates a copy."""
    new = dict(data)
    actions: list[str] = []

    # 1. Flatten params.* into top-level (no overwrite).
    params = new.get("params")
    if isinstance(params, dict) and params:
        for k, v in params.items():
            if v is None:
                continue
            if isinstance(v, (str, int, float, bool)):
                if k not in new or new[k] in (None, ""):
                    new[k] = v
                    actions.append(f"params.{k}")

    prompt = new.get("prompt") or ""
    desc = new.get("description") or ""

    # 2. prompt empty, description non-empty → mirror
    if not prompt and desc:
        new["prompt"] = desc
        actions.append("description→prompt")

    # 3. description empty, prompt non-empty → mirror
    elif not desc and prompt:
        new["description"] = prompt
        actions.append("prompt→description")

    # 4. both empty → synthesize
    elif not prompt and not desc:
        synthesized = mint_description(new)
        if synthesized:
            new["description"] = synthesized
            new["prompt"] = synthesized
            actions.append("synthesize")

    return new, actions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true",
                        help="Write changes to DB (default: dry-run)")
    args = parser.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT id, project_id, episodes_id, data
        FROM canvas_nodes
        WHERE type = 'asset'
    """)
    rows = cur.fetchall()

    stats: dict[str, int] = {
        "total": 0,
        "would_change": 0,
        "already_complete": 0,
        "no_signal": 0,
    }
    action_counts: dict[str, int] = {}
    samples: list[dict] = []

    for row in rows:
        stats["total"] += 1
        try:
            data = json.loads(row["data"]) if row["data"] else {}
        except json.JSONDecodeError:
            continue

        new_data, actions = backfill_node(data)

        if not actions:
            stats["already_complete"] += 1
            continue

        if all(a == "synthesize" for a in actions) and not new_data.get("prompt"):
            stats["no_signal"] += 1
            continue

        stats["would_change"] += 1
        for a in actions:
            action_counts[a] = action_counts.get(a, 0) + 1

        if len(samples) < 5:
            samples.append({
                "node_id": row["id"],
                "actions": actions,
                "before_keys": sorted(data.keys()),
                "after_keys": sorted(new_data.keys()),
            })

        if args.apply:
            cur.execute(
                "UPDATE canvas_nodes SET data = ?, updated_at = ? "
                "WHERE id = ? AND project_id = ? AND episodes_id = ?",
                (json.dumps(new_data, ensure_ascii=False),
                 int(__import__("time").time() * 1000),
                 row["id"], row["project_id"], row["episodes_id"]),
            )

    if args.apply:
        conn.commit()

    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    print(f"DB: {DB_PATH}")
    print(f"Total asset nodes scanned: {stats['total']}")
    print(f"  Already complete (no change): {stats['already_complete']}")
    print(f"  Would change / changed: {stats['would_change']}")
    print(f"  No signal (cannot repair): {stats['no_signal']}")
    print(f"\nAction breakdown:")
    for action, count in sorted(action_counts.items()):
        print(f"  {action}: {count}")

    if samples:
        print(f"\nSample changes (first 5):")
        for s in samples:
            print(f"  {s['node_id']}")
            print(f"    actions: {s['actions']}")
            print(f"    before:  {s['before_keys']}")
            print(f"    after:   {s['after_keys']}")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
