# Roadmap

## Milestones

- ✅ **v1.0 MVP** — Phases 1-6 (shipped)
- ✅ **v1.1 Hermes Intelligent Decision Engine** — Phases 7-10 (shipped 2026-06-06)
- ✅ **v1.2 Integration Testing** — Phases 11-14 (shipped 2026-06-07)
- ✅ **v1.3 Architecture Alignment** — Phases 15-19.1 (shipped 2026-06-13)
- ✅ **v1.4 Production Verification + Repo Governance** — Phases 20-22 (shipped 2026-06-13, partial)
- ✅ **v1.5 Architecture Hardening + Code Hygiene** — Phases 23-27 (shipped 2026-06-14)
- ✅ **v1.6 Workflow Skill Contract** — Phases 28-34 (shipped 2026-06-15)
- ✅ **v1.7 Infinite Canvas Storyboard & Orchestration** — Phases 35-38 (shipped 2026-06-18)
- ✅ **v1.8 Canvas ↔ Movie-Agent V8.6 Adaptation** — Phase 39 (shipped 2026-06-19)
- ✅ **v1.9 Canvas Sync Reliability** — Phases 40-41 (shipped 2026-06-24)
- ✅ **v2.0 Canvas Sync Permanence** — Phases 42-47 (shipped 2026-07-16)
- ✅ **v2.1 候选资产配套 (candidate-asset-completeness)** — Phases 48-50 (shipped 2026-08-19)
- ✅ **v3.0 画布创作体验 (Canvas Creative Experience for kmc)** — Phases 51-57 (shipped 2026-08-22, audit passed)
- ✅ **v3.1 重生成闭环深化 (regen-loop-deepening)** — Phases 58-62 (shipped 2026-08-24, audit passed)
- 🔄 **v3.2 跨仓协调清偿 (cross-repo-coordination-debt-clearance)** — Phases 63-73 (executed 2026-08-25 回溯立项, 3 项待真机 carry-forward, audit pending)

## Phases

**Phase Numbering:**

- Integer phases (1-14): Shipped in v1.0-v1.2
- Integer phases (15-19) + decimal (19.1): Shipped v1.3
- Integer phases (20-22): v1.4
- Integer phases (23-27): v1.5
- Integer phases (28-34): v1.6 (shipped)
- Integer phases (35-38): v1.7 (shipped)
- Integer phase (39): v1.8 (shipped)
- Integer phases (40-41): v1.9 (shipped)
- Integer phases (42-47): v2.0 (shipped)
- Integer phases (48-50): v2.1 (shipped)
- Integer phases (51-57): v3.0 (shipped 2026-08-22 — audit passed; Phase 52 externally owned, code-on-master, user-accepted)
- Integer phases (58-62): **v3.1 (shipped 2026-08-24)**
- Integer phases (63-73): **v3.2 (executed 2026-08-25, 回溯立项同日)**
- Decimal phases (e.g., 58.1): Urgent insertions

Decimal phases appear between their surrounding integers in numeric order.

### ✅ Previous Milestones (Shipped)

<details>
<summary>Phases 1-50: v1.0 through v2.1 — collapsed</summary>

See [milestones/](milestones/) for per-milestone ROADMAP/REQUIREMENTS/AUDIT archives and [MILESTONES.md](MILESTONES.md) for summaries:

- v1.0-v1.2: generation pipeline + hermes decision engine + integration testing
- v1.3-v1.5: engine consolidation, production verification, architecture hardening
- v1.6: Workflow Skill Contract (manifest/registry/canvas dynamic node types)
- v1.7: storyboard metadata + one-click orchestrator + batch execution
- v1.8-v2.0: canvas ↔ movie-agent adaptation, sync reliability, sync permanence
- v2.1: ingest candidate grouping + selection write-back + historical backfill + contract guards

</details>

<details>
<summary>✅ v3.0 画布创作体验 (Phases 51-57) — SHIPPED 2026-08-22</summary>

以 kmc 22-phase/16-gate 创作流为准绳：画布写路径统一走 V3 canonical graph，"看/选/改/批"四类创作交互一等公民化。

- [x] Phase 51: 写路径地基统一 (Canonical Write Path + Coordination Guard) — completed 2026-08-21
- [x] Phase 52: 生成-迭代闭环 (Prompt Edit → Regenerate Loop) — **materials delivered 2026-08-22 by owning session** (8/8 SUMMARYs + VERIFICATION passed + UAT gaps closed; verify:phase-52 31/31, e2e 62, 真机 probe 全绿)
- [x] Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade) — completed 2026-08-21 (Wave A; Wave B gated on khs2 v2.4 Phase 25)
- [x] Phase 54: Gate 中心 (Gate Center + Blocking-State UX) — completed 2026-08-21
- [x] Phase 55: 画布导航与规模 (Navigation & Scale) — completed 2026-08-22
- [x] Phase 56: 创作环节可视化 (Creative Visualization) — completed 2026-08-22
- [x] Phase 57: 平台页面与门户 (Portal & Delivery Pages) — completed 2026-08-22

Audit: **passed** (305/305 verify assertions · 435/435 vitest · 3× tsc clean · live probes ok). Full detail: [milestones/v3.0-ROADMAP.md](milestones/v3.0-ROADMAP.md) · [milestones/v3.0-MILESTONE-AUDIT.md](milestones/v3.0-MILESTONE-AUDIT.md)

</details>

### 🔄 v3.2 跨仓协调清偿 (cross-repo-coordination-debt-clearance) — CURRENT

**Milestone Goal:** 付清 08-25 12-agent 双仓复审确认的 40 条跨仓协调欠账（15 high/16 med/9 low），四仓合围（kap / khs2 / kais-gold-team / kais-review-platform），终结「verify 门绿但链路断」的假成功模式。纯清偿性里程碑，零新能力。

**Created:** 2026-08-25（回溯立项）
**Source:** 08-25 12-agent fan-out 双仓复审 40 findings → F01-F40 全落 phase（40/40 覆盖，无遗漏）。
**Evidence annex:** [v3.2-ROADMAP-DRAFT.md](v3.2-ROADMAP-DRAFT.md)（F01-F40 findings 索引 + 逐 phase 执行证据 + 验证矩阵）
**ADRs:** [adrs/adr-v3.2-variant-domain.md](adrs/adr-v3.2-variant-domain.md)（三 ADR: chosen_variant_id=string finalist id / score scale 三档 unit/ten/percent / 归组一主两从）

**⚠️ 回溯立项（retrospective formalization）:** 11/11 phases 已于 2026-08-25 当天在授权代执行下完成（四仓 24 commits: kap 12 · khs 6 · gold-team 2 · review-platform 1），本 ROADMAP 按已交付终态固化，非前瞻规划。验证矩阵全绿：verify-53 102/102 · 54 62/62 · 55 18/18 · 56 89/89 · 65 31/31 · canvas vitest 496/496 · khs 三目录 831+ · review-platform 443+（基线外零新失败）· 生产 :10588 pid 2680419 GOLD_TEAM_URL+KMC_MANIFEST_TRANSPORT=fs 双 env 实证 · review-api 容器重建部署。⏸ 3 项待真机 carry-forward（WBX-05 / 70-05 CHS-05 / QVR-03 存量部），代码链全通，随下次活体管线自然覆盖。

**v3.2 Phases:**

