# Phase 45: Text Asset Mapping + UI Completeness - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Source:** Inline planning session (skipped discuss-phase + research subagents per user preference)

<domain>
## Phase Boundary

Phase 45 closes the "文字资产完整映射" half of the v2.0 canvas-sync triad.
Phase 44 shipped the receiver-side schema + import-path stamping; Phase 45
makes sure every phase text output (`.txt` file) has a home on the canvas,
and that the detail panels never collapse to a bare label.

In scope:
- Backend (`import-from-dir.ts`): lift the 500-char sidecar cap, add
  handling for standalone `.txt` files in script phase directories
  (currently silently dropped).
- Frontend (`NodeDetailPanel.tsx`): add description rendering to
  `StoryboardDetail` and `VideoDetail`; add `prompt` as final fallback
  in `ScriptDetail`.
- Tier 2 (optional): toolbar search filter narrows visible nodes by
  substring match against `description` / `prompt`.

Out of scope:
- Source-side manifest changes (Phase 42 territory).
- Schema field-set expansion (Phase 44 shipped; we only consume its
  outputs here).
- E2E regression tests (Phase 46 — consumes our verify script).
- Historical backfill (Phase 47 — gated on Phase 46 contract tests).

</domain>

<decisions>
## Implementation Decisions

### TEXT-01 — Backend text-asset mapping

- **D1: Lift the 500-char sidecar cap.** Current behavior at
  `import-from-dir.ts:512` truncates sidecar `.txt` to 500 chars. This
  drops long script content. Replace with a generous cap (10_000 chars
  ≈ 50KB UTF-8) — large enough for any reasonable script/prompt, small
  enough to keep node.data sizes sane in the relational store.
- **D2: Standalone `.txt` files in script phase dirs become script nodes.**
  Currently only sidecar `.txt` (matching media basenames) are read.
  Add a new probe pass: for each script-typed phase dir, scan for
  standalone `.txt` files; each becomes a `script` artifact with
  `description` = file content, `label` = filename basename, `phase` =
  detected phase. Skip files already consumed as sidecars (dedupe via
  the filename set built in step 1).
- **D3: `description` is the canonical field.** Sidecar `.txt` and
  standalone `.txt` both write to `artData.description`. The existing
  `extra.description` flatten guard at `import-from-dir.ts:441` ensures
  manifest-side description wins if both exist (Pitfall 2 from Phase 44
  RESEARCH — top-level precedence already preserved).
