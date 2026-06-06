---
phase: 10
plan: 01
subsystem: client
tags: [hermes-client, fallback, nodejs, tdd]
key-files:
  - docker/movie-agent/lib/hermes-client.js
  - docker/movie-agent/tests/test-hermes-client.js
metrics:
  tasks: 1
  commits: 2
  files_created: 2
  files_modified: 0
---

# Phase 10 Plan 01: Hermes Client with Decide/Audit + Fallback Summary

## One-liner

Created hermes-client.js ESM module exporting decide() and audit() functions that call hermes-agent FastAPI service with 5s timeout, single retry, and graceful degradation to embedded HERMES_DEFAULTS (FLUX, Wan2.2, TTS params).

## Commits

| # | Hash | Message | Files |
|---|------|---------|-------|
| 1 | f5b8ddd | test(10-01): add failing tests for hermes-client decide/audit/degradation | docker/movie-agent/tests/test-hermes-client.js |
| 2 | 23091a3 | feat(10-01): implement hermes-client with decide/audit and HERMES_DEFAULTS fallback | docker/movie-agent/lib/hermes-client.js |

## TDD Gate Compliance

- RED gate: `f5b8ddd` - test commit with 6 failing tests (module not found)
- GREEN gate: `23091a3` - implementation commit, all 6 tests pass
- REFACTOR gate: Not needed - clean implementation on first pass

## What Was Built

### docker/movie-agent/lib/hermes-client.js
- ESM module exporting `decide(task, context)` and `audit(decisionId, outcome, metrics)`
- `decide()` sends POST to `/v1/decide` with `{domain: "movie-pipeline", task, context}`, retries once on failure (1s delay), degrades to `HERMES_DEFAULTS[task]` with `degraded=true`
- `audit()` sends POST to `/v1/audit` with `{domain: "movie-pipeline", decision_id, outcome, metrics}`, never throws, returns `{recorded: false}` on any error
- `HERMES_DEFAULTS` embedded: soul-visual (FLUX: steps=20, guidance_scale=3.5), video-gen (Wan2.2: width=832, total_steps=20), voice (TTS: voice=default, speed=1.0)
- Constants: `HERMES_URL` (env override, default `http://kais-hermes-agent:8080`), `TIMEOUT_MS=5000`, `RETRY_DELAY_MS=1000`
- Zero external npm dependencies (native fetch + AbortSignal.timeout)

### docker/movie-agent/tests/test-hermes-client.js
- 6 unit tests using Node.js built-in test runner (`node:test`)
- Mock fetch via `globalThis.fetch` override
- Tests: happy-path decide, ECONNREFUSED degradation, timeout+retry degradation, unknown-task fallback, happy-path audit, audit failure non-throw
- All tests pass in ~3 seconds (retry delay accounts for most duration)

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| hermes-client.js exports `decide` and `audit` | PASS |
| HERMES_URL defaults to `http://kais-hermes-agent:8080` | PASS |
| HERMES_DOMAIN hardcoded `movie-pipeline` | PASS |
| Timeout 5000ms, retry delay 1000ms | PASS |
| HERMES_DEFAULTS has keys: soul-visual, video-gen, voice | PASS |
| soul-visual.flux.steps === 20, guidance_scale === 3.5 | PASS |
| video-gen.wan.width === 832, total_steps === 20 | PASS |
| No other movie-agent files modified | PASS |
| `node --test` exits 0 | PASS (6/6 tests pass) |

## Requirements Satisfied

| Requirement | Description | Status |
|-------------|-------------|--------|
| CLIENT-01 | hermes-client.js calls /v1/decide and /v1/audit with domain field | SATISFIED |
| CLIENT-02 | Graceful degradation to HERMES_DEFAULTS when hermes unavailable | SATISFIED |
| CLIENT-03 | hermes-adapter.js unchanged, no dependency on new hermes | SATISFIED (verified: zero diff) |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

- [x] docker/movie-agent/lib/hermes-client.js exists
- [x] docker/movie-agent/tests/test-hermes-client.js exists
- [x] Commit f5b8ddd found in git log
- [x] Commit 23091a3 found in git log
- [x] All 6 tests pass via `node --test`

## Self-Check: PASSED
