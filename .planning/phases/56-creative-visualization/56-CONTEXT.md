# Phase 56: 创作环节可视化 (Creative Visualization) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Interactive discuss — 4 领域 × 16 决策(全选全讨)

<domain>
## Phase Boundary

审核与资产组织从"卡片平铺"升级为创作导向的可视化——p03/p14 多维审核分数雷达图与 verdict 角标直贴资产、角色 turnaround/场景多视角/音色试听的组视图、G16 配音审核工作台。

Requirements: VIZ-01, VIZ-02, VIZ-03

</domain>

<decisions>
## Implementation Decisions

### 雷达+角标呈现 (VIZ-01)
- **D-01:** 雷达呈现 = 面板 + hover 弹层——ScoreRadar 留详情面板(已消费 `aiScore.dimensions`)+ 新增节点 hover mini-radar popover;93 镜规模不占常驻面积,悬停即看;雷达不复制造轮(既有纯 SVG 组件直接复用)
- **D-02:** verdict 角标视觉 = 眼/耳图标 + 色环——qwen-eye 👁 / qwen-ear 👂 图标 + pass(绿)/fail(红)色环,落四角角标系统左下 verdict 位(与 stale 琥珀三角的共存/优先级规则 planner 定);hover tooltip 展示维度分明细
- **D-03:** 刷新链 = socket 事件驱动——复用 `node:state` scored 事件(Phase 51 已修 canonical 回写),角标从 store 派生自动刷;成功标准 1"分数更新后角标实时刷新"原生满足
- **D-04:** LOD 联动 = L1 起显示——verdict 角标 L1(卡片态)起显示,L0 全景色块态不渲染(93 镜×多角标性能),与既有 LodProvider 消费模式一致

### 组视图形态 (VIZ-02)
- **D-05:** 组视图载体 = 全屏组视图剧场——变体墙(53)同族范式,双击组/角色节点开全屏;turnaround/场景画廊/voice_profile 三种组视图一个交互范式,与 53 剧场体验连贯
- **D-06:** turnaround 布局 = 2×2 + 同步缩放——四视图 2×2 同屏网格 + 中间参考图/角色名/一致性分;支持同步缩放看细节
- **D-07:** 场景画廊布局 = 主图 + 缩略行——多视角(top-down/front/side/rear)作缩略图行 + 主视图大图 + 视角切换;与 2×2 turnaround 同容器不同布局
- **D-08:** voice_profile 试听 = 卡上 mini + 完整两级——节点卡内嵌 mini 播放键(点即播,不进面板);组视图/详情里完整播放器(波形+时长)

### G16 工作台 (VIZ-03)
- **D-09:** 形态 = 审核剧场变体——组视图剧场的审核变体:左侧配音条目列表(逐条试听)+ 右侧波形+转写对照+verdict + 底部批量动作;与剧场家族同范式但列表主导(逐条审的流水性质)
- **D-10:** 对照布局 = 时间轴对齐双轨——波形在上、转写分句在下、共享时间轴光标;点击转写句跳播;与 53-D06 同播走带呼应
- **D-11:** 批量豁免通道 = 复用 G15 操作桥——复用 53-D15 操作桥的 waive 通道(同一 bridge action,不同 gate 目标);一套机制两处消费,不重复建
- **D-12:** 播放组织 = 连续播放 + 键盘——工作台内逐条连续播放(播完自动下一条,可暂停/跳过)+ 键盘(空格播停/→下条);与 53-D20 键盘流一致

### 数据契约消费
- **D-13:** verdict 真值源 = socket scored 事件——verdict 真值 = `node:state` scored payload(51 已修 canonical 回写)+ 落 node.state 持久化;角标/工作台都从 store 派生;单一链路
- **D-14:** 维度口径 = 数据驱动不硬编码——维度名/分值完全来自 53 契约 `aiScore.dimensions`,前端不硬编码维度表(ScoreRadar 已 N 维自适应);契约测试保 p03/p14 维度集;khs 改维度不炸前端
- **D-15:** 维度中文文案 = 契约层映射表——维度中文名映射放 kap 契约层(53 契约伴生映射,未知维度回退英文原名)
- **D-16:** turnaround 一致性分 = 透传展示——一致性分从 khs turnaround-ssim gate 工件透传(53/54 契约链),组视图只展示不计算;平台不复制算法

