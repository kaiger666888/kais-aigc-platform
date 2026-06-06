---
phase: "07"
slug: hermes-agent-core-service
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-06
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x |
| **Config file** | pyproject.toml or pytest.ini |
| **Quick run command** | `pytest tests/ -x -q` |
| **Full suite command** | `pytest tests/ -v --tb=short` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pytest tests/ -x -q`
- **After every plan wave:** Run `pytest tests/ -v --tb=short`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | API-01 | — | N/A | smoke | `python -c "from run_agent import AIAgent; print('ok')"` | ✅ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | DOMAIN-01, DOMAIN-02 | — | N/A | unit | `pytest tests/test_domain_registry.py -v` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | API-02, API-05 | T-07-01 | Input validation | unit | `pytest tests/test_routes.py -v` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | API-03, API-04, API-06, DOMAIN-03 | T-07-02 | Domain existence check | unit | `pytest tests/test_routes.py -v` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 3 | All | — | N/A | integration | `pytest tests/test_integration.py -v` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/conftest.py` — shared fixtures (FastAPI TestClient, mock AIAgent)
- [ ] `tests/test_domain_registry.py` — domain registry CRUD tests
- [ ] `tests/test_routes.py` — all endpoint tests (register, decide, audit, health, domains, 404)
- [ ] `tests/test_decision_engine.py` — decision engine unit tests
- [ ] `tests/test_integration.py` — end-to-end integration tests
- [ ] `pytest` and `httpx` installed in Python environment

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| AIAgent.chat() returns valid response | API-01 | Requires running LLM provider | Start server, POST /v1/decide with valid domain, verify response contains recommendation |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-06
