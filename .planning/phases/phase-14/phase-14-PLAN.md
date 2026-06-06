# Phase 14: CI Pipeline & Reporting - Plan

**Phase:** 14
**Status:** Executing
**Created:** 2026-06-07

---

## Plan 14.1: GitHub Actions Workflow

### Tasks

1. **Create `.github/workflows/hermes-integration-test.yml`**
   - Trigger: PR to master, manual dispatch
   - Steps: checkout → build hermes-agent image → compose up → wait health → run pytest → compose down
   - Secrets: LLM_API_KEY
   - Timeout: 15 minutes
   - On failure: collect container logs

### Files Created
- `.github/workflows/hermes-integration-test.yml`

---

## Plan 14.2: Reporting & Developer Experience

### Tasks

1. **Update `Makefile`** — Add report targets
   - `test-integration-report`: runs tests with JUnit XML output
   - `test-integration-logs`: collects container logs on failure

2. **Create `scripts/run-integration-tests.sh`** — Smart test runner script
   - Handles build, health check, test execution, teardown
   - Collects logs on failure
   - Generates summary report

### Files Created
- `scripts/run-integration-tests.sh`
- Update `Makefile`

---

## Requirements Mapping

| Req ID | Plan | Deliverable |
|--------|------|-------------|
| FR-04.1 | 14.1 | docker-compose.test.yml (already exists) |
| FR-04.2 | 14.1 | GitHub Actions workflow |
| FR-04.3 | 14.2 | make test-integration (already exists) + run script |
| FR-04.4 | 14.2 | pytest --junitxml report |
| FR-04.5 | 14.1/14.2 | Container log collection |