- [x] **Phase 63: 引擎真值源收编 (Engine Truth-Source Consolidation)** — gold-team 容器真值四文件回灌入仓 (47/50 md5) + v9 compose 钉 real 镜像 + khs assets 5.0Pro 清零 (completed 2026-08-25)
- [x] **Phase 64: p11a5 相位跟进与注册表契约门 (p11a5 Registry Catch-up)** — 注册表 22→23 + TYPE_MAP 契约门 F 组 + 六处类型分叉修正; verify:phase-55 12/14 红→18/18 绿 (completed 2026-08-25)
- [x] **Phase 65: 重生成引擎契约对齐 (Regen Engine Contract Alignment)** — Stage→TaskType 对照引擎消费契约 + video 首帧/tts text/图像配方保真 (ratio/modelVersion 键名/seed 真值) + bgm/foley 走 kap 内部端点 (completed 2026-08-25)
- [x] **Phase 66: 生产通电与真机闭环 (Production Power-On)** — serve-production.sh 双 env + 真机探针 9/9 cloud-jimeng 真渲染 + 52 时代验证口径回溯标注 (completed 2026-08-25)
- [x] **Phase 67: G15/G16 豁免桥三仓闭环 (Waive Bridge 3-Repo Closure)** — review-platform `/api/v1/g15/ops` 端点 + khs 逐镜头子集豁免消费端 + kap 桥诚实化 (⏸ WBX-05 UAT 11 待真机) (completed 2026-08-25)
- [x] **Phase 68: 变体域契约重对齐 (Variant Domain Contract Realignment)** — v2.5 键重冻结 + 三档 scale + S1f 双源验证门 + 三 ADR + Wave B 失实理由销账; verify-53 97→102 (completed 2026-08-25)
- [x] **Phase 69: Wave B 实施——manifest transport 与真实数据源 (Wave B Implementation)** — FS transport 通电 + G15 真实数据源 + khs 五源落盘 + requeue 并集消费 (completed 2026-08-25)
- [x] **Phase 70: 换选通道端到端 (Choose/Swap Channel E2E)** — per-phase id 空间 + variantNumber 真编号 + fullPhaseToken 防错批 + selected ADR-1 (⏸ 70-05 G13 换选 e2e 待真机) (completed 2026-08-25)
- [x] **Phase 71: 画布↔kmc 共存语义 (Canvas↔kmc Coexistence)** — 裁决②a 画布为配方真值: `_kmc_prompt` 哨兵 + stale 两仓统一 + canvas-takes 产物回流 + replace/sequence 收口 (completed 2026-08-25)
- [x] **Phase 72: QC 与评分可视化真数据 (QC & Score Visualization Real-Data)** — 判定数组透传 + aiScore 生产者 + DIM_LABELS 修真 + 五值 verdict + registerAuditToken 扩展 + 声纹 metaSub (⏸ QVR-03 存量回填待下次 sync) (completed 2026-08-25)
- [x] **Phase 73: 门中心语义细化与调度欠账 (Gate Center Semantics & Scheduling Debt)** — p11b 异步哨兵 + 红线 reject 墓碑上浮 + qwen-eye 队列优先 + status-check v2 关系表 (completed 2026-08-25)

**裁决点 (6, 全落):** ①bgm/foley 走 kap 内部端点 (65) ②a 画布为配方真值 (71) ③chosen_variant_id=string finalist id (68/70) ④review-platform 新增 /api/v1/g15/ops (67) ⑤a 判定数组节点保留不展开 (72) ⑥11 phase 全量立项。③⑤详见 ADR，①②④⑥ 记录于 [v3.2-ROADMAP-DRAFT.md](v3.2-ROADMAP-DRAFT.md) 裁决表。

**里程碑级守护:**

- **COORD-01 (v3.0 延续)** — 跨仓变更必须双向销账。
- **COORD-02 (新) 端到端数据链验证纪律** — 每个跨仓 phase 的 verify 门必须含「生产数据命中」断言（端点 curl 非 404 / 消费端 grep 有生产者 / 生产库行数>0），「映射表字面量命中」不再单独作为通过依据——本轮 15 条 high 中 8 条由此漏网。
- **COORD-03 (新) 契约冻结时效** — 任何冻结契约引用对侧仓状态时（如 Wave B gate），verify 门定期复查引用是否过期（gate 满足后 deferral 文档自动标红）。
- **回归锁** — 52/55/59/62 既有 verify 门全绿为每 phase 完成前置；64 完成后 verify:phase-55 恢复其「跨仓漂移告警」设计职能。

### ✅ v3.1 重生成闭环深化 (regen-loop-deepening) — SHIPPED

**Milestone Goal:** 付清 v3.0 收尾锁定的三笔「生成-迭代闭环」欠账——窄触发 stale 级联、全配方持久化、保存后面板保持——并顺带清掉审计三笔低优先债 (TD-3/4/5)。全部改动限 kap 仓画布侧，无跨仓库依赖。

**Created:** 2026-08-23
**Source:** v3.0 收尾锁定的三笔闭环欠账 + 51-REVIEW I1/I5 + 里程碑审计 TD-3/4/5

**v3.1 Phases:**

- [x] **Phase 58: 全配方持久化 (Full Recipe Persistence)** — §14 窄通道扩展为全量高级字段进出 `EventNodeV3.params`:面板编辑/持久化/序列化往返/重生成请求体 + schema↔面板防漂移守护 (completed 2026-08-23)
- [x] **Phase 59: 窄触发 stale 级联 (Narrow-Trigger Stale Cascade)** — 面板编辑重生成 + 换 seed 重跑两条路径按请求关联自动标下游 stale;编排/批量路径零影响(负向断言锁死) (completed 2026-08-23)
- [x] **Phase 60: 保存后面板保持 (Post-Save Panel Persistence)** — canvasStore reload 链保 `detailNode`,真机保存 200 后详情面板不收起,锚定语义等价 (completed 2026-08-24)
- [x] **Phase 61: 审计清债 TD-3/4/5 (Audit Debt Clearance)** — placeNewAsset 活调用方 + reviewBridge 尾斜杠 307 消除 + buildMeta 5 字段读回 + node:created canonical-or-document (completed 2026-08-24)
- [x] **Phase 62: 资产管理中心资产层级与选定逻辑 (Asset Hierarchy & Selection)** — 三层资产层级视图(阶段/类型→候选组→候选) + 层级化选定逻辑 + 画布内 pre/final 冗余配置入口(2026-08-24 /goal 扩入;改动仍限 kap 仓画布侧,kmc 仓配合面由 khs v2.5 处理)

**Architecture decisions (v3.1):**

1. **Phase 编号延续 v3.0** (Phase 58+)
2. **RECIPE 先于 STALE** — 两者都要动 execute.ts 请求体与两条重生成路径(panel-edit-regen / reroll-seed);先定数据通道的最终形状(全配方字段进请求体),再在其上挂 per-request 关联级联,避免同文件二次返工;STALE-01 的验收故事("编辑配方后重生成")直接消费 RECIPE 成果
3. **STALE 锁定最小方案** — executeNode extra channel + per-request correlation;仅 panel-edit-regen 与 reroll-seed 两条路径触发级联;orchestrate/batch 路径必须保持零改动,以负向断言/e2e 锁死(STALE-03 是行为不变式,不是新功能)
4. **PANEL 与 DEBT 均 parallel-safe** — PANEL 是 canvasStore reload 链修复,与 58/59 的数据通道正交;DEBT 四项相互独立;串行排在末两位只为 solo 执行次序,无硬依赖
5. **改动限 kap 仓画布侧** — `packages/infinite-canvas` + `src/`;khs2 Wave B (TD-1) 维持范围外;e2e 测试落 `packages/infinite-canvas/test/e2e/tests/`
6. **守护传统延续** — RECIPE-04 防漂移 verify 断言、STALE-03 负向断言、DEBT-02 回归锁、DEBT-03 往返保真断言,均为 phase 验收门

