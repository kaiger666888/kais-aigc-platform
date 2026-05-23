# 审计报告：kais-aigc-integration → V6.0 Final Architecture 迁移分析

**日期**: 2026-05-23  
**审计范围**: kais-aigc-integration 仓库全量代码  
**对比基准**: Notion V6.0 Final Architecture  

---

## 一、现状概览

### 1.1 仓库结构

```
kais-aigc-integration/
├── crew.js                          # 3层调研+架构设计管线定义
├── docker-compose.yml               # 4服务一键部署
├── modules/
│   ├── gold-team-control/           # Module 1: FastAPI Gateway (8900)
│   ├── gold-team-worker/            # Module 2: GPU Worker (8903)
│   ├── movie-agent-integration/     # Module 3: TypeScript/Express 集成层 (3000)
│   └── review-platform-extension/   # Module 4: FastAPI 审核扩展 (8090)
├── tests/                           # 6个集成测试文件
├── docs/                            # 架构文档 + ADR + API Reference + 部署指南
├── start.sh                         # 一键启动脚本
└── ARCHITECTURE.md                  # 架构总览
```

### 1.2 代码规模统计

| 模块 | 技术栈 | 源文件数 | 核心代码行 | 测试文件数 |
|------|--------|----------|-----------|-----------|
| gold-team-control | Python/FastAPI | 8 (.py) | ~600 | 5 |
| gold-team-worker | Python/FastAPI | 16 (.py) | ~1500 | 1 |
| movie-agent-integration | TypeScript/Express | 18 (.ts) | ~1200 | 9 |
| review-platform-extension | Python/FastAPI | 18 (.py) | ~1800 | 9 |
| 顶层集成测试 | Python/pytest | 6 (.py) | ~800 | - |
| **合计** | - | **66** | **~5900** | **24** |

### 1.3 代码质量评估

**优点**:
- 模块化清晰，4个 Docker 服务职责分明
- API 接口设计完整（CRUD + SSE + Webhook + HMAC）
- 策略引擎（YAML）可扩展，已有 gold_team/movie_agent 两套策略
- 集成测试覆盖了 HMAC 签名、SSE 事件、容错、性能等场景
- ADR 文档体系健全（001-010）
- crew.js 管线定义完整，可复现

**问题**:
- **Mock 实现**：gold-team-control 的 task_store 是内存实现（无持久化），worker 的引擎适配器是桩代码
- **重复代码**：review-platform-extension 与 kais-review-platform 仓库有大量重叠（state_machine/policy/security/schemas）
- **movie-agent-integration 是独立 Express 应用**，而非 kais-movie-agent skill 的库集成
- **docker-compose 不含 Redis**，review-platform-extension 的 SSE/回调依赖未配置
- 集成测试大量使用 mock，无真实服务间通信验证

---

## 二、模块→V6.0 目标项目映射

### 2.1 迁移映射表

| # | 当前模块/代码 | V6.0 目标项目 | 迁移动作 | 优先级 |
|---|-------------|-------------|---------|--------|
| 1 | `gold-team-control/` | **kais-core-backend** (Jellyfish) | 重构迁移：Control Node Gateway 逻辑融入 Jellyfish FastAPI 的 TaskRouter 模块 | P0 |
| 2 | `gold-team-worker/` | **kais-gold-team** (统一执行 Agent) | 合并：worker 的引擎适配器、容器管理、回调客户端合并到 kais-gold-team 已有的 Guardian/Executor | P0 |
| 3 | `movie-agent-integration/` | **kais-movie-agent** (独立 Docker 服务) | 拆分：客户端库(gold-team-client, review-platform-client) → kais-movie-agent/lib/；Express API 层 → kais-movie-agent 的 HTTP 入口 | P1 |
| 4 | `review-platform-extension/` | **kais-review-platform** (治理层) | 合并：多候选审核、评分、批量接口合并到 kais-review-platform 已有代码库 | P1 |
| 5 | `crew.js` | **kais-aigc-integration** (保留为集成测试/CI 项目) | 保留：作为自动化调研+架构设计的可复现管线定义 | P2 |
| 6 | `docker-compose.yml` | **kais-aigc-integration** | 重写：从4服务 Mock 改为引用各独立项目的真实 Docker 镜像 | P1 |
| 7 | `tests/` (集成测试) | **kais-aigc-integration** | 保留+扩展：改为跨仓库端到端集成测试 | P1 |
| 8 | `docs/` (ADR/架构文档) | **kais-aigc-platform** (文档中心) 或各自项目 | 分发：ADR 按主题归入对应项目，架构全景图归入 kais-aigc-platform | P2 |

