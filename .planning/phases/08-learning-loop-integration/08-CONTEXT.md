# Phase 8: Learning Loop Integration - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode)

<domain>
## Phase Boundary

接通 audit → hermes-agent 记忆系统 → decide confidence 的自学习闭环。
audit 数据真正写入域记忆，decide 的 confidence 基于历史动态计算，低分触发 auto_learn 检测。
新增 GET /v1/domains/:domain/memory 端点查询域记忆。

</domain>

<decisions>
## Implementation Decisions

### Memory Storage Strategy
- Audit data stored as JSON files in `memory/audit_history.json` grouped by task — consistent with Phase 7's `{decision_id}.json` pattern
- Retain last 100 audit records per task, auto-prune oldest — prevents unbounded disk growth
- Memory query returns aggregated summary (avg score per task, trend direction, record count) + recent 10 records

### Confidence & Auto-Learn
- Exponentially Weighted Moving Average (EWMA) for confidence — recent results weighted higher, simple to compute
- Score < 0.5 triggers auto-learn detection — configurable per-domain via config
- Auto-learn in Phase 8 only sets `auto_learn_triggered: true` and logs the trigger — skill extraction is Phase 9 work
- Minimum 3 audits before adjusting confidence — avoids premature swings

### Domain Isolation & API Design
- Domain memory isolation via path derivation from `domain/` directory — already established in Phase 7
- New endpoint: GET /v1/domains/:domain/memory returns JSON with task stats and grouped recent records — matches other GET endpoint style

### Claude's Discretion
- Implementation details for EWMA alpha parameter
- Exact pruning logic for 100-record cap
- Memory response pagination if needed

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/hermes-agent/src/core/decision_engine.py` — `record_audit()` already writes to `memory/` dir, returns `auto_learn_triggered: False`
- `docker/hermes-agent/src/core/decision_engine.py` — `decide()` already has `confidence: 0.0` placeholder
- `docker/hermes-agent/src/core/domain_registry.py` — `base_dir / domain / "memory"` path pattern established
- `docker/hermes-agent/src/api/routes.py` — audit and decide route handlers already delegate to engine

### Established Patterns
- Pydantic models for request/response validation (models.py)
- Dependency injection singletons (deps.py)
- FastAPI router pattern with /v1 prefix

### Integration Points
- `record_audit()` in decision_engine.py — extend with memory aggregation
- `decide()` in decision_engine.py — compute dynamic confidence
- routes.py — add GET /v1/domains/:domain/memory endpoint
- models.py — add MemoryResponse model

</code_context>

<specifics>
## Specific Ideas

No specific requirements — standard learning loop implementation following hermes-agent patterns.

</specifics>

<deferred>
## Deferred Ideas

- Skill extraction from auto-learn triggers (Phase 9)
- Movie-pipeline domain registration (Phase 9)
- Client adaptation and old service replacement (Phase 10)

</deferred>