## Phase Details

### Phase 58: 全配方持久化 (Full Recipe Persistence)

**Goal**: §14 窄通道(现仅 prompt/seed/engine/modelVersion)扩展为全量高级配方——steps/cfg/sampler/lora/量化等字段经 `EventNodeV3.params` 全链路打通:详情面板(EventParamsPopover)可编辑、persistEventParams 持久化、serialize 往返、execute.ts 重生成请求体直接消费。编辑即真值,窄通道不再丢弃高级字段。
**Depends on**: Nothing within v3.1 (first v3.1 phase; builds on shipped Phase 52 §14 narrow channel + 51 canonical write path)
**Requirements**: RECIPE-01, RECIPE-02, RECIPE-03, RECIPE-04
**Success Criteria** (what must be TRUE):

  1. 用户在详情面板编辑 steps/cfg/sampler 等高级字段并保存后,刷新页面重新加载画布,字段值保持编辑后的值(reload 往返保真断言)。
  2. 编辑 cfg/steps 后点击重生成,发出的引擎请求体携带编辑后的高级字段值(请求体断言可见)——编辑即真值,窄通道不再丢弃未覆盖字段。
  3. lora/量化等复杂结构字段可在面板编辑且结构保真;只改 steps 时,未编辑的 lora/quant 原样保留,不被 nullish 清洗抹掉。
  4. verify 断言锁死 canvasAssetSchema 字段集 ↔ 面板可编辑字段集一致——任一侧新增字段未同步另一侧时断言变红。

**Plans**: 4 plans
Plans:
**Wave 1**

- [x] 58-01-PLAN.md — 数据通道: recipe.ts 九键映射契约 + migrate 全集提取 + serialize 反向覆盖拓宽 + delete 传播(serialize+migrate 同 plan,Pitfall 3)+ verify-phase-51 断言注解

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 58-02-PLAN.md — 编辑 UI: PromptSection 高级参数折叠区(UI-SPEC 契约)+ popover KNOWN_KEYS 换共享常量源 + canvasAssetSchema 五类型 optional 声明

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 58-03-PLAN.md — e2e: phase58-recipe.mjs fixture 注入 + 编辑往返/清空 delete/请求体整袋/落选只读三层断言 + 全量回归
- [x] 58-04-PLAN.md — 守护与真机: verify-phase-58 三方集合相等聚合门 + forced-failure + probe-58-real 零足迹探针

**UI hint**: yes

### Phase 59: 窄触发 stale 级联 (Narrow-Trigger Stale Cascade)

**Goal**: 生成-迭代闭环获得下游感知——仅面板编辑配方重生成与事件芯片换 seed 重跑两条路径,按 per-request 关联(executeNode extra channel)把该资产的下游节点自动标 stale,角标可见且可一键重跑;编排/批量执行路径行为零变化。**+ execute 链四断点全修**(2026-08-23 discuss 用户裁决扩入:①_engine poll 读引擎真实 outputs.image ②/mnt/agents/output→/oss/ 路径翻译 ③_simulate 假成功改真错误广播 ④ref_images 参数名与路径形态对齐,含 REGEN-02 seed 透传)——级联必须建立在真实成功信号上,详见 59-CONTEXT D-06/D-07。
**Depends on**: Phase 58 (关联级联构建在最终请求体形状之上;STALE-01 触发路径即 Phase 58 打通的配方编辑重生成)
**Requirements**: STALE-01, STALE-02, STALE-03
**Success Criteria** (what must be TRUE):

  1. 用户在详情面板编辑配方后重生成成功,该资产的下游节点自动出现 stale 角标——无需任何手动标记动作。
  2. 用户在事件芯片换 seed 重跑成功后,下游节点同样自动标 stale。
  3. 编排(orchestrate)/批量执行成功后,下游不出现任何 stale 角标——既有批量链路行为零变化,负向断言/e2e 锁死。
  4. 被 stale 的节点可经既有 Phase 52「重跑下游」出口消除标记(重跑完成后角标消失);与该资产无下游关系的节点不受级联波及。
  5. execute 链断点修复后,面板重生成产物真实落画布(引擎 outputs.image 读取/oss 路径翻译/ref_images 参数全对齐,seed 真传引擎);引擎故障时报 error 不再假成功——负向断言锁死。

**Plans**: TBD (via /gsd:plan-phase)
**UI hint**: yes

### Phase 60: 保存后面板保持 (Post-Save Panel Persistence)

**Goal**: 保存动作不再打断审片流——graph:saved 触发的整图重载链保住 `detailNode`,真机后端保存 200 后详情面板保持打开,重载恢复的锚定与保存前语义等价,mock/真机行为对齐。
**Depends on**: Nothing hard within v3.1 (canvasStore reload 链与 58/59 数据通道正交,parallel-safe;串行排在 Phase 59 后)
**Requirements**: PANEL-01, PANEL-02
**Success Criteria** (what must be TRUE):

  1. 真机后端保存返回 200 后,详情面板保持打开——不因 graph:saved 触发的整图重载而收起。
  2. 重载恢复后的面板锚定与保存前语义等价——同一资产/同一事件锚,不漂移到其他节点、不丢失锚上下文。
  3. mock 后端与真机后端两个环境下保存后面板行为一致(对齐 Phase 52 时代 mock 行为),e2e 双环境断言通过。

**Plans**: 5 plans
Plans:
**Wave 1**

- [x] 60-01-PLAN.md — 诊断先行: 真机 :10588 roundtrip id-diff 探针 + store 重锚/loading 探针 → 60-DIAGNOSIS 钉死收起根因与 A/B 修复分支(RESEARCH Pitfall 2 强制次序)
- [x] 60-02-PLAN.md — savedBy tabId 自回声跳过(D-01/D-04/D-05): server zod+broadcast 回显 + clientTabId + saveCanvasGraph 单点附身 + FlowCanvas skip 分支(FLAG-1 基线重置保留) + mock 镜像 + suppressGraphSaved 退役(FLAG-4)

**Wave 2** *(blocked on 60-01)*

- [x] 60-03-PLAN.md — reload 重锚语义: D-03 锚丢失诚实收起 warn + D-07 对称锁 + 诊断分支修复(A 仅锁不修 / B 定层修 id 漂移,roundtrip 零漂移门收口)

**Wave 3** *(blocked on 60-02 + 60-03)*

- [x] 60-04-PLAN.md — phase60-panel-persist.mjs 四用例 e2e(self-save silent / other-client symmetry / anchor-miss / no-revival) + D-12 全量回归(52 三件套+59 全部)

**Wave 4** *(blocked on 60-04)*

- [x] 60-05-PLAN.md — verify:phase-60 聚合门(静态锁 FLAG-1/2/4 + 行为 + dispatch + forced-failure) + probe-60-real 零足迹真机探针(协议段回显契约 + 真浏览器段面板保持)

**UI hint**: yes

### Phase 61: 审计清债 TD-3/4/5 (Audit Debt Clearance)

