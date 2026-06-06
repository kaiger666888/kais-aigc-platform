# Phase 11: Test Infrastructure & Standalone Integration - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure + testing phase)

<domain>
## Phase Boundary

构建 hermes-agent 集成测试基础设施（docker-compose.test.yml、共享 fixture、Makefile target），并编写独立服务的全 API 端点集成测试。使用真实 Docker 容器 + 真实 LLM (ZhiAI glm-5.1)，覆盖 health、register、decide、audit、domains、memory 全部端点，以及域隔离和学习循环的完整验证。

**Requirements:** FR-01.1 ~ FR-01.9, NFR-01 ~ NFR-04
**Exit Criteria:** 全部 FR-01 Must 项通过；docker compose up → pytest 自动执行并报告

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure and testing phase. Use ROADMAP phase goal, REQUIREMENTS.md, and existing test patterns (conftest.py, test_e2e.py) to guide decisions.

**Key constraints:**
- Real LLM (no mocking) — tests validate actual hermes-agent + LLM integration
- Docker Compose for test environment isolation
- Tests must be idempotent and repeatable (NFR-02)
- Total test suite < 10 minutes (NFR-01)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/hermes-agent/tests/conftest.py` — FastAPI TestClient fixtures with dependency overrides
- `docker/hermes-agent/tests/test_e2e.py` — E2E test patterns (health probe, session-scoped skip, httpx client)
- `docker/hermes-agent/tests/test_integration.py` — Integration test patterns (full flow, domain isolation, learning loop)
- `docker/hermes-agent/src/api/routes.py` — API endpoint definitions
- `docker/hermes-agent/src/api/models.py` — Pydantic request/response schemas
- `docker-compose.v9.yml` — Docker Compose service definitions

### Established Patterns
- FastAPI TestClient for unit tests, httpx for E2E tests
- `conftest.py` with tmp_hermes_dir, mock_agent, registry fixtures
- Session-scoped autouse fixture to skip when container not running
- Domain registration via POST /v1/register with tasks and skills_manifest

### Integration Points
- `docker/hermes-agent/` — service source and existing tests
- `docker/hermes-agent/scripts/register_movie_pipeline.py` — domain registration script with 10 tasks
- `docker-compose.v9.yml` — hermes-agent service definition (port 8080, hermes-data volume)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — infrastructure and testing phase. Follow existing test patterns and REQUIREMENTS.md acceptance criteria.

</specifics>

<deferred>
## Deferred Ideas

None — phase scope is clear from REQUIREMENTS.md.

</deferred>
