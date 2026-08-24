# Phase 62: 资产管理中心资产层级与选定逻辑 (Asset Hierarchy & Selection) - Context

**Gathered:** 2026-08-24
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous /goal) — 6 areas, all auto-accepted as recommended

<domain>
## Phase Boundary

资产管理中心获得显式三层资产层级与层级化选定，外加画布内 pre/final 冗余配置入口：

1. **HIER-01 三层层级视图** — 第一层资产域分组（类型组）→ 第二层候选组 → 第三层候选；层间折叠导航 + 选定/待选/淘汰计数聚合；单产物（无组）资产有明确挂载位
2. **HIER-02 层级化选定** — 组内 winner 复用既有闭环 + 层级聚合批量决策入口；DAG `has-candidates` 计数与层级视图一致
3. **HIER-03 冗余配置入口** — 读侧展示各资产类型 n_candidates/final_candidates 当前值 + 写侧可编辑；键面以 khs v2.5（kais-hermes-skills）ROADMAP Phase 26/27 + 27-CONTEXT 灰区 2 快照为契约；不可配键显式标注原因
4. **HIER-04 三态流转零回归** — 分组互斥/取消选定恢复/场景声纹手动规则/G13 首尾分选语义保持（负向断言锁死）
5. **HIER-05 e2e** — 三条新链路 + 既有资产管理 e2e 全量零回归

改动限 kap 仓画布侧（`packages/infinite-canvas` + `src/`）；khs 仓零改动（其配合面由 khs v2.5 自己落地，本 phase 只以只读快照为契约）。

</domain>

<decisions>
## Implementation Decisions

### 层级视图数据语义（灰区 1）
- **D-01: 第一层纲 = 资产域分组（REAL_TYPE_GROUPS 扩展），非管线阶段 P01..P15。** `AssetDetail` 无 phase 字段（canvasApi.ts:203-222 确认），阶段归属只能启发式推导；REAL_TYPE_GROUPS 是左侧树既成事实（assetManagerData.ts:269）。层级第一层沿「角色/场景/道具 → 媒体产物 → 文本产物」三域扩展，管线阶段降级为**徽标**：`meta.phaseName/phaseCode` 直读优先，缺省按 inferSubtype → 阶段映射静态表推导（该表做成常量 + e2e 契约锁，避免启发式漂移）。
- **D-02: 第二层组 = getGroupKey 唯一分组轴。** 候选组语义绑定既有 `getGroupKey`（AssetLibrary.tsx:273 起，char:/scene:/keyframe: 词表）——它同时是三态流转（选定/互斥/淘汰）的原子单位，换轴即破坏 HIER-04。**variantGroupId 不在资产中心另立组层**；其「复用」落在组 ↔ 画布变体组的**反查通道共享**：把 `handleGoCanvasSelect` 的精确反查逻辑（graph.variantGroups 按 `asset-{id}` 节点匹配）提取为共享 util，层级组卡显示映射到的画布变体组徽标（组 id + variantGroupSize），点击既有开墙行为保持。
- **D-03: 无组资产（单产物）挂载位 = 第一层域分组下的「单件」桶。** 不强行造组、不隐藏；42 节点口径下单产物资产（报告/审计类除外）在层级树有显式节点，计数聚合含其总数。
- **D-04: 计数聚合与 DAG 一致性。** 每组/每域的选定/待选/淘汰计数从 `useRealAssets` 的同一 assets 数组派生（`!!isPrimaryView && state!=='eliminated'` 等既有判定式，AssetLibrary.tsx:500-505）；DAG `has-candidates` 计数公式（model.ts:937 `candidates = total - selected - eliminated`）数据源相同——一致性由 e2e 对同一 fixture 断言两处计数相等锁死，不改 DAG 派生代码。

