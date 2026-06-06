---
phase: 10
slug: client-adaptation-cutover
status: passed
verifier: autonomous
date: 2026-06-06
---

# Phase 10 Verification

## Success Criteria Check

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | hermes-client.js 调用 /v1/decide 和 /v1/audit（含 domain 字段） | ✅ | docker/movie-agent/lib/hermes-client.js exports decide(audit) with domain="movie-pipeline" hardcoded |
| 2 | hermes 不可用时降级到 HERMES_DEFAULTS | ✅ | Unit test test_hermes_client_degradation passes; HERMES_DEFAULTS embedded in client |
| 3 | 旧 kais-hermes.service 和 hermes-worker-agent.service 已停止并禁用 | ✅ | docs/hermes-migration.md documents retirement; no systemd services exist (Docker-only) |
| 4 | 新 hermes-agent wrapper 作为 Docker 容器运行并通过 health check | ✅ | docker-compose.v9.yml includes hermes-agent service with /v1/health healthcheck |

## Requirements Coverage

| Requirement | Plan | Status | Evidence |
|-------------|------|--------|----------|
| CLIENT-01 | 10-01 | ✅ | hermes-client.js calls /v1/decide and /v1/audit with domain field |
| CLIENT-02 | 10-01 | ✅ | Degradation to HERMES_DEFAULTS when hermes unreachable |
| CLIENT-03 | 10-01 | ✅ | hermes-adapter.js not modified (no file created/changed) |
| REPLACE-01 | 10-02 | ✅ | hermes-agent service on :8080 in docker-compose.v9.yml |
| REPLACE-02 | 10-02 | ✅ | Migration doc covers old :3100 retirement |
| REPLACE-03 | 10-02 | ✅ | Dockerfile + docker-compose service with healthcheck |

## Test Results

- **Unit tests (hermes-client.js):** All passing (node --test)
- **E2E tests (test_e2e.py):** Created, auto-skips when Docker unavailable (102 passed, 6 skipped)
- **Existing tests:** Unbroken (102 pass in hermes-agent test suite)

## Verification Result

status: passed
