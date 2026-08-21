# Phase 53: 候选变体契约与选片 (Variant Contract + Picker Upgrade) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Interactive discuss — 5 领域 × 20 决策(1 个追加领域)

<domain>
## Phase Boundary

kmc 各 phase 的候选/变体字段不再被压平丢失——field-map/canvas_sync 补 candidate/variant/winner/selected 映射;VariantPicker 升级为带评分与并排对比的变体墙(全屏审片剧场);G13/G14 换选直接回写 kmc manifest;G15 失败镜头批量豁免/重渲。

Requirements: VAR-01, VAR-02, VAR-03, VAR-04

</domain>

<decisions>
## Implementation Decisions

### 分期策略(外部门控)
- **D-01:** 双波拆分——Wave A = kap 接收端全部工作(zod 契约 + 双端 contract test 框架、VAR-02 变体墙、VAR-04 G15 分诊面板)立即开工;Wave B = khs field-map/canvas_sync 映射(VAR-01 khs 侧)+ VAR-03 端到端闭环,等 khs2 v2.4 Phase 25 验收完成后单独 plan。符合 ROADMAP"kap 侧纯接收端工作可先行"注释
- **D-02:** 契约 kap schema 先行——kap 侧 zod candidate envelope(canvasAssetSchema 扩展)+ 双端 contract test 先落地,khs 映射后补;复刻 v2.0 四道闸模式(历史上零漂移)
- **D-03:** 存量不回填——已在流的 p03 候选(2026-08-18 透传上线)不动,新契约只对增量同步生效
- **D-04:** COORD-01"工作树干净"判定范围 = 仅代码文件(`pipeline/phases/*.py` + `plugins/kais_aigc/`);`episodes/` 运行时产物与 `.pipeline-state.json` 永脏不算 blocker(否则永远开不了工)

### 变体墙设计 (VAR-02)
- **D-05:** 布局 = 全屏审片剧场——全屏接管、暗色剧场、上方 N-up 大屏视频墙、底部候选胶片条;签名元素 = 跨变体同步走带(一条主控时间轴驱动所有 take);沿用 catppuccin token 体系(`v3theme.signal.select`/`theme.bg.panel`)
- **D-06:** 同播语义 = 主控同播 + solo 声——一条主控 transport(播放/暂停/拖动)同时驱动所有 take;音频 solo 模式(同一时刻只听一条的声,点击卡切换)
- **D-07:** 信息密度分层——卡上精要(缩略/视频 + aiScore 徽章 + 时长 + seed;prompt 摘要单行截断),完整 prompt 在选中卡下方详情区展开
- **D-08:** 选定交互 = 检视 + 显式选定——点卡 = 检视(展开详情/设 solo 声),每卡显式「选定」按钮才提交;防误触(换 winner 会级联 stale),与 select-winner 端点幂等语义配合

### 选优回写通道 (VAR-03)
- **D-09:** 通道 = 扩展 select-winner 端点——在 Phase 49 端点(`src/routes/canvas/v2/select-winner.ts`)上挂 manifest 回写 hook(与 reviewBridge 同位、best-effort 隔离);复用事务化/幂等/广播,选定通道一处收口不漂移
- **D-10:** 降级语义 = canvas 真值 + 重试队列——选定立即落 canvas(体验不阻塞),manifest 回写失败进待同步队列、恢复后重放;与 Phase 49 D-07"canvas 为真值源不回滚"同构
- **D-11:** G13 首尾分选——G13 条件帧拆首帧墙 + 尾帧墙两栏(或两组),各自显式选定 → manifest 分别写 `selected_first_variant` / `selected_last_variant`(与 ROADMAP 字段名对齐;不做成对选定,首尾最优可能不在同一变体)
- **D-12:** 前端接线 = 直连端点 + optimistic——点「选定」→ 本地立即更新(optimistic)+ POST select-winner,失败回滚 + toast;与 approveNode/rejectNode 模式同构;废弃本地 selectWinner + 💾保存双轨

### G15 失败镜头操作面 (VAR-04)
- **D-13:** 落位 = 独立分诊面板——Phase 53 建独立面板(列表+归因+批量处置),接口预留嵌入位;Phase 54 gate 中心建成后作为其内嵌块复用,不返工。分诊工作台(列表)与选片剧场(全屏墙)是两种工作模式,不硬塞同一 UI
- **D-14:** 批量语义 = 勾选 + 动作条 + 二次确认——勾选多条 → 底部「批量豁免」「批量重渲」+ 确认(重渲是 GPU 串行贵操作,不可误触)
- **D-15:** 回写通道 = G15 操作桥——豁免 = waive 语义走 reviewBridge 扩展;重渲 = requeue 指令走同桥新 action;一个桥收口,与 VAR-03 select-winner 同构但独立端点(豁免不是选定,语义不污染)
- **D-16:** 归因数据 = take_log 主 + review 补——take_log 结构化透传为主(VAR-01 契约内)+ G15 review payload 归因维度补充;行上显示错误类别徽章,展开看原始日志截断

