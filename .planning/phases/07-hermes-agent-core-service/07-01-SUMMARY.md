---
phase: 07-hermes-agent-core-service
plan: 01
subsystem: agent-core
tags: [hermes-agent, aiagent, domain-registry, agent-factory, decision-engine, fastapi]

# Dependency graph
requires: []
provides:
  - DomainRegistry with filesystem-based domain CRUD and skills/memory isolation
  - AgentFactory creating per-domain AIAgent instances with SOUL.md context injection
  - DecisionEngine with prompt construction, audit recording, and health check
  - Settings configuration class with env-var-driven defaults
  - Project scaffold under docker/hermes-agent/
affects: [07-02-PLAN, 07-03-PLAN]

# Tech tracking
tech-stack:
  added: [hermes-agent>=0.15.1, fastapi>=0.136.1, uvicorn>=0.46.0, pydantic>=2.13]
  patterns: [domain-scoped-aiagent-factory, filesystem-domain-registry, atomic-json-writes, domain-name-validation-regex]

key-files:
  created:
    - docker/hermes-agent/requirements.txt
    - docker/hermes-agent/src/config.py
    - docker/hermes-agent/src/core/domain_registry.py
    - docker/hermes-agent/src/core/agent_factory.py
    - docker/hermes-agent/src/core/decision_engine.py
    - docker/hermes-agent/tests/test_core.py
  modified: []

key-decisions:
  - "Used editable install from local hermes-agent source (v0.15.1) instead of PyPI due to network instability"
  - "Plain Settings class with os.environ.get() instead of pydantic-settings to avoid extra dependency"
  - "DomainRegistry reads fresh from file each time (no stale in-memory cache) for concurrent access safety"
  - "AgentFactory creates fresh AIAgent per call (no caching) since AIAgent state is per-conversation"
  - "Confidence is static 0.0 for Phase 7; dynamic confidence deferred to Phase 8"
  - "auto_learn_triggered always returns False; self-learning loop deferred to Phase 8"

patterns-established:
  - "Domain-scoped AIAgent Factory: each domain gets isolated skills/, memory/, SOUL.md"
  - "Atomic JSON writes: write to .tmp then rename for registry.json safety"
  - "Domain name validation: regex ^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$ prevents path traversal"

requirements-completed: [API-01, DOMAIN-01, DOMAIN-02]

# Metrics
duration: 50min
completed: 2026-06-06
---

# Phase 7 Plan 01: Core Domain Infrastructure Summary

**hermes-agent library integrated with DomainRegistry (filesystem-isolated domain CRUD), AgentFactory (per-domain AIAgent with SOUL.md injection), and DecisionEngine (prompt construction + audit recording)**

## Performance

- **Duration:** 50 min
- **Started:** 2026-06-06T09:45:41Z
- **Completed:** 2026-06-06T10:36:08Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Installed hermes-agent (v0.15.1 from local source) and verified `from run_agent import AIAgent` works
- Built DomainRegistry with filesystem-based domain CRUD, registry.json persistence, domain name validation
- Built AgentFactory creating per-domain AIAgent instances with SOUL.md as ephemeral_system_prompt
- Built DecisionEngine with structured prompt construction, audit JSON recording, and health check
- 35 tests passing covering all core module functionality
- Domain name validation prevents path traversal (rejects `../`, `/`, uppercase, special chars)

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold project structure with config** - `0c24147` (feat)
2. **Task 2: TDD RED - failing tests** - `62f5407` (test)
3. **Task 2: TDD GREEN - implementation** - `c14fe99` (feat)

## Files Created/Modified

- `docker/hermes-agent/requirements.txt` - Python dependency declarations (hermes-agent, fastapi, uvicorn, pydantic)
- `docker/hermes-agent/.gitignore` - Excludes .venv, __pycache__, build artifacts
- `docker/hermes-agent/src/__init__.py` - Package init
- `docker/hermes-agent/src/config.py` - Settings class with env-var-driven config, singleton get_settings()
- `docker/hermes-agent/src/core/__init__.py` - Re-exports DomainRegistry, AgentFactory, DecisionEngine
- `docker/hermes-agent/src/core/domain_registry.py` - Domain CRUD with filesystem isolation, registry.json, validation
- `docker/hermes-agent/src/core/agent_factory.py` - Per-domain AIAgent instantiation with SOUL.md injection
- `docker/hermes-agent/src/core/decision_engine.py` - Prompt construction, audit recording, decide(), check_health()
- `docker/hermes-agent/src/api/__init__.py` - Package init (for Plan 02)
- `docker/hermes-agent/tests/__init__.py` - Package init
- `docker/hermes-agent/tests/test_core.py` - 35 tests for DomainRegistry, AgentFactory, DecisionEngine

