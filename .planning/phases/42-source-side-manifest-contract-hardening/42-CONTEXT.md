# Phase 42: Source-side Manifest Contract Hardening - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped per smart-discuss spec)

<domain>
## Phase Boundary

The first v2.0 phase. Hardens `kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py` so every manifest writer emits complete structured params + meaningful (non-terse) descriptions. All downstream phases depend on this contract.

The existing `_manifest.py` already has substantial work (MANIFEST_PARAM_SCHEMA for video/audio/storyboard, REQUIRES_CONTENT set, PHASE_REQUIRED_FIELDS for p01/p03, _validate_node_params, _validate_node_content, write_manifest raises ValueError). This phase UPGRADES that foundation to fully satisfy the 5 success criteria.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase. Use ROADMAP phase goal, success criteria, and existing codebase patterns to guide decisions.

Key strategic decisions made during analysis:
1. **asset type baseline stays `{label}`** — "asset requires archetype/role" interpreted as p04 character-specific requirement (other asset types like p07 scenes, p08 selected-scenes have different fields). Enforced via PHASE_ASSET_REQUIRED_FIELDS extension.
2. **MIN_DESCRIPTION_LEN = 20** — applied to whichever of {prompt, description} is provided; at least one must meet the minimum.
3. **Fallback strings in phase modules enriched** — every phase's `else: description = "..."` fallback upgraded to ≥20 chars so empty desc_parts doesn't trip the new contract.
4. **Text coverage validator is opt-in** — `validate_text_coverage(phase_oss_dir)` helper added; not auto-invoked by write_manifest (would block legitimate phases that don't produce .txt). Test suite exercises it.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `_manifest.py:64` MANIFEST_PARAM_SCHEMA — already covers video/audio/storyboard/script/asset/structural
- `_manifest.py:109` PHASE_REQUIRED_FIELDS — pattern for per-(type, phase:id) enforcement
- `_manifest.py:170` _validate_node_content — non-empty check exists, needs length upgrade
- `tests/test_manifest_schema.py` — 700+ lines of existing schema tests, must be updated not broken
- `tests/test_manifest_phase_required.py` — phase-aware required field tests

### Established Patterns
- Phase modules build `manifest_nodes` list, call `write_manifest(PHASE_ID, manifest_nodes)` inside try/except `(OSError, RuntimeError)` — ValueError propagates correctly
- Description construction: `desc_parts = []; desc_parts.append(...); description = " · ".join(desc_parts) or "fallback"`
- Fallback strings are typically `"中文 (english)"` format, many <20 chars

### Integration Points
- Phase OSS dir: `oss/{project_id}/p{NN}/manifest.json`
- Text artifacts (when present): `oss/{project_id}/p{NN}/{name}.txt` — currently NOT scanned
- Pre-commit hook target: `/data/workspace/kais-hermes-skills/` root (no .pre-commit-config.yaml exists)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure phase. Refer to ROADMAP success criteria 1-5.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
