# KAIS AIGC Platform — Engine Integration

## What This Is

AI 短剧全链路制作平台，通过 kais-gold-team 统一执行引擎编排 ComfyUI 本地推理和云端商业 API，实现从剧本到成片的一站式 AI 制作。服务于内容创作者和影视团队。

## Core Value

让 AI 短剧制作流程跑通——从角色设计、剧本生成、分镜、视频生成到后期制作的完整管线能够自动执行并产出可交付的成片。

## Current Milestone: v3.1 重生成闭环深化 (regen-loop-deepening)

**Goal:** 付清 v3.0 收尾锁定的三笔「生成-迭代闭环」欠账——窄触发 stale 级联、全配方持久化、保存后面板保持——并顺带清掉审计三笔低优先债 (TD-3/4/5)。

**Target features:**
- **窄触发 stale 级联** — 仅面板编辑重生成 / 换 seed 重跑两条路径按请求关联把下游标 stale；Phase 37 批量执行零影响
- **全配方持久化** — steps/cfg/sampler/lora/quant 等全量高级字段进出 `EventNodeV3.params`，编辑即真值，重生成直接消费
- **保存后面板保持** — reload 链保 `detailNode`，真机保存 200 后面板不收起，与 mock 行为对齐
- **TD-3/4/5 清债** — `placeNewAsset` 无调用方、reviewBridge 无尾斜杠 307 陷阱、51-REVIEW I1 buildMeta round-trip + I5 node:created 派生直写

**Key context:** khs2 v2.4 Phase 25 gate 未过 → 53 Wave B (TD-1) 继续留在范围外；本期全部改动限 kap 仓画布侧，无跨仓库依赖。

v3.0 画布创作体验 shipped 2026-08-22 (audit passed f9280e0c; 305/305 verify; Phase 52 verification materials delivered 2026-08-22 by owning session — carry-forward closed). Archive: milestones/v3.0-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md.

## Shipped: v3.0 画布创作体验 (Canvas Creative Experience for kmc)

**Goal:** 以 kmc 22-phase/16-gate 创作流为准绳，系统性修复画布写路径地基，并把"看/选/改/批"四类创作交互在画布 + 平台页面上做到一等公民。

**Target features:**
- **写路径统一** — 保存/审核/删除全部走 V3 canonical graph，废弃 legacy v1 mapper 绕行与派生缓存直改
- **prompt 编辑→重生成闭环** — 画布上可编辑 prompt、同配方换 seed 重跑、stale 下游一键重跑
- **候选对比升级** — 变体墙(评分/prompt/参数/并排大屏)，修复缩略图 resolveMediaUrl
- **Gate 中心 + 阻塞态呈现** — 16 gate 的 pending/approve/reject/waive 在画布一等化
- **变体组全链路渲染 + 选优回写** — field-map 补 candidate/variant/winner 字段(kmc 侧同步修改已授权)
- **画布 UX 深化** — 死代码清理(~2500 行)、zone 表对齐 22 phase、分镜层级浏览、审核分数可视化、角色/场景组视图
- **平台页面与门户** — Toonflow 替换评估(纳入本期)、页面互链、成片交付(p13)页面

**Key context:** 诊断驱动(三路并行审计 2026-08-21)；Toonflow 26MB 无源码 bundle 纳入替换评估；kmc 仓库(kais-hermes-skills)允许同步修改；版本号 v3.0(画布体验重大重构)。

## Requirements

### Validated

<!-- Shipped and confirmed. -->

