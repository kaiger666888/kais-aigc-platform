# Retrospective

## Milestone: v1.5 — Architecture Hardening + Code Hygiene

**Shipped:** 2026-06-14
**Phases:** 5 (23-27) | **Requirements:** 9/9 satisfied | **Commits:** 9

### What Was Built

1. **GpuScheduler Redis backend** — StateStore abstraction (`stateStore.ts` + `memoryStateStore.ts` + `redisStateStore.ts`) with Lua atomic release; `getGpuSchedulerAsync()` factory auto-detects REDIS_URL with graceful memory fallback
2. **gold-team Python retirement** — Deleted `acestep.py` + `docker_polling.py` (395 LOC) + 5 cleanup sites in main/executor/engine_registry/router; Dockerfile stripped of ACE-Step source install + 7 ENV ACESTEP_* vars
3. **Output path convention** — `src/lib/paths.ts` typed API (`engineOutputDir`, `EngineKind` union) + backwards-compatible legacy env var aliases + migration guide
4. **TypeScript compile clean** — 4 vendored project excludes added to `tsconfig.json`; `yarn lint` errors 12,447 → 0
5. **router.ts auto-gen root-cause fix** — `src/core.ts` SKIP_PATTERNS regex; 12 config/shared files no longer `export default router`; router.ts 248 → 236 routes (12 phantom routes removed)

### What Worked

- **Skipping GSD ceremony (smart_discuss + plan-phase)** — Each phase had clear scope (1-2 reqs, well-bounded). Writing CONTEXT.md directly + implementing + writing VERIFICATION.md saved substantial ceremony overhead without losing quality.
- **Memory-first verification pattern** — `verify-phase-23.ts --memory-only` runs in CI/Planning context (no Redis dependency); full Redis test path is coded and ready for production runtime. Decouples verification from infrastructure availability.
- **Root-cause fixing over symptom patching** — Phase 27 fixed `src/core.ts` (the auto-generator) instead of repeatedly patching `src/router.ts` (the generated output). v1.4 commit 7a9393e had tried the symptom approach and was repeatedly overwritten.
- **3-source cross-reference for audit** — REQUIREMENTS.md traceability + Phase VERIFICATION.md + checkbox state triangulated requirement completion; caught no orphans.

### What Was Inefficient

- **TypeScript ESM/CJS interop friction** — Calling `core.ts`'s `generateRouter` via `tsx -e "import(...)"` returned `{ default: object }` instead of a function. Required writing a standalone `/tmp/regen-router.ts` script to invoke properly.
- **No project test framework** — Project lacks jest/vitest/mocha. Verification had to use standalone `tsx scripts/verify-phase-*.ts` files instead of integrated test runner. Limits CI integration.
- **Two-round cleanup for config files** — Phase 27 required (a) fixing `core.ts` to skip, then (b) cleaning 12 existing files that had been forced to `export default router` as a workaround. Could have been one pass if `core.ts` had been correct from the start.

### Patterns Established

- **StateStore abstraction for cross-process state** — Pattern for any future shared state (cache, sessions, locks): interface + memory impl + Redis impl + factory with fallback + WARN log on degradation.
- **"Root cause or it didn't happen"** — When a fix has been tried before and reverted (commit 7a9393e), suspect the fix was at the wrong layer. Audit the generator, not the generated.
- **Vendored project isolation** — Embedded projects under `docker/*` get their own tsconfig; main project excludes them from compile. Prevents 12k+ error noise from polluting main build.
- **Migration via alias, not breakage** — `paths.ts` accepts legacy env vars as overrides; new convention is opt-in via `OUTPUT_ROOT`. Zero breaking changes for existing deployments.

### Key Lessons

- **5 phases of "code hygiene" is the right granularity for a milestone** — Each phase had 1-2 requirements, took 1-3 hours to implement + verify. Larger milestones (v1.3 with 26 reqs) feel different — feature work, not cleanup.
- **VERIFICATION.md with "Deferred Items" section** is more honest than "all green" — explicitly documents what wasn't tested live (Redis path, Docker build, etc.) vs what was tested in CI.
- **audit-milestone doesn't require integration-checker for independent phases** — When 5 phases address different subsystems with no cross-wiring, spawning integration-checker adds noise without value.

### Cost Observations

- Model mix: ~95% Sonnet, ~5% Haiku (no Opus needed for hygiene work)
- Sessions: 1 (long autonomous session, context summarized mid-way)
- Notable: Skipping GSD plan/execute ceremony saved an estimated 40-60% of token cost vs full ceremony for 5 small phases

---

## Milestone: v1.1 — Hermes Intelligent Decision Engine

**Shipped:** 2026-06-06
**Phases:** 4 | **Plans:** 10

### What Was Built

1. Domain-agnostic REST API (decide/audit/register/health) wrapping hermes-agent as a Python library
2. EWMA-based self-learning loop: audit data flows into per-domain memory, confidence adapts over time
3. movie-pipeline domain registered as first tenant with 14 expert skills and seed parameter memory
4. hermes-client.js adapted for Node.js movie-agent with HERMES_DEFAULTS fallback; Docker container deployment
5. Legacy hermes-worker-agent (:3100) and kais-hermes Decision API retired

### What Worked

- **TDD-first approach**: Every plan started with failing tests, then implementation. All 4 phases passed verification on first run.
- **Wave-based execution**: Dependency-aware waves (07→08∥09→10) allowed parallel work without blocking.
- **Hardcoded skill list**: Explicit 14-file migration list avoided glob-based fragility.
- **Docker-first deployment**: Container health checks validated E2E without systemd complexity.

### What Was Inefficient

- **Context exhaustion at 75%**: Long session hit context limits before finishing, requiring session restart.
- **run_agent.py God Object (9000 lines)**: Wrapping hermes-agent required working around its monolithic structure; stable API surface was narrower than expected.
- **E2E tests auto-skip without Docker**: Tests pass in CI but skip locally without Docker, giving false confidence during development.

### Patterns Established

- **Domain-scoped AIAgent factory**: Each domain gets isolated skills, memory, and SOUL.md — reusable for future domains.
- **HERMES_DEFAULTS fallback pattern**: Client embeds defaults so pipeline survives hermes outage — applicable to other service dependencies.
- **Atomic JSON writes**: All file-based state uses write-to-tmp + rename for crash safety.

### Key Lessons

- When wrapping a large OSS library (hermes-agent 172k stars), focus on a narrow stable API surface rather than trying to expose all capabilities.
- EWMA alpha=0.3 gives good balance between recency and stability for confidence scoring.
- Node.js ↔ Python bridge via REST is simpler than IPC; the latency cost is acceptable for decision calls.

### Tech Debt

- E2E tests auto-skip when Docker container unavailable (by design, but limits local validation)
- Full GPU pipeline run not automated (requires hardware)
- No WebSocket real-time push (v2 scope)

---

## Cross-Milestone Trends

| Metric | v1.1 |
|--------|------|
| Phases | 4 |
| Plans | 10 |
| Requirements | 21/21 |
| Verification | All passed |
| Timeline | 1 day execution |
