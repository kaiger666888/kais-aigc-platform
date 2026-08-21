# Phase 55: 画布导航与规模 (Navigation & Scale) - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning
**Mode:** Interactive discuss — 1 领域 × 4 决策(用户单选 zone 对齐;分镜层级/LOD+落点/分支 UI 交 researcher+planner)

<domain>
## Phase Boundary

画布导航对齐 kmc 22-phase 真实结构并在 93 镜规模下可用——zone/泳道补全缺失 phase、场景→镜头两级浏览、搜索升级为结果列表+聚焦跳转的导航器、新资产落点合理、LOD 默认可读、分支 UI 接通多结局探索。

Requirements: NAV-01, NAV-02, NAV-03, NAV-04, NAV-05, NAV-06

</domain>

<decisions>
## Implementation Decisions

### zone 对齐口径 (NAV-01)
- **D-01:** 真相源对齐 = 镜像 + 契约测试——PIPELINE_PHASES 扩到 22 phase,以 khs `canvas_sync._PHASE_INDEX_MAP` 为唯一真相源,kap 侧固化镜像 + contract test(khs 改映射时测试变红);v2.0 / 53-D02 / 54-D02 同模式第三次复刻,零漂移史
- **D-02:** 泳道分组 = 创作阶段分组——沿用既有 `PHASE_GROUPS` 框架(research/story/production/post),新 phase 按创作语义归组(p035→story、p09b/p09c/p10c/p11*→production、p12*/p14/p15→post 之类),具体归组 planner 可调;与 Phase 54 泳道阻塞高亮同坐标系
- **D-03:** 未知 phase 兜底 = fallback zone + 断言——未知 phaseIndex 节点落入「未映射」zone + console.warn,fail-loud 但不崩;成功标准 1 的断言 = 全量 episode 导入后未映射区为空
- **D-04:** 词汇统一 = 单一注册表——zone 表(扩展后的 22-phase 注册表)作为前端 phase 词汇的唯一来源;Phase 54 泳道阻塞高亮、Phase 57 PORTAL-04 taxonomy 对齐都消费它,避免两套 phase 词汇漂移(ROADMAP 57 依赖注明的风险)

### Claude's Discretion
- **分镜层级浏览(NAV-02 未深讨)**——候选形态:StoryboardTimeline(3028 行,已有 `sceneNumOf`/场景色带地基)扩展 vs 画布内 zone 折叠组 vs 独立面板;镜头卡信息密度(shot_id/景别/运镜/时长/video_prompt/引用角色&场景缩略图——素材字段已由 v1.7 storyboard metadata 铺好);依 frontend-design 纪律先出 token 层设计(两级浏览的信息架构:场景行→镜头卡的展开/折叠语义)
- **LOD 默认可读(NAV-05)取舍**——keyFields 可读需 L2(≥0.6)但超大图(34160px)天然 fit-zoom ~0.05,现有 FITVIEW_MIN_ZOOM=0.4 保 L1;候选:提下限(超大图更只见局部)/每泳道缩放记忆/混合(默认 L1+一键放大到泳道 L2);**不可回归** LOD 体系既有修法(LodProvider+Context 跨阈值才算、迟滞 0.03、FITVIEW_MIN_ZOOM 下限——2026-08 月盲区修复的成果)
- **新资产落点(NAV-04)优先级**——视口中心 vs 事件源旁,何者优先/何时用哪个(有事件源时源旁、无时视口中心是最可能组合,planner 定;断言=坐标与视口/源距离有界)
- **搜索导航器(NAV-03)**——语义已清晰(结果列表+focusAssetNodeId 聚焦跳转+`/` 快捷键+不再隐藏非命中);索引范围(节点名/shot_id/prompt 摘要)与结果列表形态 planner 定
- **分支 UI(NAV-06)**——BranchPanel 已被 51-WRITE-04 删除,`selectBranchAsMain` 仍活在 canvasStore;重写形态(侧栏 vs 顶栏切换器)、多结局探索交互(预览分支 vs 直接切主线)planner 定;持久化语义沿用既有 store

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 真相源与注册表
- `packages/infinite-canvas/src/components/pipeline/model.ts` — PIPELINE_PHASES 17 阶段注册表(扩到 22 的基座);注释明言 khs `canvas_sync._PHASE_INDEX_MAP` 是唯一真相源(W6 起子阶段各有唯一 phaseIndex)
- `//data/workspace/kais-hermes-skills/plugins/kais_aigc/canvas_sync.py` `_PHASE_INDEX_MAP` — D-01 契约对齐的 khs 侧真相源(contract test 守护对象)
- `packages/infinite-canvas/src/constants`(PHASE_GROUPS) — D-02 泳道分组框架

