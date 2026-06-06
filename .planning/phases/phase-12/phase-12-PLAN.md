# Phase 12: Movie-Agent Joint Integration - Plan

**Phase:** 12
**Status:** Executing
**Created:** 2026-06-06

---

## Plan 12.1: Client Integration Tests

### Tasks

1. **`test_client_decide_integration.py`** — FR-02.1, FR-02.3
   - Node.js subprocess calls hermes-client.js decide() against real hermes-agent
   - Verify non-degraded response for each of 10 tasks
   - Validate response structure matches DecideResponse

2. **`test_client_audit_integration.py`** — FR-02.2
   - Node.js subprocess calls hermes-client.js audit() against real hermes-agent
   - Verify recorded=true
   - Test with metrics

### Files Created
- `docker/hermes-agent/tests/test_client_decide_integration.py`
- `docker/hermes-agent/tests/test_client_audit_integration.py`

---

## Plan 12.2: Degradation & Retry Tests

### Tasks

1. **`test_client_degradation_integration.py`** — FR-02.4
   - HERMES_URL points to dead port → degraded=true + HERMES_DEFAULTS
   - Verify for multiple tasks (soul-visual, video-gen, voice)

2. **`test_client_timeout_integration.py`** — FR-02.5, FR-02.6
   - Timeout test: slow proxy → verify degradation
   - Retry test: first request fails, verify retry happens

### Files Created
- `docker/hermes-agent/tests/test_client_degradation_integration.py`

---

## Requirements Mapping

| Req ID | Plan | Test File |
|--------|------|-----------|
| FR-02.1 | 12.1 | test_client_decide_integration |
| FR-02.2 | 12.1 | test_client_audit_integration |
| FR-02.3 | 12.1 | test_client_decide_integration (10 tasks) |
| FR-02.4 | 12.2 | test_client_degradation_integration |
| FR-02.5 | 12.2 | test_client_degradation_integration (timeout) |
| FR-02.6 | 12.2 | test_client_degradation_integration (retry) |
