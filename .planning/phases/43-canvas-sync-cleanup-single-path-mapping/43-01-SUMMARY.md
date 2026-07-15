---
phase: 43-canvas-sync-cleanup-single-path-mapping
plan: 01
wave: 1
requirements: [SYNCSIDE-01, SYNCSIDE-02, SYNCSIDE-03]
status: complete
target_repo: kais-hermes-skills
target_repo_path: plugins/kais_aigc
commits:
  - "Multiple commits in kais-hermes-skills (see 43-VERIFICATION.md for the full file list)"
key-files:
  modified:
    - plugins/kais_aigc/canvas_sync.py
  created:
    - plugins/kais_aigc/tests/test_canvas_sync_params_forwarding.py
---

# 43-01 — canvas_sync.py Cleanup + Single-Path Mapping

## What was built

Consolidated `canvas_sync.py`'s node-building logic into a single
testable path and verified that every `params.*` key transparently
forwards into canvas node data. Three architectural criteria met, one
line-count criterion soft-missed.

### Architectural criteria (MET)

1. **`_build_node_from_phase_result()`** — new module-level helper at
   `canvas_sync.py:2971`. Pure mapping function: given a phase_id +
   result, returns the node_data that would be POSTed. Wraps the same
   `CanvasSyncSubscriber` mapping methods that `on_phase_complete` uses
   internally. No HTTP I/O.

2. **`_NullCanvasClient`** — new no-op client at `canvas_sync.py:3057`.
   Every method returns a benign empty value so tests can drive the
   helper with fixture data + no live canvas.

3. **`sync_phase_result` documents the single-path contract** at line
   3433. Both the standalone API and the subscriber funnel through the
   same mapping code; divergence is structurally prevented.

4. **`test_canvas_sync_params_forwarding.py`** — NEW, 7 tests:
   - Helper exists and is callable
   - Persisted-checkpoint unwrap
   - Empty outputs degrade gracefully
   - P04 character asset params forward (Phase 42 contract:
     archetype + role)
   - P11 video params forward (engine + resolution + duration_sec +
     shot_id)
   - **Arbitrary unknown params key auto-forwards** — future-proofing:
     a new params key in a future phase doesn't need allowlist changes
   - Internal keys skipped (id / label / type / selected / _origin_key)

### Line-count criterion (SOFT MISS)

- **Target:** ≤2500 lines (≥25% reduction from 3409)
- **Actual:** 3518 (+109 from the new helper + null client)
- **Why missed:** Explore-agent survey confirmed every module-level
  helper (lines 62-751) and every `CanvasSyncSubscriber` method has
  active production callers or test coverage. Specifically:
  - Reference-linking block (~560 lines) — required by
    `test_provenance_chain.py` + `test_canvas_v4.py`
  - `_extract_candidates` + `_build_gate_node` — called from production
    `on_phase_complete` / `on_gate_resolved`
  - `_enrich_p01_summary` (170 lines) — tested by name in
    `test_canvas_sync_p01_quality.py:440`
  - All 23 module-level helpers — each has ≥1 production call site

  Hitting 2500 would have required either (a) splitting into multiple
  modules (out of scope — phase boundary specified in-place reduction)
  or (b) deleting tested/used code. Both options risked breaking the
  49 passing tests for a soft-target metric. Documented in
  `43-VERIFICATION.md` as best-effort.

## Test results (from 43-VERIFICATION.md, 2026-07-15)

```
plugins/kais_aigc/tests/test_canvas_sync.py                — 14 tests passed
plugins/kais_aigc/tests/test_canvas_sync_field_map.py      —  4 tests passed
plugins/kais_aigc/tests/test_canvas_sync_p01_quality.py    — 14 tests passed (1 pre-existing fail)
plugins/kais_aigc/tests/test_canvas_sync_integration.py    — 17 tests passed (2 pre-existing fail)
plugins/kais_aigc/tests/test_canvas_sync_params_forwarding.py —  7 tests passed (NEW)
Total: 56 tests, 53 pass + 3 pre-existing failures (zero new regressions)
```

## Notable design decisions

- **Pure-mapping helper, not full refactor.** The phase boundary asked
  for a single testable path + params transparency, not a full module
  split. The `_build_node_from_phase_result` helper delivers the
  testable path; the rest of `canvas_sync.py` stays as-is to avoid
  breaking the 49 passing tests.
- **`_NullCanvasClient` over mock.patch.** A dedicated no-op client is
  clearer than scattered `mock.patch` decorators in tests. The class
  also documents the CanvasClient interface contract implicitly.
- **Future-proofing test.** `test_arbitrary_unknown_params_key_is_forwarded`
  is the most important test in the new file — it proves that adding a
  new params key in a future phase (e.g. `render_cost_seconds`,
  `custom_field_future_phase`) will auto-forward without allowlist
  changes. This is what "transparent forwarding" actually means.
- **Pre-existing failures left alone.** 3 tests were failing before
  Phase 43 (test_hook_design_summary_has_hook_type,
  test_full_pipeline_episode_canvas_save_v2_per_phase,
  test_save_v2_bodies_carry_phase_node_ids). Phase 43 didn't introduce
  them and didn't fix them — they're tracked separately.

## Forward enables

- **Phase 44** (receiver schema) — the params-forwarding contract
  verified here is what Phase 44's `EXPECTED_PARAM_FIELDS_BY_TYPE`
  warning builds on top of.
- **Phase 45** (text UI) — every forwarded param becomes a potential
  field in NodeDetailPanel's StructuredFieldPanel rendering.
- **Phase 46** (E2E + contract tests) — the
  `test_canvas_sync_params_forwarding.py` suite is the receiver-side
  half of the cross-repo contract drift check.
- **Phase 47** (backfill) — historical nodes that pre-date Phase 42's
  source contract can be re-synced via `_build_node_from_phase_result`
  to verify they round-trip correctly through the new mapping.

## Verification artifact

See `43-VERIFICATION.md` for the full file-change manifest + test output
snapshot. Status: passed (3/4 criteria fully met; line-count
best-effort), dated 2026-07-15.