### LOD 与布局
- `packages/infinite-canvas/src/hooks/useLod.ts` — LOD 三级(L0<0.22/L1 0.22–0.6/L2≥0.6)、迟滞 0.03、FITVIEW_MIN_ZOOM=0.4 —— NAV-05 修改基线,不可回归其修法
- `packages/infinite-canvas/src/utils/autoLayout.ts` — zone 节点(type='zone')布局:子节点按 phase 归组、zone 边界从子包围盒重算
- `packages/infinite-canvas/src/components/StoryboardTimeline.tsx`(3028 行) — NAV-02 的 scene 分组既有地基(sceneNumOf/VT_SCENE_COLORS/首尾帧三态覆盖表)

### 需求与路线
- `.planning/REQUIREMENTS.md` §NAV — NAV-01..06 定义
- `.planning/ROADMAP.md` §Phase 55 — 成功标准 5 条(zone 22 phase 无未映射/两级浏览镜头卡字段/搜索聚焦跳转/落点有界断言/fitView 可读+BranchPanel 重写)
- `.planning/phases/51-canonical-write-path-coordination-guard/51-CONTEXT.md` — WRITE-04 删除旧 BranchPanel/死代码清单(NAV-06 重写的干净地基)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PIPELINE_PHASES` 注册表 + `PHASE_GROUPS`(pipeline/model.ts)——D-01/D-02 直接扩展
- `useLod`/`LodProvider`(hooks/useLod.ts)——LOD 消费已 Context 化(缩放性能修复①的成果,2026-07-27)
- `focusAssetNodeId`(canvasStore)——NAV-03 聚焦跳转复用(53-D19 资产中心跳转同款)
- `StoryboardTimeline` scene 分组地基——NAV-02 不从零起
- `selectBranchAsMain` + branches store(canvasStore)——NAV-06 复活消费
- autoLayout zone 重算机制——zone 扩表后子归组自动适应

### Established Patterns
- 镜像+契约测试(第三次复刻:v2.0 asset schema → 53-D02 candidate envelope → 54-D02 gates snapshot → 本期 _PHASE_INDEX_MAP)
- fail-loud 不崩(fallback zone + warn)——与 reviewBridge CR-01 fail-closed 哲学同源
- zone 节点从子包围盒派生边界——扩表无需新布局算法

### Integration Points
- 导入链:import-from-dir/load-v2 的 phaseIndex 写入(48 建 workflow_phase 真值源)——zone 归组的数据来源
- Phase 54 泳道阻塞高亮、Phase 57 PORTAL-04 taxonomy——D-04 单一注册表的下游消费者
- 缩放性能剩余杠杆②③④(memory: 卡顿 ∝ 总节点数,①已修)——NAV-05 若动 LOD 渲染须兼顾

</code_context>

<specifics>
## Specific Ideas

- **前端设计纪律(用户要求全程应用 /frontend-design):** 两级浏览(场景→镜头)与搜索导航器是本期主 UI——须先出信息架构设计(场景行折叠语义/镜头卡字段排布/搜索结果列表项结构),复用 catppuccin 体系;93 镜规模是设计约束:导航器结果列表要能按场景分组显示,不能 93 行平铺;plan 里 UI 任务含设计检查步
- 成功标准 1 的断言口径:全量 episode 数据导入后「未映射」zone 为空(D-03)
- LOD 既有修法不可回归:FITVIEW_MIN_ZOOM=0.4 下限是 08 月盲区修复成果(曾因亚像素全员 LOD0 色块看不到缩略图)
- 本 phase 纯 kap 侧(packages/infinite-canvas),无 khs 修改(除 contract test 读取 khs 文件做对照)

</specifics>

<deferred>
## Deferred Ideas

None — 讨论未超出 phase 范围。(分镜层级/LOD+落点/分支 UI 三区未深讨,已列 Claude's Discretion,非新能力。)

</deferred>

---

*Phase: 55-画布导航与规模 (Navigation & Scale)*
*Context gathered: 2026-08-21*