## Decisions Made

- **Editable install from local source**: PyPI was unreachable due to network instability. Installed hermes-agent in editable mode from `/data/workspace/hermes-agent/` (v0.15.1). The requirements.txt still declares `hermes-agent>=0.15.1,<0.17` for proper deployment.
- **Plain Settings over pydantic-settings**: Avoided extra dependency by using `os.environ.get()` in a plain class. Sufficient for this phase's needs.
- **Fresh file reads for registry**: DomainRegistry reads registry.json from disk on every call instead of caching in memory. This avoids stale state issues in concurrent access scenarios.
- **No agent caching**: AgentFactory creates fresh AIAgent per call because AIAgent maintains per-conversation state. Caching would leak conversation context between calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed UnboundLocalError in DomainRegistry.__init__**
- **Found during:** Task 2 GREEN phase
- **Issue:** `from pathlib import Path` inside the `if base_dir is None` block shadowed the top-level import, causing `UnboundLocalError: cannot access local variable 'Path'` when base_dir was provided
- **Fix:** Removed inner import since Path was already imported at module level
- **Files modified:** docker/hermes-agent/src/core/domain_registry.py
- **Committed in:** c14fe99

**2. [Rule 3 - Blocking] PyPI network instability prevented pip install**
- **Found during:** Task 1 (hermes-agent installation)
- **Issue:** Repeated `BrokenPipeError`, `IncompleteRead`, and JSON decode errors from PyPI across both pip and uv
- **Fix:** Used editable install from local source at `/data/workspace/hermes-agent/` via `pip install --no-deps -e /data/workspace/hermes-agent/`. The existing hermes-agent venv at that path already had all dependencies installed.
- **Impact:** hermes-agent v0.15.1 (source version) used instead of v0.16.0 (PyPI version). Functionality is equivalent for our usage (AIAgent.__init__, chat, run_conversation).

**3. [Rule 1 - Bug] Fixed test expecting "ab" to be invalid domain name**
- **Found during:** Task 2 GREEN phase
- **Issue:** Test listed "ab" as an invalid name, but regex `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` allows 2-char names (minimum 2 chars per plan spec). "ab" is valid.
- **Fix:** Removed "ab" from the invalid names parametrize list
- **Files modified:** docker/hermes-agent/tests/test_core.py
- **Committed in:** c14fe99

---

**Total deviations:** 3 auto-fixed (1 bug fix, 1 blocking network issue, 1 test alignment)
**Impact on plan:** No scope creep. All deviations were correctness fixes.

## TDD Gate Compliance

- RED gate: `62f5407` test(07-01): add failing tests -- tests failed with ModuleNotFoundError
- GREEN gate: `c14fe99` feat(07-01): implement DomainRegistry, AgentFactory, DecisionEngine -- all 35 tests pass
- No REFACTOR gate needed -- code was clean after GREEN

## Issues Encountered

- PyPI network instability required workaround (editable install from local source). For production deployment, requirements.txt has proper version pins and a Dockerfile will handle installation at build time.

## Next Phase Readiness

- Core domain infrastructure is importable and testable independently of the HTTP layer
- Plan 02 can now build FastAPI routes that consume DomainRegistry, AgentFactory, and DecisionEngine
- The `src/api/` directory scaffold is ready for route definitions in Plan 02
- All three core modules (DomainRegistry, AgentFactory, DecisionEngine) have clean public APIs documented via tests

## Self-Check: PASSED

All 11 files verified present. All 3 commits verified in git log. 35 tests passing.

---
*Phase: 07-hermes-agent-core-service*
*Completed: 2026-06-06*