**Goal**: 清偿审计登记的三笔低优先债——`placeNewAsset(anchor='source')` 获得活调用方、reviewBridge 列表尾斜杠 307 消除、buildMeta 读回 5 个持久化字段、node:created 写 canonical 或显式文档化;每项带回归/守护,清完即销账。
**Depends on**: Nothing hard within v3.1 (四项相互独立,parallel-safe;排在末位避免与 58-60 在途改动冲突)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04
**Success Criteria** (what must be TRUE):

  1. 用户从资产中心/画布入口放置新资产时,走 `placeNewAsset(anchor='source')` 活路径落位到有界位置——附 e2e 断言。
  2. reviewBridge 列表请求直连命中,无 307 中间跳(尾斜杠修正),回归测试锁死不再复发。
  3. 保存含 emotion/promptMeta/murchGrade/archetype/viewAngle 的节点 meta 后 reload 读回一致——buildMeta 5 字段 save→reload 往返保真。
  4. `node:created` 要么写入 canonical graph(V3 资产构造),要么显式文档化为 ephemeral 并留守护注释——代码中的二义消除,裁定结果成文可查。

**Plans**: 5 plans
Plans:

**Wave 1** *(four debts parallel, zero files_modified overlap — D-03)*

- [x] 61-01-PLAN.md — DEBT-01: 资产中心拖入接线(卡片 draggable + 页签 dragover 切视图 + ReactFlow onDrop → placeNewAsset(source) + placeAssetNode 真封装)+ stub 链退役 + mock 两路由 + phase61 e2e 三用例
- [x] 61-02-PLAN.md — DEBT-02: reviewBridge L182 尾斜杠一字修 + 契约注释同步 + node:test 回归锁(字面量正反双断言 + 分页双跳)
- [x] 61-03-PLAN.md — DEBT-03: buildMeta 四分支 5 字段读回(script emotion number 陷阱)+ migrate 单测 + adapt∘serialize 往返(raw=null 档)+ 三面收口
- [x] 61-04-PLAN.md — DEBT-04: Branch A 裁定成文(61-DEBT-04-VERDICT.md: 证据链 + I5 原文 + 静态锁规格,零代码改动)

**Wave 2** *(blocked on 61-01..04 — 收口门 + 销账)*

- [x] 61-05-PLAN.md — verify:phase-61 聚合门(S1-S5 静态锁 + B 行为门 + F forced-failure,零 live probe)+ D-04 销账(REQUIREMENTS 勾选 + Traceability)

### Phase 62: 资产管理中心资产层级与选定逻辑 (Asset Hierarchy & Selection)

**Goal**: 资产管理中心获得显式资产层级——按「管线阶段/资产类型 → 候选组(variant group) → 候选」三层组织资产库,层级间可折叠导航、层内计数聚合(每组选定/待选/淘汰);选定逻辑升级为层级化(组内 winner 选定既有闭环之上提供层级批量决策入口与聚合态展示);新增画布内 pre/final 冗余配置入口(读 kmc generation_config 键面矩阵 + 编辑写入,写入侧契约 discuss 定夺)。2026-08-24 /goal 扩入 phase——资产管理是画布创作闭环「选」面的深化,与 v3.1 主题一致。
**Depends on**: Nothing hard within v3.1(资产管理域与 58-61 债务域文件正交);软依赖 khs(kais-hermes-skills) v2.5 冗余全域化——配置入口的键面契约以 kmc v2.5 交付的 42 节点可配性矩阵为准,UI 可先行以矩阵快照为契约开发,键面漂移由 e2e 契约测试暴露
**Requirements**: HIER-01, HIER-02, HIER-03, HIER-04, HIER-05
**Success Criteria** (what must be TRUE):

  1. 资产管理中心呈现三层层级视图(阶段/资产类型 → 候选组 → 候选),复用既有 `variantGroupId` 分组语义不另造第二套分组;层间可折叠,每层有选定/待选/淘汰计数聚合;42 节点口径下无组资产(单产物)亦有明确层级挂载位。
  2. 选定逻辑层级化:组内 winner 选定走既有 select-winner 事务闭环(不复制粘贴第二套);其上提供层级聚合的批量决策入口(如按资产类型批量选定/批量淘汰,形态 discuss 定夺);DAG 管线 `has-candidates` 待决策提示与层级视图计数一致不回归。
  3. 画布内冗余配置入口:资产层级视图/节点详情可查每资产类型的 pre/final(n_candidates/final_candidates)当前值(读侧)且可编辑(写侧);写入通道契约 discuss 定夺(kap project config 落地 vs kmc requirement.json 同步通道 vs 两段式)并成文;键面覆盖 kmc v2.5 全域化矩阵,未支持键显式标注不可配原因而不是隐藏。
  4. 既有三态流转零回归:AssetLibrary 分组互斥、取消选定恢复、场景/声纹手动选定规则、G13 首尾分选在层级视图下语义保持(负向断言/e2e 锁死)。
  5. e2e 覆盖三条新链路(层级导航 / 层级化选定 / 冗余配置读+写)+ 既有资产管理 e2e 全量回归零破坏。

**Plans**: 7 (via plan-phase)
Plans:
**Wave 1** *(62-01/02/03 并行,文件零交叠)*

- [x] 62-01-PLAN.md — 共享地基: groupCanvasLinkage 提取(双前缀反查/判定式单套)+ generationConfigKeys 键面常量(runner 实码 11+3+18 口径)+ 纯函数单测
- [x] 62-02-PLAN.md — 服务端: generation_config_overrides 表(PK 三列)+ store CRUD + generation-config 路由(GET 三源合并/PUT 两段式 + requirement.json best-effort 三态 writeState)+ node:test
- [x] 62-03-PLAN.md — mock 扩面: PATCH assets-registry/select-winner/generation-config mock + rich search preset(默认字节等价 61 fixture)

**Wave 2** *(blocked on 62-01)*

- [x] 62-04-PLAN.md — 层级视图 UI: 第 5 Tab「资产层级」(域树/组卡/计数芯片/单件桶/双徽标)+ selectGroupWinner 共享提取(D-05 单组全语义+fire-and-forget)+ renderAssetCard 模式参数化

**Wave 3** *(blocked on 62-04)*

- [x] 62-05-PLAN.md — 层级化选定: C4 批量决策(arm-confirm)/场景声纹手动规则/winner mtime-最新规则(单组 auto-init 同步升级)/createdAt 透传(UI-GREY-1)

**Wave 4** *(blocked on 62-02/04/05)*

- [x] 62-06-PLAN.md — 冗余配置 UI: C8 rail(三源角标/钳制双道/写徽标三态/锁定区 19 键口径)+ 层级视图第三栏挂载

**Wave 5** *(blocked on 62-02/03/04/05/06)*

- [x] 62-07-PLAN.md — e2e 三文件(层级/选定/冗余配置,D-04 跨源契约+D-05 勿断 applied:true+D-12 键面契约)+ 全量回归(52/55/61)+ verify-phase-62 聚合门(S/B/F)

**UI hint**: yes

### Phase 63: 引擎真值源收编 (Engine Truth-Source Consolidation)

