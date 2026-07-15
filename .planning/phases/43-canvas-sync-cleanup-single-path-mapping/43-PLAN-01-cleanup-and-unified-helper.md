# Plan 43-01: canvas_sync.py Cleanup + Single-Path Mapping

**Phase:** 43 — canvas_sync.py Cleanup + Single-Path Mapping
**Repo:** `kais-hermes-skills/plugins/kais_aigc/canvas_sync.py`
**Goal:** Architectural criteria fully met + best-effort line reduction.

## Tasks

### Task 1: Add `_build_node_from_phase_result()` unified helper
- File: `plugins/kais_aigc/canvas_sync.py`
- New module-level function that wraps the `CanvasSyncSubscriber` instance creation + `on_phase_complete` call. Used by both:
  - `sync_phase_result()` (standalone API)
  - Future test code that wants to drive the mapping without spinning up a full subscriber
- Signature: `_build_node_from_phase_result(phase_id, result, *, client=None) -> dict | list[dict]` returns the node_data dicts that would be POSTed.
- This is the single testable path the criteria asks for. The actual `on_phase_complete` still handles canvas I/O (POST + load + save); the new helper isolates the pure mapping logic.

### Task 2: Add params forwarding test
- File: `plugins/kais_aigc/tests/test_canvas_sync_params_forwarding.py` (NEW)
- Test: build a synthetic manifest node with `params = {engine: "ltx", resolution: "1280x704", shot_id: "S01", duration_sec: 3.5, archetype: "protagonist", role: "main", scene_id: "S01", description: "P04 character turnaround · protagonist view"}`
- Pass through `_build_node_from_phase_result()` (or `_build_artifact_node` directly)
- Assert every params key appears in the returned `node_data["data"]` dict
- This is the contract: no params.* silently dropped.

### Task 3: Inline single-use module-level helpers
- File: `plugins/kais_aigc/canvas_sync.py`
- Inline these helpers (each has only ONE call site, definition + call = no reuse):
  - `_coerce_float` → inline at line 376
  - `_translate_enum` → inline at line 491
  - `_derive_archetype`, `_derive_age_range`, `_hook_intensity`, `_murch_numeric_to_string`, `_normalize_resolution` → inline into `_apply_transform` (lines 372-379)
  - `_sync_error_log_path` → inline at line 173
  - `_is_newer` → inline at line 710
- Expected savings: ~30-50 lines

### Task 4: Trim verbose docstrings/comments
- File: `plugins/kais_aigc/canvas_sync.py`
- Replace multi-paragraph docstrings with one-line summaries for private helpers
- Drop "WHAT" comments that just restate the code; keep "WHY" comments (history, gotchas, contract requirements)
- Targeted at: `_extract_artifacts` (375 lines), `_build_artifact_node` (184 lines), `_add_reference_links` family
- Expected savings: ~100-150 lines

### Task 5: Compress redundant artifact-extraction branches
- File: `plugins/kais_aigc/canvas_sync.py` (`_extract_artifacts`, lines 2290-2664)
- This method has many per-phase branches. Consolidate where the pattern is identical (e.g., all phases that emit a single dict artifact follow the same shape — extract once).
- Keep behavior identical — tests pin specific output.
- Expected savings: ~80-100 lines

### Task 6: Verify all existing tests pass + measure line count
- Run: `python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync*.py plugins/kais_aigc/tests/test_canvas_v4*.py skills/kais-movie-pipeline/tests/test_canvas_v4.py skills/kais-movie-pipeline/tests/test_provenance_chain.py`
- Check `wc -l canvas_sync.py` — document final count
- If count > 2500: document the rationale (every helper tested/used) and what additional reductions would be unsafe

## Verification

1. `_build_node_from_phase_result()` exists, is testable in isolation, and is called by `sync_phase_result()` (architectural criteria 2 ✓)
2. New params-forwarding test asserts every params.* key appears in node_data.data (criteria 3 ✓)
3. All existing tests pass (criteria 4 ✓)
4. Line count documented (criteria 1 — best-effort, may not hit 2500)

## Out of Scope

- Splitting canvas_sync.py into multiple modules
- Removing reference-linking block (tested by test_provenance_chain.py)
- Removing candidate/gate handlers (called from production)
