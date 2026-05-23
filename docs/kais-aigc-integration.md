# kais-aigc-integration 改造文档

> **版本**: V6.0  
> **日期**: 2026-05-23  
> **定位**: kais-aigc-platform 的集成测试与 CI/CD 协调项目  
> **来源**: V6.0 Final Architecture (`docs/architecture.md`) + 审计报告 (`context/audit-aigc-integration.md`)

---

## 目录

1. [改造目标](#1-改造目标)
2. [模块迁移清单](#2-模块迁移清单)
3. [迁移后的职责](#3-迁移后的职责)
4. [保留和扩展](#4-保留和扩展)
5. [迁移步骤和依赖关系](#5-迁移步骤和依赖关系)
6. [验收标准](#6-验收标准)
7. [风险与缓解](#7-风险与缓解)

---

## 1. 改造目标

### 1.1 当前问题

kais-aigc-integration 当前承载 4 个功能模块（gold-team-control / gold-team-worker / movie-agent-integration / review-platform-extension），存在以下结构性问题：

- **Mock 实现**：gold-team-control 的 task_store 是内存实现，worker 的引擎适配器是桩代码
- **代码重叠**：review-platform-extension 与 kais-review-platform 有大量重复（state_machine / policy / security / schemas）
- **架构冲突**：movie-agent-integration 是独立 Express 应用，而 V6.0 目标是 kais-movie-agent 作为 Docker 服务
- **基础设施缺失**：docker-compose 不含 Redis，SSE/回调依赖未配置
- **测试不真实**：集成测试大量 mock，无真实服务间通信验证

### 1.2 改造目标

将 kais-aigc-integration 从"4 模块 Mock 集成项目"重新定位为 **kais-aigc-platform 的集成测试和 CI/CD 协调项目**：

```
改造前                                    改造后
┌──────────────────────────┐             ┌──────────────────────────┐
│ gold-team-control/       │ ──迁移──→   │ kais-core-backend        │
│ gold-team-worker/        │ ──迁移──→   │ kais-gold-team           │
│ movie-agent-integration/ │ ──迁移──→   │ kais-movie-agent         │
│ review-platform-extension│ ──迁移──→   │ kais-review-platform     │
├──────────────────────────┤             ├──────────────────────────┤
│ docker-compose.yml       │ ──重写──→   │ V6.0 全栈编排             │
│ tests/                   │ ──扩展──→   │ 跨仓库 E2E 集成测试       │
│ docs/                    │ ──分发──→   │ 跨系统契约文档            │
│ crew.js                  │ ──保留──→   │ 自动化管线定义            │
└──────────────────────────┘             └──────────────────────────┘
```

### 1.3 改造后的角色

kais-aigc-integration 成为 **"胶水层"**——连接 5 个独立 Docker 服务（core-backend / movie-agent / gold-team / review-platform / ComfyUI），确保系统整体可用：

- 不含任何业务逻辑代码
- 不含任何功能模块的 Docker 镜像
- 只负责编排、测试、验证、CI/CD

---

## 2. 模块迁移清单

### 2.1 总览

| # | 当前模块 | 代码量 | 目标项目 | 迁移动作 | 优先级 | 预估工时 |
|---|---------|--------|---------|---------|--------|---------|
| 1 | `gold-team-control/` | ~600 行 (8 文件) | **kais-core-backend** (Jellyfish) | 重构迁移：Control Node Gateway → Jellyfish TaskRouter | P0 | 3 天 |
| 2 | `gold-team-worker/` | ~1500 行 (16 文件) | **kais-gold-team** (统一执行 Agent) | 合并：引擎适配器、容器管理、回调 → Guardian/Executor | P0 | 5 天 |
| 3 | `movie-agent-integration/` | ~1200 行 (18 文件) | **kais-movie-agent** (Docker 服务) | 拆分：客户端库 → lib/；Express API → server.js HTTP 入口 | P1 | 4 天 |
| 4 | `review-platform-extension/` | ~1800 行 (18 文件) | **kais-review-platform** (治理层) | 合并：多候选审核、评分、批量 API → 已有代码库 | P1 | 4 天 |

**总代码量**: ~5900 行 (66 文件)  
**总迁移工时**: ~16 天

### 2.2 Module 1: gold-team-control → kais-core-backend

**当前状态**: FastAPI Gateway（端口 8900），任务 CRUD + SSE 事件广播，内存存储

| 组件 | 当前实现 | 迁移目标 | 策略 |
|------|---------|---------|------|
| `app/main.py` | FastAPI app, 任务 CRUD + SSE | Jellyfish `routers/tasks.py` | 保持 API 兼容，融入 Jellyfish 路由体系 |
| `app/core/security.py` | API Key + HMAC 验证 | Jellyfish `core/auth.py` | 适配 Jellyfish JWT 体系 |
| `app/core/events.py` | SSE 事件广播（内存） | Jellyfish `core/events.py` | 改用 Redis Pub/Sub |
| `app/models/task.py` | Pydantic 任务模型 | Jellyfish `models/task.py` | 扩展为 V6.0 统一任务模型 |
| `app/services/task_store.py` | 内存存储 | **废弃** | Jellyfish 用 PostgreSQL/SQLite 持久化 |
| `Dockerfile` + `requirements.txt` | Python 3.12 独立镜像 | **废弃** | 融入 Jellyfish 统一镜像 |

**迁移风险**: 低。API 接口设计可直接复用，核心改动仅存储层从内存换持久化。

### 2.3 Module 2: gold-team-worker → kais-gold-team

**当前状态**: GPU Worker（端口 8903），6 个引擎适配器（blender / facefusion / ace_step / tts / woosh / parallax），Docker 容器管理

| 组件 | 当前实现 | 迁移目标 | 策略 |
|------|---------|---------|------|
| `app/engines/*.py` | 6 个引擎适配器 | kais-gold-team Executor 引擎适配层 | **先 diff 对比**，只合并 worker 独有功能 |
| `app/engines/registry.py` | 引擎注册表 | kais-gold-team Hypervisor | 可能已被覆盖，需对比 |
| `app/services/container_manager.py` | Docker 容器管理 | kais-gold-team Executor | 对比取优 |
| `app/services/callback_client.py` | 回调到 Control Node | 保留但改调 Jellyfish (core-backend) | URL 更新 |
| `app/services/file_transport.py` | Syncthing + SFTP 双通道 | kais-gold-team 已有等价实现 | **可能废弃** |
| `app/services/resource_monitor.py` | GPU/内存监控 | kais-gold-team 监控层 | 合并 |
| `app/services/error_handler.py` | 错误分类与恢复 | kais-gold-team Guardian | 合并 |
| `app/services/task_executor.py` | 任务执行编排 | kais-gold-team Guardian | 对比合并 |

**⚠️ 关键注意**: kais-gold-team 已有成熟的 Guardian / Executor / Hypervisor，worker 的引擎适配器可能是简化版。**必须先 diff 对比**，避免盲目合并引入倒退。

**迁移风险**: 中。需仔细对比，避免功能冲突。

### 2.4 Module 3: movie-agent-integration → kais-movie-agent

**当前状态**: TypeScript/Express 集成层（端口 3000），Gold Team 客户端 + Review Platform 客户端 + 审核中间件

| 组件 | 当前实现 | 迁移目标 | 策略 |
|------|---------|---------|------|
| `src/clients/gold-team-client.ts` | Gold Team HTTP 客户端 | `kais-movie-agent/lib/gold-team-client.js` | TS → JS 适配 |
| `src/clients/review-platform-client.ts` | Review Platform HTTP 客户端 | kais-movie-agent 已有 `lib/review-platform-client.js` | 合并差异 |
| `src/middleware/review-middleware.ts` | 审核中间件 | kais-movie-agent `lib/pipeline.js` review hook | 融入管线 |
| `src/review/*.ts` | 审核门控/回调/状态管理 | `lib/hooks/` + `lib/interactive-review.js` | 逻辑迁移 |
| `src/services/task-manager.ts` | 任务管理 | kais-movie-agent Pipeline 编排 | 融入 |
| `src/state/state-machine.ts` | 状态机 | kais-movie-agent GitStageManager | 评估是否需要 |
| `src/utils/*.ts` | HMAC/重试/缓存/日志 | 部分可复用 | TS → JS |
| `src/index.ts` | Express 应用入口 | **评估** | V6.0 中 movie-agent 是 Docker 服务，可改造复用 |
| `Dockerfile` | Node.js 容器 | V6.0 kais-movie-agent Docker 服务 | 保留改造 |

**迁移风险**: 中高。需 TS → JS 适配，且 movie-agent 从 skill 架构转向 Docker 服务。

### 2.5 Module 4: review-platform-extension → kais-review-platform

**当前状态**: FastAPI 审核扩展（端口 8090），多候选审核 + 评分 + 批量 API

| 组件 | 当前实现 | 迁移目标 | 策略 |
|------|---------|---------|------|
| `app/api/v1/reviews.py` | 多候选审核 API | 合并到 kais-review-platform `app/api/v1/reviews.py` | 新增功能 |
| `app/api/v1/batch.py` | 批量审核 | 新增到 kais-review-platform | 新增 |
| `app/api/v1/events.py` | SSE 事件 | kais-review-platform 已有 SSE | 合并增强 |
| `app/api/v1/webhooks.py` | Webhook 管理 | 合并到 kais-review-platform | 新增 |
| `app/core/policy.py` | 策略引擎 | kais-review-platform 已有 | **重点对比差异** |
| `app/core/state_machine.py` | 4 态状态机 | kais-review-platform 已有 | **可能废弃** |
| `app/core/security.py` | HMAC + API Key | kais-review-platform 已有 | 不迁移 |
| `app/core/events.py` | 事件总线 | 合并差异 | 对比 |
| `app/models/schemas.py` | 多候选/评分 Schema | 合并到 kais-review-platform Schema | 新增字段 |
| `app/models/orm.py` | ORM 模型 | 合并 candidates 表 | 新增表 |
| `app/policies/*.yaml` | 策略文件 | 迁移到 kais-review-platform `policies/` | 复制 |
| `app/services/callback_service.py` | 回调投递 | kais-review-platform 已有 | 对比差异 |
| `migrations/add_candidates.py` | DB 迁移 | 应用到 kais-review-platform | 直接应用 |

**迁移策略**: 以 kais-review-platform 为主，只 cherry-pick extension 中的**新增功能**（多候选、评分、批量），重叠的核心模块不迁移。

**迁移风险**: 低中。重叠度高但新增功能明确。

---

## 3. 迁移后的职责

模块全部迁移后，kais-aigc-integration 保留以下 4 项核心职责：

### 3.1 全栈集成测试

作为跨仓库集成测试的唯一归属地，验证 5 个独立 Docker 服务之间的协作正确性。

**测试层级**:

```
Level 1: 单元测试    → 各项目各自运行
Level 2: 服务测试    → docker-compose 启动后对每个服务单独测试
Level 3: 集成测试    → kais-aigc-integration 的 tests/ 目录（本仓库）
Level 4: 端到端测试  → 模拟完整用户流程（从创建项目到导出交付）
```

**测试矩阵**:

| 测试类型 | 覆盖范围 | 执行频率 |
|---------|---------|---------|
| 契约兼容性 | 各服务 API 符合 OpenAPI spec | 每次合并 |
| 跨服务流程 | movie-agent → core-backend → gold-team → review-platform → callback | 每日 |
| 部署冒烟 | 每个服务 health check + 基本功能 | 每次部署 |
| 数据一致性 | 任务状态在多个服务间一致 | 每日 |
| 故障容错 | 服务降级、超时、重试、回滚 | 每周 |

### 3.2 Docker Compose 编排

管理 V6.0 全栈 docker-compose.yml，编排所有服务的一键启动/停止。

**服务清单**:

| 服务 | 镜像 | 端口 | 依赖 |
|------|------|------|------|
| core-backend | `kais-core-backend:latest` | 8000 | redis, postgres |
| movie-agent | `kais-movie-agent:latest` | 8001 | core-backend, gold-team, review-platform |
| gold-team | `kais-gold-team:latest` | 8002 | redis, core-backend |
| review-platform | `kais-review-platform:latest` | 8090 | redis, postgres |
| comfyui | ComfyUI 镜像 | 8188 | — |
| redis | `redis:7-alpine` | 6379 | — |
| postgres | `postgres:15-alpine` | 5432 | — |

**编排原则**:
- 所有端口绑定 `127.0.0.1`，外部访问通过 Tailscale VPN
- 服务名作为 DNS 主机名（Docker Compose 内置）
- 产物路径 `/mnt/agents/output/` 统一挂载
- 环境变量配置服务 URL，不硬编码

### 3.3 E2E 测试框架

基于 pytest + httpx 的端到端测试框架，模拟真实用户场景。

**框架结构**:

```
tests/
├── conftest.py                  # 共享 fixtures（服务 URL、认证、清理）
├── contracts/                   # API 契约测试
│   └── test_contract_compatibility.py
├── integration/                 # 跨服务集成测试
│   ├── test_cross_service_flow.py
│   ├── test_gold_team_integration.py
│   ├── test_movie_agent_integration.py
│   └── test_data_consistency.py
├── resilience/                  # 容错与性能测试
│   ├── test_fault_tolerance.py
│   └── test_performance.py
├── smoke/                       # 部署冒烟测试
│   └── test_deployment_smoke.py
└── e2e/                         # 完整用户流程
    └── test_full_pipeline.py
```

**新增测试用例（V6.0）**:

| 测试 | 覆盖流程 |
|------|---------|
| `test_cross_service_flow` | movie-agent → core-backend → gold-team → review-platform → callback 完整链路 |
| `test_contract_compatibility` | 各服务 API 响应符合 OpenAPI spec |
| `test_deployment_smoke` | 每个服务 health check + 基本功能验证 |
| `test_data_consistency` | 任务状态在多服务间同步一致 |

### 3.4 CI/CD 流水线

基于 GitHub Actions 的 CI 管线，拉取各项目 Docker 镜像 → 启动 → 运行集成测试。

**流水线结构**:

```
.github/workflows/
├── integration-test.yml         # 主流水线
│   ├── 拉取最新 Docker 镜像
│   ├── docker-compose up -d
│   ├── 等待所有服务就绪 (health check)
│   ├── 运行 Level 3 集成测试
│   ├── 运行 Level 4 E2E 测试
│   └── docker-compose down
├── contract-check.yml           # 契约变更检测
└── nightly-e2e.yml              # 每日全量 E2E
```

---

## 4. 保留和扩展

### 4.1 保留资产

| 资产 | 说明 | 处理方式 |
|------|------|---------|
| `crew.js` | 3 层调研+架构设计管线定义 | 原样保留，可复用模式 |
| `tests/test_hmac_signing.py` | HMAC-SHA256 签名验证 | 直接保留，协议层不变 |
| `tests/test_sse_events.py` | SSE 事件流测试 | 直接保留，协议层不变 |
| `tests/test_fault_tolerance.py` | 容错/降级测试 | 直接保留，场景通用 |
| `tests/test_performance.py` | 性能基准 | 直接保留，框架可复用 |
| `start.sh` | 一键启动脚本 | 保留并升级 |
| `docs/` 中的跨系统文档 | API 契约、数据流图 | 保留并精简 |

### 4.2 需适配的资产

| 资产 | 改动内容 |
|------|---------|
| `tests/test_gold_team_integration.py` | gold-team-control `/api/tasks` → core-backend 路由 |
| `tests/test_movie_agent_integration.py` | mock 改为调用真实 kais-movie-agent Docker 服务 |
| `modules/integration-tests/test_e2e.py` | 重写为 V6.0 全栈 E2E |

### 4.3 docker-compose.yml 升级为 V6.0 架构

从 4 服务 Mock 编排升级为 7 服务真实编排：

```yaml
# 改造前 (v1.0-draft)
services:
  control-node:     # FastAPI, 内存存储 → 废弃
  worker-node:      # 模拟 GPU 引擎 → 废弃
  movie-agent:      # Express 集成层 → 废弃
  review-platform:  # 扩展层 → 废弃
# 无 Redis，无 PostgreSQL

# 改造后 (V6.0 Final)
services:
  core-backend:     # kais-core-backend:latest (Jellyfish FastAPI) :8000
  movie-agent:      # kais-movie-agent:latest (Node.js) :8001
  gold-team:        # kais-gold-team:latest (Python) :8002
  review-platform:  # kais-review-platform:latest (FastAPI) :8090
  comfyui:          # ComfyUI Worker :8188
  redis:            # redis:7-alpine :6379
  postgres:         # postgres:15-alpine :5432
```

**升级步骤（渐进式）**:

1. **Step 1**: 在当前 compose 中添加 Redis + PostgreSQL，验证 review-platform 和 gold-team 可连接
2. **Step 2**: 逐个替换为真实镜像（先 review-platform → 再 gold-team → 再 movie-agent → 最后 core-backend）
3. **Step 3**: 移除旧的 control-node / worker-node 服务定义
4. **Step 4**: 添加 ComfyUI Worker 服务

### 4.4 集成测试框架扩展

**新增目录结构**:

```
kais-aigc-integration/
├── .github/workflows/           # [新增] CI 管线
├── contracts/                   # [新增] API 契约文件（OpenAPI specs）
│   ├── core-backend.openapi.yml
│   ├── movie-agent.openapi.yml
│   ├── gold-team.openapi.yml
│   └── review-platform.openapi.yml
├── scripts/                     # [新增] 跨项目部署和验证脚本
│   ├── wait-for-services.sh
│   ├── run-integration-tests.sh
│   └── smoke-test.sh
├── tests/                       # [扩展] 集成测试
│   ├── contracts/               # [新增] 契约兼容性测试
│   ├── integration/             # [适配+新增] 跨服务测试
│   ├── resilience/              # [保留] 容错与性能测试
│   ├── smoke/                   # [新增] 部署冒烟测试
│   └── e2e/                     # [新增] 端到端流程测试
├── docker-compose.yml           # [重写] V6.0 全栈编排
├── crew.js                      # [保留] 管线定义
└── start.sh                     # [升级] 一键启动
```

### 4.5 故障容错测试保留

现有容错测试套件完整保留，并扩展覆盖 V6.0 新场景：

| 现有测试 | 覆盖场景 | 状态 |
|---------|---------|------|
| 服务宕机恢复 | gold-team / review-platform 不可用后恢复 | ✅ 保留 |
| 超时降级 | 引擎超时后云端降级 | ✅ 保留 |
| 回调重试 | 回调失败自动重试 | ✅ 保留 |
| 数据一致性 | 状态在服务间同步 | ✅ 保留 |

| 新增测试 | 覆盖场景 |
|---------|---------|
| Redis 宕机 | Redis 不可用时服务降级行为 |
| PostgreSQL 宕机 | DB 不可用时的写缓冲和恢复 |
| ComfyUI Worker 挂起 | GPU 推理超时后的任务重新调度 |
| 全链路超时 | movie-agent → gold-team → ComfyUI 多级超时传播 |
| 竞态条件 | 并发任务提交时的资源争抢 |

---

## 5. 迁移步骤和依赖关系

### 5.1 依赖拓扑

```
Phase 0: review-platform-extension → kais-review-platform
         (无外部依赖，最独立，可立即开始)
              │
Phase 1: gold-team-worker → kais-gold-team
         (需要 review-platform 的审核回调接口稳定)
              │
Phase 2: gold-team-control → kais-core-backend (Jellyfish)
         (需要 gold-team-worker 的引擎适配层已合并)
              │
Phase 3: movie-agent-integration → kais-movie-agent
         (依赖 core-backend 和 review-platform 的 API 稳定)
              │
Phase 4: docker-compose 重写 + 集成测试扩展
         (所有模块迁移完成后)
              │
Phase 5: kais-aigc-integration 仓库清理
         (移除 modules/，完成改造)
```

### 5.2 详细执行计划

| Phase | 任务 | 前置依赖 | 预估工时 | 验收标准 |
|-------|------|---------|---------|---------|
| **P0** | review-platform-extension 合并到 kais-review-platform | 无 | 4 天 | 多候选审核 + 评分 + 批量 API 在 kais-review-platform 中通过全部测试 |
| **P1** | gold-team-worker 引擎适配器合并到 kais-gold-team | P0 | 5 天 | 6 引擎适配器在 kais-gold-team Guardian 中可正常调度 |
| **P2** | gold-team-control API 融入 kais-core-backend (Jellyfish) | P1 | 3 天 | 任务 CRUD + SSE + HMAC 在 Jellyfish 中工作，API 兼容 |
| **P3** | movie-agent-integration 客户端库融入 kais-movie-agent | P0 + P2 | 4 天 | gold-team-client + review-platform-client 在 kais-movie-agent pipeline 中工作 |
| **P4** | docker-compose 重写 + 集成测试扩展 | P0-P3 | 3 天 | 全栈 `docker-compose up` → 端到端测试通过 |
| **P5** | kais-aigc-integration 仓库清理 | P4 | 1 天 | `modules/` 目录删除，保留 tests/ + docs/ + docker-compose.yml |

**总工时**: ~20 天（含测试和验证）

### 5.3 可并行任务

```
P0 (review-platform 合并) ──┐
                            ├── 可并行
P1 (gold-team-worker 合并) ─┘
                            
P2 和 P3 不可并行——P3 依赖 P2 的 core-backend API 稳定
```

### 5.4 甘特图

```
Week 1-2: [P0: review-platform 合并]  [P1: gold-team-worker 合并]
Week 3:   [P1 续]                      [P2: control-node → core-backend]
Week 4:   [P2 续]                      [P3: movie-agent-integration 合并]
Week 5:   [P3 续]                      [P4: docker-compose + 测试扩展]
Week 6:   [P4 续]                      [P5: 仓库清理]
```

### 5.5 每个迁移模块的清理动作

模块迁移完成后，在 kais-aigc-integration 中执行以下清理：

| Phase | 删除内容 | 保留内容 |
|-------|---------|---------|
| P0 完成后 | `modules/review-platform-extension/` | 对应测试文件移入 `tests/integration/` |
| P1 完成后 | `modules/gold-team-worker/` | 对应测试文件适配后移入 `tests/integration/` |
| P2 完成后 | `modules/gold-team-control/` | 对应测试文件适配后移入 `tests/integration/` |
| P3 完成后 | `modules/movie-agent-integration/` | 对应测试文件适配后移入 `tests/integration/` |
| P5 最终 | 确认 `modules/` 目录为空并删除 | `ARCHITECTURE.md` 精简为跨系统文档 |

---

## 6. 验收标准

### 6.1 迁移完成标准

- [ ] `modules/` 目录已完全删除
- [ ] 4 个模块的代码在目标项目中通过各自单元测试
- [ ] kais-aigc-integration 不含任何业务逻辑代码

### 6.2 集成测试通过标准

- [ ] `docker-compose up` 一键启动 7 个服务
- [ ] 所有服务 health check 返回 200
- [ ] Level 3 集成测试全部通过（跨服务流程、契约兼容性）
- [ ] Level 4 E2E 测试通过（完整用户流程）
- [ ] 容错测试通过（服务宕机恢复、超时降级）

### 6.3 CI/CD 就绪标准

- [ ] GitHub Actions 流水线可自动拉取镜像并运行测试
- [ ] 契约变更检测正常工作
- [ ] 每日全量 E2E 定时运行

---

## 7. 风险与缓解

### 7.1 迁移风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| gold-team-worker 引擎适配器是简化版，合并可能引入倒退 | 中 | **先 diff 对比** kais-gold-team 现有 Guardian/Executor，只合并独有功能 |
| review-platform-extension 与 kais-review-platform 大量重叠 | 低 | 以 kais-review-platform 为主，只 cherry-pick 新增功能 |
| movie-agent-integration TypeScript 代码需转 JS | 中 | 只迁移核心逻辑（客户端库），Express 入口和 TS 基础设施不迁移 |
| Jellyfish (kais-core-backend) 尚未完成深度改造 | 高 | 先完成 Jellyfish 架构确认再迁移 Control Node；P2 可延后 |

### 7.2 集成测试风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Docker 镜像构建失败阻塞测试 | 中 | CI 中缓存镜像层；本地开发用 `docker-compose build` |
| GPU 依赖导致 CI 无法运行 GPU 测试 | 中 | CI 中用 mock GPU 模式；GPU 测试仅在本地或有 GPU 的 runner 运行 |
| 测试环境与生产环境不一致 | 低 | 同一份 docker-compose.yml 用于开发和 CI |

### 7.3 不可妥协的底线

| # | 原则 | 验证方法 |
|---|------|---------|
| 1 | kais-aigc-integration **不含业务逻辑** | 代码审查：无 CRUD、无状态机、无策略引擎 |
| 2 | 所有服务端口绑定 `127.0.0.1` | docker-compose.yml 审查 + `netstat` 验证 |
| 3 | 大文件零 HTTP（产物走文件系统路径） | API 审查：所有端点只传元数据 |
| 4 | 测试可重复执行（幂等性） | 连续运行两次测试，结果一致 |
| 5 | CI 管线失败时阻塞合并 | GitHub branch protection rule 配置 |
