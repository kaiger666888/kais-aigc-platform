# Phase 7: Hermes Agent Core Service - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Pre-discussed (extensive conversation context)

<domain>
## Phase Boundary

安装 NousResearch/hermes-agent Python 库，构建域无关 REST API wrapper 服务。
API 暴露 /v1/decide, /v1/audit, /v1/register, /v1/health。
支持多域注册和隔离，每个域有独立的技能集和记忆。

</domain>

<decisions>
## Implementation Decisions

### 已确认的架构决策

1. **hermes-agent Python 库模式** — `from run_agent import AIAgent`，不跑 CLI/Gateway
2. **FastAPI wrapper** — 暴露域无关 REST API，替代现有 decision_api.py
3. **域注册机制** — `POST /v1/register` 动态注册域，域间技能/记忆隔离
4. **接口设计** — decide 接受 `{domain, task, context}`，audit 接受 `{domain, decision_id, outcome, metrics}`
5. **部署位置** — 新服务监听 :8080 替代旧 kais-hermes Decision API
6. **存储** — 利用 hermes-agent 内置的 ~/.hermes/ 目录结构（技能、记忆、SOUL.md）
7. **运行方式** — 单独 Python 进程（systemd service 或 Docker 容器），movie-agent 通过 HTTP 调用

### 技术选型

- Python 3.11 + FastAPI + uvicorn
- NousResearch/hermes-agent (pip install)
- 配置: ~/.hermes/config.yaml + .env

</decisions>

<code_context>
## Existing Code Insights

### 现有 hermes 集成（需兼容）
- `kais-movie-agent/lib/hermes-client.js` — HTTP client，调 :8080/decide 和 :8080/audit
- `kais-movie-agent/lib/hermes-adapter.js` — LLM 路由（不依赖新 hermes 服务，不动）
- `kais-aigc-integration/shared/hermes-decision-client.js` — 旧版 CJS client
- `hermes-worker-agent/hermes/decision_api.py` — 现有 Decision API（将被替代）

### 现有 Decision API 接口（需向后兼容或平滑迁移）
- POST /decide {phase, context} → {decision_id, expert, params, confidence, experts_consulted}
- POST /audit {phase, decision_id, ...metrics}
- GET /health → {status, version, phases}
- GET /experts → {experts, phase_mapping, count}

### 现有服务
- kais-hermes.service (systemd) — 现有 Decision API on :8080
- hermes-worker-agent.service (systemd) — Node.js worker on :3100

</code_context>

<specifics>
## Specific Ideas

1. 新服务代码放在 `docker/hermes-agent/` 目录下（与 gold-team、review-platform 并列）
2. 域配置存放在 `~/.hermes/domains/{domain}/` — skills/、memory/、SOUL.md
3. decide 实现用 AIAgent.chat() 构造决策 prompt，注入目标域的技能和记忆作为上下文
4. 域注册表用 JSON 文件（~/.hermes/domains/registry.json）— 不需要数据库

</specifics>

<deferred>
## Deferred Ideas

- 自学习循环（Phase 8）
- movie-pipeline 域注册（Phase 9）
- 客户端适配和旧服务替换（Phase 10）

</deferred>
