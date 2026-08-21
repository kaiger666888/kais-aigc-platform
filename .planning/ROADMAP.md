# Roadmap: v3.0 画布创作体验 (Canvas Creative Experience for kmc)

**Milestone Goal:** 以 kmc 22-phase/16-gate 创作流为准绳，系统性修复画布写路径地基，并把"看/选/改/批"四类创作交互在画布 + 平台页面上做到一等公民——保存/审核/删除全部走 V3 canonical graph，prompt 编辑→重生成闭环，变体墙选片升级，16 gate 画布内闭环，导航/可视化/门户对齐 22-phase 真实结构。

**Created:** 2026-08-21
**Source:** 三路并行诊断(画布 UX 代码审计 / 平台页面审计 / kmc 创作流需求提取) + 用户圈定 + khs2 并行工作流冲突评估

### v3.0 Phases

- [x] **Phase 51: 写路径地基统一 (Canonical Write Path + Coordination Guard)** — 保存/审核/删除/socket 回写全部切到 V3 canonical graph + ~2500 行死代码清理 + khs2 v2.4 横切冲突约束落地 (completed 2026-08-21)
- [ ] **Phase 52: 生成-迭代闭环 (Prompt Edit → Regenerate Loop)** — 详情面板 prompt 编辑一键重生成 + 换 seed 重跑 + stale 下游重跑链 + 面板交互优化
- [x] **Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade)** — field-map 补 candidate/variant/winner 字段 + VariantPicker 升级 + 选优回写 manifest + 失败镜头批量操作 (completed 2026-08-21)
- [ ] **Phase 54: Gate 中心 (Gate Center + Blocking-State UX)** — 16 gate 状态接入 + 画布阻塞态一等呈现 + approve/reject/waive 画布内闭环
- [ ] **Phase 55: 画布导航与规模 (Navigation & Scale)** — zone 表对齐 22 phase + 分镜层级浏览 + 搜索导航器 + 落点修正 + LOD 可读 + 分支 UI 接通
- [ ] **Phase 56: 创作环节可视化 (Creative Visualization)** — 审核分数雷达图/角标 + 角色场景组视图 + 配音审核工作台
- [ ] **Phase 57: 平台页面与门户 (Portal & Delivery Pages)** — Toonflow 替换评估 + 四套前端互链 + p13 成片交付页 + manifest taxonomy 重对齐

**Architecture decisions (v3.0):**

1. **Phase 编号延续 v2.1** (Phase 51+)
2. **写路径地基最先** — WRITE 是所有画布 UX 深化(REGEN/VAR/GATE 回写)的前提；COORD-01 作为横切约束并入 Phase 51，让"只碰契约/映射层、避让 khs2 v2.4 phases 内部算法"从第一天成为工程纪律
3. **用户价值流排序** — 地基(51) → 创作闭环(52) → 选片(53) → gate(54) → 导航(55) → 可视化(56) → 门户(57)；同类别需求聚合在同一 phase
4. **kmc 侧变更限定契约/映射层** — field-map/canvas_sync/manifest schema 允许同步修改(已授权)；VAR-01 涉及 p04/p09 等输出字段映射，排序在中后段且**前置条件: khs2 v2.4 Phase 25 验收完成**；每个涉及 kmc 侧的 plan 开工前检查工作树干净。规范全文与 plan 开工 checklist 见 .planning/specs/COORD-01-khs2-parallel-coordination.md
5. **PORTAL-01 调研型可并行** — Toonflow 替换评估不阻塞任何编码 phase，放 Phase 57 但可与 52-56 并行启动
6. **破坏性变更允许，无 legacy adapter** — 延续 v1.6/v2.0 决策：废弃 `canvasToFlowGraph` 直接删除而非包装；WRITE-04 死代码清理与 NAV-06 分支 UI 重写协调(先删后建)
7. **GUARD 收尾传统延续** — 每个 phase 带 verify:phase-N 契约断言，末 phase 汇总守护全 milestone 行为不回归

### Phase 51: 写路径地基统一 (Canonical Write Path + Coordination Guard)

