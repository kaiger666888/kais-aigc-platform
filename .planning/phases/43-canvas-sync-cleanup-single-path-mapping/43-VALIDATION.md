---
phase: 43
slug: canvas-sync-cleanup-single-path-mapping
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-15
completed: 2026-07-15
formalized: 2026-07-16  # GSD artifacts backfilled after the fact
---

# Phase 43 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Phase 43 work was executed directly in the kais-hermes-skills repo
> before GSD tracking artifacts were formalized. This validation strategy
> was backfilled on 2026-07-16 from the existing test suite that was
> already in place.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (Python stdlib + pytest) |
| **Config file** | none — tests are self-contained |
| **Quick run command** | `cd kais-hermes-skills && python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync.py plugins/kais_aigc/tests/test_canvas_sync_field_map.py plugins/kais_aigc/tests/test_canvas_sync_p01_quality.py plugins/kais_aigc/tests/test_canvas_sync_integration.py plugins/kais_aigc/tests/test_canvas_sync_params_forwarding.py --no-header -q` |
| **Full suite command** | Quick run + downstream consumers (`skills/kais-movie-pipeline/tests/test_canvas_v4.py` + `test_provenance_chain.py`) |
| **Estimated runtime** | ~3-5 seconds |

---

## Sampling Rate

- **On every commit:** full canvas_sync test suite via the manifest-contract-tests pre-commit hook (Phase 42) + manual `pytest` invocation
- **Before merging changes to canvas_sync.py:** full suite + downstream consumer tests
- **Before v2.0 milestone close:** confirm cross-repo drift test (Phase 46) references this suite + the new params-forwarding test

---

## Per-Task Verification Map

> Phase 43 work was a single coherent plan (43-01) with 3 sub-tasks.
> All 3 sub-tasks are covered by the 5 canvas_sync test files.

### Plan 43-01 (single plan, 3 sub-tasks)

| Task ID | Sub-task | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|----------|-------------|------------|-----------------|-----------|-------------------|--------|
| 43-01-01 | Add _build_node_from_phase_result() + _NullCanvasClient | SYNCSIDE-02 | T-43-02 | Single testable mapping entry point; both callers (standalone + subscriber) funnel through it | unit + integration | `grep -c "_build_node_from_phase_result" plugins/kais_aigc/canvas_sync.py \| grep -qE '^[3-9]$' && grep -c "_NullCanvasClient" plugins/kais_aigc/canvas_sync.py \| grep -qE '^[2-9]$'` | ✅ green |
| 43-01-02 | Add test_canvas_sync_params_forwarding.py — 7-test contract | SYNCSIDE-03 | T-43-01 | Every params.* key forwards; future-proofing test catches new keys automatically | unit | `python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync_params_forwarding.py -q --no-header` | ✅ green (7/7) |
| 43-01-03 | Run full canvas_sync suite + document line count | SYNCSIDE-01 (SOFT) | — | Zero regressions; line count documented with rationale | integration | `python3 -m pytest plugins/kais_aigc/tests/test_canvas_sync*.py -q --no-header` + `wc -l plugins/kais_aigc/canvas_sync.py` | ⚠️ SOFT MISS (3518 lines vs ≤2500 target — rationale documented; every helper tested/used) |

---

## Wave 0 Requirements

All present and accounted for:

- [x] `plugins/kais_aigc/canvas_sync.py` — `_build_node_from_phase_result` helper + `_NullCanvasClient` stub + single-path documentation in `sync_phase_result`
- [x] `plugins/kais_aigc/tests/test_canvas_sync_params_forwarding.py` — 7-test contract suite
- [x] Existing test files (5 total) continue to pass — zero regressions
- [x] Downstream consumer tests (`test_canvas_v4.py`, `test_provenance_chain.py`) still pass

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Line count reduction below 3000 (more aggressive than shipped) | SYNCSIDE-01 | Would require deleting tested code or splitting modules; out of original scope | Future phase candidate — split canvas_sync.py into subscribers/helpers/tests submodules |
| Live phase run produces canvas nodes with all params.* forwarded | SYNCSIDE-03 | Requires running the full pipeline + inspecting the canvas | Phase 46 VERIFY-03 covers this end-to-end |

---

## SOFT-MISS Documentation

### SYNCSIDE-01 (line count ≤2500)

**Target:** ≤2500 lines (≥25% reduction from baseline 3409).
**Actual:** 3518 lines (+109 from helper + null client).

**Rationale:**
1. Explore-agent survey + repo-wide grep confirmed every module-level
   helper (lines 62-751) and every `CanvasSyncSubscriber` method has
   active production callers or test coverage.
2. The reference-linking block (~560 lines) is required by
   `test_provenance_chain.py` + `test_canvas_v4.py`.
3. `_extract_candidates` + `_build_gate_node` are called from production
   `on_phase_complete` / `on_gate_resolved`.
4. `_enrich_p01_summary` (170 lines) is tested by name in
   `test_canvas_sync_p01_quality.py:440`.
5. Hitting 2500 would have required deleting tested code (unsafe) or
   splitting modules (out of phase boundary).

**Mitigation:**
- Architectural + behavioral criteria (SYNCSIDE-02 + SYNCSIDE-03) are
  fully met. These are the higher-value deliverables.
- Module split is tracked as a future phase candidate (see 43-CONTEXT.md
  `<deferred>` section).

---

## Validation Sign-Off

- [x] All sub-tasks have automated verification (5 test files)
- [x] Sampling continuity: every commit runs the canvas_sync suite via pre-commit hooks
- [x] All Wave 0 deliverables present before Phase 46 consumes the single-path contract
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] SOFT-MISS documented with rationale + mitigation

**Approval:** ready (work shipped 2026-07-15; artifacts formalized 2026-07-16)