**Goal**: 结束「引擎真值只活在一个未溯源的容器镜像里」的状态。容器 /app 内模型政策代码（t2i 白名单 {5.0, 5.0lite}、i2i 强制 4.6、cloud 直通 passthrough、image_refine ref_images 兜底）回灌 kais-gold-team 仓留 git 历史；处置 v9 compose 从分叉仓构建抢 :8002 的隐患；清掉 khs2 assets/ 的 5.0Pro 残留。回灌后「按仓重建镜像」必须与现役容器行为等价。
**Depends on**: Nothing（全里程碑地基，Wave 1）
**Repo ownership**: kais-gold-team（主）· kap（compose）· khs2（assets 清零）
**Requirements**: ETS-01, ETS-02, ETS-03, ETS-04 (F04/F34/F40)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: gold-team b0e8839 现场保全 + 39bb666 回灌（47/50 md5 逐一相等 + 3 有意保留，重建镜像策略断言过）；kap 938f26e5 v9 compose 钉 `kais-gold-team:real` 镜像；khs 37631a1 assets 5.0Pro 清零。
**Success Criteria** (what must be TRUE):

  1. 容器内四文件（executor.py / cloud_jimeng.py / cloud_base.py / workflow_builder.py）与仓 HEAD md5 逐一相等；`git log -S '_I2I_MODEL'` / `-S 'model_version'` 在仓内有历史。
  2. 按仓 rebuild 镜像隔离拉起，实测 `_T2I_ALLOWED_MODELS={'5.0','5.0lite'}`、`_I2I_MODEL='4.6'` + image_refine 冒烟 completed——重建即等价。
  3. docker-compose.v9.yml 不再从 ../kais-gold-team 分叉仓构建抢 :8002，v9 误起不再能静默替换白名单实现。
  4. khs2 活代码路径 `grep -rn '5\.0Pro'` 零命中（deprecated 留档例外带标注）。

**Plans**: 已执行（回溯立项，plans 建议见 draft）

### Phase 64: p11a5 相位跟进与注册表契约门 (p11a5 Registry Catch-up)

**Goal**: khs2 已落地第 23 个活跃相位 p11a5_preview_audio，kap 22-phase 注册表与 canvas_sync 工件映射双双未跟进——verify:phase-55 12/14 红、p11a5 产物画布零节点、DAG 恒 pending。让跨仓相位漂移告警门回绿且测得出更多漂移（canvasType/assetType 纳入门内）。
**Depends on**: Nothing（Wave 1，快速止血项）
**Repo ownership**: kap（注册表+verify 门）· khs2（前缀正则+工件映射+retro 测试）
**Requirements**: PRG-01, PRG-02, PRG-03 (F22/F23/F24)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: kap 736889db（注册表 22→23 + TYPE_MAP 契约门 F 组 + 6 处类型分叉修正）；khs b432bba（no-fold+四工件+zone+retro）；verify:phase-55 **12/14 红 → 18/18 绿**；khs 11/11。
**Success Criteria** (what must be TRUE):

  1. verify:phase-55 全绿：phaseRegistry 含 p11a5 全套条目，khs 23 活跃 id 与 kap 注册表等值，only-in-khs 为空。
  2. khs `_PHASE_PREFIX_RE` 对 p11a5_preview_audio 提取 `p11a5`（不再折叠 p11a），`_PHASE_OUTPUT_MAP` 注册其四工件（ambient_stems/preview_mix_path/roughcut_path/roughcut_meta）；retro 与五个 registry↔map 一致性测试全绿；真实 episode 跑 p11a5 后画布出现四工件节点、DAG P11a.5 子图不再恒 pending。
  3. PHASE_REGISTRY canvasType/assetType 23 条目与 khs 实际值逐条相等（p09b/p11c/p12a/p12b/p13/p15 六处历史分叉修正）；verify:phase-55 新增两字段断言组，khs 侧改值必变红。

**Plans**: 已执行（回溯立项）

### Phase 65: 重生成引擎契约对齐 (Regen Engine Contract Alignment)

**Goal**: 59-01 的 NODE_TYPE_TO_TASKType 映射只验证了字面量存在，从未对照引擎对每类 TaskType 的实际消费参数。补齐四类断点：video 缺 image 参必失败、TTS 引擎读 text 而 kap 只送 prompt、bgm/foley 被引擎 v1.5 起 direct reject、图像配方几何/键名/丢弃/seed 四处保真断层。修完之后「补上 env」才有意义。
**Depends on**: Phase 63（契约对照权威面=收编后的仓，非容器黑盒）
**Repo ownership**: kap（_simulate.ts/_engine.ts/canvasApi extra 通道）
**Requirements**: REA-01, REA-02, REA-03, REA-04, REA-05, REA-06 (F02/F03)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: 4b182d8d 契约对齐（video 首帧/tts text/bgm+foley 诚实拒绝/ratio 推导/modelVersion 键名翻译/seed 真值）；65-04 余量 bc9d783a（bgm→ACE-Step 异步+轮询 / foley→SA3 同步，同 commit 排雷 _promptAnchor 误注册路由）；verify:phase-65 31/31。
**Success Criteria** (what must be TRUE):

  1. 映射表驱动契约测试：verify 逐 TaskType 对照引擎 executor 消费参数（image/text/ratio/model_version/ref_images），映射表新增类型而参数不满足时断言红——终结「五键命中」式字面量验证。
  2. video/video_final 重生成请求体携带 image 参（referenceImages 通道 canvasApi extra→submitEngineTask），引擎侧不再缺参 FAILED。
  3. audio/voice→tts 请求体携带引擎读的 text 键（prompt→text 显式映射），不再对空文本合成。
  4. bgm/foley 按裁决①走 kap 内部端点（bgm→/api/v1/ace/generate 异步+轮询 / foley→/stableaudio/generate 同步），不再投递引擎必拒任务还报「已提交」。
  5. 图像重生成携带 ratio（九键配方补几何键或资产尺寸推导）；modelVersion→model_version 键名翻译送出；cloud 不消费的键 UI 明示，不再静默丢弃。
  6. seed 语义修正：cloud 路径 seed 不影响产物时不再作为装饰真值回写 canonical，画布配方不再记录从未影响产物的 seed。

**Plans**: 已执行（回溯立项）

### Phase 66: 生产通电与真机闭环 (Production Power-On)

**Goal**: 把已修好的 canvas→引擎链真正插上电：生产 10588 加载 GOLD_TEAM_URL，分类型灰度放开重生成，用真机证据关掉「有 success 无产物」的假成功时代；同时回溯标注 52 时代的验证口径。
**Depends on**: Phase 63 + Phase 65（先修映射再通电，否则 video/TTS 从静默假变 loudly 翻车）
**Repo ownership**: kap（部署契约+文档）
**Requirements**: PWR-01, PWR-02, PWR-03, PWR-04 (F01/F33)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: 4e60b9c8（serve-production.sh + 66-02 真机断点 model_preference 顶层字段——静态 review 双漏、真机探针抓到）；probe-66 零足迹 9/9（40s cloud-jimeng 真渲染）；生产 :10588 pid 2680419 GOLD_TEAM_URL 双 env 实证。
**Success Criteria** (what must be TRUE):

  1. 生产启动路径显式加载引擎 env（serve-production.sh export 落死）；重启后 `/proc/<pid>/environ` 含 GOLD_TEAM_URL，verify 断言锁死「env 缺失时启动告警」而非静默 simulateOnly。
  2. 灰度次序留档：image 先行（65 完成即开），video/tts 随 65-02 完成放开；灰度开关显式存在，未放开类型 UI 明示而非假提交。
  3. 真机 e2e：画布发起图像重生成 → :8002 出现 `canvas-*` 任务并 completed → 产物落盘 → node.data.filePath 更新 → 前端新图回贴；probe 脚本可重跑、零足迹。
  4. 文档回溯：52-07-SUMMARY 与 v3.0-MILESTONE-AUDIT TD 注记补注「当时建立在 simulate 链上，真实闭环 66 完成」。

**Plans**: 已执行（回溯立项）

### Phase 67: G15/G16 豁免桥三仓闭环 (Waive Bridge 3-Repo Closure)