- ✓ 画布写路径统一 (V3 canonical graph: save-v2 保存/右键审核删除/MetaEditor+socket 回写; ~3,200 行死代码清除; @kais/flowgraph-v3 依赖正名; COORD-01 成文) — v3.0 Phase 51
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
- ✓ Skill Manifest 契约 + zod v4 校验器 + 命名空间节点 ID (`<skill_id>::<type>`) — v1.6
- ✓ 持久化 skill registry + 零配置启动 (`o_skillRegistry` + `registry.ts` + `loader.ts`) — v1.6
- ✓ Skill Registry REST API (`GET/POST /api/v1/skills/*`) — v1.6
- ✓ Pipeline callbacks 解耦 movie-v1 (注册表查询取代硬编码常量) — v1.6
- ✓ Canvas 节点类型动态化 + FallbackNode 兜底未知类型 — v1.6
- ✓ movie-v1 install-ready manifest + Skill 作者文档 — v1.6
- ✓ ingest 候选建组 + assetType 真值源 + workflow_phase 自动写入 (135 断言 verify:phase-48) — v2.1 Phase 48
- ✓ 选定回写闭环: select-winner 事务化端点 + 资产中心↔画布双向联动 + review-platform 桥接 (gates 79/63/50 + vitest 172/172) — v2.1 Phase 49; SC-4 kmc 消费侧半环为跨仓库债务 (review-platform 无 chosen_variant_id/词汇不匹配, 已登记)
- ✓ 存量回填 + 契约守护: 154 组/240 行挂链, workflow_phase NULL 1456→922, eliminated 386 字节未动, verify:phase-50 114 断言 — v2.1 Phase 50

## Shipped: v2.1 候选资产配套 (candidate-asset-completeness) — 2026-08-19

**Goal:** 打通 kmc 冗余候选生成 ↔ kap 无限画布/资产管理中心的配套管道。

**Outcome:** 3 phases (48-50), 8 plans, 12/12 requirements。ingest 候选建组契约源头 + assetType 真值源 + select-winner 事务化回写闭环 (前端接线/双向联动/review 桥接) + 生产存量回填 (154 组/240 挂链/wf NULL 1456→922/eliminated 386 未动/幂等 0/0) + verify:phase-50 等 5 个 gate 契约守护。Deferred: SC-4 kmc 消费侧半环 (跨仓库债务)、HUMAN-UAT 浏览器目检 4 项、WR-10 竞态。见 [MILESTONES.md](MILESTONES.md)。


## Shipped: v2.0 Canvas Sync Permanence (画布同步永久治理) — 2026-07-16

**Goal:** 永久根治 kais-movie-pipeline → 无限画布自动同步中"资产同步不全 / 结构化参数缺失 / 描述过简"三联症。通过**源端契约 + 接收端契约 + E2E 回归 + 存量 backfill** 四道闸,让该问题不再回归。

**Outcome:** 6 phases (42-47) 全部 shipped,12/12 plans。源端 manifest 契约硬化 + canvas_sync 单路径映射 + 接收端 schema 严格化 + 文字资产 UI 完整性 + E2E 契约测试 + 历史 backfill。唯一 deferred:BACKFILL-02 人工抽样签收。

**Target features (delivered):**
- **源端契约硬化** (`kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py`) — 当前 `REQUIRES_CONTENT` 只管 prompt/description;扩展为**全字段契约**:`archetype/role/era/scene_id/shot_id/engine/...` 都必须出现在 manifest `params.*` 中,且 round-trip 到 canvas `node.data`。新增 manifest schema 测试。
- **canvas_sync.py 精简** (`plugins/kais_aigc/canvas_sync.py`,3409 行) — 拆分/瘦身,删除 legacy 路径,确保 `phase_result → canvas node` 是单一可测的映射路径。
- **接收端契约硬化** (`src/lib/canvasAssetSchema.ts`) — schema 声明完整字段集;`import-from-dir.ts` 检查 manifest 字段完整性;UI fallback 链路完整。
- **文字资产完整映射** — 每个 phase `.txt` 输出(script/prompt/description 等)必须映射为节点 description 或独立文字资产节点,不再仅剩 label。
- **端到端回归测试** — 跑一个完整 phase(如 p04),断言画布上每个节点都有 prompt OR description + 关键 `params.*` 字段齐全。
- **存量 backfill 执行** — 跑 `python3 scripts/backfill-asset-descriptions.py --apply` 修 530 个历史空壳节点。