### 2.2 各模块详细迁移分析

#### Module 1: gold-team-control → kais-core-backend

| 组件 | 当前实现 | 迁移策略 |
|------|---------|---------|
| `app/main.py` | FastAPI app，任务 CRUD + SSE | → Jellyfish 的 `routers/tasks.py`，保持 API 兼容 |
| `app/core/security.py` | API Key + HMAC 验证 | → Jellyfish 的 `core/auth.py`，需适配 Jellyfish 的 JWT 体系 |
| `app/core/events.py` | SSE 事件广播（内存） | → Jellyfish 的 `core/events.py`，改用 Redis Pub/Sub |
| `app/models/task.py` | Pydantic 任务模型 | → Jellyfish 的 `models/task.py`，扩展为 V6.0 统一任务模型 |
| `app/services/task_store.py` | 内存存储 | → 废弃，Jellyfish 用 PostgreSQL/SQLite 持久化 |
| `Dockerfile` + `requirements.txt` | Python 3.12 | → 废弃，融入 Jellyfish 统一镜像 |

**迁移工作量**: 中（~3天）  
**风险**: 低。Control Node 的 API 接口设计可直接复用，核心改动在存储层从内存换持久化。

#### Module 2: gold-team-worker → kais-gold-team

| 组件 | 当前实现 | 迁移策略 |
|------|---------|---------|
| `app/engines/*.py` | 6个引擎适配器（blender/facefusion/ace_step/tts/woosh/parallax） | → 与 kais-gold-team 已有的 Executor 引擎适配层对比，合并差异部分 |
| `app/engines/registry.py` | 引擎注册表 | → 可能已被 kais-gold-team 的 Hypervisor 覆盖，需对比 |
| `app/services/container_manager.py` | Docker 容器管理 | → 与 kais-gold-team Executor 对比，取优 |
| `app/services/callback_client.py` | 回调到 Control Node | → 保留但改调 Jellyfish |
| `app/services/file_transport.py` | Syncthing + SFTP 双通道 | → kais-gold-team 已有等价实现，对比后可能废弃 |
| `app/services/resource_monitor.py` | GPU/内存监控 | → 合并到 kais-gold-team 的监控层 |
| `app/services/error_handler.py` | 错误分类与恢复 | → 合并到 kais-gold-team Guardian |
| `app/services/task_executor.py` | 任务执行编排 | → 与 kais-gold-team Guardian 对比，合并 |

**迁移工作量**: 中高（~5天）  
**风险**: 中。需仔细对比 kais-gold-team 现有的 Guardian/Executor/Hypervisor，避免功能冲突。worker 的引擎适配器可能是简化版本，需补完。

#### Module 3: movie-agent-integration → kais-movie-agent

| 组件 | 当前实现 | 迁移策略 |
|------|---------|---------|
| `src/clients/gold-team-client.ts` | Gold Team HTTP 客户端 | → `kais-movie-agent/lib/gold-team-client.js`（JS，非 TS） |
| `src/clients/review-platform-client.ts` | Review Platform HTTP 客户端 | → kais-movie-agent 已有 `lib/review-platform-client.js`，合并差异 |
| `src/middleware/review-middleware.ts` | 审核中间件 | → kais-movie-agent 的 `lib/pipeline.js` 中的 review hook |
| `src/review/*.ts` | 审核门控/回调处理/状态管理 | → kais-movie-agent 的 `lib/hooks/` 和 `lib/interactive-review.js` |
| `src/services/task-manager.ts` | 任务管理 | → 融入 kais-movie-agent 的 Pipeline 编排 |
| `src/state/state-machine.ts` | 状态机 | → kais-movie-agent 已有 GitStageManager，评估是否需要额外状态机 |
| `src/utils/*.ts` | HMAC/重试/缓存/日志 | → 部分可复用，需转为 JS |
| `src/index.ts` | Express 应用入口 | → 评估：kais-movie-agent 是 OpenClaw skill，不独立运行 Express。此代码可能无用 |
| `Dockerfile` | Node.js 容器 | → V6.0 中 kais-movie-agent 是独立 Docker 服务，可保留并改造 |

