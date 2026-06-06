# Retrospective

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
