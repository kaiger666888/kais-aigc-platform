# KAIS AIGC Platform — Engine Integration

## What This Is

AI 短剧全链路制作平台，通过 kais-gold-team 统一执行引擎编排 ComfyUI 本地推理和云端商业 API，实现从剧本到成片的一站式 AI 制作。服务于内容创作者和影视团队。

## Core Value

让 AI 短剧制作流程跑通——从角色设计、剧本生成、分镜、视频生成到后期制作的完整管线能够自动执行并产出可交付的成片。

## Requirements

### Validated

<!-- Shipped and confirmed. -->

- ✓ 视频生成 (Wan2.2 T2V/I2V via ComfyUI GGUF) — gold-team v6
- ✓ 图片生成 (FLUX via ComfyUI) — gold-team v6
- ✓ 语音合成 (CosyVoice3 TTS) — gold-team v6
- ✓ 音乐生成 (ACE-Step) — gold-team v6
- ✓ 3D 生成 (TRELLIS2 + Hunyuan3D) — kais-aigc-platform routes
- ✓ 云端降级 (Kling/Jimeng/Seedance) — gold-team cloud pool
- ✓ 统一任务 API (gold-team :8002 REST) — gold-team v6
- ✓ 图片描述 (JoyCaption) — gold-team v6
- ✓ 域无关智能决策 API (hermes-agent REST :8080) — v1.1
- ✓ 自学习循环 (audit → EWMA confidence → auto-learn) — v1.1
- ✓ movie-pipeline 域注册 + 14 专家技能迁移 — v1.1
- ✓ hermes-client.js + HERMES_DEFAULTS 降级 + Docker 部署 — v1.1
- ✓ hermes-agent 集成测试体系 (42+ tests, CI pipeline) — v1.2
- ✓ ACE-Step 音乐生成迁移到 ComfyUI workflow (替代独立容器) — v1.4 (commit e3d649e)
- ✓ ACE 路由套件收敛(14→10 端点,统一走 ComfyUI)— v1.4 (commit e3d649e)
- ✓ GpuScheduler Redis-backed 多进程协调 — v1.5
- ✓ gold-team ACE-Step Python 引擎彻底退役 — v1.5
- ✓ 统一输出路径约定 (`src/lib/paths.ts`) — v1.5
- ✓ 主工程 TypeScript 编译干净(12,447 → 0 错误)— v1.5
- ✓ router.ts 自动生成机制根因修复(config/_shared 跳过)— v1.5

### Active

<!-- Current milestone scope. -->

- [ ] 口型同步引擎 (Lip Sync) — LatentSync via ComfyUI
- [ ] 角色面部一致性 (IP-Adapter FaceID)
- [ ] 角色零样本保持 (InstantID)
- [ ] 角色多参考图生成 (PhotoMaker)
- [ ] 超分辨率 (Real-ESRGAN workflow)
- [ ] 人脸修复 (GFPGAN/CodeFormer workflow)
- [ ] 视频帧插值 (RIFE via ComfyUI)

### Out of Scope

- 多语言配音/语音翻译 — 不阻塞短剧核心流程，后续里程碑
- 视频风格迁移 (V2V Style Transfer) — 非必须，现有 Wan2.2 + prompt 足够
- 全自动剪辑 — 需要人工介入创作决策，AI 仅辅助
- 移动端审批 — 属于 review-platform 功能，非引擎范畴

## Context

### 技术架构

- **kais-gold-team** (FastAPI :8002): 统一执行引擎，管理所有本地/云端引擎
- **ComfyUI Worker** (RTX 3090 24GB): GPU 推理执行器，承载 ComfyUI 模型
- **引擎注册模式**: BaseEngine 抽象类 → submit/poll/get_output/cancel/health 生命周期
- **Workflow Builder**: Python 函数构建 ComfyUI API-format JSON workflow dict
- **Executor 路由**: 按 TaskType 枚举自动匹配引擎和构建 workflow
- **云端降级**: ComfyUIEngine 本地执行 → CloudXxxEngine API 调用

### 现有引擎组织模式

1. **ComfyUI 路径** — ComfyUIEngine + workflow_builder.py (Wan2.2, FLUX, JoyCaption)
2. **独立容器路径** — DockerAPIEngine 子类 (FaceFusion, CosyVoice TTS)
3. **云端 API 路径** — CloudXxxEngine (Kling, Jimeng, Seedance)

### 关键文件

- `docker/gold-team/src/v6/models/task.py` — TaskType 枚举
- `docker/gold-team/src/v6/engines/workflow_builder.py` — ComfyUI workflow 构建
- `docker/gold-team/src/v6/engines/comfyui.py` — ComfyUI 引擎
- `docker/gold-team/src/v6/executor.py` — 任务执行和路由
- `docker/gold-team/src/v6/main.py` — 引擎注册入口

