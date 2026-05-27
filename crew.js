module.exports = {
  name: "kais-aigc-platform",
  goal: "基于 Notion V6.0 Final Architecture，分析目标架构与现存关联项目（kais-gold-team / kais-aigc-integration / kais-review-platform / kais-movie-agent / hermes-worker-agent）的最新代码关系，完善设计架构，并为每个关联项目生成针对性改造文档",
  workdir: "/home/kai/.openclaw/workspace/kais-aigc-platform",
  project: { lang: "general" },
  github: "kais-aigc-platform",

  steps: [
    // ─── Layer 0: 并行审计现存项目最新代码 ───
    {
      id: "audit-gold-team",
      skill: "deep-research",
      params: {
        topic: `深度审计 kais-gold-team 仓库最新代码，与 Notion V6.0 Final Architecture 的目标架构进行对比分析。

## 目标架构要求（V6.0 Final）
- 统一执行 Agent（kais-gold-team），Engine Router 默认本地 3090，降级云端
- Local Pool → OpenClaw → ComfyUI @ 3090（Wan2.2/LTX-Video/FLUX/ACE-Step/TTS/Real-ESRGAN/GFPGAN/TRELLIS/Hunyuan3D）
- Cloud Pool → 可灵/即梦/Seedance/Runway/Luma（复用 Jellyfish 商业 API 代码）
- 统一回调格式：task_id/status/engine_used/outputs/metadata
- Docker 部署，REST API 端口 8002
- 显存估算：video 14B fp16 ≈ 20G, FLUX ≈ 12G, SD3.5 ≈ 10G, TTS ≈ 4G, 后处理 ≈ 2G

## 当前代码现状
- 已有 V2 双卡拓扑（3090 + 3060Ti），32-node routing table，TopologyAwareRouter
- combo 模式：3060Ti Combo Resident（6个轻量模型常驻30分钟）
- hypervisor 层：gpu_health/watchdog/vram_budget/batch_scheduler/runtime_supervisor
- kais-hub: Control Node + Worker Node（~~双机分布式~~ 已退役，迁移到单机）
- 三通道通信：Syncthing/SFTP/HTTP Callback
- workers: heavy_worker(3090)/light_worker(3060ti)/ffmpeg_worker/overflow_worker
- journal: Redis Streams 事务日志
- storage: 三层权重存储（Hot SSD/Warm HDD/Cold Archive）

## 请输出
1. 当前代码与 V6.0 目标的 Gap 清单（功能缺失、接口不匹配、架构偏差）
2. 需要新增/改造的模块列表（含优先级和预估工作量）
3. 需要删除/废弃的旧代码
4. 与 kais-core-backend（Jellyfish 改造）的集成接口设计建议
5. 与 kais-movie-agent 的接口契约对齐分析
6. Docker 部署从~~双机分布式~~到单机 Docker Compose 的迁移路径`,
        depth: "deep"
      },
      output: "context/audit-gold-team.md"
    },
    {
      id: "audit-review-platform",
      skill: "deep-research",
      params: {
        topic: `深度审计 kais-review-platform 仓库最新代码，与 Notion V6.0 Final Architecture 的目标架构进行对比分析。

## 目标架构要求（V6.0 Final）
- 治理层：kais-review-platform (React Web)
- 卡片流轻量审核（只读 Audit DB）
- 五维雷达图仪表盘
- Git 审计追溯
- 移动端快速审批
- 与 Toonflow 审核模式分离：Toonflow = 深度审片工作台，review-platform = 治理与移动端入口
- 共享 Audit DB 但权限隔离

## 当前代码现状
- FastAPI + SQLAlchemy + Alembic + Redis + arq 任务队列
- 完整审核 API：reviews/audit/actions/batch/events/webhooks/shot_cards/ab_tests/analytics/mobile/media/tokens
- 策略引擎：Policy V2（default.yaml, gold_team_risk.yaml）
- 审核路由：AUTO/HUMAN/AI_AUDIT/BLOCK
- Telegram Bot 集成（bot/handlers/lifecycle/notifications）
- PostgreSQL + TimescaleDB + MinIO 对象存储
- 状态机（state_machine.py）+ 事件系统（events.py）
- 检查点管理（checkpoint_manager.py）
- 双写（dual_write.py）+ Merkle 校验
- Progressive Fill + Scoring Bus + Topology Collapser
- Git Policy Provider + Template Registry
- SSE 实时推送
- 前端：HTMX + Alpine.js + Tailwind CSS（非 React）

## 请输出
1. 当前代码与 V6.0 目标的 Gap 清单
2. 前端从 HTMX/Alpine 到 React 的迁移路径和必要性评估
3. 与 Audit DB（PostgreSQL）共享给 Toonflow 的方案
4. 权限隔离设计：Toonflow 深度审片 vs review-platform 治理
5. 移动端审批能力增强方向
6. 五维雷达图仪表盘的实现方案`,
        depth: "deep"
      },
      output: "context/audit-review-platform.md"
    },
    {
      id: "audit-movie-agent",
      skill: "deep-research",
      params: {
        topic: `深度审计 kais-movie-agent（OpenClaw skill）最新代码，与 Notion V6.0 Final Architecture 的目标架构进行对比分析。

## 目标架构要求（V6.0 Final）
- kais-movie-agent 作为 OpenClaw 调度中枢
- PHASE 0~7 状态机（剧本→分镜→生成→审核→剪辑→导出）
- Skill Router：toonflow/*（画布操作）/ jellyfish/*（数据服务）/ hermes-agent/*（专家咨询）/ gold-team/generate（统一生成）
- 质量闸门（审核触发/通过/驳回）
- Docker 部署，REST API 端口 8001
- 与 kais-core-backend（Jellyfish）通过 REST 通信
- 与 kais-gold-team 通过 REST 通信

## 当前代码现状
- OpenClaw skill 形式，不独立部署为 Docker 服务
- 11 Phase 管线：requirement → art-direction → character → scenario → voice → storyboard → scene → camera-preview → camera-final → post-production → quality-gate
- pipeline.js 纯编排器（<200行）+ phaseHandlers 注册表
- ReviewPlatformClient 集成（远程审核）
- GoldTeamClient 集成（13 个 GPU 函数）
- Hermes Worker Agent 集成（LLM 路由）
- 即梦 API 降级链
- Telegram 通知
- Git 版本管理 + 断点续传
- Asset Bus（跨 phase 资产总线）
- Prompt Injector（自动组装 GPU prompt）
- Shot List Parser（镜头参数映射）
- AI Scorer（剧本质量评分）
- 14 个子 skill（symlink 到 workspace skills/）

## 请输出
1. 从 OpenClaw skill 到独立 Docker 服务的迁移路径
2. Skill Router 实现方案（toonflow/jellyfish/hermes/gold-team 路由）
3. PHASE 0~7 与当前 11 Phase 的映射关系
4. 与 kais-core-backend（Jellyfish 改造）的集成接口
5. 审核流程从 ReviewPlatformClient 到新架构的升级
6. 子 skill 管理在 Docker 环境下的方案`,
        depth: "deep"
      },
      output: "context/audit-movie-agent.md"
    },
    {
      id: "audit-aigc-integration",
      skill: "deep-research",
      params: {
        topic: `深度审计 kais-aigc-integration 仓库最新代码，与 Notion V6.0 Final Architecture 的目标架构进行对比分析。

## 目标架构要求（V6.0 Final）
- kais-aigc-integration 的角色在 V6.0 中被拆分为：
  - kais-core-backend（Jellyfish FastAPI 深度改造）
  - kais-movie-agent（独立 Docker 服务）
  - kais-gold-team（统一执行 Agent）
  - kais-review-platform（治理层）
  - Toonflow Desktop（前端）
- kais-aigc-integration 中的集成代码需要重新分配到各子项目

## 当前代码现状
- 4 模块架构：
  1. gold-team-control（Control Node，端口 8900）
  2. gold-team-worker（Worker Node，端口 8903）
  3. movie-agent-integration（TypeScript/Express，端口 3000）
  4. review-platform-extension（Python/FastAPI，端口 8090）
- crew.js 定义了3层调研 + 架构设计 + 路线图的完整流程
- docker-compose.yml 一键部署
- 集成测试框架（test_e2e.py）
- 故障容错/HMAC签名/SSE事件/性能测试

## 请输出
1. kais-aigc-integration 中哪些模块/代码应迁移到哪个目标项目
2. 迁移后的 kais-aigc-integration 定位（是否保留为集成测试/CI 项目）
3. 各模块迁移的依赖关系和顺序
4. docker-compose.yml 从当前架构到 V6.0 架构的升级路径
5. 集成测试框架的保留和扩展策略`,
        depth: "deep"
      },
      output: "context/audit-aigc-integration.md"
    },

    // ─── Layer 1: 汇总分析 + 完善设计架构 ───
    {
      id: "architecture-design",
      skill: "auto-dev",
      input: [
        "context/audit-gold-team.md",
        "context/audit-review-platform.md",
        "context/audit-movie-agent.md",
        "context/audit-aigc-integration.md"
      ],
      output: "docs/architecture.md",
      params: {
        requirement: `基于四个仓库的审计报告和 Notion V6.0 Final Architecture，输出完善的设计架构文档。

## 输入参考
1. Notion V6.0 Final Architecture（9大章节：硬件拓扑/软件架构总览/分层职责/Toonflow-Jellyfish整合/生成层/产物文件系统/Docker Compose/审核与治理/不可妥协设计原则）
2. 四个仓库的 Gap 分析报告

## 要求
1. **系统全景图**：用 Mermaid 绘制所有系统关系拓扑（含数据流、控制流）
2. **接口契约完善**：定义每个系统间集成点的精确 API 规范
   - kais-core-backend ↔ Toonflow（Canvas Sync API）
   - kais-movie-agent ↔ kais-core-backend（REST）
   - kais-movie-agent ↔ kais-gold-team（统一生成 API）
   - kais-review-platform ↔ Audit DB ↔ Toonflow
   - kais-movie-agent ↔ review-platform（审核回调）
3. **数据模型统一**：Project/Node/Asset/Shot/Task 的 schema 定义
4. **状态机设计**：从创作到成片的完整状态流转
5. **部署拓扑**：Docker Compose 服务编排 + 宿主机配置
6. **迁移策略**：从现有代码到目标架构的分阶段迁移路径
7. **风险评估**：技术风险、依赖风险、兼容性风险

技术栈：FastAPI/Node.js/Electron/PostgreSQL/Redis/Docker/ComfyUI/Telegram
输出格式：Markdown + Mermaid 图表`
      }
    },

    // ─── Layer 2: 生成各关联项目改造文档 ───
    {
      id: "doc-gold-team",
      skill: "auto-dev",
      input: ["docs/architecture.md", "context/audit-gold-team.md"],
      output: "docs/kais-gold-team.md",
      params: {
        requirement: `为 kais-gold-team 项目生成针对性改造文档（与目标项目 kais-aigc-platform 同名）。

基于架构设计和 gold-team 审计报告，输出：
1. **改造目标**：从当前 V2 双卡拓扑到 V6.0 统一执行 Agent 的演进路径
2. **新增模块清单**：
   - Engine Router（默认本地 3090，降级云端）
   - Cloud Pool（可灵/即梦/Seedance/Runway/Luma）
   - 统一回调格式实现
   - Docker 部署配置
3. **改造模块清单**：
   - hypervisor → 简化为单机 Docker Compose
   - kais-hub → 保留核心调度，去除双机分布式
   - workers → heavy_worker 合并为统一引擎接口
   - journal → Redis Streams 保留，增加回调通知
4. **删除模块清单**：
   - combo 相关（3060Ti Combo 在 V6.0 中重新定义）
   - 双机通信（Syncthing/SFTP/Callback）
   - Control Node / Worker Node 分离架构
5. **接口变更**：
   - 新增 REST API（端口 8002）
   - 统一生成接口设计
   - 回调格式对齐
6. **迁移步骤**：分阶段，含验证检查点
7. **依赖关系**：与其他项目改造的先后依赖`
      }
    },
    {
      id: "doc-review-platform",
      skill: "auto-dev",
      input: ["docs/architecture.md", "context/audit-review-platform.md"],
      output: "docs/kais-review-platform.md",
      params: {
        requirement: `为 kais-review-platform 项目生成针对性改造文档。

基于架构设计和 review-platform 审计报告，输出：
1. **改造目标**：从当前 FastAPI+HTMX 审核系统到 V6.0 治理层的演进
2. **前端迁移评估**：
   - HTMX/Alpine → React 的必要性和工作量
   - 五维雷达图仪表盘实现
   - 移动端优化方案
3. **数据层改造**：
   - Audit DB 与 Toonflow 共享方案
   - 权限隔离设计（Toonflow 深度审片 vs review-platform 治理）
4. **API 改造**：
   - 新增 Toonflow 审核模式 API
   - 审核回调接口升级
5. **移动端审批增强**
6. **Git 审计追溯集成**
7. **迁移步骤和依赖关系**`
      }
    },
    {
      id: "doc-movie-agent",
      skill: "auto-dev",
      input: ["docs/architecture.md", "context/audit-movie-agent.md"],
      output: "docs/kais-movie-agent.md",
      params: {
        requirement: `为 kais-movie-agent 项目生成针对性改造文档。

基于架构设计和 movie-agent 审计报告，输出：
1. **改造目标**：从 OpenClaw skill 到独立 Docker 服务（V6.0 调度中枢）
2. **服务化改造**：
   - OpenClaw skill → FastAPI Docker 服务（端口 8001）
   - Skill Router 实现（toonflow/jellyfish/hermes/gold-team）
   - 状态机从 Phase 0~7（精简当前 11 Phase）
3. **集成接口**：
   - 与 kais-core-backend 的 REST 接口
   - 与 kais-gold-team 的统一生成 API
   - 与 review-platform 的审核回调
4. **子 skill 管理**：Docker 环境下的子 skill 方案
5. **审核流程升级**：ReviewPlatformClient 接口适配
6. **LLM 调用迁移**：Hermes Agent 集成方案
7. **迁移步骤和依赖关系**`
      }
    },
    {
      id: "doc-aigc-integration",
      skill: "auto-dev",
      input: ["docs/architecture.md", "context/audit-aigc-integration.md"],
      output: "docs/kais-aigc-integration.md",
      params: {
        requirement: `为 kais-aigc-integration 项目生成针对性改造文档。

基于架构设计和 aigc-integration 审计报告，输出：
1. **改造目标**：重新定位为 kais-aigc-platform 的集成测试和 CI/CD 项目
2. **模块迁移清单**：
   - gold-team-control → 迁移到 kais-gold-team
   - gold-team-worker → 迁移到 kais-gold-team
   - movie-agent-integration → 迁移到 kais-movie-agent
   - review-platform-extension → 迁移到 kais-review-platform
3. **迁移后的职责**：
   - 全栈集成测试
   - Docker Compose 编排
   - E2E 测试框架
   - CI/CD 流水线
4. **保留和扩展**：
   - docker-compose.yml 升级为 V6.0 架构
   - 集成测试框架扩展
   - 故障容错测试保留
5. **迁移步骤和依赖关系**`
      }
    },
    {
      id: "doc-hermes-agent",
      skill: "auto-dev",
      input: ["docs/architecture.md"],
      output: "docs/hermes-worker-agent.md",
      params: {
        requirement: `为 hermes-worker-agent 项目生成针对性改造文档。

基于架构设计，输出：
1. **改造目标**：从通用 LLM 路由到 V6.0 架构中的专家咨询层
2. **角色定位**：在 kais-movie-agent Skill Router 中作为 hermes-agent/* 路由目标
3. **功能增强**：
   - 6 个 tools（memory/plan/reflect/learn/llm/llm_vision）的接口对齐
   - 与 kais-movie-agent 的集成方式
   - 与 kais-core-backend 的数据服务接口
4. **Docker 部署方案**
5. **迁移步骤和依赖关系**`
      }
    },

    // ─── Layer 3: 汇总报告 ───
    {
      id: "summary",
      skill: "auto-dev",
      input: [
        "docs/architecture.md",
        "docs/kais-gold-team.md",
        "docs/kais-review-platform.md",
        "docs/kais-movie-agent.md",
        "docs/kais-aigc-integration.md",
        "docs/hermes-worker-agent.md"
      ],
      output: "README.md",
      params: {
        requirement: `基于所有架构文档和改造文档，生成 kais-aigc-platform 项目的 README.md。

内容包括：
1. **项目概述**：KAIS AIGC 短剧生产管线 V6.0 Final Architecture
2. **系统架构全景图**（Mermaid）
3. **项目组成**：5 个关联项目及其角色
4. **改造路线图**：各项目改造的阶段划分和依赖关系
5. **快速开始**：如何从零搭建 V6.0 环境
6. **关联项目改造文档索引**：链接到各 docs/*.md
7. **设计原则**：9 大不可妥协原则
8. **技术栈总览**`
      }
    }
  ]
};
