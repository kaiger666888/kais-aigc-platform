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

## Verification

| Check | Result |
|-------|--------|
| `tsc -p tsconfig.json` clean for iteration/index.ts | ✅ (pre-existing errors only in unrelated files) |
| Backend restarts cleanly with new routes | ✅ |
| `/store-plan` returns stored plan with auto-generated `id` | ✅ (`plan-mr3kycpf-pxbjem`) |
| `/store-plan` validation: bad plan shape → 400 | ✅ |
| `/store-plan` validation: bad workdir (`/etc/...`) → 400 with security msg | ✅ |
| Plan appears in `GET /plans` after `store-plan` | ✅ |
| Test plans cleaned from `.pipeline-assets/iteration-plans.jsonl` | ✅ |

## ⚠️ Known issue: `/collect-feedback` deadlocks

**The spec expected `/collect-feedback` to "not hang (no LLM call)". It does hang.** Verified via curl + backend log:

- curl POST hangs for the full 120s spawnSync timeout, then returns 500.
- Backend log shows the subprocess's HTTP fetch calls (`GET /api/v1/feedback/project/1`, `GET /api/v1/feedback/propagation/...`) only being processed AFTER the 120s timeout fires.

**Root cause:** `_runEngine` uses `spawnSync`, which **blocks the Express event loop** for up to 120s. `collectFeedback()` makes HTTP fetch calls to `${apiBase}/api/v1/feedback/*` — and `apiBase` defaults to `http://localhost:10588`, i.e. **the same Express server**. Result: subprocess → fetch → server (blocked) → deadlock until timeout.

This is the same underlying flaw the spec called out for `/plan` (LLM call), just with a different trigger (HTTP self-call). The spec author didn't anticipate that `collectFeedback()` calls back into the same server.

**Code is correct per spec** — it does exactly what `/tmp/gsd-task-hermes-driven-iteration.md` prescribes. But the spec's stated verification ("Must NOT hang") cannot be met without changing `_runEngine`.

### Fix options for a follow-up quick task

1. **Convert `_runEngine` to async spawn** (`child_process.spawn` + Promise). Express event loop stays alive, subprocess HTTP calls get served. ~30 lines of change. Recommended.
2. **Bypass HTTP for self-calls**: have a new `collectFeedbackDirect()` engine method that reads feedback from SQLite directly (skip `fetch()` to self). Bigger change in repo 2 (kais-movie-agent).
3. **Move `_runEngine` to a worker thread** — heaviest, but cleanly isolates blocking work.

Spec constraints (#5) say "DO NOT use docker compose build — this is a hot code change" — option 1 keeps that property.

## Files changed

- `src/routes/v1/iteration/index.ts` — +2 schemas, +2 routes, +deprecation comment on `/plan`