### 层级化选定通道（灰区 3 → HIER-02）
- **D-05: 组内选定 = 既有 handleSelect 全语义零回归 + 画布组映射时 best-effort select-winner 同步。** 两域真值分工：资产中心域走既有 `updateAsset` 通道（winner 置 isPrimaryView+active、同组其余淘汰——HIER-04 绑定语义，不改）；当组经 D-02 反查映射到画布 variantGroup 且新 winner 在画布有节点时，**fire-and-forget 调既有 `POST /api/canvas/v2/variant-groups/:groupId/select-winner`**（复用其事务 + D-07 反向同步 o_assets + review bridge + manifest writeback 整个闭环，不复制粘贴第二套事务代码）。同步失败仅 toast 警示「画布侧同步失败」+ console.warn，**不回滚不阻断**——与 select-winner 自身 D-07「canvas 为真值源不回滚」镜像对称：o_assets 为资产中心真值源。幂等安全：select-winner 的 D-07 反向写 isPrimaryView 与我们已写的值一致。
- **D-06: 批量决策入口 = 组层多选（checkbox）+ 两个动作。** 「批量选定」= 每个选中组各选一个 winner（规则 = 组内**最新非淘汰**候选——升级现有自动初始化的 activeGroup[0] 取首规则为 mtime 最新，单组路径同步升级）；「批量淘汰」= 选中组的全部待选候选置 eliminated（有选定的组不动 winner）。每个组仍走 D-05 单组通道循环提交，不发明组级事务。不做跨组任意资产组合（保守可测）。
- **D-07: 场景/声纹手动规则在层级视图同等生效。** 批量选定跳过场景组与声纹组（沿用自动初始化的 isSceneGroup/isVoiceGroup 豁免，AssetLibrary.tsx:557-560），UI 上这些组显示「手动选择」标注而非静默跳过。

### 冗余配置入口（灰区 4 → HIER-03）
- **D-08: 写入通道 = 两段式。** ①**kap 权威覆盖层**：新表 `generation_config_overrides`（projectId + episodesId + phase_key 为主键，n_candidates/final_candidates/updated_at；经 canvasRelationalStore 同域挂载），UI 编辑先落此处，确定性寻址；②**requirement.json best-effort 写回**：写覆盖层成功后尝试定位 kmc requirement.json 并原子写（tmp + rename），寻址顺序 = 可配置 base（khs runs 工作区，env/config 注入）→ `/mnt/agents/output/pipelines/pipe-*/requirement.json` 按 projectId 反查取最新 mtime。写回结果**显式分级呈现**（「已存覆盖层」/「已同步 requirement.json」/「文件面寻址失败——覆盖层已保存」三态徽标），绝不假成功。
- **D-09: 读侧三源合并。** 展示值优先级 = kap 覆盖层 > requirement.json 实测值（若寻址成功）> khs v2.5 键面快照默认值（下表）；三源各自的来源在 UI 上可辨（tooltip 或角标）。
- **D-10: 键面契约 = khs 27-CONTEXT 灰区 2 快照（12 嵌套键 + Phase 26 三扁平键），硬编码为 kap 侧常量表。** 快照内容（2026-08-24 提取自 `/data/workspace/kais-hermes-skills/.planning/phases/27-pre-final/27-CONTEXT.md`）：

  | phase_key | 档位 | pre/final 形态 |
  |---|---|---|
  | `p01_hook.topic_kernel` | LLM 产物类 | 成对 pre+final |
  | `p06_script.spatio_temporal` | LLM 产物类 | 成对 |
  | `p09_shotlist.shot_list` / `p09_shotlist.transition` | LLM 产物类 | 成对 |
  | `p11_video.video_render` | 引擎产物类 | 成对（GPU 成本护栏标注） |
  | `p12_audio.bgm` / `p12_audio.foley` | 引擎产物类 | 成对 |
  | `p07_style.style_vector` / `p07_style.color_intent` | 确定性派生类 | **pre 硬上限 1**，final 开放 |
  | `p12_compose.master_timeline` / `p12_compose.audio_mix` | 确定性派生类 | pre 硬上限 1，final 开放 |
  | `p13_master.master_mp4` | 确定性派生类 | pre 硬上限 1，final 开放 |
  | `p01_hook` / `p02_outline` / `p03_script`（扁平） | 文本候选（khs Phase 26） | 成对 `{n_candidates, final_candidates}` |

  钳制语义全域复用 khs resolver：`pre ≥ 1`；`final = clamp(1, final, pre)`——kap 写侧对确定性派生类 pre>1 输入直接拒绝（前端禁用 + 后端 400 + 原因文案），与 khs「显式 warn + 回落」对齐但更早拦截。
