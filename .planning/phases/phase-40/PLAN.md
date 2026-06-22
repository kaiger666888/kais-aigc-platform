# Phase 40 — Canvas ↔ Movie-Agent Joint Debug Fix

**Milestone:** v1.9 (post-shipped maintenance)
**Branch:** master (continue inline)
**Goal:** Close the 5 integration risks surfaced during canvas ↔ kais-movie-agent state audit so that the two systems can run end-to-end joint debug without crashing or corrupting the shared `canvasGraph` blob.

## Context

Phase 39 shipped v1.8 (Canvas ↔ Movie-Agent V8.6 Adaptation). A post-merge audit of the uncommitted working tree (`git status` M + ??) surfaced 5 integration risks spanning the platform and the sibling agent repo. None were caught by tests because they sit on the contract boundary.

## Scope

**In scope:**
- `kais-movie-agent/lib/canvas-content-sync.js` runtime crash
- reviewStatus enum mismatch between v1 (TS) and v2 (zod)
- Path traversal vulnerability in `src/routes/canvas/v2/review-gate.ts`
- Stale `static/` SPA bundle vs. modified source
- `GOLD_TEAM_URL` wiring verification

**Out of scope:**
- New features (this is maintenance only)
- Refactors not directly tied to a listed risk
- Test scaffolding for movie-agent side (its repo, its conventions)

## Tasks

### Wave A — Fix crashes & security (blocks joint debug)

- [x] **T1** `canvas-content-sync.js` — declare `loadGraph` / `saveGraph` `async`, hoist `writeFileSync` import to module top, fix `graph.nodes.map(n => n).length` no-op sanity check.
- [x] **T2** `review-gate.ts` — add `safeNodeId()` sanitization (strip `/`, `..`, shell metachars); reject before writing.

### Wave B — Schema alignment (blocks data correctness)

- [x] **T3** Unify `ReviewStatus`. Pick the v2 enum (`pending | approved | rejected`) as canonical; update TS `ReviewStatus` type and all `'awaiting_audit'` references in the FE to `'pending'`. Keep zod schema unchanged.

### Wave C — Deploy readiness (blocks browser testing)

- [x] **T4** Rebuild `packages/infinite-canvas` → refresh `src/routes/canvas/static/assets/index-*.js`.
- [x] **T5** Confirm `GOLD_TEAM_URL` is set in `docker-compose.v9.yml`; if missing, document fallback path (`_simulate` is automatic via `probeEngine()`).

## Verification

Per-task verification:
- T1: `node -e "import('./lib/canvas-content-sync.js')"` parses without SyntaxError in movie-agent.
- T2: `curl -X POST /api/v2/canvas/review/submit -d '{"nodeId":"../../etc/passwd",...}'` → 400.
- T3: `yarn typecheck` (FE) passes; `tsc --noEmit` on canvas package green.
- T4: `git status` shows new hash in `static/assets/index-*.js`; browser hard-refresh loads new bundle.
- T5: `docker compose config | grep GOLD_TEAM_URL` prints non-empty.

End-to-end smoke test (manual after all tasks):
1. Start platform + movie-agent
2. Open canvas in browser, pick a project
3. Trigger a pipeline run from movie-agent
4. Watch canvas nodes transition running → success via WebSocket

## Risks & Rollback

- **T3 is the riskiest** — changing `'awaiting_audit'` → `'pending'` touches FE rendering branches. If a stale graph in prod has `'awaiting_audit'` strings, the new code will render them as "unknown" status. Mitigation: keep a backwards-compat normalizer in `flowDataMapper.ts` for one release.
- All fixes are atomic per task → individual revert via `git revert <sha>`.
