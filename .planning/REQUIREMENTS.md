# Requirements: Hermes Intelligent Decision Engine (v1.1)

**Defined:** 2026-06-06
**Core Value:** 以 NousResearch/hermes-agent 为底座，构建通用智能决策引擎，让管线任务越做越聪明

## v1 Requirements

### 通用决策 API

- [ ] **API-01**: hermes-agent Python 库模式安装并可通过 `from run_agent import AIAgent` 调用
- [ ] **API-02**: FastAPI 服务暴露 `POST /v1/decide` 接受 `{domain, task, context}` 返回 `{decision_id, recommendation, confidence}`
- [ ] **API-03**: FastAPI 服务暴露 `POST /v1/audit` 接受 `{domain, decision_id, outcome, metrics}` 返回 `{recorded, auto_learn_triggered}`
- [ ] **API-04**: FastAPI 服务暴露 `POST /v1/register` 接受 `{domain, description, tasks, skills_manifest}` 注册新域
- [ ] **API-05**: `GET /v1/domains` 列出所有已注册域，`GET /v1/domains/:domain/skills` 列出域技能
- [ ] **API-06**: `GET /v1/health` 返回服务状态和 hermes-agent 引擎状态

### 域隔离与技能系统

- [ ] **DOMAIN-01**: 每个域有独立的技能集（~/.hermes/domains/{domain}/skills/）和记忆（memory/）
- [ ] **DOMAIN-02**: 域注册后 hermes-agent 自动加载该域的 SOUL.md 和技能作为决策上下文
- [ ] **DOMAIN-03**: decide 调用仅使用目标域的技能和记忆，不同域之间互不干扰

### 自学习循环

- [ ] **LEARN-01**: audit 数据写入 hermes-agent 记忆系统（而非 JSON 文件），作为下次 decide 的上下文
- [ ] **LEARN-02**: 连续低分触发 auto-learn（类似现有 _check_auto_learn），hermes-agent 自动提取改进技能
- [ ] **LEARN-03**: decide 返回的 confidence 基于该域该 task 的历史成功率动态计算

### Movie-Pipeline 域注册

- [ ] **MOVIE-01**: 注册 movie-pipeline 域（10 tasks: requirement-bible 到 composition）
- [ ] **MOVIE-02**: 14 个电影专家领域知识（identity/workflow/params_guide/style_guide）转为 hermes 技能
- [ ] **MOVIE-03**: HERMES_DEFAULTS（60+ 行参数默认值）作为 movie-pipeline 域的初始记忆注入
- [ ] **MOVIE-04**: movie-pipeline 域的 SOUL.md 定义电影管线智能决策顾问身份

### 客户端适配

- [ ] **CLIENT-01**: kais-movie-agent 的 hermes-client.js 改为调用 `/v1/decide` 和 `/v1/audit`（含 domain 字段）
- [ ] **CLIENT-02**: hermes 不可用时降级到 HERMES_DEFAULTS（保持现有容错行为）
- [ ] **CLIENT-03**: hermes-adapter.js (LLM 路由) 保持不变，不依赖新 hermes 服务

### 旧服务替换

- [ ] **REPLACE-01**: 新 hermes wrapper service 监听 :8080 替代旧 kais-hermes Decision API
- [ ] **REPLACE-02**: 停用 hermes-worker-agent.service（Node.js :3100）
- [ ] **REPLACE-03**: 新 systemd unit 或 Docker 容器部署 hermes-agent wrapper

## v2 Requirements

### 额外域

- **CODE-01**: code-review 域注册（安全审计、代码审查）
- **DATA-01**: data-pipeline 域注册（ETL 优化、数据质量）

### 高级能力

- **ADV-01**: WebSocket 实时决策推送
- **ADV-02**: 批量决策 `POST /v1/decide/batch`
- **ADV-03**: 域间知识迁移（一个域学到的经验可启发另一个域）

## Out of Scope

| Feature | Reason |
|---------|--------|
| hermes-agent 完整 CLI/Gateway | 只用 Python 库模式，不跑 CLI 或 Gateway |
| 子 agent 委派 | 决策场景不需要子 agent |
| 多平台消息网关 | 不用 hermes 的 Telegram/Discord 网关 |
| 替代 OpenClaw 编排 | OpenClaw 继续做编排，hermes 只做决策 |
| movie-agent 管线代码重构 | 管线代码零改动，只改 hermes-client.js |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| API-01 | Phase 7 | Pending |
| API-02 | Phase 7 | Pending |
| API-03 | Phase 7 | Pending |
| API-04 | Phase 7 | Pending |
| API-05 | Phase 7 | Pending |
| API-06 | Phase 7 | Pending |
| DOMAIN-01 | Phase 7 | Pending |
| DOMAIN-02 | Phase 7 | Pending |
| DOMAIN-03 | Phase 7 | Pending |
| LEARN-01 | Phase 8 | Pending |
| LEARN-02 | Phase 8 | Pending |
| LEARN-03 | Phase 8 | Pending |
| MOVIE-01 | Phase 9 | Pending |
| MOVIE-02 | Phase 9 | Pending |
| MOVIE-03 | Phase 9 | Pending |
| MOVIE-04 | Phase 9 | Pending |
| CLIENT-01 | Phase 10 | Pending |
| CLIENT-02 | Phase 10 | Pending |
| CLIENT-03 | Phase 10 | Pending |
| REPLACE-01 | Phase 10 | Pending |
| REPLACE-02 | Phase 10 | Pending |
| REPLACE-03 | Phase 10 | Pending |

**Coverage:**
- v1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-06*
*Last updated: 2026-06-06 after initial definition*
