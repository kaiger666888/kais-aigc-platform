module.exports = {
  name: "kais-aigc-platform-dev",
  goal: "基于 Toonflow-app fork 和 V6.0 架构设计，制定并执行 kais-aigc-platform 及关联 repo 的联合开发计划",
  workdir: "/home/kai/.openclaw/workspace/kais-aigc-platform",
  project: { lang: "node" },
  github: "kais-aigc-platform",

  steps: [
    // ─── Phase 0: 开发计划制定 ───
    {
      id: "dev-plan",
      skill: "deep-research",
      params: {
        topic: `制定 kais-aigc-platform V6.0 MVP-0 联合开发计划。

## 基础信息

### Toonflow-app 现有代码（fork 基础）
- Express + better-sqlite3 + Electron 全栈
- 19 个 API route 模块（project/script/assets/production/task 等）
- 10 个 cloud vendor 适配器（klingai/deepseek/openai/minimax 等）
- AI agent skill 系统（script/production/story/art 四类）
- WebSocket 实时通信
- SQLite 本地存储 + Electron 桌面端

### V6.0 架构目标（docs/architecture.md）
- 前端层：Toonflow Electron（3060Ti 显示域）
- 服务层：kais-core-backend（Toonflow Express 深度改造）:8000
- 调度层：kais-movie-agent（OpenClaw skill → Docker 服务）:8001
- 执行层：kais-gold-team（统一生成 Agent）:8002
- 治理层：kais-review-platform（React Web）:8090
- 专家层：hermes-worker-agent（LLM 路由）

### 关联 repo 现状
- kais-gold-team: V2 双卡拓扑，32-node routing，需简化为 V6.0 统一执行 Agent
- kais-review-platform: FastAPI+HTMX 成熟后端，需增加 Toonflow 审核集成
- kais-movie-agent: OpenClaw skill，需独立 Docker 服务化
- kais-aigc-integration: 模块需拆分到各目标项目
- hermes-worker-agent: 通用 LLM 路由，需升级为专家咨询层

### 各项目改造文档
- docs/kais-gold-team.md（31KB）
- docs/kais-review-platform.md（34KB）
- docs/kais-movie-agent.md（52KB）
- docs/kais-aigc-integration.md（24KB）
- docs/hermes-worker-agent.md（42KB）

## 请输出

### 1. MVP-0 范围定义
- 最小可运行范围：哪些功能必须有，哪些可以后加
- 核心链路：用户触发 → Toonflow 画布 → movie-agent 编排 → gold-team 生成 → review 审核 → 交付

### 2. 分阶段开发计划
每个阶段包含：
- 阶段名称、目标、时长预估
- 涉及的 repo 和具体任务
- 前后依赖关系
- 验收标准

### 3. Repo 间协调策略
- 各 repo 独立开发 vs 集成联调的节奏
- 接口先行（API contract first）的具体方案
- 测试策略（单元测试 + 集成测试 + E2E）

### 4. 技术决策点
列出需要用户确认的关键决策：
- Toonflow Express 后端是否拆分为独立 FastAPI 服务？
- kais-movie-agent 是否从 OpenClaw skill 完全迁移为独立服务？
- 数据库策略（SQLite vs PostgreSQL）
- 部署策略（单机 Docker Compose vs 保持当前架构）

### 5. 风险和缓解

### 6. 推荐执行顺序（甘特图或时间线）
`,
        depth: "deep"
      },
      output: "docs/dev-plan.md"
    }
  ]
};
