---
phase: 59-narrow-trigger-stale-cascade
fixed_at: 2026-08-23T19:20:00Z
review_path: .planning/phases/59-narrow-trigger-stale-cascade/59-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 59: Code Review Fix Report

**Fixed at:** 2026-08-23T19:20:00Z
**Source review:** .planning/phases/59-narrow-trigger-stale-cascade/59-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (CRITICAL + WARNING): 7
- Fixed: 7
- Skipped: 0

**Verification (hard requirements):**
- `npm run verify:phase-59`: **72/72 PASS, exit 0** (56 → 72; additions: S2 CR-01 scrub probe ×3, S3-cascade CR-01 chain ×3, S4-orchestrate-legacy ×3, static CR-01 ×2 + CR-02 ×1, flipped WR-01 static lock)
- `packages/infinite-canvas npx tsc -b --noEmit`: exit 0
- `packages/infinite-canvas npm run build`: success (vite built in 2.45s)
- `npx playwright test test/e2e/tests/phase59-stale-cascade.mjs`: **5/5 passed** (incl. new `cross-episode node:updated is scope-guarded (CR-02)` case)
- Regression: `phase52-reroll/regen/stale-panel` e2e 9/9 passed (WR-04 popover touch)
- Root `npx tsc --noEmit` + flowgraph-v3 tsc + vitest ×2 (S6): all green

## Fixed Issues

### CR-01: Client-controlled `params` bag spreads verbatim into engine task params

**Files modified:** `src/routes/canvas/_simulate.ts`, `src/routes/canvas/_engine.ts` (+ gate: `scripts/verify-phase-59.ts`, `scripts/verify-59-dispatch.ts`)
**Commit:** 1a36dc61 (fix) + 7368334d (verify assertions)
**Applied fix:** Two-layer defense. `_simulate.ts` adds `CLIENT_PARAM_KEYS` whitelist — Phase 58 §14 full-recipe scalar keys (`seed, negative, modelVersion, lora, steps, cfg, quant, sageAttention`) exactly matching how EventParamsPopover/NodeDetailPanel build params; unknown keys silently dropped (no 500, e2e stays green). `prompt` deliberately excluded — it has a dedicated top-level execute channel (`overrides.prompt` → `input.prompt` → `params.prompt`). `_engine.ts` adds `RESERVED_PARAM_KEYS` (`ref_images, model_preference, prompt, nodeId, projectId, episodesId, nodeType, originalNodeId`) scrub of `input.metadata` before the params spread — server-set values can never be overridden even by future callers bypassing the whitelist. Behavioral gate: S2 scrub probe (forged metadata → server values survive, `seed` passes); S3-cascade dispatch body carries forged `ref_images:["/etc/passwd"]`, `model_preference:"local"`, `prompt`, `nodeId` — asserted absent/overridden in the captured engine POST body.
**Note:** whitelist key-set selection is semantic — flagged "fixed: requires human verification" per logic-bug rule (judgment: modelVersion/lora included as §14 recipe scalars).

### CR-02: `node:updated` stale broadcast carries no episodesId scope; client handler unguarded

**Files modified:** `src/routes/canvas/_stale.ts`, `packages/infinite-canvas/src/hooks/useCanvasSocket.ts`, `packages/infinite-canvas/src/components/FlowCanvas.tsx`, `packages/infinite-canvas/test/e2e/mock-backend/server.mjs`, `packages/infinite-canvas/test/e2e/tests/phase59-stale-cascade.mjs`
**Commit:** 5c386eab
**Applied fix:** Scope threaded through the wire: `_stale.ts` broadcast payload now `{ projectId, episodesId, node, changedFields }`; `useCanvasSocket` forwards the two fields; `FlowCanvas.onNodeUpdated` gains the standard two-line guard (mirror of `onGateState`/`onVariantSelected`): mismatch (including legacy payloads lacking scope) silently returns — before stale-shape validation, so cross-episode contamination via deterministic node ids (`a-p04-art0` etc.) can no longer reach `triggerStaleCascade`. Mock backend `replayStaleCascade` mirrors the payload shape. New e2e test `cross-episode node:updated is scope-guarded (CR-02)`: foreign-episode emit via `/__mock/emit` → zero badges; same-scope emit → cascade fires (guard is not dead code).

### CR-03: `import-from-dir` exposes arbitrary host dirs via unsanitized `workdir` symlink

