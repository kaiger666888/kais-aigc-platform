# Phase 15: Production Stability Fixes - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix ACE-Step container permissions so it runs stably without restarts, and fully remove movie-agent dead code from the codebase (Docker Compose, source code, env vars). Verify OpenClaw Agent/hermes covers movie-agent's orchestration duties.

</domain>

<decisions>
## Implementation Decisions

### ACE-Step Permission Fix
- Add `user: "1000:1000"` to docker-compose service definition + ensure Dockerfile creates dirs with correct ownership — minimal change, matches other services
- Add `curl`-based healthcheck to docker-compose service definition so Docker reports healthy/unhealthy — consistent with other services

### movie-agent Removal Scope
- Delete `docker/movie-agent/` directory entirely — OpenClaw Agent replaces it, keeping it causes confusion
- Delete `src/routes/proxy/movieAgent.ts` — dead code since service no longer exists
- Remove all MOVIE_AGENT_* env vars from `.env` and `.env.example`

### OpenClaw Agent Verification
- Code comparison: list movie-agent's orchestration duties from its source and verify OpenClaw Agent/hermes has equivalent capabilities — document as verification table in VERIFICATION.md

### Claude's Discretion
Implementation details for permission fix (exact Dockerfile changes), cleanup order, and commit granularity are at Claude's discretion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- docker-compose.v9.yml — primary production compose, contains both ACE-Step and movie-agent service defs
- docker-compose.real.yml, docker-compose.smoke.yml — also contain movie-agent references
- src/routes/v1/ace/ — ACE-Step API route handlers
- src/routes/proxy/movieAgent.ts — movie-agent proxy route (to be removed)

### Established Patterns
- Other services in docker-compose use `user: "1000:1000"` for volume permission fixes
- Docker HEALTHCHECK pattern used by gold-team and hermes-agent services
- hermes-agent includes OpenClaw/claw.py for orchestration — this is the replacement

### Integration Points
- ACE-Step service connects via internal Docker network to gold-team
- movie-agent was proxied through Node.js API server at /v1/proxy/movie-agent/*
- OpenClaw Agent capabilities are registered through hermes-agent REST API

</code_context>

<specifics>
## Specific Ideas

No specific requirements — follow ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.
