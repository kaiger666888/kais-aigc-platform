---
phase: 42-source-side-manifest-contract-hardening
plan: 01
wave: 1
requirements: [MANIFEST-01, MANIFEST-02, MANIFEST-03, MANIFEST-04, MANIFEST-05]
status: complete
target_repo: kais-hermes-skills
target_repo_path: skills/kais-movie-pipeline
commits:
  - "Multiple commits in kais-hermes-skills (see 42-VERIFICATION.md for the full file list)"
key-files:
  modified:
    - pipeline/phases/_manifest.py
    - pipeline/phases/p01..p14 (11 modules)
    - tests/test_manifest_schema.py
    - tests/test_manifest_phase_required.py
  created:
    - tests/test_manifest_golden.py
    - tests/fixtures/manifests/p01..p14.json
    - scripts/check_manifest_no_bare_except.py
    - .pre-commit-config.yaml
---

# 42-01 — Source-side Manifest Contract Hardening

## What was built

Hardened the source-side manifest writer (`kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py`)
into a contract-enforcing gatekeeper. 5 success criteria satisfied:

1. **MANIFEST-01** — `MANIFEST_PARAM_SCHEMA` declares per-type baseline
   requireds; `PHASE_REQUIRED_FIELDS` extends with phase-specific adds
   for `p01:topic-kernel` (genre/tone/total_duration_sec),
   `p03:script` (mcmahon_arc), `p04` character assets (archetype/role).
   Phase-prefix fallback handles variable node IDs.

2. **MANIFEST-02** — `tests/test_manifest_golden.py` parametrizes over
   14 golden fixtures (`tests/fixtures/manifests/p01..p14.json`). 44
   test cases total. Coverage gate ensures new phases can't ship
   without a fixture.

3. **MANIFEST-03** — `MIN_DESCRIPTION_LEN = 20` constant;
   `_validate_node_content` enforces it on whichever of {prompt,
   description} is provided for `REQUIRES_CONTENT` types. Bare label
   echoes like `"角色 A"` (4 chars) now fail loudly.

4. **MANIFEST-04** — `validate_text_coverage(phase_oss_dir, nodes,
   known_artifacts=None)` helper returns orphan .txt files. Opt-in —
   `write_manifest` does NOT auto-invoke (most phases don't produce
   .txt). 10 test cases in `TestValidateTextCoverage`.

5. **MANIFEST-05** — Bare `except: pass` in write_manifest's merge
   logic replaced with typed `except (json.JSONDecodeError, OSError)`.
   AST-level pre-commit guard `check_manifest_no_bare_except.py`
   prevents regression.

## Test results (from 42-VERIFICATION.md, 2026-07-15)

```
tests/test_manifest_schema.py        — 88 tests passed
tests/test_manifest_phase_required.py — 11 tests passed
tests/test_manifest_golden.py         — 44 tests passed (3 parametrized per phase × 14 + coverage tests)
Total: 132 manifest contract tests passed in 0.43s
```

Pre-commit:
```
Manifest contract tests (Phase 42).......................................Passed
Forbid bare except-pass in _manifest.py..................................Passed
```

## Notable design decisions

- **`asset` baseline stays `{label}`** — "asset requires archetype/role"
  interpreted as p04 character-specific (other asset types like p07
  scenes, p08 selected-scenes have different fields). Enforced via
  PHASE_REQUIRED_FIELDS, not the global schema.
- **20-char floor on stripped length** — counts characters not bytes,
  so CJK chars count as 1. Phases building via `" · ".join(desc_parts)`
  naturally exceed the floor once desc_parts has 2+ entries.
- **`validate_text_coverage` is opt-in** — auto-invoking would block
  legitimate phases that don't produce .txt. Phases that DO produce
  .txt call it after write_manifest.
- **AST-level bare-except guard** — string-matching grep is too fragile
  (would miss multi-line forms, false-positive on comments). The
  `ast`-based check is exact.

## Forward enables

- **Phase 43** (canvas_sync.py cleanup) can trust that incoming
  manifests carry the full param set — single mapping path becomes
  feasible.
- **Phase 44** (receiver-side schema) mirrors `MANIFEST_PARAM_SCHEMA`
  baseline; contract drift between Python and TS is now catchable.
- **Phase 45** (text UI) — Phase 42's MIN_DESCRIPTION_LEN = 20
  guarantees the canvas detail panel has meaningful text to render.
- **Phase 46** (E2E + contract tests) — the manifest contract test
  suite IS the source-side half of the cross-repo drift check.
- **Phase 47** (backfill) — new writes can't produce empty-shell nodes;
  backfill is a one-time repair, not recurring infrastructure.

## Verification artifact

See `42-VERIFICATION.md` for the full file-change manifest + test output
snapshot. Status: passed (dated 2026-07-15, before this formal
PLAN/SUMMARY was written).
