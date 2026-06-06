# Phase 11: Test Infrastructure & Standalone Integration - Plan

**Phase:** 11
**Status:** Executing
**Created:** 2026-06-06

---

## Plan 11.1: Test Infrastructure

### Tasks

1. **Create `docker-compose.test.yml`** — Isolated hermes-agent test environment
   - Single service: hermes-agent with test-specific env vars
   - Isolated volume: `hermes-test-data` (not `hermes-data`)
   - Health check for readiness detection
   - No dependency on other services (CPU-only, no GPU)

2. **Create integration test fixtures** — `docker/hermes-agent/tests/conftest_integration.py`
   - Session-scoped health probe (skip if container not running)
   - Shared httpx client fixture
   - Domain registration helper
   - Cleanup fixture to remove test domains between test classes

3. **Create Makefile target** — `make test-integration`
   - Builds hermes-agent image
   - Starts docker-compose.test.yml
   - Waits for health check
   - Runs pytest integration tests
   - Tears down on exit (trap)

### Files Created
- `docker-compose.test.yml`
- `docker/hermes-agent/tests/conftest_integration.py`
- `docker/hermes-agent/Makefile` (or update existing)

---

## Plan 11.2: Standalone API Integration Tests

### Tasks

1. **`test_health_integration.py`** — FR-01.1
   - GET /v1/health returns 200, status=ok, engine=hermes-agent
   - Response has domains_count and domains list

2. **`test_register_integration.py`** — FR-01.2
   - POST /v1/register with movie-pipeline returns 201
   - Idempotent: re-register returns 422
   - GET /v1/domains includes registered domain
   - GET /v1/domains/{domain}/skills returns skill list

3. **`test_decide_integration.py`** — FR-01.3, FR-01.4
   - POST /v1/decide for each of 10 pipeline tasks
   - Validate response structure (decision_id, recommendation, confidence, domain, task, timestamp)
   - Context-aware decide: different contexts produce different recommendations
   - Non-existent domain returns 404

4. **`test_audit_integration.py`** — FR-01.5, FR-01.9
   - POST /v1/audit after decide, verify recorded=true
   - audit_history.json written to disk
   - Learning loop: decide(conf=0) → audit × N → decide(conf>0)
   - Auto-learn trigger after threshold

5. **`test_domain_isolation_integration.py`** — FR-01.8
   - Register two domains, operate on one, verify other unchanged

6. **`test_memory_integration.py`** — FR-01.7
   - GET /v1/domains/{domain}/memory returns task_stats with confidence

### Files Created
- `docker/hermes-agent/tests/test_health_integration.py`
- `docker/hermes-agent/tests/test_register_integration.py`
- `docker/hermes-agent/tests/test_decide_integration.py`
- `docker/hermes-agent/tests/test_audit_integration.py`
- `docker/hermes-agent/tests/test_domain_isolation_integration.py`
- `docker/hermes-agent/tests/test_memory_integration.py`

---

## Requirements Mapping

| Req ID | Plan | Task |
|--------|------|------|
| FR-01.1 | 11.2 | test_health |
| FR-01.2 | 11.2 | test_register |
| FR-01.3 | 11.2 | test_decide |
| FR-01.4 | 11.2 | test_decide (context) |
| FR-01.5 | 11.2 | test_audit |
| FR-01.6 | 11.2 | test_register (domains/skills) |
| FR-01.7 | 11.2 | test_memory |
| FR-01.8 | 11.2 | test_domain_isolation |
| FR-01.9 | 11.2 | test_audit (learning loop) |
| NFR-01 | 11.1 | Makefile timeout |
| NFR-02 | 11.1 | Cleanup fixtures |
| NFR-03 | 11.2 | Retry in conftest |
| NFR-04 | 11.1 | Compose works on mac/linux |