**迁移工作量**: 中（~4天）  
**风险**: 中高。当前 movie-agent-integration 是独立 Express 应用，而 kais-movie-agent 是 skill 架构。V6.0 要求 kais-movie-agent 成为独立 Docker 服务，这正好对齐。但需从 TS→JS 适配。

#### Module 4: review-platform-extension → kais-review-platform

| 组件 | 当前实现 | 迁移策略 |
|------|---------|---------|
| `app/api/v1/reviews.py` | 多候选审核 API | → 合并到 kais-review-platform 的 `app/api/v1/reviews.py` |
| `app/api/v1/batch.py` | 批量审核 | → 新增到 kais-review-platform |
| `app/api/v1/events.py` | SSE 事件 | → kais-review-platform 已有 SSE，合并增强 |
| `app/api/v1/webhooks.py` | Webhook 管理 | → 合并到 kais-review-platform |
| `app/core/policy.py` | 策略引擎 | → kais-review-platform 已有等价实现，**重点对比差异** |
| `app/core/state_machine.py` | 4态状态机 | → kais-review-platform 已有，**可能废弃** |
| `app/core/security.py` | HMAC + API Key | → kais-review-platform 已有 |
| `app/core/events.py` | 事件总线 | → 合并差异 |
| `app/models/schemas.py` | 多候选/评分 Schema | → 合并到 kais-review-platform 的 Schema |
| `app/models/orm.py` | ORM 模型 | → 合并 candidates 表 |
| `app/policies/*.yaml` | 策略文件 | → 迁移到 kais-review-platform 的 policies 目录 |
| `app/services/callback_service.py` | 回调投递 | → kais-review-platform 已有，对比差异 |
| `migrations/add_candidates.py` | DB 迁移 | → 应用到 kais-review-platform |

**迁移工作量**: 中（~4天）  
**风险**: 低中。大量代码与 kais-review-platform 重叠，主要是多候选审核和评分的新增特性需合并。

---

## 三、迁移后 kais-aigc-integration 的定位

### 3.1 推荐定位：集成测试 + CI/CD 协调项目

迁移完成后，kais-aigc-integration 保留为**跨项目集成测试和 CI 协调仓库**，角色类似微服务架构中的 `integration-tests` 仓库。

**保留内容**:
- `crew.js` — 自动化调研+架构设计管线（可复用模式）
- `docker-compose.yml` — 重写为引用各项目 Docker 镜像的全栈编排
- `tests/` — 扩展为跨仓库端到端集成测试
- `start.sh` — 一键启动/停止/测试脚本
- `docs/` — 精简为仅保留跨系统文档（API 契约、数据流图、部署拓扑）

**移除内容**:
- `modules/` 全部 4 个子模块（各自归入目标项目）
- `ARCHITECTURE.md` 中与具体模块实现相关的章节

**新增内容**:
- `.github/workflows/` — CI 管线（拉取各项目镜像 → 启动 → 运行集成测试）
- `contracts/` — API 契约文件（OpenAPI specs from each project）
- `scripts/` — 跨项目部署和验证脚本

### 3.2 新 docker-compose.yml 骨架

```yaml
version: '3.8'
# V6.0 Final Architecture — 全栈编排
services:
  # ─── kais-core-backend (Jellyfish) ───
  core-backend:
    image: kais-core-backend:latest
    ports: ["8900:8900"]
    environment:
      - DATABASE_URL=sqlite:///data/jellyfish.db
      - REDIS_URL=redis://redis:6379
    depends_on: [redis]

  # ─── kais-gold-team (统一执行 Agent) ───
  gold-team-worker:
    image: kais-gold-team:latest
    environment:
      - CONTROL_NODE_URL=http://core-backend:8900
      - GPU_ENABLED=${GPU_ENABLED:-false}
    volumes:
      - shared-data:/shared
    depends_on: [core-backend]

  # ─── kais-movie-agent (独立 Docker 服务) ───
  movie-agent:
    image: kais-movie-agent:latest
    ports: ["3000:3000"]
    environment:
      - CORE_BACKEND_URL=http://core-backend:8900
      - REVIEW_PLATFORM_URL=http://review-platform:8090
    depends_on: [core-backend, review-platform]

  # ─── kais-review-platform (治理层) ───
  review-platform:
    image: kais-review-platform:latest
    ports: ["8090:8090"]
    environment:
      - DATABASE_URL=sqlite:///data/reviews.db
      - REDIS_URL=redis://redis:6379
    depends_on: [redis]

  # ─── Redis (共享) ───
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

volumes:
  shared-data:
```

