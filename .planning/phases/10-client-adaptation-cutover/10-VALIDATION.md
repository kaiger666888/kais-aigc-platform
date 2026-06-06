---
phase: 10
slug: client-adaptation-cutover
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-06
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (hermes-client.js) + pytest 7.x (E2E) |
| **Config file** | none — Wave 0 creates test files |
| **Quick run command** | `node --test docker/movie-agent/tests/test-hermes-client.js` |
| **Full suite command** | `node --test docker/movie-agent/tests/test-hermes-client.js && cd docker/hermes-agent && python -m pytest tests/test_e2e.py -v` |
| **Estimated runtime** | ~15 seconds (unit), ~60 seconds (E2E with Docker) |

---

## Sampling Rate

- **After every task commit:** Run `node --test docker/movie-agent/tests/test-hermes-client.js`
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | CLIENT-01 | — | N/A | unit | `node --test docker/movie-agent/tests/test-hermes-client.js` | ❌ W0 | ⬜ pending |
| 10-01-01 | 01 | 1 | CLIENT-02 | — | N/A | unit | `node --test docker/movie-agent/tests/test-hermes-client.js` | ❌ W0 | ⬜ pending |
| 10-01-01 | 01 | 1 | CLIENT-03 | — | N/A | source-check | `grep -c hermes-adapter docker/movie-agent/lib/hermes-client.js` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | REPLACE-01 | — | N/A | integration | `docker compose -f docker-compose.v9.yml exec hermes-agent curl -sf http://localhost:8080/v1/health` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | REPLACE-02 | — | N/A | source-check | `grep -c hermes-worker-agent docker-compose.v9.yml` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | REPLACE-03 | — | N/A | integration | `docker compose -f docker-compose.v9.yml ps hermes-agent` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 2 | CLIENT-01 | — | N/A | integration | `cd docker/hermes-agent && python -m pytest tests/test_e2e.py::test_decide -v` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 2 | CLIENT-02 | — | N/A | integration | `cd docker/hermes-agent && python -m pytest tests/test_e2e.py::test_degradation -v` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `docker/movie-agent/tests/test-hermes-client.js` — unit tests for CLIENT-01, CLIENT-02 (decide/audit/fallback)
- [ ] `docker/hermes-agent/tests/test_e2e.py` — E2E integration tests for CLIENT-01, CLIENT-02, REPLACE-01, REPLACE-03
- [ ] Node.js built-in test runner — available in Node 20+ (no install needed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full movie-agent pipeline run with hermes-agent | All | Requires GPU + all Docker services running | Run a complete pipeline from requirement to delivery |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
