#!/usr/bin/env python3
"""Cinema KB maintenance — keeps `seed-data.json` (source of truth) and the
`cinema_knowledge` SQLite table in lock-step.

The TS layer (`src/routes/v1/cinema/_shared/db.ts`) only auto-seeds when the
table is EMPTY and `insertEntries(replace=...)` can't delete rows that were
removed from the seed file. So incremental, mirrored edits (both file + DB) are
the correct way to mutate the KB while preserving auto-increment ids (which
`cinema_usage_stats.knowledge_id` references — a full DELETE/INSERT would orphan
them).

Subcommands:
  check                 Reconcile DB vs seed-data.json; report any drift.
  count                 Print per-category row counts (DB).
  delete CAT k1 k2 ...  Remove the listed keys from CAT in BOTH seed + DB.
  add FILE.json         Insert the JSON array in FILE into BOTH seed + DB
                        (replace mode: same (category,key_name) is overwritten).
  reseed                Full resync: wipe + reload DB from seed-data.json.
                        (Will reassign ids — only safe when usage_stats is empty.)

Serialization mirrors db.ts `serializeEntry`/`toJson` exactly: empty arrays /
objects / None → SQL NULL, otherwise compact JSON (no spaces, raw UTF-8) so it
matches JS `JSON.stringify`.
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone

REPO = "/data/workspace/kais-aigc-platform"
SEED = f"{REPO}/src/routes/v1/cinema/seed-data.json"
DB = f"{REPO}/data/db2.sqlite"

# Columns in cinema_knowledge, in DB order.
COLUMNS = [
    "category", "key_name", "key_type",
    "related_emotions", "related_camera_moves", "related_shot_scales",
    "related_duration_min", "related_duration_max", "related_pacing",
    "related_composition",
    "primary_recommendation", "alternative_recommendations", "rationale",
    "speed_words", "prompt_tokens", "extra_data",
    "source_file", "source_section", "tags", "priority",
]
JSON_ARRAY_FIELDS = {
    "related_emotions", "related_camera_moves", "related_shot_scales",
    "related_composition", "alternative_recommendations", "speed_words", "tags",
}
JSON_OBJECT_FIELDS = {"prompt_tokens", "extra_data"}


def now_iso() -> str:
    """JS-style ISO 8601 (millisecond precision, Z suffix) to match db.ts nowIso."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        datetime.now(timezone.utc).strftime("%f")[:3] + "Z"


def to_json(v):
    """db.ts toJson: None / empty array / empty object -> SQL NULL; else compact JSON.

    Uses compact separators to match the live server's `JSON.stringify` (db.ts
    toJson). The existing DB mixes compact + spaced encodings (a legacy of
    multiple Python ingestion batches); both parse identically, so whitespace is
    cosmetic. New rows follow the canonical (compact) TS convention.
    """
    if v is None:
        return None
    if isinstance(v, (list, dict)) and len(v) == 0:
        return None
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def norm_json(v):
    """Normalize a JSON-stored column value for whitespace-insensitive compare:
    parse the DB text back to a Python object (None if unparseable/empty)."""
    if v is None or v == "":
        return None
    try:
        p = json.loads(v)
    except (ValueError, TypeError):
        return v
    if p in ([], {}):
        return None
    return p


def serialize(entry: dict) -> tuple:
    """Mirror db.ts serializeEntry -> row tuple matching COLUMNS (+ timestamps)."""
    row = []
    for c in COLUMNS:
        if c in JSON_ARRAY_FIELDS or c in JSON_OBJECT_FIELDS:
            row.append(to_json(entry.get(c)))
        elif c == "related_duration_min":
            row.append(entry.get(c) if entry.get(c) is not None else None)
        elif c == "related_duration_max":
            row.append(entry.get(c) if entry.get(c) is not None else None)
        elif c == "priority":
            row.append(entry.get(c) if entry.get(c) is not None else 50)
        else:
            v = entry.get(c)
            row.append(v if v is not None else None)
    return tuple(row)


def load_seed() -> list:
    with open(SEED, encoding="utf-8") as f:
        data = json.load(f)
    assert isinstance(data, list), "seed-data.json must be a top-level array"
    return data


def save_seed(data: list) -> None:
    """Dump byte-identically to the hand-maintained format (2-space indent, raw
    UTF-8, trailing newline). Verified round-trip clean before relying on this."""
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    with open(SEED, "w", encoding="utf-8") as f:
        f.write(text)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


# --------------------------------------------------------------------------- #
# commands
# --------------------------------------------------------------------------- #

def cmd_count(_args):
    conn = connect()
    rows = conn.execute(
        "SELECT category, COUNT(*) c FROM cinema_knowledge GROUP BY category ORDER BY c DESC"
    ).fetchall()
    total = 0
    for r in rows:
        print(f"{r['c']:>4}  {r['category']}")
        total += r["c"]
    print(f"----\n{total:>4}  TOTAL")


