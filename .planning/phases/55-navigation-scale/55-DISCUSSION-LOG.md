# Phase 55: 画布导航与规模 (Navigation & Scale) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 55-画布导航与规模 (Navigation & Scale)
**Areas discussed:** zone 对齐口径 (NAV-01)

**Mode:** Interactive discuss(用户经 /gsd-manager Continue 进入;要求全程应用 /frontend-design;仅选 1/4 灰区)

---

## 灰区选择

4 个灰区 offered(zone 对齐/分镜层级/LOD+落点/分支 UI;搜索 NAV-03 语义已清晰不单列),用户仅选「zone 对齐口径」;其余三区转 Claude's Discretion。

## zone 对齐口径 (NAV-01)

### 真相源机制

| Option | Description | Selected |
|--------|-------------|----------|
| 镜像+契约测试 | PIPELINE_PHASES 扩 22,khs _PHASE_INDEX_MAP 唯一真相源 + contract test(v2.0 同模式第三复刻) | ✓ |
| 运行时拉取 | kap 启动从 khs 拉映射(部署耦合) | |
| 手工维护 | 不守契约(17→22 落后即漂移证据) | |

**User's choice:** 镜像+契约测试 (Recommended)

### 泳道分组

| Option | Description | Selected |
|--------|-------------|----------|
| 创作阶段分组 | 沿用 PHASE_GROUPS(research/story/production/post),新 phase 语义归组,planner 可调 | ✓ |
| 单泳道平铺 | 22 phase 一条线(横向过长) | |
| 模态分组 | 图/视频/音频(与线性依赖链冲突) | |

**User's choice:** 创作阶段分组 (Recommended)

### 未知 phase 兜底

| Option | Description | Selected |
|--------|-------------|----------|
| fallback+断言 | 「未映射」zone + console.warn;断言=全量导入后未映射区空 | ✓ |
| 就近混入 | 显示在相邻 zone(静默错位) | |
| 拒绝导入 | fail hard(khs 新 phase 阻塞全部同步) | |

**User's choice:** fallback+断言 (Recommended)

### 词汇统一

| Option | Description | Selected |
|--------|-------------|----------|
| 单一注册表 | zone 表=22-phase 词汇唯一前端来源;54 高亮/57 taxonomy 都消费 | ✓ |
| 各自维护 | 各 phase 各自维护(54/57 落地时漂移成本高) | |
| Claude 定 | 延后定(跨 phase 契约返工面大) | |

**User's choice:** 单一注册表 (Recommended)

---

## Claude's Discretion

- 分镜层级浏览形态(StoryboardTimeline 扩展 vs 画布折叠组 vs 独立面板)+ 镜头卡信息密度
- LOD 默认可读取舍(提下限 vs 每泳道缩放记忆 vs 混合);既有 LOD 修法不可回归
- 新资产落点优先级(事件源旁 vs 视口中心的组合规则)
- 搜索索引范围与结果列表形态
- BranchPanel 重写形态与多结局探索交互

## Deferred Ideas

None — 讨论未超出 phase 范围。
