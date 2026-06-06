---
phase: 07-hermes-agent-core-service
plan: 02
subsystem: api
tags: [fastapi, pydantic, rest-api, dependency-injection, cors, asyncio]

# Dependency graph
requires:
  - phase: 07-01
    provides: DomainRegistry, AgentFactory, DecisionEngine, Settings
provides:
  - FastAPI REST API with 6 endpoints on /v1 prefix
  - Pydantic request/response models with domain name validation
  - Dependency injection singletons for registry, factory, engine
  - CORS-enabled FastAPI app entrypoint with uvicorn runner
affects: [07-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [fastapi-depends-singletons, asyncio-to-thread-blocking-sync, pydantic-field-regex-validation]

key-files:
  created:
    - docker/hermes-agent/src/api/models.py
    - docker/hermes-agent/src/api/deps.py
    - docker/hermes-agent/src/api/routes.py
    - docker/hermes-agent/src/main.py
  modified:
    - docker/hermes-agent/src/api/__init__.py

key-decisions:
  - "Removed router prefix from APIRouter (prefix handled by main.py include_router) to avoid double /v1/v1/ prefix"
  - "Module-level singleton pattern in deps.py instead of lru_cache for simpler DI wiring"
  - "Domain validation enforced at two layers: Pydantic regex on RegisterRequest + DomainRegistry ValueError"

patterns-established:
  - "FastAPI Depends singletons: module-level None-checked instances for Settings, DomainRegistry, AgentFactory, DecisionEngine"
  - "asyncio.to_thread for sync AIAgent.chat(): prevents event loop blocking on LLM calls"
  - "Layered domain validation: Pydantic regex at API boundary + DomainRegistry regex at core layer (defense in depth)"

requirements-completed: [API-02, API-03, API-04, API-05, API-06, DOMAIN-03]

# Metrics
duration: 6min
completed: 2026-06-06
---

# Phase 7 Plan 02: FastAPI REST API Layer Summary

**FastAPI REST API with 6 endpoints (register, decide, audit, domains, skills, health) backed by Pydantic validation, dependency injection singletons, and asyncio.to_thread for synchronous AIAgent.chat() calls**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-06T10:40:14Z
- **Completed:** 2026-06-06T10:45:54Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All 6 REST endpoints operational: POST /v1/register (201), GET /v1/domains, GET /v1/domains/{domain}/skills, POST /v1/decide, POST /v1/audit, GET /v1/health
- Pydantic models with domain name regex validation, max_length constraints, and Field descriptions
- Dependency injection singletons for Settings, DomainRegistry, AgentFactory, DecisionEngine
- FastAPI app entrypoint with CORS middleware (allow all origins/methods/headers) and /v1 router mounting
- Domain validation at API boundary (Pydantic regex) and core layer (DomainRegistry ValueError) -- defense in depth
- AIAgent.chat() wrapped in asyncio.to_thread() to prevent event loop blocking
- Comprehensive functional verification: 10 assertions covering all endpoints, 404s, 422s

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Pydantic models, dependency injection, and FastAPI app entrypoint** - `41864c9` (feat)
2. **Task 2: Implement all /v1/* route handlers** - `fcc2f0d` (feat)

## Files Created/Modified

- `docker/hermes-agent/src/api/models.py` - Pydantic request/response models for all 6 endpoints with validation
- `docker/hermes-agent/src/api/deps.py` - FastAPI dependency injection singletons
- `docker/hermes-agent/src/api/routes.py` - All /v1/* route handlers with error handling
- `docker/hermes-agent/src/main.py` - FastAPI app entrypoint with CORS, router mounting, uvicorn runner

## Decisions Made

- **Router prefix in main.py only:** Removed `prefix="/v1"` from APIRouter because main.py's `include_router(router, prefix="/v1")` already adds it. Having both caused double prefix /v1/v1/*.
- **Module-level singletons over lru_cache:** Used simple module-level None-checked instances in deps.py. Cleaner than lru_cache for DI functions that take Depends parameters.
- **Layered domain validation:** Pydantic regex on RegisterRequest catches invalid names at the API boundary before they reach DomainRegistry. DomainRegistry also validates independently -- defense in depth per threat model T-07-01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed double /v1/v1/* route prefix**
- **Found during:** Task 2 (route verification)
- **Issue:** APIRouter had `prefix="/v1"` AND main.py included the router with `prefix="/v1"`, producing /v1/v1/register instead of /v1/register
- **Fix:** Removed `prefix="/v1"` from APIRouter, keeping it only in main.py's `include_router()` call
- **Files modified:** docker/hermes-agent/src/api/routes.py
- **Verification:** TestClient requests to /v1/health returned 200 (was 404 before fix)
- **Committed in:** fcc2f0d

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** No scope creep. Fix was a correctness requirement.

## Issues Encountered

None.

## Next Phase Readiness

- All 6 REST endpoints fully operational and verified via TestClient
- Plan 03 can now build integration tests and Dockerfile
- The API layer is a thin wrapper -- all business logic delegates to core/ modules from Plan 01
- Decide endpoint requires a registered domain and a valid LLM API key to produce real decisions (502 if LLM unreachable)

## Self-Check: PASSED

All 5 files verified present. All 2 commits verified in git log.

---
*Phase: 07-hermes-agent-core-service*
*Completed: 2026-06-06*