**Architecture decisions (v2.0):**
1. **v2.0 major** — 跨仓库结构化契约变更,且是"永久治理"性质;比 minor 更重
2. Phase 编号延续 v1.9(Phase 42+)
3. **双仓库同步变更**,但通过 manifest 契约解耦——每侧可独立测试
4. **E2E 测试归位 kais-aigc-platform 仓库**,通过 docker-compose 跑一个真实 phase 验证画布节点齐全
5. **canvas_sync.py 精简不重写**——渐进式,删除明确 dead code,保留核心 `on_phase_complete` 路径
6. **Backfill 是一次性脚本**,不进入持续运行代码;`--apply` 后归档
7. **契约真值源** ——`src/lib/canvasAssetSchema.ts` (TS zod) 和 `pipeline/phases/_manifest.py` (Python `MANIFEST_PARAM_SCHEMA`) 平行声明,通过双端 contract test 守住字段集一致

## Shipped: v1.9 Canvas Sync Reliability (2026-06-24)

**Goal:** Eliminate silent data-loss in kais-movie-agent ↔ canvas sync via append-only event log + monotonic reducer + idempotent write API + resumable WS subscription.

**Outcome:** Phase 40 (joint-debug) + Phase 41 (event sourcing) shipped. 12 SYNC-* requirements satisfied. `kv_canvasEvent` table + reducer + `POST /api/v2/canvas/events` + `load-v2?since=` + WS `subscribe` handshake. Frontend hook behind `VITE_CANVAS_EVENT_REPLAY=1` flag.

## Shipped: v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation (2026-06-19)

**Goal:** Reconcile drifted master ↔ kais-movie-agent V8.6 (sibling repo). Master exposes `/api/v2/canvas/*` contract routes.

**Outcome:** Phase 39 shipped — 3 waves (ADAPT/EXEC/VERIFY), 10/10 ADAPT/EXEC/VERIFY requirements satisfied. Real gold-team engine wiring env-gated; 33/33 contract assertions pass.

## Shipped: v1.7 Infinite Canvas Storyboard & Orchestration (2026-06-18)

**Goal:** 借鉴字节小云雀短剧 Agent 的核心差异化能力,增强无限画布——补齐分镜元数据(运镜/景别/构图/节奏)、引入"一键成片"全链路编排、解锁批量执行工作流。

**Outcome:** 4 phases (35-38), 24/24 requirements satisfied. Tier 1 storyboard metadata + one-click orchestrator + batch execution + Tier 2 preview placeholder all shipped. Zero backend schema changes — fields persist via existing JSON blob.

### Active

<!-- Next milestone (v1.7+) scope — to be defined via /gsd:new-milestone. -->

- [ ] 第二参考 skill (播客/广告/互动/短视频之一) — 验证契约抽象对单 skill 之外的扩展性
- [ ] Skill scaffolding CLI (`kais-skill new`) — 降低第三方作者入门门槛 (AUTHOR-01)
- [ ] Skill 热重载 — 作者修改 manifest 无需重启平台 (AUTHOR-02)
- [ ] 离线 manifest 校验 CLI (`kais-skill validate manifest.json`) — 提交前本地校验 (AUTHOR-03)
- [ ] 单项目多 skill 共存 (MULTI-01/02/03) — 当前 v1.6 一个项目一个 skill
- [ ] 自定义节点渲染器 HTTP 下发 (RENDER-01/02) — 当前仅 5 内置 + FallbackNode
- [ ] 单 skill 健康追踪 + 自动禁用 (HEALTH-01/02/03) — 复用 hermes EWMA 模式
- [ ] Phase 33 COMPLIANCE-03 实跑签收 — Docker + GPU 上跑 movie-v1 全链路（前置生产部署）
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
| 契约归属平台仓库 (`src/skills/contract.ts`) | 平台是 source of truth；契约与运行时同库，避免漂移 | ✓ Good — v1.6 一次漂移都没发生 |
| zod schema 是 spec 的真值源 | markdown 由 schema 推导或字段相等性测试 (Pitfalls C1) | ✓ Good — drift test 在 verify-phase-28 守住 |
| 节点 ID 命名空间 `<skill_id>::<type>` | 防止多 skill 之间节点类型冲突；validator 拒绝裸 ID | ✓ Good — COMPLIANCE-04 负向测试守住 |
| Manifest 仅描述，行为在平台侧 (Pitfalls A4) | 不允许 manifest 携带可执行代码；保持平台对行为的完全控制 | ✓ Good — 守住"反 Web3 智能合约"边界 |
| Registry 是真值源，删除常量而非包装 | 避免"两个真值"漂移；契约升级时一处变更 (Architecture Pattern 3) | ✓ Good — PIPELINE-05 等价性回归守住 |
| 破坏性变更允许，无 legacy adapter | kais-movie-agent 同步升级，避免长期技术债 | ✓ Good — 单一参考 skill，升级面小 |
| 零配置默认 seed (`seedDefaultIfEmpty`) | 升级路径无需手跑迁移；empty DB 自动落 movie-v1 | ✓ Good — 23/24 CI 通过，1 留作 live 签收 |
| 项目级单 skill (本期) | 验证抽象本身，多 skill 共存留 v1.7+ (MULTI-01..03) | ⚠️ Revisit — v1.7 必须验证多 skill 共存场景 |

