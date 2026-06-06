# Phase 10: Client Adaptation & Cutover - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous mode)

<domain>
## Phase Boundary

连接 kais-movie-agent 到新 hermes-agent 服务，完成客户端适配、服务部署和端到端验证。
包括：创建 hermes-client.js 调用新 API、降级容错、Docker 部署、旧服务迁移文档、E2E 验证。

</domain>

<decisions>
## Implementation Decisions

### Hermes Client Design
- 单文件 hermes-client.js，导出 async 函数（decide, audit）— 与 movie-agent 现有 gold-team-client.js 模式一致
- HERMES_DEFAULTS 内嵌在 hermes-client.js 中，按 task 分组（soul-visual, video-gen, voice 等）— 零外部依赖，始终可用
- 超时 5s，1 次重试延迟 1s — 快速降级到 defaults，管线永不阻塞
- domain 硬编码 "movie-pipeline" — 当前唯一域，避免配置复杂度

### Integration Points
- 7 个有 review 的管线阶段调用 hermes decide：art-direction, character, scenario, storyboard, scene, camera-preview, camera-final
- 各 phase handler 显式 import hermes-client — 易追踪，非全局拦截
- 每个阶段生成任务完成后调用 /v1/audit — 传入 pass/fail + metrics，驱动学习循环
- decide 传入阶段特定上下文：当前参数、前序结果、风格偏好 — 聚焦决策相关数据

### Deployment Strategy
- hermes-agent 加入 docker-compose.v9.yml — 与 gold-team、core-backend 并列
- 旧 hermes-worker-agent (Node.js :3100) 从未部署到 Docker，仅需文档记录迁移说明
- 健康检查 GET /v1/health，无外部依赖（无状态服务），movie-agent 可选择依赖 hermes-agent healthy
- 创建最小 Python Dockerfile — pip install requirements + uvicorn main，无 GPU

### End-to-End Verification
- 单元测试 hermes-client.js（mock HTTP）+ 集成测试脚本调用真实 hermes-agent Docker 容器
- E2E 脚本：注册 movie-pipeline 域 → 各 task decide → 验证响应 → audit → 检查 memory stats
- 单元测试 mock ECONNREFUSED 验证降级到 HERMES_DEFAULTS
- 文档检查：确认 docker-compose 无旧 :3100 端口引用，docs 更新

### Claude's Discretion
- hermes-client.js 的具体错误日志格式
- Dockerfile 的 Python 基础镜像版本选择
- 测试文件的具体组织方式

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `docker/hermes-agent/src/main.py` — FastAPI 应用入口，CORS 已配置，路由挂载 /v1
- `docker/hermes-agent/src/api/routes.py` — 完整的 REST API（register, decide, audit, health, domains, memory）
- `docker/hermes-agent/src/api/models.py` — Pydantic 请求/响应模型（DecideRequest/Response, AuditRequest/Response）
- `docker/hermes-agent/src/config.py` — 配置管理（端口 8080, LLM 设置）
- `docker/hermes-agent/scripts/register_movie_pipeline.py` — 域注册脚本，含 SEED_MEMORY 默认值
- `docker/movie-agent/lib/gold-team-client.js` — 现有 HTTP client 模式参考
- `docker/movie-agent/lib/pipeline.js` — PHASES 数组定义 11 个管线阶段
- `docker-compose.v9.yml` — 现有 Docker 编排（core-backend, gold-team, comfyui-primary/auxiliary, redis, audit-db）

### Established Patterns
- movie-agent HTTP client 模式：async 函数 + fetch + 超时控制（gold-team-client.js）
- Docker 服务编排：kais-net bridge 网络 + healthcheck + depends_on
- FastAPI 路由：Pydantic 验证 + dependency injection + router 前缀 /v1
- 域目录结构：~/.hermes/domains/{domain}/skills/ + memory/ + SOUL.md

### Integration Points
- `POST /v1/decide` — hermes-client.js 主调用入口（{domain, task, context} → {decision_id, recommendation, confidence}）
- `POST /v1/audit` — 阶段完成后反馈（{domain, decision_id, outcome, metrics}）
- `GET /v1/health` — 健康检查（{status, engine, domains_count, domains}）
- docker-compose.v9.yml — 新增 hermes-agent service 条目
- movie-agent phase handlers — 各阶段 import hermes-client 并在生成前调用 decide

</code_context>

<specifics>
## Specific Ideas

1. hermes-client.js 放在 `docker/movie-agent/lib/hermes-client.js` — 与 gold-team-client.js 并列
2. HERMES_DEFAULTS 至少包含 soul-visual (FLUX params), video-gen (Wan2.2 params), voice (CosyVoice params) 三类任务参数
3. Dockerfile 放在 `docker/hermes-agent/Dockerfile`，基于 python:3.11-slim
4. E2E 验证脚本放在 `docker/hermes-agent/tests/test_e2e.py`，可用 pytest 运行
5. 管线阶段通过 `import { decide, audit } from './hermes-client.js'` 调用

</specifics>

<deferred>
## Deferred Ideas

- hermes-adapter.js (LLM 路由) 保持不变 — CLIENT-03 明确不依赖新服务
- 全自动管线运行验证 — 超出 Phase 10 范围，需要完整 GPU 环境
- WebSocket 实时决策推送 — v2 特性
- 批量决策接口 — v2 特性

</deferred>