**Files modified:** `src/routes/canvas/v2/import-from-dir.ts`
**Commit:** 9d4df6b8
**Applied fix:** `workdir` root-constrained to the engine-whitelist same roots — `/data/workspace/**` and `/mnt/agents/output/**` (iteration-route `ALLOW_ROOT` precedent; repo `data/oss` lives under `/data/workspace` so existing e2e/mock/probe flows are unaffected; no e2e or verify script POSTs this route with a workdir, confirmed by grep). `resolve()`-normalized before `startsWith` check; violations → 400. Review's secondary suggestion (reject rebind of an existing `/oss` basename to a different target) not applied — rebind is now constrained to sanctioned roots only; residual risk minimal, documented here.
**Note:** root-set selection is semantic — flagged "fixed: requires human verification" (judgment: `/mnt/agents/output` + `/data/workspace` cover all known pipeline outputs).

### WR-01: orchestrate 404s legacy-blob-only projects

**Files modified:** `src/routes/canvas/orchestrate.ts`, `scripts/verify-59-dispatch.ts`, `scripts/verify-phase-59.ts`
**Commit:** da40449b (+ harness import-order fix in ca50a4fd)
**Applied fix:** Relational-first fast path (`loadFullGraph`) preserved; on null (legacy-blob-only project) falls back to the pre-59-02 `o_agentWorkData`/`canvasGraph` blob query — old behavior restored for legacy projects; both empty → original 404. Target predicate verbatim-frozen; zero cascade structure (static lock unchanged). Gate: new dispatch mode `orchestrate-legacy` (isolated sqlite, blob-only single node) asserts 200 + `total=1/skipped=0`; static lock flipped from "no blob read" to "fallback present" per the reviewed fix contract. Harness note: the dispatch child must import `src/utils` before `src/utils/db` (same circular-import order as `app.ts` L13/L18) or `u.db` snapshots as undefined.
**Note:** fallback semantics involve judgment — flagged "fixed: requires human verification".

### WR-02: `node:state running` broadcast before early-exits → stuck-running

**Files modified:** `src/routes/canvas/execute.ts`
**Commit:** 95ec99de
**Applied fix:** `running` broadcast moved below all early-return branches — emitted only when the `setImmediate` dispatch actually arms (IterationEngine queued path no longer emits running at all; queued response is terminal). Unsupported-type 400 path now emits terminal `node:state error` before the 400 (`error` never clears stale — 52-01 red line respected). Chose the "don't emit running until past early-return" minimal option.

### WR-03: one unsupported V2 node type disables cascade for whole graph

**Files modified:** `src/routes/canvas/_stale.ts`, `scripts/verify-59-dispatch.ts`, `scripts/verify-phase-59.ts`
**Commit:** e43ef892
**Applied fix:** Chose the review's first option (filter unsupported types before migrate): `MIGRATE_SUPPORTED_V2_TYPES` = exact `FlowNodeV2Type` union from `v2types.ts` (note: probe-59-real's `MIGRATE_SUPPORTED` list is over-broad vs the actual `planNode` case table — the true supported set is the 10-value union; `variant`/`reference` bypass `planNode` via Pass 3/4). Unsupported nodes filtered pre-migrate with a distinct `console.warn`; migrate tolerates the resulting dangling links (`Pass 2` drops with warning) so the supported-subset cascade proceeds; execute success path unaffected (errors still propagate to execute's marking try/catch). Dispatch fixture now injects a `'phase'` node after the self-check — S3-cascade's DB assertions behaviorally prove the cascade survives a legacy graph (they fail if the filter regresses).

### WR-04: reroll-seed drops recipe when event lookup fails

**Files modified:** `packages/infinite-canvas/src/components/eventParams/EventParamsPopover.tsx`
**Commit:** 329d478a
**Applied fix:** `!evt` → reroll button disabled with hint (`事件已被折叠/删除，无法换 seed` / label `🎲 事件已删除，无法换 seed`) + defensive early-return in the handler with warning toast (no seed-only submission — the same-recipe promise is honored by not submitting rather than submitting a wrong recipe; when `evt` exists the full `evt.params` base + seed-only override is submitted as before). Output-asset reverse lookup now collects all `role:'output'` matches, warns on multiple, takes first — PromptSection's multi-producing-event behavior alignment.

## Skipped Issues

None — all 7 in-scope findings fixed.

## Environment / Gate Notes

- Fixes were developed and verified in an isolated git worktree (`gsd-reviewfix/59-*` branch, fast-forwarded to `master` on completion). Worktree `node_modules` were symlinked from the main checkout (including `packages/flowgraph-v3/ts/node_modules`, which is gitignored and absent in a bare worktree — without it S6's flowgraph tsc/vitest fail with `TS2688 vitest/globals`).
- S1/S2 probe fixtures now write to the literal whitelabeled root `ossToEnginePath` actually probes, making the gate checkout-location-independent (previously implicit REPO_ROOT == deployment literal assumption).
- Info findings (IN-01..IN-04) out of scope per fix_scope, untouched.

---

_Fixed: 2026-08-23T19:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