**Goal**: 豁免通道 ship 了 UI 却投递到全网不存在的 /api/v1/g15/ops（404→队列无限重放→toast 报「已豁免 N 条」）。三仓合围：review-platform 补服务端、khs2 补逐镜头豁免消费端（终结「子集被放大成全量」错放行）、kap 桥诚实化；附带修掉 review-platform web UI/batch 绕过 decision 持久化缺口。
**Depends on**: Nothing（Wave 1；WB-03 为当日止血项先行）
**Repo ownership**: kais-review-platform（端点）· khs2（消费端）· kap（桥诚实化）
**Requirements**: WBX-01, WBX-02, WBX-03, WBX-04, WBX-05 (F09/F14/F15/F16/F27)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: kap 3312a0c1（WBX-03 止血）+ 4bf51216/ce1f571（桥 episodeRefs 接通）；review-platform 7eea588（/api/v1/g15/ops fail-closed 匹配 + union 幂等 + approve carry-forward + 六路径 decision 补洞，容器已重建部署，10 用例）；khs runner 注入 + p10c/p11c 子集优先（空=legacy 全量，双侧测试「豁免 5 失败镜中的 2 个→只 2 个 waived」）。
**⏸ Pending (待真机)**: WBX-05 UAT 11 真机 drill（khs p10c-gate 收到 comment 后状态正确 + G16 听审批量豁免端到端）——代码链全通，留下集活体管线自然覆盖。
**Success Criteria** (what must be TRUE):

  1. 豁免操作服务端端点真实存在（裁决④a）：kap g15Bridge POST 不再 404；per-shot waive / requeue 行为有 API 契约文档与测试。
  2. khs2 逐镜头豁免消费端成立：waived_shot_ids 有了生产者，p11c/p10c 读 per-shot 子集豁免（operator 豁免 5 个失败镜中的 2 个→只 2 个进 waived，其余照常阻塞），不再 approve=全量一刀切。
  3. kap 桥诚实化：delivered=false 不再成功 toast（乐观标记回滚），队列重放有上限与死信可见；drain 读取 payload 不再丢 gate 字段（排队的 p10c-gate 豁免不再错发成缺省 p11c-gate）。
  4. review-platform web UI（htmx 单条 / batch / API batch）全部写 metadata.review_result.decision，「web UI reject → kmc 不阻、kap 反显示 approve」三方读法不一致消除。
  5. v3.0 UAT 登记项 11 真机通过；G16 听审批量豁免端到端：工作台勾选 → khs p10c 下一轮 waived 状态正确。〔⏸ 待真机〕

**Plans**: 已执行（回溯立项）

### Phase 68: 变体域契约重对齐 (Variant Domain Contract Realignment)

**Goal**: Wave A 契约冻结于 08-21，khs2 v2.5（08-24）演进出了 finalists/final_n/final_rank/dropped/selection_meta/render_variants，kap 信封契约/fixture/推导器零跟进；加上 score schema 自相矛盾、chosen_variant_id 类型相悖、归组键三套词表并存——Wave B 若照旧契约开工必然返工。本 phase 纸面/契约层：重冻结+三项裁定+文档销账。
**Depends on**: Nothing（Wave 1，纸面先行，可与所有 phase 并行）
**Repo ownership**: kap（契约/schema/verify）· khs2（词表真相源确认）
**Requirements**: VDR-01, VDR-02, VDR-03, VDR-04 (F06/F10/F11/F12/F13/F39)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: v2.5 键（finalists/final_rank/dropped/selection_meta/render_variants）进五源信封 schema + 三档 scale（unit/ten/percent，ten=真实 0..10）+ S1f 双源验证门首跑即抓真漂移（khs take-log 实际写 shot_index + seed:null）+ 三 ADR + Wave B 失实理由三处更正；verify-53 97→**102/102**。
**Success Criteria** (what must be TRUE):

  1. candidateEnvelope 契约重冻结并对 khs2 v2.5 实际产出形状逐源验证：新五键进入五源信封 schema，take-log 信封含 render_variants；dropped 候选在墙上有区分，final_rank 名次语义保留。
  2. 三项裁定落 ADR：①chosen_variant_id=string finalist id（per-phase id 空间，全线统一）；②candidateScoreSchema percent 域修正（三档 scale，p11a0 的 0..10 信封不再被拒收整条丢弃）；③跨组共享候选归组真相源唯一化（khs 短横线形主 + kap canonicalFlfGroupKey 单点映射，一主两从）。
  3. verify 门补端到端形状断言：fixture 与 khs2 真实产出（take-log + 落库样本）双源校验，schema 拒收即红——不再只有 fixture 自说自话。
  4. 文档销账：Wave B「验收未过 (TD-1)」失实理由更新为「gate 已于 08-23 满足，待排期」；52-VERIFICATION 跨组归组遗留指向本 phase ADR。

**Plans**: 已执行（回溯立项）

### Phase 69: Wave B 实施——manifest transport 与真实数据源 (Wave B Implementation)

**Goal**: Wave B 三件套从零到一：manifest 回写通道（getManifestTransport 恒 null→真实现，画布换选真正到达 kmc manifest）、G15 分诊面板真实数据源（fixture 硬编码行→take-log/failed-shots 真实消费）、requeue khs 消费端（delivered=true 不再只是送达语义）。khs2 半部（envelope/field-map）一并认领。
**Depends on**: Phase 68（契约重冻结后开工，防二次返工）
**Repo ownership**: kap（transport/数据源）· khs2（envelope 映射+requeue 消费）
**Requirements**: WBI-01, WBI-02, WBI-03, WBI-04 (F07/F35)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: FS transport 真实现并通电（`KMC_MANIFEST_TRANSPORT=fs` 生产实证：iframe-manifest/hook-candidates chosen 覆写 + 原子写 tmp+rename + 幂等同值 no-op，S3g 真写 5 断言）；graphG15Source 消费 failed-shots/per_shot/take-log 派生（fixture 降级为显式测试模式）；khs 五源落盘（p03 script-candidates / p11a preview-candidates 新生产者 + _CANDIDATE_FILES 注册）；requeue 消费端（runner→p11c→p11b 重渲集并集，explicit shots 即使 waived 也重渲）；WBI-04 envelope 映射按 68 契约对齐。
**Success Criteria** (what must be TRUE):

  1. 画布变体墙换选 winner → khs manifest selected_first/last_variant 被覆写 → 下一轮 p11b 消费新选定渲染——全链留痕可断言，「画布已选定但管线用旧的」假闭环消除。
  2. G15TriagePanel 数据源切换为真实 take-log/failed-shots（五源在 khs _CANDIDATE_FILES 全注册，p03_nbest/p11a_preview/p11b_take 三源补生产路径），fixture 降级为显式测试模式。
  3. requeue 消费端在 khs2 落地：面板点「重渲」→ 镜头真实进入重渲队列，delivered=true 从送达语义升级为消费确认。
  4. khs2 侧 envelope 映射（field-map）按 68 契约完成，活体 episode 数据回放验证信封解析零 fallback-null。

**Plans**: 已执行（回溯立项）

### Phase 70: 换选通道端到端 (Choose/Swap Channel E2E)

