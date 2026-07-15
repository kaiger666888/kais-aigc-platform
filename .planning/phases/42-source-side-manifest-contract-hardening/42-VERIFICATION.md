# Phase 42: Source-side Manifest Contract Hardening — Verification

**Date:** 2026-07-15
**Status:** passed
**Repo:** `kais-hermes-skills/skills/kais-movie-pipeline`

## Success Criteria Verification

### 1. ✅ MANIFEST_PARAM_SCHEMA declares per-type required structured fields
- `pipeline/phases/_manifest.py:64-74` — video/audio/storyboard baseline enforced.
- `PHASE_REQUIRED_FIELDS` extended to add `("asset", "p04") → {archetype, role}` for character assets.
- Phase-wide lookup falls back when node IDs are variable (e.g. `p04/char-{name}`).
- `_validate_node_params` raises via `write_manifest` ValueError on missing.

### 2. ✅ `_validate_node_content` rejects nodes where description < MIN_DESCRIPTION_LEN
- `pipeline/phases/_manifest.py:91-95` — `MIN_DESCRIPTION_LEN = 20` constant.
- Validator upgraded: at least one of {prompt, description} must be ≥20 chars (whitespace-stripped).
- Error message includes observed length so developer knows exactly how short.
- Bare label echoes like `"角色 A"` (4 chars) now fail loudly.

### 3. ✅ Text asset coverage — orphan .txt → contract violation
- `pipeline/phases/_manifest.py` — new `validate_text_coverage(phase_oss_dir, nodes, known_artifacts=None)` helper.
- Default scans for `script.txt / prompt.txt / description.txt / scene_notes.txt`.
- Returns list of orphan files (phases decide whether to raise or warn).
- Opt-in: `write_manifest` does NOT call automatically (most phases don't produce .txt).
- Tested in `tests/test_manifest_schema.py::TestValidateTextCoverage` (10 cases).

### 4. ✅ `tests/test_manifest_schema.py` with golden manifests per phase + pre-commit
- `tests/test_manifest_golden.py` — 44 parametrized tests across p01..p14.
- `tests/fixtures/manifests/p01..p14.json` — one golden fixture per phase.
- Coverage test ensures new phases can't ship without a fixture.
- Schema drift detection: changing MANIFEST_PARAM_SCHEMA / PHASE_REQUIRED_FIELDS causes fixture failures.
- `.pre-commit-config.yaml` runs all three test files on every commit.

### 5. ✅ `write_manifest` raises ValueError; no `except: pass` swallows
- `pipeline/phases/_manifest.py` — bare `except Exception: pass` replaced with typed `except (json.JSONDecodeError, KeyError, TypeError) as exc:` + warning log.
- `read_all_manifests` similar — `except Exception` → `except (json.JSONDecodeError, OSError)`.
- New pre-commit hook `check_manifest_no_bare_except.py` enforces AST-level zero bare-except in `_manifest.py`.

## Test Results

```
tests/test_manifest_schema.py        — 88 tests passed
tests/test_manifest_phase_required.py — 11 tests passed
tests/test_manifest_golden.py         — 44 tests passed (3 parametrized per phase × 14 + coverage tests)
Total: 132 manifest contract tests passed in 0.43s
```

No regressions in pre-existing tests (22 unrelated baseline failures persist from prior in-progress work on canvas_sync.py / p03 / p10 etc., confirmed via `git stash`).

## Pre-Commit Hooks

```
$ pre-commit run --all-files
Manifest contract tests (Phase 42).......................................Passed
Forbid bare except-pass in _manifest.py..................................Passed
```

Contributors must run `pre-commit install` once per clone.

## Files Changed

### Source code (kais-hermes-skills)
- `pipeline/phases/_manifest.py` — added MIN_DESCRIPTION_LEN, validate_text_coverage, PHASE_ASSET_REQUIRED_FIELDS for p04, typed exception handling
- `pipeline/phases/p01..p14` (11 modules) — fallback descriptions enriched to ≥20 chars
- `scripts/check_manifest_no_bare_except.py` — AST-based pre-commit hook
- `.pre-commit-config.yaml` — new

### Tests
- `tests/test_manifest_schema.py` — updated for new contract, added TestMinDescriptionLen (10 cases) + TestPhaseRequiredAssetFields (7 cases) + TestValidateTextCoverage (10 cases)
- `tests/test_manifest_golden.py` — new, 44 tests
- `tests/fixtures/manifests/p01..p14.json` — new, 14 fixtures

## Out of Scope (Deferred to Later Phases)

- canvas_sync.py 3409-line cleanup — Phase 43
- Receiving-side (kais-aigc-platform) schema strictness — Phase 44
- Text asset mapping UI — Phase 45
- E2E + cross-repo contract tests — Phase 46
- Historical backfill of 530 empty-shell nodes — Phase 47