---

## 四、迁移依赖关系和顺序

### 4.1 依赖拓扑

```
Phase 0: review-platform-extension → kais-review-platform
         (无外部依赖，最独立)
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
```

### 4.2 详细执行计划

| Phase | 任务 | 前置依赖 | 预估工时 | 验收标准 |
|-------|------|---------|---------|---------|
| **P0** | review-platform-extension 合并到 kais-review-platform | 无 | 4天 | 多候选审核+评分+批量 API 在 kais-review-platform 中通过全部测试 |
| **P1** | gold-team-worker 引擎适配器合并到 kais-gold-team | P0 | 5天 | 6引擎适配器在 kais-gold-team Guardian 中可正常调度 |
| **P2** | gold-team-control API 融入 kais-core-backend (Jellyfish) | P1 | 3天 | 任务 CRUD + SSE + HMAC 在 Jellyfish 中工作，API 兼容 |
| **P3** | movie-agent-integration 客户端库融入 kais-movie-agent | P0+P2 | 4天 | gold-team-client + review-platform-client 在 kais-movie-agent pipeline 中工作 |
| **P4** | docker-compose 重写 + 集成测试扩展 | P0-P3 | 3天 | 全栈 docker-compose up → 端到端测试通过 |
| **P5** | kais-aigc-integration 仓库清理 | P4 | 1天 | modules/ 删除，保留 tests/ + docs/ + docker-compose.yml |

**总工时**: ~20天（含测试和验证）

### 4.3 可并行的任务

- P0（review-platform 合并）和 P1（worker 合并）可并行启动
- P2 和 P3 不可并行——P3 依赖 P2 的 core-backend API 稳定

---

## 五、docker-compose 升级路径

### 5.1 当前架构 → V6.0 架构对比

```
当前 (v1.0-draft)                         V6.0 Final
┌─────────────────────┐                   ┌─────────────────────┐
│ control-node :8900   │                   │ core-backend :8900   │
│ (FastAPI, 内存存储)   │      →→→          │ (Jellyfish, 持久化)   │
├─────────────────────┤                   ├─────────────────────┤
│ worker-node :8903    │                   │ gold-team-worker     │
│ (模拟 GPU 引擎)      │      →→→          │ (真实 GPU 引擎)       │
├─────────────────────┤                   ├─────────────────────┤
│ movie-agent :3000    │                   │ movie-agent :3000    │
│ (Express 集成层)     │      →→→          │ (独立 Docker 服务)    │
├─────────────────────┤                   ├─────────────────────┤
│ review-platform :8090│                   │ review-platform :8090│
│ (扩展层，多候选)     │      →→→          │ (合并后完整版)        │
├─────────────────────┤                   ├─────────────────────┤
│ (无 Redis)           │                   │ redis :6379          │
│ (无 Toonflow)        │                   │ toonflow-desktop     │
└─────────────────────┘                   └─────────────────────┘
```

### 5.2 渐进式升级策略

**Step 1** (保持当前 compose 可用):
- 在 docker-compose.yml 中添加 Redis 服务
- review-platform-extension 连接 Redis

**Step 2** (逐个替换为真实镜像):
```yaml
# 先替换 review-platform
review-platform:
  image: kais-review-platform:latest  # 替换 build 为 image
  # ...

# 再替换 gold-team
gold-team-worker:
  image: kais-gold-team:latest
  # ...
```

**Step 3** (引入新服务):
- 添加 kais-core-backend (Jellyfish)
- 添加 Toonflow Desktop (如需前端)

**Step 4** (移除 control-node):
- control-node 的功能已被 core-backend 覆盖
- 移除 control-node 服务定义

---

## 六、集成测试框架保留与扩展策略

### 6.1 当前测试资产