def cmd_check(_args):
    """Reconcile DB vs seed-data.json. Reports missing/extra/mismatched rows."""
    seed = load_seed()
    seed_map = {(e["category"], e["key_name"]): e for e in seed}
    conn = connect()
    db_rows = {
        (r["category"], r["key_name"]): r
        for r in conn.execute("SELECT * FROM cinema_knowledge")
    }
    seed_keys = set(seed_map)
    db_keys = set(db_rows)
    only_seed = seed_keys - db_keys
    only_db = db_keys - seed_keys
    # content mismatch: same key, different payload. JSON columns are compared
    # by their PARSED value (whitespace-insensitive) since the existing DB mixes
    # compact + spaced encodings that all parse identically.
    mismatched = []
    for k in seed_keys & db_keys:
        entry = seed_map[k]
        row = db_rows[k]
        for c in COLUMNS:
            got = row[c]
            if c in JSON_ARRAY_FIELDS or c in JSON_OBJECT_FIELDS:
                want = entry.get(c)
                want = None if want in (None, [], {}) else want
                got_n = norm_json(got)
                if want != got_n:
                    mismatched.append((k, c, repr(want), repr(got)))
                    break
            elif c == "priority":
                want = entry.get(c) if entry.get(c) is not None else 50
                if want != got:
                    mismatched.append((k, c, repr(want), repr(got)))
                    break
            elif c in ("related_duration_min", "related_duration_max"):
                want = entry.get(c)
                if want != got and not (want in (None, "") and got in (None, "")):
                    mismatched.append((k, c, repr(want), repr(got)))
                    break
            else:
                want = entry.get(c)
                if want != got and not (want in (None, "") and got in (None, "")):
                    mismatched.append((k, c, repr(want), repr(got)))
                    break
    ok = True
    if only_seed:
        ok = False
        print(f"IN SEED BUT NOT DB ({len(only_seed)}):")
        for k in sorted(only_seed):
            print(f"   {k[0]} | {k[1]}")
    if only_db:
        ok = False
        print(f"IN DB BUT NOT SEED ({len(only_db)}):")
        for k in sorted(only_db):
            print(f"   {k[0]} | {k[1]}")
    if mismatched:
        ok = False
        print(f"CONTENT MISMATCH ({len(mismatched)}):")
        for k, c, want, got in mismatched[:40]:
            print(f"   {k[0]} | {k[1]} :: {c}: seed={want} db={got}")
        if len(mismatched) > 40:
            print(f"   ... and {len(mismatched)-40} more")
    if ok:
        print(f"OK: seed==db, {len(seed_keys)} rows in perfect sync.")
    else:
        sys.exit(1)


def cmd_delete(args):
    category = args[0]
    keys = args[1:]
    if not keys:
        sys.exit("delete: need at least one key_name")
    seed = load_seed()
    keyset = set(keys)
    before = len(seed)
    seed = [e for e in seed if not (e["category"] == category and e["key_name"] in keyset)]
    removed = before - len(seed)
    save_seed(seed)
    conn = connect()
    cur = conn.execute(
        "DELETE FROM cinema_knowledge WHERE category=? AND key_name IN (%s)"
        % ",".join("?" * len(keys)),
        [category, *keys],
    )
    conn.commit()
    print(f"deleted: seed -{removed}, db -{cur.rowcount} (category={category})")


def cmd_add(args):
    path = args[0]
    with open(path, encoding="utf-8") as f:
        entries = json.load(f)
    if isinstance(entries, dict):
        entries = [entries]
    assert isinstance(entries, list), "add: FILE must contain a JSON array or object"
    # validate minimal contract
    for e in entries:
        if not e.get("category") or not e.get("key_name"):
            sys.exit(f"add: entry missing category/key_name: {e}")
    # 1. merge into seed-data.json (replace by category+key_name, else append)
    seed = load_seed()
    idx = {(e["category"], e["key_name"]): i for i, e in enumerate(seed)}
    appended = 0
    replaced = 0
    for e in entries:
        k = (e["category"], e["key_name"])
        if k in idx:
            seed[idx[k]] = e
            replaced += 1
        else:
            seed.append(e)
            idx[k] = len(seed) - 1
            appended += 1
    save_seed(seed)
    # 2. upsert into DB (replace mode: delete then insert, like insertEntries)
    conn = connect()
    for e in entries:
        conn.execute(
            "DELETE FROM cinema_knowledge WHERE category=? AND key_name=?",
            (e["category"], e["key_name"]),
        )
    ts = now_iso()
    rows = [(*serialize(e), ts, ts) for e in entries]
    placeholders = ",".join("?" * (len(COLUMNS) + 2))
    conn.executemany(
        f"INSERT INTO cinema_knowledge ({','.join(COLUMNS)}, created_at, updated_at) "
        f"VALUES ({placeholders})",
        rows,
    )
    conn.commit()
    print(f"added: seed {appended} new + {replaced} replaced | db inserted {len(rows)}")


def cmd_reseed(_args):
    seed = load_seed()
    conn = connect()
    conn.execute("DELETE FROM cinema_knowledge")
    ts = now_iso()
    rows = [(*serialize(e), ts, ts) for e in seed]
    placeholders = ",".join("?" * (len(COLUMNS) + 2))
    conn.executemany(
        f"INSERT INTO cinema_knowledge ({','.join(COLUMNS)}, created_at, updated_at) "
        f"VALUES ({placeholders})",
        rows,
    )
    conn.commit()
    print(f"reseeded: {len(rows)} rows wiped+reloaded from seed-data.json")


COMMANDS = {
    "count": cmd_count,
    "check": cmd_check,
    "delete": cmd_delete,
    "add": cmd_add,
    "reseed": cmd_reseed,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1 if len(sys.argv) >= 2 else 0)
    COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
