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
- 🚧 **v3.1 重生成闭环深化 (regen-loop-deepening)** — Phases 58-61 (in progress)

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
- Integer phases (58-61): **v3.1 (current)**
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

### 🚧 v3.1 重生成闭环深化 (regen-loop-deepening) — In Progress

**Milestone Goal:** 付清 v3.0 收尾锁定的三笔「生成-迭代闭环」欠账——窄触发 stale 级联、全配方持久化、保存后面板保持——并顺带清掉审计三笔低优先债 (TD-3/4/5)。全部改动限 kap 仓画布侧，无跨仓库依赖。

**Created:** 2026-08-23
**Source:** v3.0 收尾锁定的三笔闭环欠账 + 51-REVIEW I1/I5 + 里程碑审计 TD-3/4/5

**v3.1 Phases:**

- [x] **Phase 58: 全配方持久化 (Full Recipe Persistence)** — §14 窄通道扩展为全量高级字段进出 `EventNodeV3.params`:面板编辑/持久化/序列化往返/重生成请求体 + schema↔面板防漂移守护 (completed 2026-08-23)
- [x] **Phase 59: 窄触发 stale 级联 (Narrow-Trigger Stale Cascade)** — 面板编辑重生成 + 换 seed 重跑两条路径按请求关联自动标下游 stale;编排/批量路径零影响(负向断言锁死) (completed 2026-08-23)
- [x] **Phase 60: 保存后面板保持 (Post-Save Panel Persistence)** — canvasStore reload 链保 `detailNode`,真机保存 200 后详情面板不收起,锚定语义等价 (completed 2026-08-24)
- [ ] **Phase 61: 审计清债 TD-3/4/5 (Audit Debt Clearance)** — placeNewAsset 活调用方 + reviewBridge 尾斜杠 307 消除 + buildMeta 5 字段读回 + node:created canonical-or-document

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

- [ ] 61-05-PLAN.md — verify:phase-61 聚合门(S1-S5 静态锁 + B 行为门 + F forced-failure,零 live probe)+ D-04 销账(REQUIREMENTS 勾选 + Traceability)

## Progress

**Execution Order:**
Phases execute in numeric order: 58 → 59 → 60 → 61 (60/61 parallel-safe if ever needed)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 58. 全配方持久化 | 4/4 | Complete    | 2026-08-23 |
| 59. 窄触发 stale 级联 | 4/4 | Complete    | 2026-08-23 |
| 60. 保存后面板保持 | 5/5 | Complete    | 2026-08-24 |
| 61. 审计清债 TD-3/4/5 | 4/5 | In Progress|  |

## Requirement → Phase Coverage (13/13)

| Phase | Requirements |
|---|---|
| 58 | RECIPE-01, RECIPE-02, RECIPE-03, RECIPE-04 |
| 59 | STALE-01, STALE-02, STALE-03 |
| 60 | PANEL-01, PANEL-02 |
| 61 | DEBT-01, DEBT-02, DEBT-03, DEBT-04 |

## Deferred (out of v3.1 scope — see REQUIREMENTS.md)

- 53 Wave B / 变体域 (VAR-01k/03k/04k) — gated on khs2 v2.4 Phase 25 验收 (TD-1)
- 重生成参数域之外的 prompt 语义辅助 (LLM 改写建议等)
- 跨组共享候选的精确归组语义 — 52-VERIFICATION 遗留,留待变体域裁定
- 非 kmc 消费侧 / 移动端改动 — 本期待改动限 kap 仓画布侧
