# kais-aigc-platform 无限画布 — 下一步开发计划

> **版本**: 1.0
> **日期**: 2026-05-31
> **作者**: 产品经理 + 技术架构师
> **基于**: 4次迭代后的代码审查 + canvas-review-integration.md 研究报告

---

## 目录

1. [现状评估](#1-现状评估)
2. [短期优化（1-2天）](#2-短期优化12天快速迭代)
3. [中期功能（3-5天）](#3-中期功能3-5天)
4. [长期愿景（1-2周）](#4-长期愿景1-2周)
5. [技术架构升级建议](#5-技术架构升级建议)
6. [推荐实施路线（优先级排序）](#6-推荐实施路线优先级排序)

---

## 1. 现状评估

### 1.1 当前代码规模

| 模块 | 文件数 | 总行数 | 说明 |
|------|--------|--------|------|
| 前端组件 | 10 | 1,940 | FlowCanvas/NodeDetailPanel/CanvasContextMenu/ScoreBadge/ProjectSelector/4节点/1边 |
| 类型定义 | 1 | 175 | canvas.ts |
| API服务 | 1 | 173 | canvasApi.ts |
| Hooks | 1 | 81 | useCanvasSocket.ts |
| 工具函数 | 2 | 202 | flowDataMapper.ts + styles.ts |
| 入口 | 1 | 10 | main.tsx |
| **前端合计** | **16** | **2,581** | |
| 后端路由 | 8 | ~755 | convert/execute/load/save/projectData/projects/approve/reject |
| **总计** | **24** | **~3,336** | |

### 1.2 架构优点

**A. 清晰的关注点分离**

```
src/
  components/     → 纯UI渲染
  hooks/          → 副作用和状态管理
  services/       → API通信层
  utils/          → 数据转换和样式
  types/          → TypeScript类型定义
```

这种五层分离让每个文件的职责单一，新人能快速定位代码。`canvasApi.ts` 封装了所有HTTP调用，`flowDataMapper.ts` 处理了所有数据格式转换。

**B. 类型系统扎实**

`canvas.ts` 定义了完整的类型层次：`FlowGraph → FlowGraphNode → ScriptNodeData/AssetNodeData/StoryboardNodeData/VideoNodeData`。所有节点数据都有明确的接口约束，而非 `any` 穿透。`AIScore` 接口预设了5维评分字段，为后续评分可视化预留了空间。

**C. 审核状态集成到位**

迭代3和4正确地将审核状态嵌入节点渲染链路：
- `convert.ts` 从 `o_agentWorkData` 读取 reviewMapping
- `flowDataMapper.ts` 通过 `FlowGraphNode.data.reviewStatus` 传递
- 节点组件根据 `reviewStatus` / `routingDecision` 动态着色
- `ScoreBadge` 同时展示分数+路由标签

**D. 实时更新架构已搭好**

`useCanvasSocket.ts` 监听了4种WebSocket事件（`node:state`, `node:preview`, `node:created`, `execution:progress`），为实时协作打下了基础。

**E. CanvasEdge 已支持非活跃路径**

`CanvasEdge.tsx` 的 `isInactive` 属性和虚线样式已为变体路径折叠做好准备，这是前瞻性设计。

### 1.3 架构不足

**A. 巨型组件问题**

| 文件 | 行数 | 问题 |
|------|------|------|
| FlowCanvas.tsx | 421 | 集成了画布渲染、项目管理、数据加载/保存、工具栏、右键菜单、WebSocket — 6个职责 |
| NodeDetailPanel.tsx | 477 | 包含9个子组件（TypeIcon/StateBadge/SectionLabel/ScriptDetail/AssetDetail/StoryboardDetail/VideoDetail/ReviewStatusBadge/ScoreDim），全内联 |
| CanvasContextMenu.tsx | 285 | 包含菜单逻辑+驳回理由输入框+节点创建逻辑 |

`FlowCanvas.tsx` 是最严重的问题：`CanvasInner` 函数体约350行，处理了数据加载、格式转换、节点/边状态管理、工具栏UI、项目切换、保存逻辑、右键菜单交互。每次打开文件都要理解全部上下文。

**B. 硬编码布局常量散落各处**

```
flowDataMapper.ts:  SCRIPT_X=50, SCRIPT_Y=50, ASSET_START_X=400, ...
FlowCanvas.tsx:     width:260, height:180, padding:0.2
AssetNode.tsx:      width:240px, thumbnail:100px
StoryboardNode.tsx: width:260px, thumbnail:120px
VideoNode.tsx:      width:240px, thumbnail:130px
CanvasContextMenu:  x+400 offset for new node placement
```

这些值分散在6个文件中，修改布局需要搜索和编辑多个文件。没有统一的布局常量文件。

**C. 颜色体系硬编码**

所有组件内联了Catppuccin Mocha颜色值，`styles.ts` 只定义了 `stateColors` 和 `edgeTypeColors`，但节点组件没有引用它们来做审核着色。每个节点组件（AssetNode/StoryboardNode/VideoNode）都各自维护了一套完全相同的审核状态→颜色映射逻辑。

**D. API层缺少错误处理和重试**

`canvasApi.ts` 每个函数都有相同的模式：
```typescript
const res = await fetch(...)
const data = await res.json()
if (data.code === 200 && data.data.code === 0) return data.data
```
但没有：
- 网络错误重试
- 请求超时控制
- 请求取消（组件卸载时）
- 请求去重（快速双击）
- 全局错误提示

**E. 后端 execute.ts 是 mock 实现**

```typescript
// execute.ts 核心逻辑
setImmediate(() => {
  broadcastToProject(projectId, 'node:state', { nodeId, state: 'running' })
  setTimeout(() => {
    broadcastToProject(projectId, 'node:state', { nodeId, state: 'success' })
  }, 2000)
})
```

当前执行API只是模拟了状态广播，没有实际触发任何生成任务。这意味着画布上的"执行"按钮是一个空壳。

**F. 缺少全局状态管理**

没有使用 Context/Zustand/Jotai 等状态管理方案。`FlowCanvas.tsx` 通过 props drilling 将 `onNodeClick`, `onSave`, `nodes`, `edges` 等传递给子组件。随着功能增加，这会导致严重的 prop 传递链。

**G. 没有测试**

整个无限画布模块零测试。没有单元测试、没有集成测试、没有E2E测试。4个迭代的代码全是手工验证。

### 1.4 用户体验痛点（基于代码分析推断）

**痛点1: 首次加载体验差**

`FlowCanvas.tsx` 的 `handleProjectSelect` 函数链路：
1. 调用 `loadCanvasGraph` → 失败则
2. 调用 `convertProjectData` → 成功后自动
3. 调用 `saveCanvasGraph`

没有任何加载进度指示（除了一个简单的 "加载中..." 文字）。convert API 跨6张表查询，在数据量大时可能需要数秒。

**痛点2: 布局不可调**

所有节点按固定坐标排列（SCRIPT在左，ASSET在中，STORYBOARD在下，VIDEO在底）。用户无法一键重新排列，拖拽后保存/加载会保留位置，但 convert（重建）会丢失手动布局。

**痛点3: 审核操作缺乏反馈**

右键"通过/驳回"后，API调用成功但节点状态更新依赖手动刷新或WebSocket推送。如果WebSocket断连，用户看不到状态变化。没有loading状态、没有toast通知、没有操作确认。

**痛点4: 节点详情面板信息密度低**

`NodeDetailPanel.tsx` 的478行中，每种节点类型只展示基本信息。资产节点只显示缩略图+prompt，没有展示审核历史、评分明细、生成参数、关联资产。评分的5个维度（aesthetics/consistency/compliance/technical_quality/audio_match）已经在 `AIScore` 类型中定义，但面板只用 `ScoreDim` 简单展示了数值+标签。

**痛点5: 无批量操作**

CanvasContextMenu 只支持单节点右键操作。在实际审核流程中，审核员需要一次通过/驳回多个节点。

**痛点6: 缩略图加载无容错**

`AssetNode.tsx` 和 `StoryboardNode.tsx` 都有 `onError` handler 用文字图标替代，但：
- 没有 lazy loading
- 没有 skeleton 加载态
- `thumbnailUrl` 拼接的是直接 OSS URL，没有 CDN 缓存
- 加载失败后没有重试机制

---

## 2. 短期优化（1-2天，快速迭代）

### 2.1 提取审核状态颜色逻辑

**问题**: AssetNode/StoryboardNode/VideoNode 各自维护了一套完全相同的审核着色逻辑（~20行重复代码×3）。

**方案**: 在 `styles.ts` 中新增函数：

```typescript
// styles.ts 新增
export function getReviewBorderColor(reviewStatus?: string, routingDecision?: string): string
export function getReviewOpacity(reviewStatus?: string): number
export function getReviewFilter(reviewStatus?: string): string
```

**涉及文件**:
- `packages/infinite-canvas/src/utils/styles.ts` — 新增3个函数（~30行）
- `packages/infinite-canvas/src/components/nodes/AssetNode.tsx` — 删除内联逻辑，调用新函数
- `packages/infinite-canvas/src/components/nodes/StoryboardNode.tsx` — 同上
- `packages/infinite-canvas/src/components/nodes/VideoNode.tsx` — 同上

**工作量**: 1.5小时

### 2.2 统一布局常量

**问题**: 布局常量散落在 `flowDataMapper.ts`、`FlowCanvas.tsx`、4个节点组件、`CanvasContextMenu.tsx` 中。

**方案**: 新建 `constants.ts`：

```typescript
// packages/infinite-canvas/src/constants.ts
export const NODE_SIZES = {
  script:   { width: 240, minWidth: 240, maxWidth: 280 },
  asset:    { width: 240, height: 180, thumbnail: 100 },
  storyboard: { width: 260, height: 200, thumbnail: 120 },
  video:    { width: 240, height: 200, thumbnail: 130 },
} as const

export const LAYOUT = {
  SCRIPT_X: 50, SCRIPT_Y: 50,
  ASSET_START_X: 400, ASSET_Y: 50,
  ASSET_GAP_X: 280, ASSET_GAP_Y: 220,
  SB_START_X: 400, SB_START_Y: 500,
  SB_GAP_X: 300,
  VIDEO_START_Y: 850,
  NEW_NODE_OFFSET: 400,
} as const

export const VIEWPORT = { padding: 0.2 } as const
```

**涉及文件**:
- 新建 `packages/infinite-canvas/src/constants.ts`（~20行）
- 修改 `flowDataMapper.ts` — 导入替换（5行改动）
- 修改 `FlowCanvas.tsx` — 导入替换（3行改动）
- 修改 4个节点组件 — 导入替换（各2行改动）
- 修改 `CanvasContextMenu.tsx` — 导入替换（1行改动）

**工作量**: 1小时

### 2.3 API层加固

**问题**: `canvasApi.ts` 没有超时、重试、取消、错误提示。

**方案**: 在 `canvasApi.ts` 中：

```typescript
// 新增
const TIMEOUT_MS = 15000
const controller = new AbortController()

async function apiCall(url: string, body: unknown): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    // ...existing logic
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时')
    throw err
  } finally {
    clearTimeout(timer)
  }
}
```

替换所有直接 `fetch` 调用为 `apiCall`。

**涉及文件**:
- `packages/infinite-canvas/src/services/canvasApi.ts` — 重构全部10个函数

**工作量**: 2小时

### 2.4 审核操作反馈优化

**问题**: 审核通过/驳回没有视觉反馈。

**方案**: 在 `FlowCanvas.tsx` 或新建 `hooks/useToast.ts` 中实现简单 toast：

```typescript
// 新建 hooks/useToast.ts
export function useToast() {
  // 返回 showToast(message, type) 和 ToastContainer 组件
}
```

在 `CanvasContextMenu.tsx` 的 handleApprove/handleReject 回调中添加 toast 调用。同时在审核操作后立即更新本地节点状态（乐观更新），不等WebSocket推送。

**涉及文件**:
- 新建 `packages/infinite-canvas/src/hooks/useToast.ts`（~50行）
- 修改 `packages/infinite-canvas/src/components/CanvasContextMenu.tsx`（~10行改动）
- 修改 `packages/infinite-canvas/src/components/FlowCanvas.tsx` — 渲染 ToastContainer（~5行）

**工作量**: 2小时

### 2.5 加载状态改善

**问题**: 画布加载只有一个 "加载中..." 文字，没有骨架屏或进度。

**方案**:
1. 新建 `LoadingOverlay.tsx` 组件，带 canvas 风格的骨架屏动画
2. 在 `FlowCanvas.tsx` 的 loading 状态时显示骨架屏而非文字
3. 添加 convert 进度提示："正在解析项目数据..."

**涉及文件**:
- 新建 `packages/infinite-canvas/src/components/LoadingOverlay.tsx`（~40行）
- 修改 `FlowCanvas.tsx` — 替换 loading 渲染逻辑（~10行改动）

**工作量**: 1.5小时

### 2.6 缩略图加载优化

**问题**: 无 skeleton、无 lazy loading、无 CDN。

**方案**: 在所有节点组件的 `<img>` 标签上：
1. 添加 skeleton 加载态（背景渐变动画）
2. 使用 `loading="lazy"` 属性
3. 添加 `onLoad` handler 切换 skeleton/图片

**涉及文件**:
- 修改 4个节点组件的 `<img>` 渲染逻辑

**工作量**: 1小时

### 2.7 短期优化汇总

| 编号 | 任务 | 文件 | 工作量 |
|------|------|------|--------|
| 2.1 | 提取审核颜色逻辑 | styles.ts + 3节点 | 1.5h |
| 2.2 | 统一布局常量 | constants.ts + 8文件 | 1h |
| 2.3 | API层加固 | canvasApi.ts | 2h |
| 2.4 | 审核操作反馈 | useToast.ts + CanvasContextMenu + FlowCanvas | 2h |
| 2.5 | 加载状态改善 | LoadingOverlay.tsx + FlowCanvas | 1.5h |
| 2.6 | 缩略图优化 | 4节点组件 | 1h |
| | **合计** | | **9h（约1.5天）** |

---

## 3. 中期功能（3-5天）

### 3.1 Phase 2: 评分可视化

**目标**: 在节点上和详情面板中展示5维评分的丰富可视化。

#### 3.1.1 节点上的迷你进度条

在 AssetNode/StoryboardNode/VideoNode 的底部添加5个微型进度条，每个对应一个评分维度：

```
┌──────────────────────────────┐
│  [缩略图]              [85分] │
│  资产名称                    │
│  prompt 文字...              │
│ ━━━━━━━━━━ ━━━━━━ ━━━━━━━━━ │
│  美 85  一致 72  合规 90      │
│  技术 78  音频 65             │
└──────────────────────────────┘
```

**实现细节**:
- 新建 `packages/infinite-canvas/src/components/ScoreMiniBar.tsx`（~60行）
  - props: `score: AIScore | undefined`
  - 渲染5个水平条，宽度按分数比例
  - 颜色跟随 getScoreColor 函数
- 在3个节点组件的底部区域引入 `ScoreMiniBar`
- 节点高度需要增加 ~30px 以容纳进度条（修改 constants.ts）

**涉及文件**:
- 新建 `ScoreMiniBar.tsx`
- 修改 `constants.ts` — 调整节点高度
- 修改 `AssetNode.tsx`, `StoryboardNode.tsx`, `VideoNode.tsx` — 引入组件

**工作量**: 3小时

#### 3.1.2 详情面板雷达图

在 `NodeDetailPanel.tsx` 中替换 `ScoreDim` 的简单文字展示，改为 Canvas/SVG 雷达图：

```
        美学 85
     /          \
  合规 90    一致 72
    |            |
  音频 65    技术 78
     \          /
```

**实现细节**:
- 新建 `packages/infinite-canvas/src/components/ScoreRadar.tsx`（~120行）
  - 使用纯SVG绘制，无需引入图表库
  - 5个维度均匀分布在360度上
  - 支持hover显示精确数值
  - 深色主题适配（Catppuccin Mocha颜色）
- 在 `NodeDetailPanel.tsx` 的 AssetDetail/StoryboardDetail/VideoDetail 中替换 ScoreDim 调用

**涉及文件**:
- 新建 `ScoreRadar.tsx`
- 修改 `NodeDetailPanel.tsx` — 替换 ScoreDim 为 ScoreRadar

**工作量**: 4小时

#### 3.1.3 后端评分API

**问题**: 当前评分数据在 convert 时一次性读取，没有独立的评分查询/刷新接口。

**方案**: 新建评分路由：

```typescript
// src/routes/canvas/review/score.ts
// POST /api/canvas/review/score
// Body: { projectId, episodesId, nodeId }
// Response: { scores: AIScore }
```

同时需要与 kais-review-platform 的 ScoringBus 集成：
1. 通过 HTTP 调用 review-platform 的评分接口
2. 如果 review-platform 不可用，返回本地缓存的评分
3. 将评分结果写回 `o_agentWorkData` 的 reviewMapping

**涉及文件**:
- 新建 `src/routes/canvas/review/score.ts`（~60行）
- 修改 `src/routes/canvas/index.ts` — 注册新路由
- 修改 `packages/infinite-canvas/src/services/canvasApi.ts` — 新增 `fetchNodeScore` 函数

**工作量**: 3小时

### 3.2 Phase 3: 变体审核

**目标**: 支持一个分镜节点有多个候选资产，审核员选择最优者，非优选路径自动折叠。

#### 3.2.1 变体组数据模型

**扩展 canvas.ts 类型定义**:

```typescript
// 新增类型
interface VariantGroup {
  groupId: string              // 唯一标识
  parentNodeId: string         // 父节点（通常是 storyboard）
  variantNodeIds: string[]     // 所有候选节点ID
  winnerNodeId?: string        // 优胜节点ID
  createdAt: string
}

// 扩展 FlowGraphNode
interface FlowGraphNode {
  // ...existing fields
  variantGroupId?: string      // 所属变体组
  variantIndex?: number        // 在组中的序号（用于标签显示）
}
```

**涉及文件**:
- 修改 `packages/infinite-canvas/src/types/canvas.ts` — 新增 VariantGroup，扩展 FlowGraphNode

**工作量**: 1.5小时

#### 3.2.2 变体节点渲染

当节点属于变体组时，在节点右上角显示变体标签（"V1", "V2", "V3"），优胜节点用金色边框高亮：

```
┌─── V1 ★ ────────────────────┐   ┌─── V2 ─────────────────────┐
│  [缩略图]              [92分] │   │  [缩略图]              [78分] │
│  资产名称                    │   │  资产名称（灰色调）          │
│  ✦ WINNER                   │   │  非优胜                     │
└──────────────────────────────┘   └──────────────────────────────┘
```

**实现细节**:
- 新建 `packages/infinite-canvas/src/components/VariantBadge.tsx`（~40行）
  - 显示变体序号 + 优胜标记
  - 优胜者金色边框，非优胜者灰色虚线边框
- 修改 AssetNode/StoryboardNode 引入 VariantBadge
- CanvasEdge 的 `isInactive` 逻辑已经存在，根据 `isWinner` 状态设置

**涉及文件**:
- 新建 `VariantBadge.tsx`
- 修改 3个节点组件 — 引入 VariantBadge

**工作量**: 2.5小时

#### 3.2.3 优胜选择交互

在 CanvasContextMenu 中添加"选为优胜"菜单项：

```typescript
// CanvasContextMenu 新增逻辑
if (node.data.variantGroupId) {
  items.push({
    label: '🏆 选为优胜',
    action: () => selectWinner(nodeId, variantGroupId)
  })
}
```

同时添加批量操作：选择变体组时，可以"全部通过"或"全部驳回"。

**涉及文件**:
- 修改 `CanvasContextMenu.tsx` — 新增优胜选择菜单项
- 新建 `src/routes/canvas/review/selectWinner.ts`（~50行）
- 修改 `canvasApi.ts` — 新增 `selectWinner` 函数

**工作量**: 2小时

#### 3.2.4 路径折叠动画

当用户选择优胜者后，非优胜路径应该平滑折叠：

1. 非优胜节点收缩为小圆点（40x40）
2. 连线变为灰色虚线（已有 CanvasEdge.isInactive 支持）
3. 点击折叠节点可展开查看

**实现细节**:
- 使用 React Flow 的 `nodeTypes` 注册一个 `CollapsedVariantNode` 类型
- 在优胜选择回调中，将非优胜节点的 `type` 改为 `collapsed-variant`
- 使用 CSS transition 动画过渡尺寸变化

**涉及文件**:
- 新建 `packages/infinite-canvas/src/components/nodes/CollapsedVariantNode.tsx`（~50行）
- 修改 `FlowCanvas.tsx` — 注册新节点类型
- 修改 `flowDataMapper.ts` — 处理折叠节点序列化

**工作量**: 3小时

#### 3.2.5 后端变体管理API

```typescript
// 新建 src/routes/canvas/review/createVariants.ts
// POST /api/canvas/review/create-variants
// Body: { projectId, episodesId, storyboardNodeId, count: number }
// → 调用生成系统创建候选资产

// 新建 src/routes/canvas/review/selectWinner.ts
// POST /api/canvas/review/select-winner
// Body: { projectId, episodesId, groupId, winnerNodeId }
// → 更新变体组的优胜者标记
```

**涉及文件**:
- 新建 `createVariants.ts`（~80行）
- 新建 `selectWinner.ts`（~50行）
- 修改 `canvasApi.ts` — 新增2个API函数

**工作量**: 3小时

### 3.3 中期功能汇总

| 功能 | 涉及文件 | 工作量 |
|------|----------|--------|
| Phase 2: 评分可视化 | | |
| 2.1 迷你进度条 | ScoreMiniBar.tsx + 3节点 + constants | 3h |
| 2.2 雷达图 | ScoreRadar.tsx + NodeDetailPanel | 4h |
| 2.3 评分API | score.ts + canvasApi.ts | 3h |
| Phase 3: 变体审核 | | |
| 3.1 数据模型 | canvas.ts | 1.5h |
| 3.2 变体渲染 | VariantBadge.tsx + 3节点 | 2.5h |
| 3.3 优胜选择 | CanvasContextMenu + selectWinner.ts + canvasApi | 2h |
| 3.4 路径折叠 | CollapsedVariantNode.tsx + FlowCanvas + flowDataMapper | 3h |
| 3.5 后端API | createVariants.ts + selectWinner.ts + canvasApi | 3h |
| | **Phase 2 合计** | **10h（~2天）** |
| | **Phase 3 合计** | **12h（~2.5天）** |
| | **中期总计** | **22h（~4.5天）** |

---

## 4. 长期愿景（1-2周）

### 4.1 画布直接触发生成（ComfyUI模式）

**愿景**: 用户在画布上右键一个分镜节点，选择"生成资产"，画布直接触发生成任务并实时显示进度。类似 ComfyUI 的工作流：连接节点 → 配置参数 → 一键执行。

**核心架构变化**:

```
当前流程:  外部系统生成 → 数据入库 → 画布展示
目标流程:  画布触发 → 调度系统 → 生成执行 → 实时回写画布
```

**需要新建的组件**:
- `GeneratePanel.tsx` — 生成参数配置面板（模型选择、提示词编辑、参数调节）
- `hooks/useGeneration.ts` — 生成任务状态管理
- 后端 `execute.ts` 重写 — 从 mock 改为真实调用 kais-movie-agent 或 kais-gold-team 的生成API

**需要的新API**:
```typescript
// src/routes/canvas/generate/start.ts
// POST /api/canvas/generate/start
// Body: { projectId, episodesId, nodeId, nodeType, params: GenerateParams }

// src/routes/canvas/generate/status.ts
// GET /api/canvas/generate/status/:taskId

// src/routes/canvas/generate/cancel.ts
// POST /api/canvas/generate/cancel
// Body: { taskId }
```

**与现有系统集成**:
- 通过 Redis Streams 向 kais-gold-team 发送生成任务
- WebSocket 实时推送生成进度（node:state + execution:progress 事件已预留）
- 生成完成后通过 node:created 事件自动在画布上创建新节点

**工作量估算**: 40-60小时（包含与 kais-movie-agent/kais-gold-team 的集成联调）

### 4.2 与 kais-review-platform 深度集成

**当前状态**: 两个系统独立运行，aigc-platform 的审核只是本地状态标记。

**目标状态**: 画布作为 review-platform 的可视化前端，所有审核操作都走 review-platform 的 state machine。

**集成架构**:

```
无限画布 ←→ aigc-platform API ←→ review-platform API
                                   ↓
                              State Machine
                              (PENDING → POLICY_EVAL → APPROVING → COMPLETE)
                                   ↓
                              ScoringBus
                              (NullScorer → 未来接入真实AI评分)
                                   ↓
                              SSE/Webhook 实时回传状态
```

**需要实现的接口**:

| 操作 | 画布 → aigc-platform | aigc-platform → review-platform |
|------|---------------------|-------------------------------|
| 审核通过 | `POST /review/approve` | `POST /api/v1/shot-cards/{id}/approve` |
| 审核驳回 | `POST /review/reject` | `POST /api/v1/shot-cards/{id}/reject` |
| 查询状态 | `GET /review/status` | `GET /api/v1/shot-cards/by-shot/{shot_id}` |
| 触发评分 | `POST /review/score` | `POST /api/v1/shot-cards/{id}/score` |
| 变体创建 | `POST /review/create-variants` | `POST /api/v1/shot-cards` (批量创建) |
| 优胜选择 | `POST /review/select-winner` | `PATCH /api/v1/shot-cards/{id}` |

**实时同步**:
- review-platform 通过 SSE 推送状态变更（已有 `emit_state_change` 机制）
- aigc-platform 通过 WebSocket 转发给前端画布
- 需要在 aigc-platform 后端实现 SSE client（订阅 review-platform 的状态流）

**工作量估算**: 30-40小时

### 4.3 多人协作编辑

**技术方案选择**:

| 方案 | 优点 | 缺点 | 推荐 |
|------|------|------|------|
| CRDT (Yjs) | 无冲突、离线支持好 | 引入新依赖、学习成本 | 推荐 |
| OT (Operational Transform) | 成熟方案 | 实现复杂、需要中心服务器 | 不推荐 |
| 乐观锁 + 广播 | 简单、利用现有WebSocket | 冲突需要手动解决 | 作为过渡方案 |

**推荐路线**: 先用乐观锁+广播做基础协作（同一时刻只有一人能编辑），后期引入 Yjs 做真正的 CRDT。

**Phase A: 基础协作（乐观锁+广播）**:
- 用户光标位置广播
- 节点拖拽锁定（某人拖拽时其他人的该节点锁定）
- 操作日志面板

**Phase B: CRDT协作（Yjs）**:
- 引入 yjs + y-websocket
- 节点位置、选中状态、编辑内容都走 CRDT
- 离线编辑 + 自动合并

**工作量估算**: Phase A 20-30h, Phase B 40-60h

### 4.4 自动布局算法

**问题**: 当前布局是硬编码的4行排列，不适合复杂项目。

**方案**:

1. **dagre/elkjs 自动布局** — 一键重排，DAG拓扑排序
   - 新建 `utils/autoLayout.ts`
   - 集成 elkjs（比dagre更活跃维护、支持更多约束）
   - 工具栏添加"自动布局"按钮

2. **分组布局** — 按剧本/分镜/资产自动分组
   - 使用 React Flow 的 Group 节点
   - 组内紧凑排列，组间保持间距

3. **增量布局** — 新增节点只影响局部布局
   - 保留用户手动调整的位置
   - 新节点插入到最佳空位

**工作量估算**: 15-25小时

### 4.5 Pipeline 执行可视化

**愿景**: 在画布上实时显示整个生成管线的执行状态，类似 GitHub Actions 的 workflow 可视化。

**设计**:
- 正在执行的节点显示脉冲动画
- 执行路径高亮（已完成=绿色连线，执行中=蓝色流动，等待=灰色）
- 节点上方显示执行时间和资源消耗
- 全局进度条显示管线完成度

**技术方案**:
- CSS `@keyframes` 实现脉冲动画和连线流动效果
- WebSocket 接收管线状态更新
- 后端需要提供管线拓扑和执行状态API

**工作量估算**: 20-30小时

### 4.6 长期功能汇总

| 功能 | 工作量 | 优先级建议 |
|------|--------|-----------|
| 画布直接触发生成 | 40-60h | P2 |
| review-platform 深度集成 | 30-40h | P1 |
| 多人协作 Phase A | 20-30h | P2 |
| 多人协作 Phase B | 40-60h | P3 |
| 自动布局 | 15-25h | P2 |
| Pipeline可视化 | 20-30h | P2 |

---

## 5. 技术架构升级建议

### 5.1 前端组件重构方向

#### 5.1.1 FlowCanvas 拆分

当前 `FlowCanvas.tsx`（421行）承担了太多职责。建议拆分为：

```
FlowCanvas.tsx (入口, ~80行)
  └── CanvasInner.tsx (核心画布, ~150行)
      ├── CanvasToolbar.tsx (~80行) — 工具栏：项目切换、保存、自动布局
      ├── CanvasEventHandler.tsx (~100行) — 事件处理：右键、点击、连接
      └── CanvasLoader.tsx (~50行) — 数据加载和状态管理
```

**拆分原则**:
- `FlowCanvas` 只负责 ReactFlowProvider 包装和全局状态
- `CanvasInner` 只负责 ReactFlow 配置和渲染
- 工具栏、事件处理、数据加载各自独立
- 通过自定义 hooks 共享状态

#### 5.1.2 NodeDetailPanel 拆分

当前 `NodeDetailPanel.tsx`（477行）包含9个内联子组件。建议拆分为：

```
NodeDetailPanel.tsx (入口, ~80行)
  ├── details/ScriptDetail.tsx (~60行)
  ├── details/AssetDetail.tsx (~80行)
  ├── details/StoryboardDetail.tsx (~80行)
  ├── details/VideoDetail.tsx (~60行)
  ├── shared/ReviewStatusBadge.tsx (~30行)
  ├── shared/ScoreRadar.tsx (~120行)
  └── shared/SectionLabel.tsx (~15行)
```

#### 5.1.3 主题系统

所有硬编码颜色应该集中到一个主题文件：

```typescript
// packages/infinite-canvas/src/theme/catppuccin.ts
export const theme = {
  base: '#1e1e2e',
  mantle: '#181825',
  crust: '#11111b',
  surface0: '#313244',
  surface1: '#45475a',
  overlay0: '#6c7086',
  text: '#cdd6f4',
  subtext: '#a6adc8',
  blue: '#89b4fa',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  red: '#f38ba8',
  mauve: '#cba6f7',
  teal: '#94e2d5',
  peach: '#fab387',
  gold: '#f5c542',  // 优胜者标记
} as const
```

所有组件从 `theme` 导入颜色，不再硬编码十六进制值。

### 5.2 后端 API 设计规范

#### 5.2.1 统一响应格式

当前后端的响应格式不统一。建议所有 canvas API 统一为：

```typescript
// 成功
{ code: 0, data: T, message: "ok" }

// 失败
{ code: number, data: null, message: "错误描述" }
// code: 10001=参数错误, 10002=未找到, 10003=权限不足, 10004=外部系统错误
```

#### 5.2.2 路由注册集中化

当前 `src/routes/canvas/` 下有 `convert.ts`, `execute.ts`, `load.ts`, `save.ts`, `projectData.ts`, `projects.ts`, `review/approve.ts`, `review/reject.ts` — 分散在多个文件中，没有统一的 index.ts。

建议新建 `src/routes/canvas/index.ts`：

```typescript
import express from 'express'
const router = express.Router()

router.post('/convert', require('./convert').default)
router.post('/execute', require('./execute').default)
router.post('/load', require('./load').default)
router.post('/save', require('./save').default)
router.post('/projectData', require('./projectData').default)
router.post('/projects', require('./projects').default)
router.post('/review/approve', require('./review/approve').default)
router.post('/review/reject', require('./review/reject').default)
router.post('/review/score', require('./review/score').default)
router.post('/review/select-winner', require('./review/selectWinner').default)
router.post('/review/create-variants', require('./review/createVariants').default)
router.post('/generate/start', require('./generate/start').default)
router.post('/generate/status', require('./generate/status').default)

export default router
```

#### 5.2.3 审核状态存储演进

**当前**: 审核状态存在 `o_agentWorkData` 表的 JSON 字段中（key: `reviewStatus-${episodesId}`）

**问题**:
- JSON 字段无法高效查询（如"查询所有 awaiting_audit 的分镜"）
- 并发更新可能丢失数据（没有乐观锁）
- 与 review-platform 的 ShotCard 模型不一致

**演进路线**:

```
Phase 1 (当前): JSON in o_agentWorkData
  ↓
Phase 2: 新建 o_canvas_review 表
  CREATE TABLE o_canvas_review (
    id SERIAL PRIMARY KEY,
    node_id VARCHAR(100) NOT NULL,
    episodes_id INT NOT NULL,
    shot_card_id VARCHAR(100),         -- 关联 review-platform
    review_status VARCHAR(50),
    routing_decision VARCHAR(50),
    ai_scores JSONB,
    is_winner BOOLEAN DEFAULT FALSE,
    variant_group_id VARCHAR(100),
    rejection_reason TEXT,
    reviewed_by VARCHAR(100),
    reviewed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(node_id, episodes_id)
  );
  CREATE INDEX idx_canvas_review_status ON o_canvas_review(review_status, episodes_id);
  ↓
Phase 3: 直接查询 review-platform 的 PostgreSQL（跨库JOIN或API调用）
```

### 5.3 状态管理方案

#### 5.3.1 推荐方案: Zustand

当前 props drilling 的问题会随着功能增加而恶化。推荐 Zustand（轻量、与 React Flow 兼容好）。

**Store 设计**:

```typescript
// packages/infinite-canvas/src/store/canvasStore.ts
import { create } from 'zustand'

interface CanvasStore {
  // 项目状态
  projectId: number | null
  episodesId: number | null
  setProject: (projectId: number, episodesId: number) => void

  // 节点/边（由 React Flow 管理，这里做桥接）
  selectedNodeId: string | null
  setSelectedNode: (id: string | null) => void

  // UI状态
  isPanelOpen: boolean
  isContextMenuOpen: boolean
  contextMenuPosition: { x: number; y: number } | null

  // 审核状态
  reviewStatuses: Record<string, ReviewStatus>
  updateReviewStatus: (nodeId: string, status: ReviewStatus) => void

  // 加载状态
  isLoading: boolean
  loadingMessage: string
}
```

**迁移路径**:
1. 先引入 zustand 管理全局UI状态（panel、menu、loading）
2. 逐步将审核状态迁移到 store
3. 最终用 store 替代大部分 props drilling

**工作量**: 引入+迁移 ~8小时

### 5.4 性能优化方向

#### 5.4.1 节点渲染优化

当前所有节点使用 `memo`，但 memo 的比较函数是默认浅比较。当 `FlowGraphNode.data` 包含嵌套对象时，浅比较可能失效。

**优化**:
```typescript
// 在 memo 中使用自定义比较
export default memo(AssetNodeComponent, (prev, next) => {
  return (
    prev.data.thumbnailUrl === next.data.thumbnailUrl &&
    prev.data.reviewStatus === next.data.reviewStatus &&
    prev.data.aiScore === next.data.aiScore &&
    prev.data.routingDecision === next.data.routingDecision &&
    prev.data.state === next.data.state &&
    prev.data.progress === next.data.progress
  )
})
```

#### 5.4.2 大规模节点优化

当项目有 100+ 节点时（大型短剧项目），需要：

1. **虚拟化渲染**: 只渲染视口内的节点
   - React Flow 内置支持（只需配置 `nodeExtent` 和 `panOnScroll`）
   - 对于 off-screen 节点，React Flow 已默认跳过 DOM 渲染

2. **分页加载**: convert API 支持增量加载
   - 先加载剧本和资产（第一层）
   - 用户展开分镜时再加载分镜和视频（第二层）

3. **缩略图懒加载**: 使用 IntersectionObserver
   - 节点进入视口时才加载缩略图
   - 低缩放级别时显示占位符而非图片

#### 5.4.3 WebSocket 优化

当前 `useCanvasSocket.ts` 每次切换项目都会创建新的 Socket 连接。优化为：

1. 使用单一长连接，通过 `projectId` 切换 room
2. 添加心跳检测和自动重连
3. 事件节流：`node:state` 事件快速连续触发时，合并为最后一次更新

---

## 6. 推荐实施路线（优先级排序）

### P0: 必须立即做（本周内，~10小时）

| # | 任务 | 文件 | 工时 | 理由 |
|---|------|------|------|------|
| P0-1 | 提取审核颜色逻辑 | styles.ts + 3节点 | 1.5h | 消除重复代码，3个节点完全相同的逻辑 |
| P0-2 | 统一布局常量 | constants.ts + 8文件 | 1h | 消除硬编码散落，为后续布局功能打基础 |
| P0-3 | API层加固 | canvasApi.ts | 2h | 超时/取消是基本健壮性要求 |
| P0-4 | 审核操作反馈 | useToast.ts + 2组件 | 2h | 核心用户流程的体验修复 |
| P0-5 | 加载状态改善 | LoadingOverlay.tsx + FlowCanvas | 1.5h | 第一印象优化 |
| P0-6 | 主题系统提取 | theme.ts + 全部组件 | 2h | 所有后续视觉功能的基础 |

### P1: 本周内做（第2-3天，~22小时）

| # | 任务 | 文件 | 工时 | 理由 |
|---|------|------|------|------|
| P1-1 | FlowCanvas拆分 | FlowCanvas.tsx → 4个文件 | 3h | 421行巨型组件，后续功能开发受阻 |
| P1-2 | NodeDetailPanel拆分 | NodeDetailPanel.tsx → 7个文件 | 2h | 477行，评分可视化前必须拆分 |
| P1-3 | ScoreMiniBar | ScoreMiniBar.tsx + 3节点 | 3h | 评分可视化的第一层 |
| P1-4 | ScoreRadar | ScoreRadar.tsx + NodeDetailPanel | 4h | 评分可视化的核心价值 |
| P1-5 | 评分API | score.ts + canvasApi.ts | 3h | 评分数据的动态来源 |
| P1-6 | 变体数据模型 | canvas.ts | 1.5h | 变体审核的基础 |
| P1-7 | 变体渲染 | VariantBadge.tsx + 3节点 | 2.5h | 变体的视觉表达 |
| P1-8 | 优胜选择 | CanvasContextMenu + selectWinner.ts | 3h | 变体审核的核心操作 |

### P2: 下周计划（第4-8天，~65小时）

| # | 任务 | 工时 | 理由 |
|---|------|------|------|
| P2-1 | 路径折叠动画 | 3h | 变体审核体验完善 |
| P2-2 | 后端变体API | 3h | 变体管理的数据支持 |
| P2-3 | review-platform集成 | 30h | 最大的架构升级，审核流程闭环 |
| P2-4 | execute.ts 真实实现 | 8h | 从mock到真实生成触发 |
| P2-5 | 自动布局(elkjs) | 15h | 大型项目必须的布局功能 |
| P2-6 | Zustand状态管理 | 8h | 为多人协作和复杂状态做准备 |

### P3: 未来规划（第2周+）

| # | 任务 | 工时 | 理由 |
|---|------|------|------|
| P3-1 | 画布直接触发生成 | 40-60h | ComfyUI模式，需要与多个系统集成 |
| P3-2 | Pipeline可视化 | 20-30h | 生成管线实时监控 |
| P3-3 | 多人协作 Phase A | 20-30h | 基础多人编辑 |
| P3-4 | 多人协作 Phase B | 40-60h | CRDT全功能协作 |
| P3-5 | 审核数据存储演进 | 8h | 迁移到独立表 |
| P3-6 | 性能优化(100+节点) | 10h | 大规模项目支持 |

---

## 附录 A: 文件改动热力图

根据以上计划，改动频率最高的文件：

| 文件 | P0改动 | P1改动 | P2改动 | 说明 |
|------|--------|--------|--------|------|
| `canvas.ts` | 0 | 1 | 0 | 类型定义，P1新增变体类型 |
| `canvasApi.ts` | 1 | 2 | 1 | API层，每次新增功能都要改 |
| `FlowCanvas.tsx` | 1 | 1 | 1 | P0主题，P1拆分，P2状态管理 |
| `NodeDetailPanel.tsx` | 0 | 1 | 0 | P1拆分+评分可视化 |
| `CanvasContextMenu.tsx` | 1 | 1 | 0 | P0反馈，P1优胜选择 |
| `AssetNode.tsx` | 2 | 2 | 0 | P0常量+主题，P1迷你条+变体 |
| `StoryboardNode.tsx` | 2 | 2 | 0 | 同上 |
| `VideoNode.tsx` | 2 | 2 | 0 | 同上 |
| `styles.ts` | 1 | 0 | 0 | P0提取审核颜色 |
| `constants.ts` (新) | 1 | 0 | 0 | P0创建 |
| `theme.ts` (新) | 1 | 0 | 0 | P0创建 |

## 附录 B: 新建文件清单

| 文件路径 | P级别 | 说明 |
|----------|-------|------|
| `src/constants.ts` | P0 | 布局常量 |
| `src/theme/catppuccin.ts` | P0 | 主题颜色 |
| `src/hooks/useToast.ts` | P0 | Toast通知 |
| `src/components/LoadingOverlay.tsx` | P0 | 加载骨架屏 |
| `src/components/CanvasToolbar.tsx` | P1 | 工具栏拆分 |
| `src/components/CanvasEventHandler.tsx` | P1 | 事件处理拆分 |
| `src/components/CanvasLoader.tsx` | P1 | 数据加载拆分 |
| `src/components/ScoreMiniBar.tsx` | P1 | 迷你评分条 |
| `src/components/ScoreRadar.tsx` | P1 | 雷达图 |
| `src/components/VariantBadge.tsx` | P1 | 变体标签 |
| `src/components/details/*.tsx` | P1 | 详情面板子组件拆分 |
| `src/routes/canvas/index.ts` | P1 | 路由注册集中化 |
| `src/routes/canvas/review/score.ts` | P1 | 评分查询API |
| `src/routes/canvas/review/selectWinner.ts` | P1 | 优胜选择API |
| `src/store/canvasStore.ts` | P2 | Zustand状态管理 |
| `src/components/nodes/CollapsedVariantNode.tsx` | P2 | 折叠变体节点 |
| `src/routes/canvas/review/createVariants.ts` | P2 | 变体创建API |
| `src/routes/canvas/generate/start.ts` | P2 | 生成触发API |
| `src/utils/autoLayout.ts` | P2 | 自动布局算法 |

## 附录 C: 与 review-platform 集成路线图

```
Week 1: 审核操作代理
  aigc-platform → review-platform HTTP调用
  approve/reject 操作转发到 ShotCard state machine
  本地缓存 + 回退策略

Week 2: 状态同步
  SSE订阅 review-platform 状态变更
  WebSocket转发到前端画布
  断线重连 + 状态对账

Week 3: 评分集成
  ScoringBus → 真实AI评分插件
  画布调用评分API → review-platform 触发评分
  评分结果回写画布节点

Week 4: 变体审核闭环
  ShotCard 变体组映射到画布变体节点
  优胜选择同步到 review-platform
  审核报告生成
```

## 附录 D: 关键技术决策记录

| 决策 | 选择 | 替代方案 | 理由 |
|------|------|----------|------|
| 状态管理 | Zustand | Context/Jotai/Redux | 轻量、与React Flow兼容好、学习成本低 |
| 自动布局 | elkjs | dagre | 更活跃维护、支持更多约束 |
| 雷达图 | 纯SVG | Recharts/D3 | 避免引入重量级图表库，SVG对5维雷达足够 |
| 多人协作 | 乐观锁→Yjs | OT/CRDT-only | 渐进式引入，降低初期复杂度 |
| 主题系统 | 常量对象 | CSS Variables/styled-components | 最小改动、TypeScript类型安全 |
| 审核存储 | JSON→独立表→跨库 | 直接跨库 | 渐进式迁移，每步可独立验证 |

---

> **文档维护**: 本计划应随着迭代进展更新。完成每个Phase后，将实际工时记录在对应任务行中，并调整后续计划。