### 显存约束

RTX 3090 24GB 串行调度，重模型 (Wan2.2 ~22GB) 和轻模型 (Real-ESRGAN ~2GB) 分时复用。短剧 pipeline 建议执行顺序：角色图 → 视频 → 口型同步 → 超分 + 人脸修复 → 帧插值。

## Constraints

- **GPU**: RTX 3090 24GB VRAM，串行调度，单模型独占
- **ComfyUI 优先**: 有 ComfyUI 节点的方案优先，无节点的才考虑独立容器
- **引擎接口**: 所有新引擎必须遵循 BaseEngine 接口 (submit/poll/get_output/cancel/health)
- **Python 3.11**: gold-team 运行时
- **模型存储**: /data/models/ 挂载到 ComfyUI Worker

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ComfyUI 节点优先 | 减少 Docker 容器管理开销，复用已有 ComfyUIEngine | — Pending |
| LatentSync 选型 | 已有 ComfyUI 社区节点，基于 Whisper + diffusion，效果经过验证 | — Pending |
| 角色 3 方案组合 | IP-Adapter FaceID (高保真) + InstantID (零样本) + PhotoMaker (多图) 覆盖不同场景 | — Pending |
| 角色一致性不新增 TaskType | 扩展 IMAGE_DRAW/IMAGE_REFINE 的 params.extra 字段，避免枚举膨胀 | — Pending |
| hermes-agent Python 库内嵌 | 免独立服务管理，直接 import 使用 | ✓ Good |
| 引擎按后端类型注册 | ComfyUI 走 workflow_builder，独立 API/Docker 走各自 Engine，不按模型拆类 | — Pending |
| TaskType 保持大类 | 细分能力通过 params.extra 路由，避免枚举膨胀 | — Pending |
| 域无关 API (domain/task/context) | 任何管线复用同一接口，不绑定电影业务 | ✓ Good |
| EWMA alpha=0.3 | 适中的时间衰减权重 | ✓ Good |
| Hardcoded 14 skill list | 避免动态 glob 的不确定性 | ✓ Good |
| 集成测试用真实 LLM | 不 mock，验证完整链路 | ✓ Good |
| 测试端口 8090 | 避免与开发环境 8080 冲突 | ✓ Good |
| Node.js 子进程测试客户端 | 复刻 test_e2e.py 模式，跨语言验证 | ✓ Good |

## Current Milestone: v1.6 Workflow Skill Contract(工作流 Skill 契约抽象)

**Goal:** 为 kais-aigc-platform 引入"工作流 Skill 契约"抽象层,让平台停止对 kais-movie-agent 的隐式耦合——任何工作流 skill(短剧/动画/纪录片/广告/短视频/海报/音乐视频/播客/有声书/互动剧情/游戏过场)都可以注册并驱动平台,平台仅作为 skill-agnostic 基础设施。

**Target features:**
- **Skill Contract 规范文档 + TypeScript 接口** — manifest schema 定义 skill_id / version / media_types / node_types / phase_taxonomy / asset_categories / review_criteria / engine_task_types(`.planning/specs/SKILL-CONTRACT.md` + `src/skills/contract.ts`)
- **Skill Registry(平台侧)** — 加载、校验、列举已注册 skill;`GET /api/v1/skills` API + 平台启动时 manifest 解析
- **Canvas 节点类型注册表泛化** — Script/Asset/Storyboard/Video/Audio 从硬编码节点变为 kais-movie-agent skill 通过 manifest 贡献的节点
- **Phase / 状态机泛化** — phase 名称由 skill manifest 声明;平台只懂 phase 推进协议,不再硬编码剧本/分镜/视频/音频等阶段名
- **Asset schema 扩展** — `o_assets` 增加 `skill_id` + `workflow_phase` 字段(同时关闭前一轮审计识别的"阶段性资产管理"gap)
- **kais-movie-agent 合规性升级** — 撰写 manifest 文件,以新契约注册为 skill #1;无新功能开发
- **Skill 作者文档** — `docs/skill-author-guide.md` 指导第三方如何贡献新 skill

**Architecture decisions (v1.6):**
1. Phase 编号延续 v1.5 → 从 Phase 28 开始
2. **契约归属**:契约规范和 TS 接口都住在 kais-aigc-platform 仓库(`src/skills/contract.ts` + `.planning/specs/SKILL-CONTRACT.md`),平台是 source of truth
3. **破坏性变更允许** —— 不需要 legacy adapter 层兜底;kais-movie-agent 同步升级以遵守新契约
4. **泛化导向**:目标 skill 覆盖影视变体 / 音频 / 互动 / 轻量四大类,契约必须高度泛化,不能为 movie 流程硬编码
5. **本期不实现第二个参考 skill** —— 只验证 kais-movie-agent 在新契约下能继续工作;第二个 skill 实现留 v1.7+
6. **不动 movie-agent 功能** —— kais-movie-agent 只做最小合规性升级(写 manifest + 注册),不开发新功能
7. 关闭"阶段性资产管理"gap(asset schema 加 skill_id + workflow_phase)作为契约落地的副产物