- **D-11: 不可配键显式标注。** `p10_voice.tts`（pre 钉死 1——first-wins/铺轨污染根因）与 29 个报告/审计类节点在配置面显示为禁用行 + 原因文案，不隐藏；「不可配」标注与 khs 27-CONTEXT 灰区 5/deferred 清单一致。
- **D-12: 键面漂移防护 = e2e 契约测试。** fixture 注入合成 requirement.json（含上表全部键）断言读侧完整呈现 + 写侧往返保真；khs v2.5 shipped 后真实键面若与快照漂移，该测试即暴露（ROADMAP 原话「键面漂移由 e2e 契约测试暴露」）。磁盘现状：现存 pipe-*/requirement.json 均为 v2.5 前旧形态（无 candidates 键，2026-08-24 盘点确认）——读侧对旧形态 requirement.json 优雅降级（显示快照默认值 + 「文件面无 v2.5 键」标注）。

### e2e 组织（灰区 6 → HIER-05）
- **D-13: 三新链路三文件 + 全量回归。** `phase62-hierarchy.mjs`（层级导航/折叠/计数聚合/单件桶/has-candidates 一致性）、`phase62-selection.mjs`（层级化选定/批量决策/画布组同步 select-winner 断言/手动规则保持）、`phase62-redundancy-config.mjs`（三源合并读/编辑写覆盖层/requirement.json 写回/不可配标注/钳制拒绝）。回归面 = phase61-debt + phase52 三件套 + phase55-nav（资产域既有全量）。沿 `__mock` 面 + testMode 桥 + `window.__kaisCanvas` 断言纪律（e2e 跑 dist，先 build）。

### Claude's Discretion
- 层级视图组件形态（树 vs 折叠列表 vs 组合）与折叠交互细节——UI-SPEC 定夺
- 阶段徽标视觉、variantGroup 徽标呈现、三源角标形态
- 覆盖层表的具体 DDL 细节与迁移挂载点（沿 canvasRelationalStore 既有模式）
- requirement.json 写回的乐观锁实现（mtime 比对 vs 全内容 ETag）
- e2e 断言的 DOM 选择器与 mock 端点组织
- getGroupKey 反查 util 的提取位置与签名

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 选定闭环与分组语义（kap 仓）
- `src/routes/canvas/v2/select-winner.ts` — 画布组选定事务闭环全貌（D-01/D-03/D-07 + WR-03 降级 + review bridge + manifest writeback + frameSlot G13 参数面）；D-05 的画布侧同步直接复用此端点
- `packages/infinite-canvas/src/components/assetManager/AssetLibrary.tsx` — 三态流转 + getGroupKey 互斥分组 + handleSelect 乐观更新 + 自动初始化（场景/声纹豁免）+ handleGoCanvasSelect 反查（D-02 提取源）
- `packages/infinite-canvas/src/components/assetManager/assetManagerData.ts` — REAL_TYPE_GROUPS / inferSubtype / inferLevel / assetDetailToItem（D-01 第一层纲与阶段推导的素材）
- `packages/infinite-canvas/src/components/assetManager/useRealAssets.ts` — 资产数据源（分页拉取 + patchLocal 乐观更新，D-04 计数派生基座）
- `packages/infinite-canvas/src/v3/adapter.ts:795-845` — variantGroupId/variantGroupIds/variantGroupSize/isWinner 迁移语义
- `packages/infinite-canvas/src/components/pipeline/model.ts:463-1006` — DagNodeState `has-candidates` 词汇表 + 计数派生公式（D-04 一致性断言对象）

