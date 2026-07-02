---
slug: hermes-driven-iteration
date: 2026-07-02
status: in-progress
---

# Hermes-Driven Iteration — collect-feedback + store-plan endpoints

## Goal

Split the monolithic `POST /api/v1/iteration/plan` (which internally calls LLM via spawnSync and blocks the backend) into two LLM-free endpoints so Hermes Agent can drive diagnosis externally.

## Changes (1 file)

`src/routes/v1/iteration/index.ts`:

1. Add `POST /collect-feedback` — calls `_runEngine(workdir, "collectFeedback", [], {projectId, episodesId, apiBase})`. Returns raw feedback payload (byNode/topology/summary). No LLM call, cannot hang.
2. Add `POST /store-plan` — accepts a complete plan JSON in `req.body.plan`, fills defaults (id/createdAt/status), calls `_runEngine(workdir, "_storePlan", [fullPlan])`.

Both endpoints placed BEFORE the existing `/plan` route. Existing `/plan` stays for backward compat (deprecated).

## Verification

- Restart backend
- `curl POST /collect-feedback` → returns feedback, no hang
- `curl POST /store-plan` → returns stored plan with auto-id
- `curl GET /plans` → test plan appears
- Clean up test plan from JSONL after verification

## Constraints

- No router.ts changes (iteration router already mounted at /api/v1/iteration)
- No docker rebuild — hot tsx reload
- Maintain _runEngine subprocess pattern (env vars, no string interpolation)
