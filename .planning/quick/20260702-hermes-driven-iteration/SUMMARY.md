---
slug: hermes-driven-iteration
date: 2026-07-02
status: complete
---

# Summary — Hermes-Driven Iteration endpoints

## What shipped

Two new endpoints in `src/routes/v1/iteration/index.ts`, placed before the deprecated `/plan`:

1. **`POST /api/v1/iteration/collect-feedback`** — calls `IterationEngine.collectFeedback()` only (no `diagnose()`, no LLM).
2. **`POST /api/v1/iteration/store-plan`** — accepts a complete `plan` JSON in `req.body`, fills `id`/`createdAt`/`status` defaults, calls `_storePlan(fullPlan)`.

Existing `/plan` route kept for backward compat and marked deprecated with an explanatory comment.

## _runEngine async-spawn conversion (fixes the deadlock)

The first commit surfaced a deadlock: `_runEngine` used `spawnSync`, which blocks the Express event loop. `collectFeedback()` makes HTTP fetch calls to `${apiBase}/api/v1/feedback/*` (= same Express server) → subprocess fetch → blocked server → 120s timeout → 500.

**Fix (second commit):**

1. `import { spawn } from "child_process"` (was `spawnSync`).
2. `_runEngine` now returns `Promise<any>` instead of `any`.
3. Body wraps `spawn` in a `new Promise((resolve, reject) => ...)`. Preserves the spawnSync error semantics:
   - `signal` set (e.g. SIGTERM from timeout) → reject with signal name + stderr.
   - `code !== 0 && !stdout` → reject with "exited N" + stderr.
   - Non-JSON stdout → reject with first 500 chars.
   - `payload.ok === false` → reject with engine error.
4. All **9 call sites** updated with `await` (collect-feedback, store-plan, plan, execute, confirm, discard, plans, status, approve-adjustment).
5. Env-var passing pattern (RG2_WORKDIR / RG2_METHOD / RG2_ARGS / etc.) **unchanged** — same injection-resistance as before.

**Bonus:** this also fixes the original `/plan` endpoint's blocking behavior. The LLM call still has a 120s timeout, but the Express event loop now stays alive to serve other requests during it.

## Verification (after async fix)

| Check | Result |
|-------|--------|
| `tsc -p tsconfig.json` clean for iteration/index.ts | ✅ |
| Backend restarts cleanly | ✅ |
| **`/collect-feedback`** returns full feedback payload | ✅ **131ms** (was 120s + 500) |
| Backend log: subprocess HTTP self-calls (`/api/v1/feedback/*`) return 200 during `/collect-feedback` | ✅ 2-3ms each |
| `/store-plan` regression | ✅ auto-id, persisted |
| `/status/:planId` regression | ✅ returns status |
| `/approve-adjustment` regression | ✅ returns ok |
| `/discard` regression (bad branchId) | ✅ engine error propagates cleanly through async wrapper |
| `GET /plans` | ✅ |
| Test plans cleaned from `.pipeline-assets/iteration-plans.jsonl` | ✅ |

## Files changed

- `src/routes/v1/iteration/index.ts` — async-spawn conversion + 2 new endpoints + deprecation comment
