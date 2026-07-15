# Plan 42-01: Manifest Contract Hardening

**Phase:** 42 — Source-side Manifest Contract Hardening
**Repo:** `kais-hermes-skills/skills/kais-movie-pipeline`
**Goal:** All 5 success criteria satisfied; manifest contract enforced by schema + tests + pre-commit.

## Tasks

### Task 1: Add MIN_DESCRIPTION_LEN + upgrade _validate_node_content
- File: `pipeline/phases/_manifest.py`
- Add `MIN_DESCRIPTION_LEN = 20` constant
- Upgrade `_validate_node_content`: at least one of {prompt, description} must be ≥20 chars (whitespace-stripped). Error message includes observed length.
- Update docstring to reflect the stricter contract.

### Task 2: Add PHASE_ASSET_REQUIRED_FIELDS for p04 character assets
- File: `pipeline/phases/_manifest.py`
- Add entries to PHASE_REQUIRED_FIELDS (extend the lookup to support phase-prefix-only matching for asset nodes, since p04 emits `p04/char-{var}` IDs):
  - `("asset", "p04")` → `{"archetype", "role"}` (phase-only key — match by phase prefix when full ID is variable)
- Adjust `_validate_node_params` to also look up `(ntype, phase_prefix)` when `(ntype, "phase:id_suffix")` is absent.

### Task 3: Add text coverage validator (opt-in helper)
- File: `pipeline/phases/_manifest.py`
- New function `validate_text_coverage(phase_oss_dir, nodes, known_artifacts=None)`:
  - Scans `phase_oss_dir` for known text artifact patterns: `script.txt`, `prompt.txt`, `description.txt`, `scene_notes.txt`
  - For each found .txt, checks it's surfaced as a node (either as description in some node OR an explicit script-type node)
  - Returns list of orphan .txt files (empty = pass)
- Document as opt-in — phases call this after write_manifest if they produce text artifacts.

### Task 4: Remove `except: pass` in write_manifest merge
- File: `pipeline/phases/_manifest.py:357-358`
- Replace bare `except Exception: pass` with specific exception handling (`json.JSONDecodeError`, `OSError`) — log warning, fall through to overwrite.

### Task 5: Enrich phase fallback descriptions to ≥20 chars
- Files: all phase modules p01..p14
- For each phase's fallback string in the description builder, ensure ≥20 chars.
- Examples:
  - p01: `"选题核 (topic-kernel)"` → `"P01 选题核 · topic-kernel · 类型与基调"`
  - p07: `f"场景 {scene_id}"` → `f"P07 场景 · {scene_id} · 场景生成"`
  - p10: `f"配音 {sid}"` → `f"P10 配音 · {sid} · voice synthesis"`
  - p11: `f"视频片段 {sid}"` → `f"P11 视频片段 · {sid} · ltx/msr render"`

### Task 6: Update existing tests to reflect stricter contract
- File: `tests/test_manifest_schema.py`
- Update happy-path tests to use descriptions ≥20 chars.
- Update content-error tests to verify the new ≥20-char enforcement.
- Add new test class `TestMinDescriptionLen` with cases for boundary (exactly 20, 19, 0).

### Task 7: Add golden manifest test per phase
- File: `tests/test_manifest_golden.py` (NEW)
- For each phase p01..p14, include a golden manifest fixture (minimal valid node set) and assert it passes write_manifest without ValueError.
- Golden fixtures live in `tests/fixtures/manifests/p{NN}.json` (NEW).

### Task 8: Add .pre-commit hook
- File: `/data/workspace/kais-hermes-skills/.pre-commit-config.yaml` (NEW)
- Hook runs `pytest tests/test_manifest_schema.py tests/test_manifest_phase_required.py tests/test_manifest_golden.py`
- Document in commit message that contributors must `pre-commit install`.

## Verification

After all tasks:
1. Run `pytest tests/test_manifest_schema.py tests/test_manifest_phase_required.py tests/test_manifest_golden.py` — all green
2. `grep -r "except.*pass" pipeline/phases/_manifest.py` — only the JSON-decode fallthrough remains (now typed)
3. Manually inspect fallback strings: `grep -rn 'or f\?"' pipeline/phases/*.py | grep -E '(角色|场景|分镜|配音|视频|选题|故事|审计|时空|质检|时间线|成片)'` — all results ≥20 chars
4. Confirm PHASE_REQUIRED_FIELDS now includes `("asset", "p04")` entry

## Out of Scope

- Receiver-side (kais-aigc-platform) schema changes — Phase 44
- canvas_sync.py cleanup — Phase 43
- E2E test with real p04 run — Phase 46