**Goal**: 画布所有写操作(保存/右键审核删除/MetadataEditor 编辑/socket node:preview/node:state 更新)统一走 V3 canonical graph 持久化，legacy v1 mapper 绕行与派生缓存直改彻底废弃；约 2500 行死代码清除；khs2 v2.4 并行开发的冲突管理规则(仅契约/映射层、避让 phases 内部算法、开工前工作树检查)作为工程约束落地。
**Depends on**: Nothing (first v3.0 phase; defines the canonical write foundation every later phase builds on)
**Requirements**: WRITE-01, WRITE-02, WRITE-03, WRITE-04, COORD-01
**Repo**: `kais-aigc-platform` (`packages/infinite-canvas` + `src/`); COORD-01 约束影响 kais-hermes-skills 侧工作纪律
**Success Criteria** (what must be TRUE):

  1. 画布保存走 save-v2 / 直接持久化 canonical V3 graph——代码库中不存在 `canvasToFlowGraph` 引用(grep 0 命中)；人为制造保存失败时 UI 弹出可见 toast，不再是仅 console.error。
  2. 右键菜单审核/删除经 `store.approveNode/rejectNode` 落 canonical 路径；删除操作带确认，且删除后刷新画布(load-v2)节点不复活——可由集成断言验证。
  3. MetadataEditor 镜头意图编辑与 socket `node:preview`/`node:state` 更新回写 canonical graph；触发一次 applyGraphTransform 后编辑内容仍在——不再被派生缓存覆盖。
  4. ScriptNode/VideoNode/AudioNode/StoryboardNode、VariantGroupDetail、BranchPanel、StructuredFieldPanel、双份徽章组件全部删除(约 2500 行)，`@kais/flowgraph-v3` 出现在 package.json dependencies；`tsc` 双根编译干净 + 既有 vitest 全绿。
  5. COORD-01 冲突约束成文并进入 phase 模板：凡涉及 kmc 侧变更的 plan 限定 field-map/canvas_sync/manifest schema 层，plan 开工 checklist 含"kais-hermes-skills 工作树干净"检查项。

**Plans**: TBD (via /gsd:plan-phase)

### Phase 52: 生成-迭代闭环 (Prompt Edit → Regenerate Loop)

**Goal**: kmc 最高频创作循环"改 prompt → 重抽"在画布内闭环——详情面板可编辑 prompt 并一键重生成、同配方换 seed 重跑接通既有接缝、stale 下游一键重跑、审片场景面板不再反复开合。
**Depends on**: Phase 51 (prompt 编辑与重生成回写依赖 canonical write path；面板编辑复用 MetadataEditor 修复后的回写通道)
**Requirements**: REGEN-01, REGEN-02, REGEN-03, REGEN-04
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. 节点详情面板内编辑 prompt 保存后点击"重生成"，触发对应生成任务且新结果回贴该节点；编辑-保存-重跑全链路有自动化断言(任务参数含新 prompt)。
  2. EventParamsPopover 的"换 seed 重跑"不再是 TODO/console.log——点击后以同配方+新 seed 提交任务，UI 有 pending/完成反馈。
  3. 上游变更后 stale 节点出现角标，角标/详情区提供"重跑下游"出口，点击后复用 orchestrate 批量执行通道重跑 stale 链；重跑完成后 stale 标记消除。
  4. 详情面板默认宽度 ~480px(非 75% 屏宽)；面板打开状态下单击切换节点，面板保持打开且内容跟随刷新到新节点。

**Plans**: TBD (via /gsd:plan-phase)

### Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade)

**Goal**: kmc 各 phase 的候选/变体字段不再被压平丢失——field-map/canvas_sync 补 candidate/variant/winner/selected 映射；VariantPicker 升级为带评分与并排对比的变体墙；G13/G14 换选直接回写 kmc manifest；G15 失败镜头批量豁免/重渲。
**Depends on**: Phase 51 (选优回写走 canonical write path); **外部前置: khs2 v2.4 Phase 25 验收完成**(VAR-01 涉及 p04/p09 输出字段映射，依 COORD-01 排序约束须等 v2.4 在改 phases 稳定；kap 侧纯接收端工作可先行)
**Requirements**: VAR-01, VAR-02, VAR-03, VAR-04
**Repo**: `kais-aigc-platform` + `kais-hermes-skills` (VAR-01/VAR-03 契约/映射层同步修改，已授权；遵守 COORD-01)
**Success Criteria** (what must be TRUE):

  1. 携带 p01 hook 候选 / p03 N-best / p11a0 条件帧 / p11a 预览变体 / p11b take-log 的 manifest 经 canvas_sync 同步后，画布节点保留 candidate/variant/winner/selected 结构——契约测试断言字段 round-trip 不丢失。
  2. VariantPicker 候选卡展示 aiScore/时长/prompt 摘要，支持并排大屏对比与视频同播；所有缩略图经 resolveMediaUrl 解析，候选墙无 404 图片。
  3. 在 G13 条件帧 / G14 预览上换选后，kmc manifest 中 chosen_variant_id / selected_first/last_variant 被更新，kmc 下一轮消费到新选定——闭环端到端断言通过。
  4. G15 失败镜头列表逐条带失败原因标注；勾选多条执行批量豁免或批量重渲后，列表状态与 kmc 侧记录一致更新。