### 入口与跨镜串行(追加)
- **D-17:** 串行形态 = 墙内下一镜——审完当前组(选定后)墙不关、直接载入下一个待审变体组;也可手动「下一镜」跳过(轻交互,不做队列传唤)
- **D-18:** 串行顺序 = shot 序 + 跳已选——同 phase 内按 shot_id 序,默认跳过已选定组;从 gate 视角进入时只列该 gate 的组
- **D-19:** 资产中心入口 = 画布主 + 跳转——本期变体墙只在画布内开(墙组件单宿主);资产中心候选组加「去画布选片」链接(复用 `focusAssetNodeId` 跳转聚焦);不做双宿主内嵌
- **D-20:** 全套键盘流——数字键 1-9 检视/选 take、Enter 确认选定、→/← 切镜、空格同播;93 镜审片刚需

### Claude's Discretion
- aiScore 数据源与口径(p03/p11 评分维度不同:视觉 7 节点/音频 A/B/C 三档;综合分 vs 维度 chips;归一化)——未深入讨论,researcher 调研后定显示口径
- Wave B 启动门槛细节(v2.4 P25 验收完成的判定工件)与 G13/G14 闭环 E2E 断言策略(真实 kmc 重跑 vs manifest 快照)——researcher/planner 依 Wave B plan 时点定
- 候选缩略图 404 自愈实现(needsThumbnailing 有误判前科;检测到 404 自动补生成 vs 降级占位)
- candidate envelope zod schema 的具体字段 shape(5 源:p01 hook 候选/p03 N-best/p11a0 条件帧/p11a 预览变体/p11b take-log 的统一信封 vs per-phase 形状)
- 重试队列的持久化载体(表 vs 现有 kv 机制)
- 同播的时钟同步实现(master clock + 漂移校正的具体技术)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 协调约束(跨仓库)
- `.planning/specs/COORD-01-khs2-parallel-coordination.md` — khs2 v2.4 并行开发的冲突管理规则(仅契约/映射层、避让 phases 内部算法、开工前工作树检查[本 phase D-04 收窄为仅代码文件]);Wave B 开工前必读
- `//data/workspace/kais-hermes-skills/.planning/STATE.md` — khs2 v2.4 当前进度(Phase 25 进行中);Wave B plan 前确认验收状态

### 契约真值源
- `src/lib/canvasAssetSchema.ts` — kap 侧 zod schema 真值源(D-02 扩展点)
- `//data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/pipeline/phases/_manifest.py` — kmc manifest writer 契约(MANIFEST_PARAM_SCHEMA 平行声明模式)
- `//data/workspace/kais-hermes-skills/plugins/kais_aigc/canvas_sync.py` — field-map/候选同步(`_extract_candidates` L1132、`_load_candidate_variants` L1338、`add_candidate_node` L1348、`_flf_variant_of` L725);Wave B 修改点

### 既有端点与桥(扩展点)
- `src/routes/canvas/v2/select-winner.ts` — Phase 49 事务化选定端点(D-09 挂 manifest hook 位置:reviewBridge 调用同位)
- `src/lib/reviewBridge.ts` — `resolveOpenReviewForSelection` 模式(D-15 G15 操作桥的 waive/requeue 扩展基座)
- `src/lib/candidateGrouping.ts` — Phase 48 ingest 候选建组
- `src/lib/canvasRelationalStore.ts` — selectWinnerInGroup/syncAssetPrimaryForWinner/demoteAssets(事务化写)