- **D4: No new node type for text.** ROADMAP success criterion allows
  "inlined as the producing node's description OR surfaced as an
  explicit text-type node." We choose inline-always because (a) the
  UI's ScriptDetail already renders description with `whiteSpace:
  'pre-wrap'`, (b) adding a new node type would balloon scope into
  canvas registry + AssetNode render + StructuredFieldPanel.

### TEXT-02 — UI panel completeness

- **D5: Mirror AssetDetail's section pattern across all detail panels.**
  AssetDetail (NodeDetailPanel.tsx:472-621) is the gold standard:
  image (when applicable) → type badge → prompt → description
  (fallback when prompt absent) → tags → provenance (when all else
  absent) → StructuredFieldPanel. Each detail panel should follow the
  same shape, omitting sections that don't apply.
- **D6: StoryboardDetail gets a description section.** Currently only
  renders `prompt` (NodeDetailPanel.tsx:668-684). Add a parallel
  `description` block immediately after, with the same fallback
  pattern as AssetDetail: shown only when `prompt` is absent but
  `description` exists.
- **D7: VideoDetail gets the full set.** Currently only renders video
  player + duration + state badge + structured fields
  (NodeDetailPanel.tsx:775-819). Add `prompt`, `description` (with
  fallback), `tags`, and `provenance` sections — mirroring AssetDetail
  lines 524-609. Skip image section (video player covers it).
- **D8: ScriptDetail adds `prompt` as final fallback.** Current
  ScriptDetail falls back `description → content`
  (NodeDetailPanel.tsx:345). Extend to `description → content → prompt`
  so nodes that carry only `prompt` (some P01 hook-design rows in
  fixtures) still render text.

### TEXT-03 (Tier 2) — Search filter

- **D9: Toolbar gets a search input.** Add an `<input>` element to the
  FlowCanvas toolbar (near the existing `ToolbarButton` cluster at
  FlowCanvas.tsx:510-561). On change, debounce 200ms, then filter
  visible nodes by case-insensitive substring match against
  `data.description`, `data.prompt`, and `data.label`.
- **D10: Filter is visibility-only — does not mutate node data.**
  Matched nodes stay visible; non-matched nodes get `hidden: true`
  (React Flow's standard visibility flag). Clearing the input restores
  all nodes.
- **D11: Tier 2 is optional but include in this phase.** The roadmap
  marks TEXT-03 as Tier 2 / optional. We include it because (a) it's
  small (~30 lines), (b) Phase 47 manual sampling benefits from it,
  (c) it gives Phase 46 contract tests another dimension to assert.

### Claude's Discretion

- Exact UI styling of the search input — use the existing `theme.bg.input`
  / `theme.border.subtle` palette to match neighboring toolbar buttons.
- Whether to debounce via `useDeferredValue`, `setTimeout`, or a `useMemo`
  — pick whichever is idiomatic for the existing FlowCanvas code.
- Whether the description block in VideoDetail should appear above or
  below the state badge — choose based on visual hierarchy (above is
  more readable; below is less intrusive).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Just-shipped Phase 44 (immediate predecessor)
- `.planning/phases/44-receiving-side-schema-strictness-import-validation/44-VERIFICATION.md` — what landed in the receiver-side contract (SCHEMA-01..04)
- `.planning/phases/44-receiving-side-schema-strictness-import-validation/44-02-SUMMARY.md` — `flattenParamsToNodeData` extraction + `__incomplete` stamping (now part of the surface we're completing)
- `src/routes/canvas/v2/import-from-dir.ts:437-443` — the params-flatten logic (now extracted to a helper) whose `!(pk in extra)` guard preserves top-level precedence for description

### Existing UI patterns (the gold standard)
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx:472-621` — `AssetDetail` is the canonical section pattern (image → type → prompt → description fallback → tags → provenance → StructuredFieldPanel)
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx:344-470` — `ScriptDetail` shows the `description → content` fallback chain
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx:623-710` — `StoryboardDetail` (needs description added)
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx:775-819` — `VideoDetail` (needs description / prompt / tags / provenance)
- `packages/infinite-canvas/src/components/FlowCanvas.tsx:510-561` — toolbar button cluster (Tier 2 search input lives here)

### Source-side manifest contract (cross-repo, read-only)
- `/data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/tests/fixtures/manifests/p01..p14.json` — fixture manifests showing the description field shape (Phase 42 contract)

</canonical_refs>

<specifics>
## Specific Ideas

- The 500-char cap at `import-from-dir.ts:512` was added in the
  2026-07-12 schema-ui-backfill quick task — fine for prompt-style
  sidecars, too tight for full scripts.
- The 313 existing asset nodes with `description` but no `prompt`
  (referenced in the comment block at NodeDetailPanel.tsx:543-544)
  prove the description-fallback pattern works in production.
- StoryboardDetail currently has a `prompt` block but no
  `description` block — any storyboard node that arrives via manifest
  with only `description` (no prompt) shows just the image + duration
  + MetadataEditor.
- VideoDetail is the most barebones of the four — only player + duration
  + state badge. Nodes that carry rich description / prompt render as
  empty cards.

</specifics>

<scope_fence>
## Scope Fence

In scope:
- `src/routes/canvas/v2/import-from-dir.ts` — sidecar cap + standalone .txt handling
- `packages/infinite-canvas/src/components/NodeDetailPanel.tsx` — StoryboardDetail + VideoDetail + ScriptDetail description rendering
- `packages/infinite-canvas/src/components/FlowCanvas.tsx` — toolbar search input (Tier 2)
- `scripts/verify-phase-45.ts` — new verify script (matches verify-phase-41 precedent)
- `package.json` — register `verify:phase-45` script

Out of scope (Phase fences):
- Source-side manifest schema (Phase 42)
- canvas_sync.py cleanup (Phase 43)
- Receiver-side schema strictness (Phase 44 — shipped)
- E2E + cross-repo contract tests (Phase 46)
- Historical backfill (Phase 47)

Anti-patterns to avoid:
- DO NOT add a new `text` node type — inline-always per D4
- DO NOT change the `description` flatten precedence in import-from-dir.ts (already correct per Phase 44 RESEARCH Pitfall 2)
- DO NOT use a backslash escape or HTML entity in the multi-line description rendering — `whiteSpace: 'pre-wrap'` is already wired up in all existing description blocks; just copy the pattern
- DO NOT regress the AssetDetail panel — it's already correct, only StoryboardDetail / VideoDetail / ScriptDetail need changes

</scope_fence>

<deferred>
## Deferred Ideas

None — Phase 45 scope is bounded by TEXT-01/02/03. The optional Tier 2
search filter is included (D9-D11) but kept in its own plan so it can be
deferred later if execution runs long.

Future phase candidates (not deferred FROM this phase, just adjacent):
- Per-phase text-output directory mapping table (DOC-01 in a future
  documentation phase)
- Full-text search index (overkill for the substring filter; would
  belong in a Phase 50+ scale work)
- Description edit-in-place UI (currently read-only)

</deferred>

---

*Phase: 45-text-asset-mapping-ui-completeness*
*Context gathered: 2026-07-16 via inline planning session*