## Shipped: v1.6 Workflow Skill Contract(工作流 Skill 契约抽象) — 2026-06-15

**Goal:** 为 kais-aigc-platform 引入"工作流 Skill 契约"抽象层,让平台停止对 kais-movie-agent 的隐式耦合——任何工作流 skill(短剧/动画/纪录片/广告/短视频/海报/音乐视频/播客/有声书/互动剧情/游戏过场)都可以注册并驱动平台,平台仅作为 skill-agnostic 基础设施。

**Outcome (shipped 2026-06-15):** 7 phases (28-34), 35/36 requirements satisfied, 277/278 automated assertions PASSED. Skill contract published at `src/skills/contract.ts` + `.planning/specs/SKILL-CONTRACT.md`. Registry layer (`o_skillRegistry` + `registry.ts` + `loader.ts`) replaces 3 hardcoded constants in pipeline callbacks. Canvas fetches node types dynamically. Skill author guide + install-ready manifest shipped. **1 deferred sign-off:** COMPLIANCE-03 (live Docker+GPU golden-path run) — environment-gated, not a code gap.

**Target features (delivered):**
- **Skill Contract 规范文档 + TypeScript 接口** — manifest schema 定义 skill_id / version / node_types / phase_taxonomy / runtime (`.planning/specs/SKILL-CONTRACT.md` + `src/skills/contract.ts` + `src/skills/validator.ts`)
- **Skill Registry(平台侧)** — `o_skillRegistry` 表 + `registry.ts` 单例 + `loader.ts` 启动注入;`GET/POST /api/v1/skills/*` 5 个 REST 端点
- **Canvas 节点类型注册表泛化** — `packages/infinite-canvas` 从 API 动态加载节点类型;`FallbackNode` 兜底未知类型
- **Phase / 状态机泛化** — `phase-complete.ts` / `resume.ts` / `submit-to-review.ts` 全部走 `registry.phaseById` 查询;3 个硬编码常量 (`REVIEW_REQUIRED_PHASES` / `PHASE_INGEST_MAP` / `PHASE_ORDER`) 已删除
- **Asset schema 扩展** — `o_assets` 增加 `skill_id` + `workflow_phase` 字段(同时关闭前一轮审计识别的"阶段性资产管理"gap)
- **kais-movie-agent 合规性升级** — `docs/skill-author-guide/movie-v1.manifest.json` install-ready artifact
- **Skill 作者文档** — `docs/skill-author-guide.md` 含字段参考、部署顺序、"反特性"清单、注释化 manifest 例子

**Architecture decisions (v1.6) — see Key Decisions table above for outcomes.**

**Known deferred sign-off:** Phase 33 COMPLIANCE-03 (live Docker + GPU golden-path run) — 6-step checklist in `33-VERIFICATION.md`. Environment-gated, not a code gap. Carried in STATE.md → Deferred Items.

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
*Last updated: 2026-08-23 — milestone v3.1 (重生成闭环深化) started*