### 需求与路线
- `.planning/REQUIREMENTS.md` §VAR — VAR-01..04 需求定义
- `.planning/ROADMAP.md` §Phase 53 — 成功标准 4 条(契约 round-trip 断言/变体墙无 404/G13 G14 闭环/G15 列表一致更新)
- `.planning/phases/51-canonical-write-path-coordination-guard/51-CONTEXT.md` — canonical write path 地基决策(store canonical action + save-v2,一切写操作的范式)
- `.planning/phases/52-prompt-edit-regenerate-loop/52-CONTEXT.md` — updateEventParams/optimistic 模式、面板宽度约定(Phase 53 前置 phase 的决策)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/infinite-canvas/src/components/variants/VariantPicker.tsx`(137 行)——现行 460px 模态;变体墙在其基础上重写(全屏剧场),保留 variantPickerStore open/close 协议与 Esc 习惯
- `packages/infinite-canvas/src/components/variants/variantPickerStore.ts` + `store/variantOps.ts`(164 行)——selectVariant 纯函数(locked/multi 守卫)可复用;本地 selectWinner 路径将废弃(D-12)
- `src/routes/canvas/v2/select-winner.ts`——事务化端点 + o_assets 联动 + `variant:selected` 广播已就绪,前端未接
- `packages/infinite-canvas/src/utils/mediaUrl.ts` `resolveMediaUrl`——缩略图解析既有通道(FlowCanvas/NodeDetailPanel/AssetDetail 等 8 处已消费)
- `focusAssetNodeId` 机制(canvasStore)——资产中心→画布跳转聚焦(D-19 复用)
- `triggerStaleCascade`(useStale)——选定后级联 stale 既有钩子
- catppuccin 主题 token(`theme`/`v3theme`)——变体墙/分诊面板的设计体系;栈开启动画 `cv-stack-fan` 已有

### Established Patterns
- 写路径:store canonical action + save-v2(Phase 51);optimistic + 回滚(approveNode/rejectNode)——D-12 同构
- 双端契约:kap zod ↔ khs MANIFEST_PARAM_SCHEMA 平行声明 + contract test 守一致(v2.0 模式,D-02 复刻)
- verify-phase-NN 范式:真实模块、:memory: sqlite、section 化契约组、npm script 注册
- best-effort 桥:reviewBridge fire-and-forget + 内部吞错 + 双 backstop(select-winner L151-158)

### Integration Points
- 变体墙入口:AssetCardNode 牌堆 `onStackToggle` → variantPickerStore.open(保留)
- G15 分诊面板入口:新建(Phase 53 独立面板 + 预留 Phase 54 gate 中心嵌入位)
- khs 侧 Wave B 修改面:canvas_sync.py 候选加载/L725 flf variant/`add_candidate_node` 结构化透传(08-18 已部分就绪,p03 K=3 落选盘加载已有)
- khs2 v2.4 现状:Phase 25 进行中(25-01/02 完成、25-03 未执行),`p04_character_design.py` dirty——Wave B 门控未满足(2026-08-21 时点)

</code_context>

<specifics>
## Specific Ideas

- **全屏审片剧场布局(用户选定版式)——Wave A 变体墙的信息架构基准:**
  ```
  ┌────────────────────────────────────────────┐
  │ G14 预览选片 · shot_012        [同播 ▶] ✕ │
  ├────────────────────────────────────────────┤
  │  ┌──────────────┐  ┌──────────────┐       │
  │  │ take v1      │  │ take v2 ★winner│     │
  │  │ ▶ 00:04.2    │  │ ▶ 00:04.2    │       │
  │  │ ──●────────── │  │ ──●────────── │       │
  │  └──────────────┘  └──────────────┘       │
  │      ↑ 同一 playhead 驱动全部 take          │
  ├────────────────────────────────────────────┤
  │ [v1🅧 82] [v2🅧 91★] [v3🅧 78]  ← 胶片条   │
  │ prompt: "雨夜巷战,主角拔刀…"  seed 40213   │
  └────────────────────────────────────────────┘
  ```
- **G15 分诊面板版式(用户选定版式):** 列表行 = 勾选框 + shot_id + phase 徽章 + 错误类别徽章 + 原因截断(展开全log);底部动作条 = 已选 N + [批量豁免] [批量重渲] + 二次确认
- **前端设计纪律(用户要求全程应用 /frontend-design):** 变体墙/分诊面板设计须先出 token 层决策(色/型/布局/签名元素)再写码;反模板默认;贴 catppuccin 既有产品语言;签名元素 = 跨变体同步走带,其余保持安静克制;plan 里 UI 任务须含此设计检查步
- 真实 GPU 重渲执行不在本期断言范围(执行语义 = requeue 指令送达 kmc,kmc 侧行为由 khs2 保证)——与 Phase 52"真实引擎派发维持现状"口径一致
- khs 仓库允许同步修改(VAR-01/VAR-03 契约/映射层),遵守 COORD-01(仅契约/映射层,避让 phases 内部算法)

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。(aiScore 口径/Wave B 门槛/缩略图自愈未深入,已列 Claude's Discretion 交 researcher/planner,非新能力。)

</deferred>

---

*Phase: 53-候选变体契约与选片 (Variant Contract + Picker Upgrade)*
*Context gathered: 2026-08-21*