| 测试文件 | 覆盖范围 | 状态 |
|---------|---------|------|
| `test_hmac_signing.py` | HMAC-SHA256 签名验证 | ✅ 可直接保留 |
| `test_sse_events.py` | SSE 事件流 | ✅ 可直接保留 |
| `test_gold_team_integration.py` | Gold Team ↔ Review Platform | ⚠️ 需适配 core-backend API |
| `test_movie_agent_integration.py` | Movie Agent ↔ Review Platform | ⚠️ 需适配新客户端库 |
| `test_fault_tolerance.py` | 容错/降级测试 | ✅ 可直接保留 |
| `test_performance.py` | 性能基准 | ✅ 可直接保留 |
| `modules/integration-tests/test_e2e.py` | 端到端流程 | ⚠️ 需重写 |

### 6.2 扩展计划

**保留层（可直接复用）**:
- HMAC 签名验证测试 — 协议层不变
- SSE 事件流测试 — 协议层不变
- 容错降级测试 — 场景通用
- 性能基准测试 — 框架可复用

**适配层（需修改 import 和 endpoint）**:
- `test_gold_team_integration.py` — 把 gold-team-control 的 `/api/tasks` 改为 core-backend 的路由
- `test_movie_agent_integration.py` — 把 mock 改为调用真实 kais-movie-agent Docker 服务

**新增层（V6.0 扩展）**:
- `test_cross_service_flow.py` — 跨3+服务的端到端流程（movie-agent → core-backend → gold-team → review-platform → callback）
- `test_contract_compatibility.py` — API 契约兼容性检查（对比 OpenAPI spec）
- `test_deployment_smoke.py` — 部署后冒烟测试（每个服务的 health check + 基本功能）
- `test_data_consistency.py` — 数据一致性验证（任务状态在多个服务间是否一致）

### 6.3 测试执行策略

```bash
# Level 1: 单元测试 — 各项目各自运行
# Level 2: 服务测试 — docker-compose 启动后对每个服务单独测试
# Level 3: 集成测试 — kais-aigc-integration 的 tests/ 目录
# Level 4: 端到端测试 — 模拟完整用户流程
```

---

## 七、风险与建议

### 7.1 关键风险

1. **kais-gold-team 已有成熟 Guardian/Executor**：worker 模块的引擎适配器可能是简化版，盲目合并可能引入倒退。**建议**：先 diff 对比，只合并 worker 中独有的功能（如 resource_monitor、error_handler 的分类逻辑）。

2. **review-platform-extension 与 kais-review-platform 重叠度高**：核心模块（state_machine、policy、security）几乎完全重复。**建议**：以 kais-review-platform 为主，只 cherry-pick extension 中的新增功能（多候选、评分、批量）。

3. **movie-agent-integration 的 TypeScript 代码需转为 JS**：kais-movie-agent 使用纯 JS。**建议**：只迁移核心逻辑（客户端库），Express 应用入口和 TypeScript 基础设施不迁移。

4. **Jellyfish (kais-core-backend) 尚未完成深度改造**：Control Node 的 API 能否直接映射到 Jellyfish 的路由取决于 Jellyfish 的设计。**建议**：先完成 Jellyfish 的架构确认，再迁移 Control Node 代码。

### 7.2 建议执行顺序

1. **先合并 review-platform-extension**（最独立，风险最低，可立即验证）
2. **再对比合并 gold-team-worker**（需 kais-gold-team 团队配合 review）
3. **等 Jellyfish 架构确认后迁移 Control Node**
4. **最后迁移 movie-agent-integration**（依赖最多）
5. **全栈 docker-compose 重写 + 集成测试扩展**

---

## 八、总结

| 维度 | 评估 |
|------|------|
| 代码可复用性 | ⭐⭐⭐⭐ (API 设计、协议层、测试框架可直接复用；具体实现需合并) |
| 迁移复杂度 | ⭐⭐⭐ (中等，主要是去重和适配，不是重写) |
| 风险等级 | ⭐⭐ (低中，有充分的测试覆盖，可渐进式迁移) |
| 预估总工时 | ~20 天（含测试验证） |

kais-aigc-integration 的核心价值在于：
1. **定义了清晰的跨系统接口契约**（REST + HMAC + SSE + Webhook）
2. **提供了可运行的集成测试框架**
3. **记录了完整的架构决策**（ADR 001-010）

迁移后保留为集成测试+CI 项目是最优解——它作为"胶水层"连接5个独立项目，确保系统整体可用。
