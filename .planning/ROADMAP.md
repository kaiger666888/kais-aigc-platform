# Roadmap: Hermes Intelligent Decision Engine (v1.1)

## Overview

以 NousResearch/hermes-agent 为底座，构建通用智能决策引擎。4 个阶段：先搭建域无关 API 和域注册机制，再接通自学习循环，然后注册 movie-pipeline 为首个域并迁移领域知识，最后适配客户端并替换旧服务。

## Phases

- [x] **Phase 7: Hermes Agent Core Service** - 安装 hermes-agent 并构建域无关 REST API wrapper (completed 2026-06-06)
- [x] **Phase 8: Learning Loop Integration** - 接通 audit → memory → improve decide 自学习闭环 (completed 2026-06-06)
- [ ] **Phase 9: Movie-Pipeline Domain Setup** - 注册首个域并迁移 14 专家知识
- [ ] **Phase 10: Client Adaptation & Cutover** - 适配客户端、替换旧服务、端到端验证

## Phase Details

### Phase 7: Hermes Agent Core Service

**Goal**: hermes-agent Python 库安装可用，域无关 REST API 服务运行在 :8080，支持 decide/audit/register/health
**Depends on**: Nothing
**Requirements**: API-01, API-02, API-03, API-04, API-05, API-06, DOMAIN-01, DOMAIN-02, DOMAIN-03
**Success Criteria**:

1. `from run_agent import AIAgent` 可正常调用，AIAgent.chat() 返回有效响应
2. `POST /v1/register` 可注册一个测试域，`GET /v1/domains` 返回已注册域列表
3. `POST /v1/decide` 对已注册域返回 `{decision_id, recommendation, confidence}`
4. `POST /v1/audit` 接受指标并返回 `{recorded, auto_learn_triggered: false}`
5. `GET /v1/health` 返回 hermes-agent 引擎和域注册表状态
6. 未注册域的 decide 调用返回 404

**Plans**: 3 plans

Plans:
**Wave 1**

- [x] 07-01-PLAN.md — Install hermes-agent + scaffold project + build domain registry, agent factory, decision engine core

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-02-PLAN.md — Implement FastAPI REST API layer with all /v1/* endpoints

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 07-03-PLAN.md — Unit tests + integration tests for all Phase 7 requirements

### Phase 8: Learning Loop Integration

**Goal**: audit 数据真正进入 hermes-agent 记忆系统，decide 的 confidence 基于历史动态计算
**Depends on**: Phase 7
**Requirements**: LEARN-01, LEARN-02, LEARN-03
**Success Criteria**:

1. audit 写入的数据可通过 `GET /v1/domains/:domain/memory` 查询到
2. 连续 3 次低分 audit 后，下次 decide 返回 `auto_learn_triggered: true`
3. 同一 task 执行 5 次 audit 后，decide 的 confidence 值与初始值不同（说明在学习）
4. 域 A 的 audit 数据不影响域 B 的 decide 结果

**Plans**: 2 plans

**Wave 1**

- [x] 08-01-PLAN.md -- TDD: DomainMemory helper class (audit aggregation, EWMA confidence, auto-learn trigger, memory query)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-02-PLAN.md -- Wire DomainMemory into DecisionEngine + add GET /v1/domains/{domain}/memory endpoint + integration tests

### Phase 9: Movie-Pipeline Domain Setup

**Goal**: movie-pipeline 域注册完成，14 专家知识转为 hermes 技能，初始参数作为记忆注入
**Depends on**: Phase 7
**Requirements**: MOVIE-01, MOVIE-02, MOVIE-03, MOVIE-04
**Success Criteria**:

1. `POST /v1/register` 注册 movie-pipeline 域含 10 个 tasks
2. `GET /v1/domains/movie-pipeline/skills` 返回 14 个专家技能
3. 对 soul-visual task 调用 decide，返回包含 FLUX 参数推荐（基于初始记忆）
4. movie-pipeline 域的 SOUL.md 定义了电影管线决策顾问身份

**Plans**: 2 plans

Plans:
**Wave 1**

- [x] 09-01-PLAN.md -- Register movie-pipeline domain + create SOUL.md + inject HERMES_DEFAULTS seed memory

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 09-02-PLAN.md -- Migrate 14 expert skills as hermes skills + verify decide returns domain-aware response

### Phase 10: Client Adaptation & Cutover

**Goal**: kais-movie-agent 连上新 hermes 服务，旧服务停用，端到端验证
**Depends on**: Phase 8, Phase 9
**Requirements**: CLIENT-01, CLIENT-02, CLIENT-03, REPLACE-01, REPLACE-02, REPLACE-03
**Success Criteria**:

1. hermes-client.js 调用 `/v1/decide` 和 `/v1/audit`（含 domain 字段），管线正常运行
2. hermes 服务不可用时，movie-agent 自动降级到 HERMES_DEFAULTS，管线不中断
3. 旧 kais-hermes.service 和 hermes-worker-agent.service 已停止并禁用
4. 新 hermes-agent wrapper 作为 systemd service 或 Docker 容器运行并通过 health check

**Plans**: 3 plans

**Wave 1**

- [ ] 10-01-PLAN.md -- Create hermes-client.js (decide/audit + HERMES_DEFAULTS fallback) + unit tests
- [ ] 10-02-PLAN.md -- Dockerfile + docker-compose hermes-agent service + migration documentation

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 10-03-PLAN.md -- End-to-end validation (health, register, decide, audit, multi-task) against Docker container

## Progress

**Execution Order:** 7 → 8 (parallel with 9) → 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Hermes Agent Core Service | 3/3 | Complete   | 2026-06-06 |
| 8. Learning Loop Integration | 2/2 | Complete   | 2026-06-06 |
| 9. Movie-Pipeline Domain Setup | 2/2 | Complete   | 2026-06-06 |
| 10. Client Adaptation & Cutover | 0/3 | Not started | - |