### Claude's Discretion
- hover mini-radar popover 的触发延迟/定位细节
- verdict 位与 stale 三角的同角共存规则(优先级/叠放)
- 波形渲染实现(自绘 canvas vs wavesurfer 等库——倾向轻量自绘,依 bundle 约束定)
- 转写分句对齐数据从 scored payload 哪个字段来(依 53 契约实际 shape)
- 剧场家族(53 变体墙/56 组视图/G16 工作台)的共享容器组件抽取时机——53 先行落地后 56 复用还是抽公共 TheaterShell

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 既有可视化资产(直接复用)
- `packages/infinite-canvas/src/components/panel/ScoreRadar.tsx` — 纯 SVG N 维自适应雷达(消费 aiScore.dimensions、dataviz 约定:颜色只落标记);D-01 复用主体
- `packages/infinite-canvas/src/components/badges/NodeBadges.tsx` — 四角角标系统(设计 §4.4 四角产权制:左上策展/右上执行+score/左下 stale);D-02 verdict 位落点与共存规则
- `packages/infinite-canvas/src/hooks/useLod.ts` — LOD 三级阈值;D-04 联动依据

### 上游契约
- `.planning/phases/53-variant-contract-picker-upgrade/53-CONTEXT.md` — Wave A 的 aiScore/candidate envelope 契约(D-13/14/15/16 消费);53-D15 G15 操作桥(D-11 复用 waive 通道);53-D06/D20 同播走带与键盘流(D-10/D12 呼应)
- `.planning/phases/51-canonical-write-path-coordination-guard/51-CONTEXT.md` — socket node:state canonical 回写(51-02 建)——verdict 数据可信的地基

### 领域文档(khs 侧)
- `//data/workspace/kais-hermes-skills/skills/kais-movie-pipeline/docs/scoring-gates.md` — 评分门分层设计(p03 5 维语义/阈值)
- `//data/workspace/kais-hermes-skills` turnaround-ssim gate(`turnaround-ssim-costume-swap-gate` 相关 phase) — 一致性分工件(D-16 透传源)

### 需求与路线
- `.planning/REQUIREMENTS.md` §VIZ — VIZ-01..03 定义
- `.planning/ROADMAP.md` §Phase 56 — 成功标准 3 条

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- ScoreRadar(纯 SVG、N 维自适应、tooltip)——雷达零新建
- NodeBadges 四角系统 + ScoreMiniBar(C 层,经 registerCInteractions 注册被 AssetCardNode 消费)——verdict 角标扩展点
- assetManager 系(CharacterWardrobe/AssetDetail/SceneShotManager)——turnaround/voice_profile 既有引用与音频播放
- canvas socket 链(useCanvasSocket → store applySocketNodeState)——scored 事件驱动既有通道

### Established Patterns
- LOD 消费:LodProvider + Context,组件各自持迟滞态——D-04 同款
- C 层注册模式(registerCInteractions)——角标/mini 播放键挂 AssetCardNode 的通道
- 契约层映射 + 回退(数据驱动)——D-14/D-15 与 53-D02 契约同链

### Integration Points
- AssetCardNode 双击行为(当前双击=开详情面板?planner 核实)——D-05 组视图剧场入口
- G16 配音审核数据流:qwen-ear verdict(kap ear 路由产出)→ socket scored → 工作台
- 波形:音频文件 URL 经 resolveMediaUrl(53 VAR-02 同链)

</code_context>

<specifics>
## Specific Ideas

- **前端设计纪律(用户要求全程应用 /frontend-design):** 剧场家族(53 变体墙/56 组视图/G16 工作台)共享同一设计语言——全屏暗色剧场容器、catppuccin token、一处签名元素;56 的签名元素候选:时间轴对齐双轨(波形×转写共享光标);radar/角标遵循既有 dataviz 约定(ScoreRadar 注释里的"颜色只落在标记上、文本走 text token");plan 里 UI 任务含设计检查步
- 审片 vernacular copy:「听审」「豁免」「重听」
- 93 镜规模是所有呈现决策的隐性约束(不占常驻面积/LOD 联动/列表主导)
- 依赖注记:Phase 53 契约就位后本 phase 才能消费 VAR 数据(ROADMAP 依赖);但 VIZ 组件层可与 53 Wave A 并行开发(消费接口 mock)

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。

</deferred>

---

*Phase: 56-创作环节可视化 (Creative Visualization)*
*Context gathered: 2026-08-21*