**Plans**: 7 plans (Wave A only — D-01;Wave B = khs field-map + E2E 闭环,gated on khs2 v2.4 Phase 25 验收,单独 plan)

Plans:
**Wave 1**

- [x] 53-01-PLAN.md — 候选信封 zod 契约 + verify-phase-53 骨架(S1) + 双代 fixtures (VAR-01 kap 半部)
- [x] 53-02-PLAN.md — 变体墙引擎:wallTransport 同播主时钟 + 键盘流 + 全屏剧场组件 (VAR-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 53-03-PLAN.md — 候选组推导/物化(cand: 组,Phase 48 词表)+ load-v2 钩子 + S2 (VAR-01/03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 53-04-PLAN.md — select-winner 扩展(frameSlot/source)+ manifest 回写 hook + canvas_writeback_queue 重试队列 + S3 (VAR-03 kap 半部)
- [x] 53-05-PLAN.md — 墙接线:frameSlot 透传 + G13 首尾两组 + 下一镜串行 + D-12 RF 双轨废弃 (VAR-02/03)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 53-06-PLAN.md — 入口改造(adapter 组成员通道/AssetCardNode 徽章)+ 资产中心「去画布选片」+ VariantPicker 删除 (VAR-02/03)
- [x] 53-07-PLAN.md — G15 操作桥 + g15-ops 端点 + 分诊面板 + S4/S5 契约门收口 (VAR-04)

### Phase 54: Gate 中心 (Gate Center + Blocking-State UX)

**Goal**: kmc 16 道 gate 的 pending/approve/reject/waive 状态接入平台并在画布一等呈现——用户一眼看到"管线停在哪道门等你决策"，且审批操作在画布内直接回写 kmc，替代 telegram/CLI 审批。
**Depends on**: Phase 51 (gate 操作回写依赖 canonical write path + kmc 契约层变更纪律); Phase 53 可并行(无强依赖，但 gate 面板复用变体选定数据时获益)
**Requirements**: GATE-01, GATE-02, GATE-03
**Repo**: `kais-aigc-platform` + `kais-hermes-skills` (回写 gates.yaml/review-outcomes 属契约层，遵守 COORD-01) + `kais-review-platform` (R1 最小契约: decision 字段 + waive 端点, 依 54-CONTEXT 自由裁量授权)
**Success Criteria** (what must be TRUE):

  1. 平台读取 kmc gates.yaml / review-outcomes 后，16 gate 各自呈现正确的 pending/approve/reject/waive 状态；kmc 侧状态变更后平台侧同步刷新(轮询或事件)。
  2. 管线停在某道 gate 时，画布对应节点/泳道高亮阻塞态，gate 面板列出待决策项，且有待办通知入口——新会话打开画布即可定位当前阻塞门。
  3. 在画布 gate 面板执行 approve/reject/waive 后，kmc 侧 gates.yaml/review-outcomes 被正确回写，kmc 恢复/继续管线时消费到该决策；全程无需 telegram/CLI。

**Plans**: 7 plans (Wave1×4 并行:契约地基/平台R1/khs R2R3/前端地基 → Wave2 服务端轮询+端点 → Wave3 阻塞态UX → Wave4 面板闭环收口)

Plans:

**Wave 1** *(四 plan 并行,零文件交集——跨三仓)*

- [x] 54-01-PLAN.md — gateCatalog D-02 快照+foldDisplayState D-04+verify:phase-54 骨架+REVIEW_PLATFORM_URL env 修复 (GATE-01)
- [ ] 54-02-PLAN.md — review-platform R1:approve 恒写 decision/reject 补写 review_result/waive 端点+部署活体冒烟 (GATE-03)
- [ ] 54-03-PLAN.md — khs R2+R3:query_review_status result 键+poller COMPLETE 词汇对齐+chosen 第三通道(契约层,COORD-01) (GATE-03)
- [ ] 54-04-PLAN.md — 前端地基:gateStore 独立 store+useCanvasSocket gate:state+canvasApi gateOps/fetchGateState (GATE-02)

**Wave 2** *(blocked on 54-01+54-02)*

- [ ] 54-05-PLAN.md — kap 服务端:gateStateService 20s 轮询+diff+gate:state 广播+gate-state/gate-ops 端点+S-poller/S-ops/S-live (GATE-01/03)

**Wave 3** *(blocked on 54-04+54-05)*

- [ ] 54-06-PLAN.md — 画布阻塞态:GateTodoChip 待办入口+PhaseColumns 阻塞列签名发光+新会话快照接线 (GATE-02)

**Wave 4** *(blocked on 54-06)*

- [ ] 54-07-PLAN.md — Gate 中心面板(420px dock+可内嵌 Block,D-13 seam)+三操作闭环+verify 收口+VALIDATION 回填 (GATE-02/03)

### Phase 55: 画布导航与规模 (Navigation & Scale)

**Goal**: 画布导航对齐 kmc 22-phase 真实结构并在 93 镜规模下可用——zone/泳道补全缺失 phase、场景→镜头两级浏览、搜索升级为结果列表+聚焦跳转的导航器、新资产落点合理、LOD 默认可读、分支 UI 接通多结局探索。
**Depends on**: Phase 51 (WRITE-04 已删除旧 BranchPanel/死代码，NAV-06 在干净地基上重写；zone 重构依赖 canonical graph)
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06
**Repo**: `kais-aigc-platform` (`packages/infinite-canvas`)
**Success Criteria** (what must be TRUE):

  1. zone 表覆盖全部 22 phase(含 p035/p09b/p09c/p10c/p11a*/p12a/p12b/p14/p15)并正确泳道分组——导入全量 episode 数据后无节点落入"未映射"区。
  2. 分镜层级浏览支持场景→镜头两级展开；镜头卡呈现 shot_id/景别/运镜/时长/video_prompt 及引用角色&场景缩略图。
  3. 搜索(`/`)呈现结果列表，点击结果聚焦跳转对应节点(复用 focusAssetNodeId)；不再隐藏非命中节点。
  4. 新资产节点落在当前视口中心或事件源旁——断言新节点坐标与视口/源节点距离有界，不再随机散布。
  5. fitView 后默认 LOD 档位下 keyFields 可读(或每泳道缩放记忆生效)；BranchPanel 重写后消费 branches store，执行 selectBranchAsMain 可切换主线并持久化。

**Plans**: 7 plans (3 waves; A1-A5/Q2-Q4 已由 orchestrator 裁决并入 plans)

Plans:
**Wave 1** *(并行，无文件交集)*

- [ ] 55-01-PLAN.md — 22-phase 单一注册表 phaseRegistry + verify-phase-55 契约测试 (NAV-01, D-01/D-04 镜像)
- [ ] 55-02-PLAN.md — sceneGrouping 共享口径 + extractShots 增强 + SceneShotBrowser 两级浏览 (NAV-02, UI-SPEC §2)

**Wave 2** *(blocked on Wave 1)*

- [ ] 55-03-PLAN.md — 消费方迁移:三旧表删除/未映射兜底/import-from-dir phaseIndex 写点修正 (NAV-01, D-03/D-04 + constraint 8)
- [ ] 55-04-PLAN.md — SearchNavigator 搜索导航器 + onNewAsset 有界落点 canonical 写回 (NAV-03/NAV-04)
- [ ] 55-05-PLAN.md — PhaseColumns 列头聚焦 + laneZoom 泳道记忆 + ShotTree 口径迁移 (NAV-05, LOD 红线钉死)

**Wave 3** *(blocked on Wave 2)*

- [ ] 55-06-PLAN.md — BranchPanel 重写 + selectBranchAsMain REST 持久化/回滚 (NAV-06, A5 事件流合并)
- [ ] 55-07-PLAN.md — e2e phase55-nav 冒烟 + NEW_NODE 死常量清除 + 全 phase 门禁 (NAV-03/04/05 收口)

### Phase 56: 创作环节可视化 (Creative Visualization)

**Goal**: 审核与资产组织从"卡片平铺"升级为创作导向的可视化——p03/p14 多维审核分数雷达图与 verdict 角标直贴资产、角色 turnaround/场景多视角/音色试听的组视图、G16 配音审核工作台。
**Depends on**: Phase 51 (socket node:state 回写已修复，verdict 角标数据可信); Phase 53 (变体/评分字段契约就位，雷达图与角标消费 VAR 数据)
**Requirements**: VIZ-01, VIZ-02, VIZ-03
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. p03 5-dim / p14 8-dim 审核分数以雷达图呈现；qwen-eye/qwen-ear verdict 角标直接贴在对应资产节点上(消费 socket node:state scored + aiScore 契约)，分数更新后角标实时刷新。
  2. 角色资产组视图同屏对比 turnaround 四视图；场景组视图以画廊呈现 top-down/front/side/rear 多视角；voice_profile 节点内嵌试听播放。
  3. G16 配音审核工作台提供波形 + 转写文本对照(qwen-ear verdict) + 逐条试听 + 批量豁免；一批待审配音可在工作台内全部处理完毕且状态回写正确。

**Plans**: TBD (via /gsd:plan-phase)

### Phase 57: 平台页面与门户 (Portal & Delivery Pages)

**Goal**: 消除四套前端孤岛并补齐 22-phase 终点的交付面——Toonflow 替换评估出结论与门户壳原型、项目页→画布深链互链、p13 成片交付页(master.mp4 + 交付清单 + G8 终审)、movie-v1.manifest taxonomy 重对齐 22 phase/16 gate。
**Depends on**: Phase 51 (页面互链依赖画布状态契约稳定); Phase 55 (PORTAL-04 taxonomy 与 zone/泳道 22-phase 词汇对齐，避免两套 phase 词汇漂移); PORTAL-01 调研无编码依赖，可与 Phase 52-56 并行启动
**Requirements**: PORTAL-01, PORTAL-02, PORTAL-03, PORTAL-04
**Repo**: `kais-aigc-platform`
**Success Criteria** (what must be TRUE):

  1. Toonflow 替换评估产出书面结论(替换方案对比 + 推荐路径 + 工作量估算)，自有门户壳原型具备路由/导航/项目入口并可运行访问。
  2. 项目页可深链跳转画布指定节点/泳道；统一导航入口覆盖 Toonflow/画布/story-map/director-desk 四套前端，任一页面可抵达其余三套。
  3. p13 成片交付页面可播放 master.mp4、展示交付清单，并提供 G8 终审界面(通过/打回操作回写 kmc gate 状态)。
  4. movie-v1.manifest 的 phase_taxonomy 从 12 阶段重对齐为 22 phase/16 gate，review 点标注真实 gate ID；registry 加载新 manifest 后 phase 查询与画布 zone 词汇一致(drift 断言通过)。

**Plans**: TBD (via /gsd:plan-phase)

---

## Requirement → Phase Coverage (29/29)

| Phase | Requirements |
|---|---|
| 51 | WRITE-01, WRITE-02, WRITE-03, WRITE-04, COORD-01 |
| 52 | REGEN-01, REGEN-02, REGEN-03, REGEN-04 |
| 53 | VAR-01, VAR-02, VAR-03, VAR-04 |
| 54 | GATE-01, GATE-02, GATE-03 |
| 55 | NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06 |
| 56 | VIZ-01, VIZ-02, VIZ-03 |
| 57 | PORTAL-01, PORTAL-02, PORTAL-03, PORTAL-04 |

## Deferred (out of v3.0 scope — see REQUIREMENTS.md)

- 剧本前段 UI 承载 (p01/p02/p03/p06 专用页面)、剧本打磨 diff 视图、跨集进化建议审批队列、真实音频波形、director-desk 后端接线、分组折叠
- Out of scope: Toonflow 本体改造、review-platform 消费侧改造(SC-4 跨仓库债务)、data/web bak 清理、kmc phases 内部算法改动(khs2 v2.4 战场)
