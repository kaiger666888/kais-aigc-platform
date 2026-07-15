# Phase 43: canvas_sync.py Cleanup + Single-Path Mapping - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase)
**Repo:** `kais-hermes-skills/plugins/kais_aigc/canvas_sync.py`

<domain>
## Phase Boundary

Trim `canvas_sync.py` from 3409 lines and extract a unified node-building helper. The cleanup establishes a single testable path from phase_result → canvas node that transparently forwards all manifest `params.*`.

</domain>

<decisions>
## Implementation Decisions

### Survey Findings (from Explore agent + grep verification)

Every helper/method I tested has active callers — no truly dead code. Specifically:
- `_add_reference_links` and the entire reference-linking block (1502-2063, ~560 lines) — required by `test_provenance_chain.py` and `test_canvas_v4.py`
- `_extract_candidates` + `_build_gate_node` — called from production `on_phase_complete` / `on_gate_resolved`
- `_enrich_p01_summary` (170 lines) — tested by name in `test_canvas_sync_p01_quality.py:440`
- All 23 module-level helpers (lines 62-751) — each has ≥1 production caller

This means the 2500-line target cannot be hit purely by "remove dead code". Compression must come from:
1. Inlining single-use helpers (saves ~3-5 lines per helper × ~10 helpers = ~50 lines)
2. Trimming verbose comments/docstrings (keep WHY, drop WHAT that code already shows)
3. Consolidating similar code blocks where patterns repeat

### Claude's Discretion — Pragmatic Scope

Per the user's "一劳永逸" intent but realistic about what's safe:
1. **Architectural criteria (HARD requirements — must hit):**
   - Extract `_build_node_from_phase_result()` as the unified entry point that both `sync_phase_result` and `on_phase_complete` funnel through. Currently they already share path via delegation, but the criteria asks for a more granular named helper.
   - Verify `params.*` forwarding via assertion in unit test.
   - All existing tests pass.
2. **Line-count criteria (SOFT — best-effort):**
   - Target ≤2500. Realistic outcome: ~3000-3200 with safe compression.
   - Document what was removed and why further reduction is unsafe.

</decisions>

<code_context>
## Existing Code Insights

### Current Structure
- Module-level helpers (62-751, 690 lines): _load_generated_mappings, _phase_prefix, _log_sync_error, enum/numeric coercion, media URL handling, thumbnail generation
- `CanvasSyncSubscriber` class (752-2956, 2200 lines): 17 methods covering on_phase_complete, on_gate_resolved, artifact/candidate/gate building, reference linking
- Standalone API (2956-3409, 450 lines): _infer_stage, _ensure_project_exists, create_new_project, sync_phase_result, register_canvas_sync

### sync_phase_result → on_phase_complete delegation (line 3329-3330)
Already shares a single path. Criteria asks to extract `_build_node_from_phase_result()` as a more explicit unification — the helper is called from within `on_phase_complete`'s artifact loop.

### Pre-existing uncommitted changes
- `plugins/kais_aigc/canvas_sync.py` — small "Shape guard" added (15 lines)
- `plugins/kais_aigc/tests/test_canvas_sync.py` — likely a test for the shape guard

These pre-existing changes are independent of Phase 43; my work stacks on top.

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

- Aggressive line reduction below 3000 — would require deleting reference-linking block or candidate/gate handlers, both of which have test coverage and production callers.
- Splitting `canvas_sync.py` into multiple modules — out of scope for this phase (criteria asks for line reduction in-place, not module reorganization).

</deferred>
