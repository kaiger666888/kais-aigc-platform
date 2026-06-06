# Phase 12: Movie-Agent Joint Integration - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Auto-generated (testing phase)

<domain>
## Phase Boundary

测试 hermes-client.js 与 hermes-agent 容器的端到端链路。验证 decide/audit 通过真实 HTTP 通信正常工作，以及降级（hermes-agent 不可达时返回 HERMES_DEFAULTS）和重试机制。

**Requirements:** FR-02.1 ~ FR-02.6
**Exit Criteria:** 全部 FR-02 Must 项通过；降级场景正确返回 HERMES_DEFAULTS

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion — testing phase. Follow existing test patterns from Phase 11 and test_e2e.py.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/hermes-agent/tests/conftest_integration.py` — Session-scoped fixtures, health probe
- `docker/movie-agent/lib/hermes-client.js` — Zero-dependency client with decide/audit/ degradation
- `docker/hermes-agent/tests/test_e2e.py` — Existing E2E test with client_degradation pattern
- `docker/movie-agent/tests/test-hermes-client.js` — Existing client unit tests

### Integration Points
- hermes-client.js uses `HERMES_URL` env var (default: `http://kais-hermes-agent:8080`)
- Client has 5s timeout, 1 retry with 1s delay
- Degradation returns `HERMES_DEFAULTS` with `degraded: true`

</code_context>

<specifics>
## Specific Ideas

Test the exact Node.js subprocess pattern from test_e2e.py but expanded to cover all 10 tasks + audit.

</specifics>

<deferred>
## Deferred Ideas

None — phase scope is clear.

</deferred>