## Shipped: v1.5 Architecture Hardening + Code Hygiene (2026-06-14)

**Goal:** 关闭 ACE 路由收敛(commit e3d649e/e817e18)后暴露的工程配合问题 — 跨进程协调、遗留 Python 代码退役、路径分散、自动生成机制元问题、内嵌项目类型卫生

**Outcome:** 5/5 phases shipped (23-27). GpuScheduler Redis backend + gold-team Python cleanup + unified output paths + TypeScript compile clean (12,447→0 errors) + router.ts auto-gen root-cause fix. Status: tech_debt (0 blockers, 11 deferred items).

## Shipped: v1.4 Production Verification + Repo Governance (2026-06-13)

**Goal:** 让 v1.3 架构对齐真正"跑通"（live runtime 验证 + ENG-04 修复），并梳理 15+ sibling agent repo 的存活状态、归档死 repo、明确依赖边界

**Target features:**
- Live runtime 验证：docker-compose.v9.yml 全栈启动 + 健康检查 + E2E 音乐生成（关闭 FIX-02/03）
- Dockerfile build 验证（关闭 MERGE-03）
- ACEStepEngine 后端类型修复（关闭 ENG-04，MOCK → DOCKER）
- Sibling repo 全面审计：active / legacy / archived 三态分类
- 死 repo 归档：移入 archive 目录或标注 deprecated
- Service ↔ Repo 依赖地图：明确每个 compose service 来自哪个 repo
- README/AGENTS.md 更新：让新加入者 5 分钟看懂仓库布局

**Architecture decisions (v1.4):**
1. v1.4 优先级：**先稳定再治理** — 生产验证在前，Repo 治理在后
2. Phase 编号延续 v1.3（Phase 20+）
3. v1.3 phase 目录**保留**（作为审计证据，不归档），v1.4 新 phase 用 `phase-20-*` 命名
4. Repo 治理采用"分类不销毁"策略：归档到 `.archive/repos/` 或在 README 标注 deprecated，不直接删除（保留 git 历史）
5. ENG-04 修复点：`docker/gold-team/src/v6/engines/acestep.py` 的 `backend_type` property override

**Outcome (partial):**
- Phase 20 (ENG-04): ✅ closed via commit `1d5996a` (backend_type classification fix)
- Phase 21 (VERIFY): ⚠ partial — VERIFY-01/02/04 closed; VERIFY-03 hardware-blocked (live music gen needs full GPU runtime)
- Phase 22 (REPO): ✅ closed via commit `6c9c3b1` (19 sibling repos audited, movie-agent archived, REPO-MAP created)
- Additionally shipped mid-milestone: ACE route convergence (commits e3d649e + e817e18) — accelerated v1.5 scope

### Shipped: v1.3 Architecture Alignment — Engine Consolidation (2026-06-13)

- v6 代码合并（研发版 → 部署版，消除分叉）
- 7 个 workflow builder 补全（flux_dev, flux_ipadapter, hunyuan3d, trellis, flux_trellis_full, lipsync, frame_interpolate）
- BackendType 枚举分类（COMFYUI/SUBPROCESS/CLOUD/DOCKER/MOCK）
- movie-agent 完全清退（OpenClaw Agent 替代）
- ACE-Step 权限修复
- 102/102 测试通过；遗留 3 个 live runtime gap（FIX-02/03, MERGE-03）+ ENG-04 → **v1.4 关闭**

### Shipped: v1.2 Integration Testing — Hermes-Agent (2026-06-07)

- docker-compose.test.yml 隔离测试环境 + conftest_integration.py 共享 fixture
- 14 个测试文件，42+ 测试用例覆盖 FR-01 ~ FR-04 全部 Must 项
- hermes-client.js 端到端链路测试 + 降级/重试验证
- 并发压力测试 (10 concurrent, 20 mixed) + 100-cycle 稳定性 + 容器重启恢复
- GitHub Actions CI workflow (PR 触发) + run-integration-tests.sh + make test-integration

### Shipped: v1.1 Hermes Intelligent Decision Engine (2026-06-06)

- 域无关 REST API (decide / audit / register / health) — hermes-agent Python 库模式
- 自学习循环 (audit → EWMA confidence → auto-learn trigger)
- movie-pipeline 首个域注册，14 专家技能 + 10 阶段参数知识迁移
- hermes-client.js 适配 + HERMES_DEFAULTS 降级 + Docker 容器部署
- 替代旧 hermes-worker-agent (:3100) 和 kais-hermes Decision API (:8080)

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-15 after v1.6 milestone kickoff*
