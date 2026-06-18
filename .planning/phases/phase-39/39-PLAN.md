---
phase: 39-canvas-movie-agent-v86-adaptation
plan: 01
type: execute
wave: 1
depends_on: [35, 36, 37, 38]
files_modified:
  - src/routes/canvas/v2/* (MERGED from feature/canvas-v2)
  - src/types/flowgraph-v2*.ts (MERGED)
  - src/router.ts (v2 routes registered)
  - packages/infinite-canvas/src/hooks/useCanvasSocket.ts (conflict resolved, both event sets kept)
  - src/routes/canvas/_simulate.ts (replace placeholder with real engine call)
  - src/routes/canvas/storyboardPreview.ts (replace TODO with real engine call)
autonomous: true
requirements: [ADAPT-01..06]

must_haves:
  truths:
    - "Master exposes both /api/canvas/* (v1, v1.7 work) and /api/v2/canvas/* (v2, contract for movie-agent V8.6)"
    - "feature/canvas-v2 work (stranded since d9c826c) is merged into master"
    - "useCanvasSocket listens to both orchestrate:* events (v1.7) and branch/review events (v2)"
    - "_simulate.ts no longer pure setTimeout — calls real gold-team proxy when available, falls back to simulation"
    - "storyboardPreview.ts calls real image generation (gold-team IMAGE_DRAW) when available, falls back to placeholder"
    - "canvas-client.js (movie-agent V8.6) contract verified against master: load/save/nodes/branches/links all return expected shapes"
    - "tsc --noEmit + tsc -b both clean"
---

# Phase 39 Plan 01 — Canvas ↔ Movie-Agent V8.6 Adaptation

## Goal

The v1.7 infinite canvas (master) and the latest kais-movie-agent V8.6 (at `/data/workspace/kais-movie-agent/`) drifted apart after d9c826c. Movie-agent V8.6 ships `lib/canvas-client.js` expecting `/api/v2/canvas/*` routes that were never merged into master (they landed on `feature/canvas-v2` and stayed there). This phase reconciles both sides so the latest agent code can drive the latest canvas.

## Drift Inventory (pre-phase)

| Area | master (v1.7) | feature/canvas-v2 | movie-agent V8.6 expects |
|------|---------------|-------------------|--------------------------|
| REST API | `/api/canvas/*` (v1) | `/api/v2/canvas/*` (v2) | `/api/v2/canvas/*` |
| FlowGraph types | v1 only | v2 (FlowGraphV2 + zod schema) | v2 |
| Branch support | none | full (BranchPanel + branch events) | branch:created/updated events |
| Review WS | none | review:approved/rejected events | review:approved/rejected events |
| Orchestrate | ✅ Phase 36 (orchestrate:* events) | none | not yet used |
| Storyboard preview | ✅ Phase 38 (placeholder only) | none | not yet used |
| Engine execution | `_simulate.ts` (setTimeout) | n/a | gold-team / dreamina CLI |

## Implementation

### Wave 1 — Reconcile v1.7 + v2 (DONE in this phase)

- Merge `feature/canvas-v2` (last commit ccf7e86) into master-side branch `feature/v1.8-canvas-movie-agent-adapt`
- Resolve conflict in `useCanvasSocket.ts` — keep BOTH event handler sets (orchestrate from master + branch/review from v2)
- Verify `tsc --noEmit` (root) + `tsc -b` (infinite-canvas) clean
- Verify router.ts has both `/api/canvas/*` and `/api/v2/canvas/*` registered

### Wave 2 — Replace placeholders with real engine calls

#### `_simulate.ts` (used by execute.ts + orchestrate.ts)

Keep the function signature, replace internals:
- Probe `process.env.GOLD_TEAM_URL` (or proxy `/api/proxy/gold-team/api/v1/tasks`)
- For each node type, map to gold-team TaskType (image_draw for asset/storyboard, video_final for video, etc.)
- On success: broadcast `node:state: success` with real asset URL
- On failure or engine unavailable: fall back to existing setTimeout simulation (graceful degradation)
- Honor existing `NODE_TYPE_TOPOLOGY` ordering

#### `storyboardPreview.ts` (Phase 38 follow-up)

Replace `await new Promise(r => setTimeout(r, 4000))` with:
- Build prompt from `o_storyboard.prompt` + `linkedAssetIds` (read from canvasGraph)
- Call gold-team IMAGE_DRAW via internal proxy
- On success: persist `preview_path` to `o_storyboard` (NEW: schema-additive column via JSON blob fallback)
- On failure: log + broadcast placeholder (current behavior)

### Wave 3 — Contract verification

- Read `/data/workspace/kais-movie-agent/lib/canvas-client.js` (795 lines)
- Cross-check each method's expected endpoint shape against master's v2 routes
- Document any remaining gaps in 39-VERIFICATION.md
- If gaps exist: small follow-up patch on either side

## Verification Criteria

1. `npx tsc --noEmit` from repo root — pass
2. `npx tsc -b` from `packages/infinite-canvas/` — pass
3. Manual review: v2 routes (`/api/v2/canvas/load|save|nodes|branches|links|layout`) all registered in router.ts
4. Manual review: `_simulate.ts` calls real engine when env var set, falls back when not
5. Manual review: `storyboardPreview.ts` calls real IMAGE_DRAW when env var set, falls back when not
6. Contract matrix: every method in canvas-client.js maps to a valid master endpoint

## Out of Scope

- Actually running movie-agent V8.6 in Docker (separate effort; needs OpenClaw runtime)
- Building new canvas UI for V8.6's 13-step pipeline (defer to v1.9+)
- Replacing gold-team proxy with direct dreamina CLI subprocess (V8.6 architectural shift; revisit in v1.9+)
- Character consistency / LLM blueprint (already deferred to v1.8+ per Xiaoyunque memory)

## Status

- Wave 1 (ADAPT): ✅ Committed (540f63c) — merged feature/canvas-v2 into master-side branch
- Wave 2 (EXEC): ✅ Committed (ed93bf0) — _simulate + storyboardPreview wired to gold-team with graceful fallback
- Wave 3 (VERIFY): ✅ Committed (pending) — verify-phase-39.ts 33/33 assertions pass; contract matrix in 39-VERIFICATION.md
- All 10 v1.8 requirements verified (ADAPT-01..04, EXEC-01..03, VERIFY-01..03)