**Goal**: operator 从任何面（变体墙 select-winner / gate-ops / 平台）换选今天全部静默无效：choose:v{N} 缺 {sid}:{ft} 作用域、variantIndex=数组位置≠v{N} 真编号、reviewBridge 相位 token 折叠恒失配、selected 是 int 而 khs 校验 string。四处断点一次修通，换选→manifest→渲染全链闭环。
**Depends on**: Phase 68（chosen_variant_id 类型裁定先行）
**Repo ownership**: kap（reviewBridge/gate-ops/变体索引）· review-platform（selected 类型）
**Requirements**: CHS-01, CHS-02, CHS-03, CHS-04, CHS-05 (F08/F17/F18)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: choose 载荷按 phase id 空间（p11a0 `{sid}:{ft}:v{N}` / p11a `{sid}:v{N}` / p01 `v{N}`）+ variantNumber 真 v{N}（节点 variant 字段→id 后缀→index 兜底，非数组位置）+ fullPhaseToken 防错批（p11a0→p11c 错批=全量豁免放行的负向锁）+ selected 按 ADR-1 string finalist id；reviewBridge node:test 3→6。
**⏸ Pending (待真机)**: 70-05 G13 换选端到端真机断言（变体墙换选→gate 批准→manifest 覆写→p11b 下一轮渲新帧）——代码链全通，待活体管线。
**Success Criteria** (what must be TRUE):

  1. choose 载荷携带完整作用域 id（per-phase id 空间），khs p11a0 rsplit 解析真实命中，manifest 覆写发生。
  2. 变体索引从节点 variant 字段解析真 v{N} 编号（非组成员数组位置），变体缺失/淘汰不再错位选错片——缺员组负向断言。
  3. reviewBridge 相位匹配迁移 fullPhaseToken（/^p\d+[a-z0-9]*/），p11a0/p11a/p11b/p11c 各自独立匹配；「资产点击静默错批同剧集 open 的 p11c 门」错批路径负向断言锁死。
  4. selected 通道类型按 ADR-1 落地（string finalist id），khs chosen_from_outcome 等值校验通过，不再 warn 回落 rank#1 却表面 approve 成功。
  5. 端到端真机断言：G13 条件帧换选 → gate 批准 → manifest selected_* 覆写 → p11b 下一轮渲的是新帧。〔⏸ 待真机〕

**Plans**: 已执行（回溯立项）

### Phase 71: 画布↔kmc 共存语义 (Canvas↔kmc Coexistence)

**Goal**: 两条全量替换写路径互相踩踏：khs canvas_sync 删建 a-* 节点抹掉画布 prompt 编辑并误清 stale，n-* 节点 stale 又永久残留；画布重生产物从不回流 kmc。先裁决共存模型（裁决②），再实现 merge 语义、stale 生命周期两仓统一、产物回流（复用 69 的 transport），并收口两条 replace 实现分叉。
**Depends on**: Phase 69（产物回流复用 manifest transport）；Kai 裁决先行（裁决②a 落地）
**Repo ownership**: khs2（canvas_sync merge）· kap（stale 链/replace 统一）
**Requirements**: COX-01, COX-02, COX-03, COX-04, COX-05 (F05/F36/F37)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: 裁决②a 画布为配方真值——khs B-4 删建抢救用户 prompt 编辑（`_kmc_prompt` 哨兵，往返测试「雨夜改推近」存活）+ kmc 重同步 upsert 集中清 stale（n-* 不再残留）；kap canvas-takes.jsonl 产物回流 + import replace 关系层同步（幽灵变体组收口）+ sequence linkType 往返存活（顶层列+data 袋双写/读时重建）。
**Success Criteria** (what must be TRUE):

  1. 共存模型按裁决②a 落地并有用例锁死：用户画布改 prompt 重生成 → kmc 重跑该 phase → 画布 prompt 编辑不再被静默蒸发（`_kmc_prompt` 哨兵保留编辑）；「stale 消失但 kmc 用旧配方渲染=假性解决」场景负向断言排除。
  2. stale 生命周期两仓统一：kmc 重跑完成 → kap 侧对应 stale 角标真实消除（upsert 集中清），n-* 节点不再永久残留 stale。
  3. 画布重生产物回流 kmc：node.data.filePath 变更经 transport 写 canvas-takes.jsonl（kmc 可感知位置），kmc 后续 phase 可选消费画布 take。
  4. import-from-dir 的 replace 与 saveGraph 全量路径行为统一：canvas_variant_groups 关系层同步清理（chunkedDelete 复用），重导入后无幽灵变体组/winner 悬空。
  5. sequence 边语义往返存活：linkType 顶层列+data 袋双写/读时重建，khs 导入→用户保存→序列蓝线不丢；往返保真断言入 verify。

**Plans**: 已执行（回溯立项）

### Phase 72: QC 与评分可视化真数据 (QC & Score Visualization Real-Data)

**Goal**: 56 的四条「真数据」链路三条断在生产数据上：G16 工作台只认顶层 clips（khs 写嵌套层）、眼/耳角标 join 零命中（per-item 数组被 canvas_sync 打散）、雷达图链路无生产者（aiScore.dimensions 全库 0 行）。打通判定数组透传契约、评分生产者、词表对齐与扩展面——56 的 SC 从「e2e 注入形状通过」升级为「生产库命中>0」。
**Depends on**: Nothing（填隙波次；词表部分弱依赖 68 裁定）
**Repo ownership**: khs2（canvas_sync 透传/aiScore 写入侧）· kap（join/词表/雷达生产者）
**Requirements**: QVR-01..QVR-07 (F25/F26/F28/F29/F30/F31/F32)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: F26 判定数组透传（canvas_sync 概览节点整块挂 fidelity_check/per_shot，detectItems 三形状）+ F28 aiScore 生产者（p03 scores 0..1 / p14 quality_audit 0..100 审计分数→节点顶层，雷达数据链从零起步）+ F29 DIM_LABELS 修真（logic/social_resonance_depth/requirement_conformance/info_package_density）+ 词表门源码锚点提取（首跑即抓 2 处真漂移）+ F32 五值 verdict（join/角标/工作台三处）+ F31 registerAuditToken 扩展契约 + F30 声纹 metaSub + F25 G16 嵌套层读取。
**⏸ Pending (待真机)**: QVR-03 存量集回填——存量 episode aiScore 回填待下次 canvas_sync 自然发生（producer 已上线+测试绿）。
**Success Criteria** (what must be TRUE):

  1. 判定数组透传契约成立（裁决⑤a 节点保留不展开）：p10c fidelity_check.clips 与 p11c per_shot 以 kap join 可读形状落画布，生产库存在携带 clips/per_shot 的节点——契约测试用生产样本而非注入形状。
  2. 眼/耳 verdict 角标对真实 kmc 数据命中：活体 episode 同步后角标渲染数 > 0（五值全呈现），shot_id join / shot_index→shot_{N} 兜底有命中率断言。
  3. aiScore.dimensions 有了真实生产者（p03/p14 审计分数→节点顶层），ScoreRadar 对真实审计分数渲染，≥3 维真实到达；雷达数据链从零起步。〔存量集回填 ⏸ 待下次 sync〕
  4. DIM_LABELS 与 khs 实际键逐一对齐；verify 门修真（源码锚点提取，includes 恒真与后缀正则漏检修正），词表漂移必红。
  5. verdict 词表三值→五值+未评态：skipped/error 呈现「未评」（非静默消失）、must_fix 呈现「必修」，不再与 pass/warn/fail 混同或丢弃。
  6. QC 接入扩展契约发布：registerAuditToken 可注册词表，khs 后续新增审计 phase（storyboard-qc/master-qc 先行接入）无需改 kap 源码。
  7. voice 剧场入口键对齐：subtype 从 o_assets.meta 同步画布节点，声纹两级试听对真实数据可达（生产库 metaSub 0→命中 > 0）。

**Plans**: 已执行（回溯立项）

### Phase 73: 门中心语义细化与调度欠账 (Gate Center Semantics & Scheduling Debt)

