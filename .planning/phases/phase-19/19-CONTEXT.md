# Phase 19: Integration Verification - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — skip discuss)

<domain>
## Phase Boundary

End-to-end validation that all merged engines and new workflows work through the unified API. Cross-cutting verification of all v1.3 requirements from Phases 15-18.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure verification phase. Write integration tests that exercise the full pipeline: task submission → routing → workflow building → result. Verify all TaskTypes route correctly, cloud fallback works, ACE-Step functions, and no movie-agent references remain.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/gold-team/tests/test_executor_routing.py` — 38 routing tests (Phase 17-18)
- `docker/gold-team/tests/test_engine_registration.py` — 27 registration/classification tests (Phase 18)
- `docker/gold-team/tests/test_workflow_builder.py` — 16 workflow builder tests (Phase 17)
- All 74 existing tests pass

### What to Verify
- Each TaskType (VIDEO, IMAGE, AUDIO, UPSCALE, VIDEO_FINAL, IMAGE_DRAW, IMAGE_REFINE) routes to at least one engine
- Cloud fallback works when ComfyUI unavailable
- ACE-Step music generation endpoint exists and routes correctly
- No movie-agent references in codebase
- Complete pipeline test: character image → video → lip sync → super-resolution → frame interpolation

</code_context>

<specifics>
## Specific Ideas

No specific requirements — verification phase. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — verification phase.