### khs v2.5 键面契约（跨仓只读——khs 仓零改动红线）
- `/data/workspace/kais-hermes-skills/.planning/ROADMAP.md` — Phase 26/27 定义 + 零行为漂移红线 + tts 钉死约束
- `/data/workspace/kais-hermes-skills/.planning/phases/27-pre-final/27-CONTEXT.md` — 灰区 1 三档机制矩阵 + **灰区 2 phase_key 命名快照**（D-10 契约源）+ 不可配键清单
- `/data/workspace/kais-hermes-skills/.planning/phases/26-final/26-CONTEXT.md` — 扁平键形态 + 缺省语义（p01 final=pre / p02p03 final=1）+ selection_meta 留痕键

### 规划契约
- `.planning/ROADMAP.md` §Phase 62 — SC-1..5 验收标准
- `.planning/REQUIREMENTS.md` HIER-01..05 — 需求原文

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `handleGoCanvasSelect`（AssetLibrary.tsx:831）— 组→画布 variantGroup 精确反查逻辑，提取为共享 util 即 D-02 徽标 + D-05 映射判定
- `updateAsset`（canvasApi.ts:314, PATCH /v1/assets-registry/:id）— isPrimaryView/state 直写通道，D-05 主路径
- `patchLocal` + 乐观更新模式（useRealAssets.ts:94）— 层级视图选定/淘汰的即时反馈基座，失败回滚范式现成
- `select-winner.ts` D-07 反向同步 — 幂等设计（重选同值 no-op）保证双通道安全
- 自动初始化 effect（AssetLibrary.tsx:543-575）— 场景/声纹豁免规则载体，D-06/D-07 复用其判定
- DagNode 计数公式（model.ts:937-961）— D-04 一致性断言的对照面，零改动

### Established Patterns
- 资产中心三态判定式（`!!isPrimaryView && state!=='eliminated'`）— 层级计数聚合必须复用同式，不得另造第二套判定
- e2e `__mock` 面 + testMode=1 + `window.__kaisCanvas` 桥（phase61-debt.mjs 范式）— D-13 三文件照此
- verify 聚合门三连范式（verify-phase-58/59/60）— 收口门沿用
- gsd 单 phase 多 plan wave 组织（61 五 plan 先例）

### Integration Points
- `AssetManager.tsx` viewMode='assets' 壳 — 层级视图作为资产库 Tab 内的新组织模式或并列子视图（UI-SPEC 定）
- `useCanvasStore` graph.variantGroups — 反查数据源（图未加载时降级仅定位，沿 handleGoCanvasSelect 现行为）
- kap DB（canvasRelationalStore 同域）— D-08 覆盖层新表挂载点
- `/mnt/agents/output/pipelines/pipe-*/requirement.json`（projectId 部分富化）+ khs runs 工作区 — D-08 写回寻址面

</code_context>

<specifics>
## Specific Ideas

- 键面快照提取自 khs 27-CONTEXT 灰区 2（2026-08-24 探子报告），与 ROADMAP Phase 62 任务书给出的期望覆盖键面完全一致（12 嵌套键 = 11 类资产 + 3 扁平键）
- khs v2.5 执行状态：两 phase 均停在「Ready for planning」未 shipped——kap 侧按快照先行是 ROADMAP 明示路径（「UI 可先行以矩阵快照为契约开发」）
- 钳制语义逐字对齐 khs resolver：`pre ≥ 1`；`final = clamp(1, final, pre)`

</specifics>

<deferred>
## Deferred Ideas

- **khs sync 下发面** — kap 覆盖层被 kmc 管线启动时主动拉取/合并的通道（两段式的第二段闭环）；需 khs 侧代码，gated on khs v2.5 shipped 后独立安排
- **42 节点可配性矩阵的单一真源自动同步** — khs Phase 27 RD-05 交付其仓内矩阵后，kap 侧常量表可改为脚本同步生成（当前手工对齐 + e2e 契约锁已够）
- **批量决策的评分自动选优** — 按 aiScore/reviewStatus 自动挑 winner（当前规则 = mtime 最新，保守）
- **requirement.json 写回的 kmc 热加载** — 管线运行中改配置即时生效（当前语义 = 下次 run 生效）
- **层级视图的管线阶段主纲切换模式** — 第一层按 P01..P15 组织的备选视图（当前类型组纲 + 阶段徽标）

</deferred>
