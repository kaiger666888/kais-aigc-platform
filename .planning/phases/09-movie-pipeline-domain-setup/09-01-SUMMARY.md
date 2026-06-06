---
phase: 09-movie-pipeline-domain-setup
plan: 01
subsystem: api
tags: [domain-registry, hermes-agent, movie-pipeline, seed-memory, soul-md]

# Dependency graph
requires:
  - phase: 07-hermes-agent-core-service
    provides: DomainRegistry, DomainMemory, REST API endpoints
  - phase: 08-learning-loop-integration
    provides: EWMA confidence, audit_history.json format, DomainMemory._save_history()
provides:
  - register_movie_pipeline.py script for domain registration
  - 6 verification tests for MOVIE-01, MOVIE-03, MOVIE-04
  - SOUL.md template defining movie-pipeline decision advisor identity
  - Seed memory with FLUX/Wan2.2/CosyVoice3 parameter defaults
affects: [09-02-movie-pipeline-domain-setup, 10-client-adaptation]

# Tech tracking
tech-stack:
  added: []
  patterns: [direct-domain-registry-import, seed-memory-injection, idempotent-registration-script]

key-files:
  created:
    - docker/hermes-agent/scripts/register_movie_pipeline.py
    - docker/hermes-agent/tests/test_movie_pipeline_domain.py
  modified: []

key-decisions:
  - "Used direct DomainRegistry import instead of HTTP API for registration script (no running server needed)"
  - "SOUL.md preserved on re-run; empty SOUL.md from register() overwritten with actual content"
  - "Seed memory merged only for tasks not already present (idempotent append)"
  - "HERMES_HOME defaults to Settings.hermes_home (~/.hermes) for domain directory"

patterns-established:
  - "Registration scripts import hermes-agent src/ directly via sys.path manipulation"
  - "Seed memory uses structured JSON by task with ewma_confidence=0.0 (1 record < MIN_AUDITS=3)"

requirements-completed: [MOVIE-01, MOVIE-03, MOVIE-04]

# Metrics
duration: 3min
completed: 2026-06-06
---

# Phase 9 Plan 01: Movie-Pipeline Domain Registration Summary

**Registration script registering movie-pipeline domain with 10 tasks, SOUL.md decision advisor identity, and FLUX/Wan2.2/CosyVoice seed memory defaults**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-06T13:18:26Z
- **Completed:** 2026-06-06T13:21:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created register_movie_pipeline.py script that registers the movie-pipeline domain with exactly 10 pipeline tasks and writes SOUL.md + seed memory
- Verified domain registration, SOUL.md content, seed memory correctness, and EWMA confidence=0.0 behavior with 6 passing tests
- Full test suite at 97 tests with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1+2 (TDD RED): Verification tests** - `6f17ba4` (test)
2. **Task 1 (TDD GREEN): Registration script** - `650f660` (feat)

## Files Created/Modified

- `docker/hermes-agent/scripts/register_movie_pipeline.py` - Domain registration script with SOUL.md writer and seed memory injection
- `docker/hermes-agent/tests/test_movie_pipeline_domain.py` - 6 test methods covering MOVIE-01, MOVIE-03, MOVIE-04

## Decisions Made

- Used direct DomainRegistry import (not HTTP) for registration script -- simpler, no running server dependency
- SOUL.md write is conditional: skips if content already exists, writes if empty (created by register())
- Seed memory merge is additive: only adds tasks not already in audit_history.json
- Path setup uses HERMES_ROOT (docker/hermes-agent/) in sys.path so `from src.core...` imports work

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sys.path for script imports**
- **Found during:** Task 1 (registration script execution)
- **Issue:** Initial code used `HERMES_SRC = .../src` in sys.path, causing `from src.core...` to fail because Python looked for `src/src/core/`
- **Fix:** Changed to `HERMES_ROOT = .../hermes-agent/` in sys.path so `from src.core...` resolves correctly
- **Files modified:** docker/hermes-agent/scripts/register_movie_pipeline.py
- **Verification:** Script runs successfully, registers domain and writes files
- **Committed in:** 650f660 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial path fix. No scope creep.

## Issues Encountered

None beyond the path fix above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Domain registration infrastructure ready for Plan 02 (14 expert skill migration)
- SOUL.md defines the domain identity that AgentFactory will load as ephemeral_system_prompt
- Seed memory provides baseline parameter defaults for decide() calls
- Skills directory created but empty -- Plan 02 will copy 14 expert .md files

---
*Phase: 09-movie-pipeline-domain-setup*
*Completed: 2026-06-06*

## Self-Check: PASSED

- FOUND: docker/hermes-agent/scripts/register_movie_pipeline.py
- FOUND: docker/hermes-agent/tests/test_movie_pipeline_domain.py
- FOUND: 6f17ba4 (test commit)
- FOUND: 650f660 (feat commit)