**Goal**: 收尾批：门中心对 p11b webhook tripwire 与硬门无差别对待（reject 承诺回滚但 kmc 根本没停车）+ 26 条 APPROVING 残留参与阻塞竞争；红线三门恒显 auto 而真实 rejected 不上浮；qwen-eye KAP 宕机兜底绕 GPU 队列（08-23 死锁五层根因的未根治项）；khs2 status-check 脚本 v1 读法误报。四件低危但真实的欠账一次清完。
**Depends on**: Nothing（Wave 1 可并入任意批次）
**Repo ownership**: kap（门中心呈现）· khs2（残留清理/兜底入队/status-check）
**Requirements**: GCX-01, GCX-02, GCX-03, GCX-04 (F19/F20/F21/F38)
**Status**: ✅ Complete (2026-08-25)
**Evidence**: F19 p11b webhook 哨兵（不参与 blocking / 「异步哨兵」呈现 / 存量 26+9 条 APPROVING 实清至 0 + resolve-stale-gates.py 收官工具）+ F20 红线 reject 墓碑上浮（khs 提交 / kap type=detector 别名路由+submit+立即 reject 409 幂等 / p13 防污染）+ F21 qwen-eye 队列优先（200/4xx 拒绝不绕队 + 0/5xx flock lease 受控拉起 only-lease-holder owns——08-23 接力死锁根治）+ F38 status-check v2 关系表（canvas_nodes/canvas_links 主，legacy 兜底）。
**Success Criteria** (what must be TRUE):

  1. p11b(webhook mode)在门中心以「异步哨兵」形态呈现、不参与 blocking 竞争；GateCenterBlock 对 webhook 门不再承诺「驳回将回滚重跑」；存量 26+9 条 ep-zhongkui-ep01 p11b APPROVING 残留实清零（resolve-stale-gates.py 收官工具）。
  2. 红线三门呈现真实态：kmc 红线 reject（真阻/真回滚）时 kap 门中心可见（墓碑上浮），不再恒显 auto。
  3. qwen-eye KAP 宕机兜底改走 GPU 队列（或带 lease 检查的受控拉起），不再裸 subprocess kap-llm.sh 绕队——08-23 接力死锁根治项销账。
  4. canvas-status-check.py 改读 v2 关系表（或 kv_canvasEvent 加 type 过滤只取整图行），v2 项目排障不再误报。

**Plans**: 已执行（回溯立项）

## Progress

**Execution Order:**
- v3.1 (58-62): 58 → 59 → 60 → 61 → 62 (60/61/62 parallel-safe if ever needed)
- v3.2 (63-73): 批次依赖图（回溯立项——实际已于 2026-08-25 当天全量执行完毕）: Wave 1 地基+止血 (63/64/67/68/73 全并行) → Wave 2 引擎链串行 (65 依赖 63 → 66 依赖 63+65) → Wave 3 变体域 (69 ∥ 70, gate on 68) → Wave 4 共存语义 (71, gate on 69) ；72 填隙无硬依赖

### v3.2 Progress (11/11 phases executed 2026-08-25)

| Phase | Plans | Status | Completed |
|-------|-------|--------|-----------|
| 63. 引擎真值源收编 | 已执行 | Complete | 2026-08-25 |
| 64. p11a5 相位跟进 | 已执行 | Complete | 2026-08-25 |
| 65. 重生成引擎契约对齐 | 已执行 | Complete | 2026-08-25 |
| 66. 生产通电与真机闭环 | 已执行 | Complete | 2026-08-25 |
| 67. 豁免桥三仓闭环 | 已执行 | Complete (⏸ WBX-05 待真机) | 2026-08-25 |
| 68. 变体域契约重对齐 | 已执行 | Complete | 2026-08-25 |
| 69. Wave B 实施 | 已执行 | Complete | 2026-08-25 |
| 70. 换选通道端到端 | 已执行 | Complete (⏸ 70-05 待真机) | 2026-08-25 |
| 71. 画布↔kmc 共存语义 | 已执行 | Complete | 2026-08-25 |
| 72. QC/评分可视化真数据 | 已执行 | Complete (⏸ QVR-03 存量回填) | 2026-08-25 |
| 73. 门中心语义+调度欠账 | 已执行 | Complete | 2026-08-25 |

### v3.1 Progress (shipped)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 58. 全配方持久化 | 4/4 | Complete    | 2026-08-23 |
| 59. 窄触发 stale 级联 | 4/4 | Complete    | 2026-08-23 |
| 60. 保存后面板保持 | 5/5 | Complete    | 2026-08-24 |
| 61. 审计清债 TD-3/4/5 | 5/5 | Complete   | 2026-08-24 |
| 62. 资产层级与选定逻辑 | 7/7 | Complete   | 2026-08-24 |

## Requirement → Phase Coverage

### v3.2 (51/51 mapped; 49 Complete + 2 Pending-真机)

| Phase | Requirements |
|---|---|
| 63 | ETS-01, ETS-02, ETS-03, ETS-04 |
| 64 | PRG-01, PRG-02, PRG-03 |
| 65 | REA-01, REA-02, REA-03, REA-04, REA-05, REA-06 |
| 66 | PWR-01, PWR-02, PWR-03, PWR-04 |
| 67 | WBX-01, WBX-02, WBX-03, WBX-04, WBX-05 (⏸) |
| 68 | VDR-01, VDR-02, VDR-03, VDR-04 |
| 69 | WBI-01, WBI-02, WBI-03, WBI-04 |
| 70 | CHS-01, CHS-02, CHS-03, CHS-04, CHS-05 (⏸) |
| 71 | COX-01, COX-02, COX-03, COX-04, COX-05 |
| 72 | QVR-01..QVR-07 (QVR-03 存量部 ⏸) |
| 73 | GCX-01, GCX-02, GCX-03, GCX-04 |

Findings 覆盖: F01-F40 全部落 phase（40/40，见 [v3.2-ROADMAP-DRAFT.md](v3.2-ROADMAP-DRAFT.md) 索引表）。

### v3.1 (18/18)

| Phase | Requirements |
|---|---|
| 58 | RECIPE-01, RECIPE-02, RECIPE-03, RECIPE-04 |
| 59 | STALE-01, STALE-02, STALE-03 |
| 60 | PANEL-01, PANEL-02 |
| 61 | DEBT-01, DEBT-02, DEBT-03, DEBT-04 |
| 62 | HIER-01, HIER-02, HIER-03, HIER-04, HIER-05 |

## Deferred / Carry-forward

### v3.2 carry-forward (待真机, 随活体管线自然覆盖)

- **WBX-05** UAT 11 真机 drill (khs p10c-gate comment 状态 + G16 批量豁免端到端) — 代码链全通
- **70-05 / CHS-05** G13 换选端到端真机断言 (manifest 覆写→p11b 渲新帧) — 代码链全通
- **QVR-03 存量部** 存量 episode aiScore 回填 (下次 canvas_sync 自然发生) — producer 已上线
- v3.2 HUMAN-UAT 视觉/交互签收 — 随 milestone audit 一并处理

### v3.1-era deferred (out of v3.1 scope — see REQUIREMENTS.md)

- 53 Wave B / 变体域 (VAR-01k/03k/04k) — gated on khs2 v2.4 Phase 25 验收 (TD-1)
- 重生成参数域之外的 prompt 语义辅助 (LLM 改写建议等)
- 跨组共享候选的精确归组语义 — 52-VERIFICATION 遗留,留待变体域裁定
- 非 kmc 消费侧 / 移动端改动 — 本期待改动限 kap 仓画布侧
