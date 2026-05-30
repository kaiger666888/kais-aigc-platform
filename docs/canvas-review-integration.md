# 画布审核集成研究报告

> 将 kais-review-platform 的审核能力集成到 kais-aigc-platform 无限画布中的可行性分析和技术方案。

## 1. 核心概念映射

### 1.1 ShotCard ↔ 画布节点映射

两个系统共享同一短剧管线的不同维度。映射关系如下：

| kais-review-platform 概念 | 无限画布对应 | 映射方式 |
|---|---|---|
| `ShotCard` (审核原子) | `FlowGraphNode` (画布节点) | `ShotCard.shot_id` ↔ `FlowGraphNode.id`（如 `storyboard-{id}`） |
| `AuditStatus` (4态) | `NodeState` (6态) | 需要扩展 NodeState 或新增 `reviewStatus` 字段 |
| `ScoreVector` (5维评分) | 节点上的 `data` 字段 | 新增 `aiScore` 嵌套对象到节点 data |
| `VisualBundle.candidates` | 同一位置的多个变体节点 | 新增 `variantGroupId` 分组机制 |
| `NarrativeContext.scene` | `StoryboardNodeData.label` | 已有自然对应 |
| `PolicyEngine` 路由决策 | 节点视觉标记 | 通过 `routingDecision` 字段驱动边框样式 |

**关键发现**：`VisualBundle` 已原生支持 `candidates: list[Candidate]`，每个 Candidate 有独立的 `candidate_id`、`keyframes`、`score`。这正是"多种可能节点"的数据基础。审核平台的 Candidate 模型天然支持同一分镜的多个候选方案。

### 1.2 "多种可能节点"的数据模型

用户需求是"审核每个阶段的多种可能节点"。这可以拆解为两种实现方式：

**方案 A：Candidate 内嵌模式（轻量级）**
- 利用 `VisualBundle.candidates` 已有结构
- 一个 `FlowGraphNode` 内部携带多个候选，节点上用 Tab 或轮播切换
- 优点：不改变画布拓扑，数据结构简单
- 缺点：无法直观对比，不支持连线差异化

**方案 B：变体节点展开模式（推荐）**
- 同一阶段生成多个平行节点，通过 `variantGroupId` 关联
- 画布上并排展示，每条连线都可见
- 选择优胜者后，未选中节点视觉变灰/折叠
- 优点：直观对比，拓扑清晰，完全符合用户描述的"选择优胜路径"
- 缺点：需要新增分组数据结构

**推荐方案 B**。具体数据结构见下节。

### 1.3 "优胜路径"的选路机制

画布是一个 DAG（有向无环图）。选路机制定义如下：

1. **变体组（Variant Group）**：同一阶段的多个候选节点共享同一个 `variantGroupId`
2. **优胜标记（Winner）**：组内被选中的节点 `isWinner: true`，其余为 `false`
3. **活跃路径（Active Path）**：从根节点沿所有 `isWinner: true` 的节点和连线可达的路径
4. **非活跃路径（Inactive Path）**：包含任何 `isWinner: false` 节点的路径段
5. **视觉表达**：活跃路径正常显示，非活跃路径整体降透明度 + 虚线连线

这等价于在 DAG 上做一次可达性标记——从 `isWinner` 节点向前/向后传播标记。

---

## 2. 数据模型设计

### 2.1 画布节点扩展字段

在现有 `FlowGraphNode` 的 `data` 字段中新增以下属性（利用现有 `[key: string]: unknown` 索引签名，无需修改 TypeScript 接口即可存入，但建议显式定义）：

```typescript
// 新增到 canvas.ts 的类型定义

/** 审核状态（来自 kais-review-platform 的 AuditStatus） */
export type ReviewStatus = 'awaiting_audit' | 'approved' | 'rejected' | 'pending_audio'

/** 路由决策（来自 PolicyEngine） */
export type RoutingDecision = 'AUTO' | 'HUMAN' | 'AI_AUDIT' | 'BLOCK'

/** 5维 AI 评分（来自 ScoringBus 的 ScoreVector） */
export interface AIScore {
  aesthetics: number | null       // 美学
  consistency: number | null      // 一致性
  compliance: number | null       // 合规
  technicalQuality: number | null // 技术质量
  audioMatch: number | null       // 音频匹配
  overall: number | null          // 综合分（加权平均）
  source: string | null           // 评分插件名
  scoredAt: string | null         // ISO 时间戳
}

/** 审核元数据（嵌入节点 data） */
export interface ReviewMeta {
  reviewStatus: ReviewStatus
  routingDecision: RoutingDecision | null
  variantGroupId: string | null   // 变体组 ID
  variantIndex: number | null     // 组内序号（候选A=0, B=1...）
  isWinner: boolean | null        // 是否被选为优胜
  aiScore: AIScore | null         // AI 评分
  shotCardId: number | null       // 关联的 ShotCard 主键
  rejectReason: string | null     // 驳回原因
  reviewedBy: string | null       // 审核人
  reviewedAt: string | null       // 审核时间
}
```

### 2.2 变体组模型

在 `FlowGraph` 层面新增 `variantGroups` 数组（与现有 `groups` 平级）：

```typescript
/** 变体组 — 表示同一阶段的多个候选节点 */
export interface VariantGroup {
  id: string                      // 如 "vg-storyboard-5"
  label: string                   // 如 "分镜 5 候选方案"
  variantNodeIds: string[]        // 所有候选节点 ID
  winnerId: string | null         // 当前优胜者节点 ID
  stageType: CanvasNodeType       // 所属阶段类型（asset/storyboard/video）
  reviewStatus: ReviewStatus      // 组级审核状态
}
```

扩展后的 `FlowGraph`：

```typescript
export interface FlowGraph {
  nodes: FlowGraphNode[]
  links: FlowGraphLink[]
  groups: FlowGraphGroup[]
  variantGroups: VariantGroup[]   // 新增
  viewport?: { x: number; y: number; zoom: number }
}
```

### 2.3 节点数据接口扩展

以 `StoryboardNodeData` 为例，新增可选审核字段：

```typescript
export interface StoryboardNodeData {
  [key: string]: unknown          // 已有 — 允许任意扩展
  label: string
  type: 'storyboard'
  storyboardId: number
  duration: number
  prompt: string
  filePath: string | null
  thumbnailUrl: string | null
  state: NodeState
  linkedAssetIds: number[]
  // ── 新增审核字段 ──
  reviewStatus?: ReviewStatus
  variantGroupId?: string | null
  variantIndex?: number | null
  isWinner?: boolean | null
  aiScore?: AIScore | null
  shotCardId?: number | null
}
```

`AssetNodeData` 和 `VideoNodeData` 同理新增相同字段。

### 2.4 审核记录关联方式

画布节点与审核平台的关联通过 `shotCardId` 实现：

```
FlowGraphNode.data.shotCardId  →  ShotCard.id (review-platform 主键)
                                →  ShadowScore.shot_card_id (5维评分)
                                →  ABTestPair.shot_id (A/B测试)
```

**双向查询路径**：

- **画布 → 审核**：`GET /api/v1/shot-cards/{shotCardId}` 获取审核状态和评分
- **审核 → 画布**：`GET /api/v1/shot-cards/by-shot/{shot_id}` 通过 `shot_id` 查找（shot_id = `storyboard-{id}`）

### 2.5 连线扩展

在 `FlowGraphLink` 中新增：

```typescript
export interface FlowGraphLink {
  // ... 现有字段 ...
  isInactive?: boolean  // 标记为非活跃路径（通向未选中变体）
}
```

非活跃连线渲染为虚线 + 低透明度。

---

## 3. 前端交互设计

### 3.1 节点视觉状态

| 状态 | 边框 | 背景 | 缩略图 | 文字 | 连线 |
|---|---|---|---|---|---|
| **Winner（已选）** | `#a6e3a1` 绿色实线 2px | 正常 `#1e1e2e` | 正常 | 正常 `#cdd6f4` | 实线 |
| **Loser（未选）** | `#585b70` 灰色虚线 1px | 半透明 `opacity: 0.4` | 灰度滤镜 `grayscale(100%)` | `#585b70` 灰色 | 虚线低透明度 |
| **Awaiting Audit** | `#f9e2af` 黄色闪烁动画 | 正常 | 正常 | 正常 | 实线黄色 |
| **Approved** | `#a6e3a1` 绿色 + 勾号徽章 | 正常 | 正常 | 正常 | 实线 |
| **Rejected** | `#f38ba8` 红色 + 叉号徽章 | 半透明 `opacity: 0.5` | 灰度 | `#f38ba8` | 虚线红色 |

在 `AssetNode.tsx`、`StoryboardNode.tsx`、`VideoNode.tsx` 的 `border` 样式中，将现有的 `stateColors[data.state]` 替换为优先级逻辑：

```typescript
function getNodeBorderStyle(data: NodeData): React.CSSProperties {
  if (data.isWinner === false) return { border: '1px dashed #585b70', opacity: 0.4 }
  if (data.reviewStatus === 'rejected') return { border: '2px solid #f38ba8', opacity: 0.5 }
  if (data.reviewStatus === 'awaiting_audit') return { border: '2px solid #f9e2af' }
  if (data.reviewStatus === 'approved') return { border: '2px solid #a6e3a1' }
  return { border: `2px solid ${stateColors[data.state]}` }
}
```

### 3.2 AI 评分标注展示

**5维评分在节点上的展示方案**：

**方案 A：综合分徽章（MVP）**
- 节点右上角显示综合分数字徽章
- 颜色编码：>=0.8 绿色，0.5-0.8 黄色，<0.5 红色
- 组件：`<ScoreBadge score={0.85} />`

```tsx
function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null
  const color = score >= 0.8 ? '#a6e3a1' : score >= 0.5 ? '#f9e2af' : '#f38ba8'
  return (
    <span style={{
      position: 'absolute', top: -8, right: -8,
      background: color, color: '#1e1e2e',
      borderRadius: '50%', width: 28, height: 28,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 700, border: '2px solid #1e1e2e',
    }}>
      {Math.round(score * 100)}
    </span>
  )
}
```

**方案 B：进度条（推荐）**
- 节点底部显示5个微型进度条（每维一个）
- 高度 3px，水平排列，颜色按维度区分
- 占用空间小，信息密度高

**方案 C：雷达图（完整版）**
- 在 `NodeDetailPanel` 中展开显示完整雷达图
- 使用 SVG 绘制，Catppuccin 配色
- 节点上只显示综合分徽章

**推荐**：Phase 1 用方案 A（徽章），Phase 2 加方案 B（进度条），Phase 3 加方案 C（雷达图）。

### 3.3 审核操作流程

在画布上的审核操作路径：

**单节点审核（右键菜单扩展）**：
1. 右键节点 → `CanvasContextMenu` 弹出
2. 新增菜单项：「审核通过 ✅」「驳回 ❌」「查看评分 📊」
3. 点击「审核通过」→ 调用 `POST /api/canvas/review/approve`
4. 驳回需要弹出原因输入（内联小表单，不用 Modal）

**变体组审核（选择优胜者）**：
1. 变体组内的节点有「选择此方案」按钮（hover 时显示）
2. 点击 → 确认 → 标记为 winner，其余节点自动变灰
3. 对应调用 `POST /api/canvas/review/select-winner`

**批量审核**：
1. Shift+点击多选同一 variantGroup 的节点
2. 工具栏出现「批量通过」「批量驳回」按钮
3. 调用 `POST /api/canvas/review/batch-approve`

### 3.4 路径折叠动画

未选中路径的折叠/展开交互：

**折叠模式**：
- 未选中的变体节点缩小为 60x40 的灰色小方块
- 显示综合分数字和序号（A/B/C）
- 单击展开回正常大小，带 `transition: all 0.3s ease`
- 折叠时连线变为虚线，`strokeDasharray: "5 5"`

**展开/折叠切换**：
- 变体组上方显示折叠/展开按钮
- 或在 `variantGroup` 的标题区有 toggle

**React Flow 动画**：
- 节点尺寸变化：通过 CSS `transition` + React Flow 的 `width`/`height` 自动处理
- 连线样式变化：`CanvasEdge` 组件根据 `isInactive` 属性切换 `strokeDasharray`
- 位置动画：修改 `position` 后 React Flow 自动插值

```tsx
// CanvasEdge.tsx 扩展
function CanvasEdgeComponent(props: EdgeProps) {
  const data = props.data as { dataType?: string; isInactive?: boolean } | undefined
  const isInactive = data?.isInactive ?? false

  return (
    <BaseEdge
      id={props.id}
      path={edgePath}
      style={{
        stroke: isInactive ? '#45475a' : color,
        strokeWidth: isInactive ? 1 : 2,
        strokeDasharray: isInactive ? '5 5' : 'none',
        opacity: isInactive ? 0.4 : 1,
        transition: 'all 0.3s ease',
      }}
    />
  )
}
```

---

## 4. 后端集成方案

### 4.1 convert API 扩展

现有 `convert.ts` 将数据库数据转为 `FlowGraph`。需要扩展以加载审核状态和变体信息。

**改动点在 `src/routes/canvas/convert.ts`**：

```typescript
// 在构建节点数据时，查询审核状态
// 新增步骤：从 o_agentWorkData 加载 shotCard 映射

// 伪代码 — 在构建 storyboard 节点循环中
for (const sb of storyboardData) {
  // ... 现有逻辑 ...

  // 新增：查询关联的 ShotCard 审核状态
  const shotCardMapping = await u.db("o_shotcard_mapping")
    .where("storyboardId", sb.id)
    .where("projectId", projectId)
    .first()

  if (shotCardMapping) {
    node.data.reviewStatus = shotCardMapping.auditStatus
    node.data.shotCardId = shotCardMapping.shotCardId
    node.data.aiScore = shotCardMapping.aiScore
      ? JSON.parse(shotCardMapping.aiScore)
      : null
    node.data.variantGroupId = shotCardMapping.variantGroupId
    node.data.variantIndex = shotCardMapping.variantIndex
    node.data.isWinner = shotCardMapping.isWinner
  }
}
```

### 4.2 新增 API 端点

在 `src/routes/canvas/` 下新增 `review.ts`：

```
POST /api/canvas/review/approve          — 审核通过单个节点
POST /api/canvas/review/reject           — 驳回单个节点
POST /api/canvas/review/select-winner    — 在变体组中选择优胜者
POST /api/canvas/review/batch-approve    — 批量通过
POST /api/canvas/review/score            — 查询/刷新节点评分
POST /api/canvas/review/create-variants  — 为节点创建候选变体
```

**具体接口定义**：

```typescript
// POST /api/canvas/review/approve
{
  projectId: number
  episodesId: number
  nodeId: string            // 如 "storyboard-5"
  comment?: string
}

// POST /api/canvas/review/reject
{
  projectId: number
  episodesId: number
  nodeId: string
  reason: string            // 必填，max 500 字符
}

// POST /api/canvas/review/select-winner
{
  projectId: number
  episodesId: number
  variantGroupId: string    // 如 "vg-storyboard-5"
  winnerNodeId: string      // 被选中的节点 ID
}

// POST /api/canvas/review/score
{
  projectId: number
  episodesId: number
  nodeIds: string[]         // 需要评分的节点 ID 列表
}

// POST /api/canvas/review/create-variants
{
  projectId: number
  episodesId: number
  sourceNodeId: string      // 源节点
  count: number             // 生成几个变体
  method: 'regenerate' | 'param-tweak' | 'model-switch'
}
```

### 4.3 与 kais-review-platform 的通信方式

**推荐方案：HTTP API 调用（松耦合）**

两个平台独立部署，通过 HTTP API 通信：

```
kais-aigc-platform (Node.js)  ──HTTP──>  kais-review-platform (FastAPI)
                                POST /api/v1/shot-cards/{id}/approve
                                POST /api/v1/shot-cards/{id}/reject
                                GET  /api/v1/shot-cards/by-shot/{shot_id}
```

**通信流程**：

1. **画布审核操作** → aigc-platform 的 `/api/canvas/review/approve` → 内部调用 review-platform 的 `POST /api/v1/shot-cards/{id}/approve`
2. **评分查询** → aigc-platform → review-platform 的 `GET /api/v1/shot-cards/{id}` → 返回 `narrative_context.ai_score_dimensions`
3. **状态同步** → review-platform 状态变更 → webhook 回调 → aigc-platform 更新画布节点

**备选方案**：
- **共享数据库**：两个平台直连同一个 PostgreSQL（review-platform 当前用 SQLite，但 CLAUDE.md 提到未来可迁 PostgreSQL）
- **消息队列**：通过 Redis pub/sub（review-platform 已用 Redis）实时推送审核状态变更

**推荐 Phase 1 用 HTTP API，Phase 3 考虑 WebSocket/Webhook 实时同步。**

### 4.4 数据存储层

审核映射关系存储在 aigc-platform 的 `o_agentWorkData` 表中（与画布图同存储位置）：

```
key: "reviewMapping-{episodesId}"
data: {
  "storyboard-5": {
    shotCardId: 42,
    reviewStatus: "awaiting_audit",
    variantGroupId: "vg-sb-5",
    variantIndex: 0,
    isWinner: null,
    aiScore: { aesthetics: 0.85, consistency: 0.72, ... }
  },
  "storyboard-5-alt-B": {
    shotCardId: 43,
    reviewStatus: "awaiting_audit",
    variantGroupId: "vg-sb-5",
    variantIndex: 1,
    isWinner: null,
    aiScore: { aesthetics: 0.78, consistency: 0.81, ... }
  }
}
```

这种方式的优点：
- 不修改现有数据库 schema
- 与画布图一起保存/加载
- 可以在 `save.ts` 中一起持久化

---

## 5. 技术可行性评估

### 5.1 功能点难度矩阵

| 功能 | 难度 | 工作量 | 关键依赖 |
|---|---|---|---|
| **节点扩展字段（ReviewMeta）** | 简单 | 2h | 无 — 利用已有 `[key: string]: unknown` |
| **审核状态边框样式** | 简单 | 3h | 修改 AssetNode/StoryboardNode/VideoNode 的 border 逻辑 |
| **综合分徽章组件** | 简单 | 3h | 需要设计 SVG 圆形徽章 |
| **变体组数据模型** | 中等 | 4h | 新增 `VariantGroup` 类型，扩展 `FlowGraph` |
| **convert.ts 加载审核状态** | 中等 | 4h | 需要建立 storyboardId ↔ shotCardId 映射 |
| **优胜者选择（变灰/折叠）** | 中等 | 6h | React Flow 节点样式 + CSS transition |
| **连线虚线/低透明度** | 简单 | 2h | 修改 `CanvasEdge.tsx` 的 style |
| **右键菜单审核操作** | 中等 | 4h | 扩展 `CanvasContextMenu` |
| **HTTP API 代理层** | 中等 | 6h | review-platform 需要运行，跨域配置 |
| **5维评分进度条** | 中等 | 4h | 节点底部空间有限，需精简设计 |
| **雷达图（DetailPanel）** | 中等 | 6h | SVG 绘制或引入轻量库 |
| **路径折叠动画** | 复杂 | 8h | 需要处理 React Flow 的节点位置插值 |
| **实时状态同步** | 复杂 | 8h | WebSocket + 后端 webhook 接收 |
| **批量审核** | 中等 | 4h | 复用已有批量逻辑 |

### 5.2 关键风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| **review-platform 未运行** | 审核操作无法执行 | Phase 1 先做 mock 数据，review-platform 可选依赖 |
| **跨平台认证** | API 调用需要 JWT token | 画布后端代理请求，用户无感 |
| **节点布局拥挤** | 多变体并排显示空间不足 | 折叠模式 + 自动布局算法 |
| **FlowGraph 向后兼容** | 新增字段影响旧画布加载 | 所有新字段 optional，旧数据自动填充 null |
| **评分维度不完整** | Phase 0 的 NullScoringPlugin 全返回 None | 前端优雅降级：无评分时不显示徽章 |

### 5.3 依赖关系图

```
Phase 1 (MVP)
├── 节点扩展字段 ← 无依赖
├── 审核状态样式 ← 依赖节点字段
├── 综合分徽章   ← 依赖节点字段
└── 右键审核菜单 ← 依赖后端 API

Phase 2 (评分可视化)
├── 5维进度条    ← 依赖 Phase 1
├── 雷达图       ← 依赖 Phase 1
└── 评分 API     ← 依赖 review-platform

Phase 3 (完整审核)
├── 变体组模型   ← 依赖 Phase 1
├── 优胜者选择   ← 依赖变体组
├── 路径折叠     ← 依赖优胜者选择
├── 实时同步     ← 依赖 review-platform webhook
└── 批量审核     ← 依赖优胜者选择
```

---

## 6. 实施路线图

### Phase 1：MVP（1-2天）

**目标**：在画布上看到审核状态和综合评分，能做基础审核操作。

**改动清单**：

1. **类型定义** — `canvas.ts`
   - 新增 `ReviewStatus`、`RoutingDecision`、`AIScore` 类型
   - 各 NodeData 接口新增可选审核字段

2. **节点样式** — `AssetNode.tsx`、`StoryboardNode.tsx`、`VideoNode.tsx`
   - 新增 `getNodeBorderStyle()` 函数
   - 替换现有 `border: 2px solid ${stateColors[data.state]}` 逻辑
   - 新增 `<ScoreBadge>` 组件

3. **连线样式** — `CanvasEdge.tsx`
   - 读取 `isInactive` 属性
   - 虚线 + 低透明度渲染

4. **右键菜单** — `CanvasContextMenu.tsx`
   - 新增「通过」「驳回」菜单项
   - 驳回弹出 inline 原因输入

5. **后端 API** — 新增 `src/routes/canvas/review.ts`
   - `POST /approve` 和 `POST /reject`
   - Phase 1 先操作本地 `o_agentWorkData` 中的审核状态
   - 预留 review-platform HTTP 调用接口

6. **前端 API** — `canvasApi.ts`
   - 新增 `approveNode()`、`rejectNode()` 函数

7. **数据注入** — `convert.ts`
   - 从 `o_agentWorkData` 读取 `reviewMapping` 注入节点 data

**验收标准**：
- 画布加载时节点边框颜色反映审核状态
- 右键节点可审核通过/驳回
- 综合分徽章显示在节点右上角

### Phase 2：评分可视化（2-3天）

**目标**：5维评分在节点和详情面板中完整展示。

**改动清单**：

1. **评分进度条** — 节点组件内新增
   - 5个微型水平进度条（3px 高）
   - 颜色映射：aesthetics=#89b4fa, consistency=#a6e3a1, compliance=#f9e2af, technicalQuality=#cba6f7, audioMatch=#94e2d5

2. **雷达图** — `NodeDetailPanel.tsx`
   - 新增 `<ScoreRadar>` SVG 组件
   - 5个维度轴，填充半透明颜色
   - 在审核状态下显示：Awaiting Audit / Approved / Rejected
   - 显示驳回原因（如有）

3. **评分查询 API** — `review.ts`
   - `POST /score`：从 review-platform 获取最新评分
   - 或从本地缓存返回

4. **评分刷新** — 节点右键菜单
   - 「刷新评分」选项
   - 调用后端 → review-platform ScoringBus → 返回 ScoreVector

**验收标准**：
- 节点底部显示5维进度条
- 点击节点在右侧面板看到雷达图
- 无评分数据时优雅降级（不显示进度条和雷达图）

### Phase 3：完整审核流程（3-5天）

**目标**：端到端审核在画布上完成，包括多变体对比和路径选择。

**改动清单**：

1. **变体组模型** — `canvas.ts`
   - 新增 `VariantGroup` 接口
   - `FlowGraph` 新增 `variantGroups` 字段

2. **变体生成 API** — `review.ts`
   - `POST /create-variants`：为指定节点生成 N 个候选
   - 复制节点数据，生成新的 thumbnailUrl
   - 自动布局到源节点旁边

3. **优胜者选择** — 前端交互
   - 节点 hover 显示「选为优胜」按钮
   - 点击后：`isWinner=true`，同组其他节点 `isWinner=false`
   - 调用 `POST /select-winner` API

4. **路径折叠** — 前端动画
   - 未选中节点缩小为 mini 模式
   - CSS transition 动画
   - 折叠/展开 toggle

5. **实时同步** — WebSocket 扩展
   - review-platform 审核 → webhook → aigc-platform → WebSocket 推送到画布
   - 已有 `useCanvasSocket` hook，新增 `onReviewStatusChange` 事件处理

6. **批量审核** — 工具栏
   - 多选节点后批量通过/驳回
   - 复用 review-platform 的 batch API 模式

**验收标准**：
- 能为分镜节点生成多个候选变体
- 变体并排展示，可选择优胜者
- 未选路径自动变灰折叠
- 审核状态实时同步到画布
- 批量审核功能正常

---

## 附录 A：现有代码改动点汇总

| 文件路径 | 改动类型 | Phase |
|---|---|---|
| `packages/infinite-canvas/src/types/canvas.ts` | 新增类型 | 1 |
| `packages/infinite-canvas/src/components/nodes/AssetNode.tsx` | 样式逻辑 | 1 |
| `packages/infinite-canvas/src/components/nodes/StoryboardNode.tsx` | 样式逻辑 | 1 |
| `packages/infinite-canvas/src/components/nodes/VideoNode.tsx` | 新建（如已有则修改） | 1 |
| `packages/infinite-canvas/src/components/edges/CanvasEdge.tsx` | 虚线逻辑 | 1 |
| `packages/infinite-canvas/src/components/CanvasContextMenu.tsx` | 菜单项 | 1 |
| `packages/infinite-canvas/src/components/NodeDetailPanel.tsx` | 评分详情 | 2 |
| `packages/infinite-canvas/src/services/canvasApi.ts` | API 函数 | 1 |
| `packages/infinite-canvas/src/utils/styles.ts` | 新增颜色映射 | 1 |
| `packages/infinite-canvas/src/utils/flowDataMapper.ts` | 序列化扩展 | 1 |
| `src/routes/canvas/review.ts` | 新建 | 1 |
| `src/routes/canvas/convert.ts` | 审核数据注入 | 1 |
| `src/routes/canvas/save.ts` | 保存审核映射 | 1 |
| `src/routes/canvas/load.ts` | 加载审核映射 | 1 |

## 附录 B：kais-review-platform API 依赖

| 端点 | 用途 | Phase |
|---|---|---|
| `POST /api/v1/shot-cards/{id}/approve` | 审核通过 | 1 |
| `POST /api/v1/shot-cards/{id}/reject` | 驳回 | 1 |
| `GET /api/v1/shot-cards/by-shot/{shot_id}` | 按自然键查询 | 1 |
| `GET /api/v1/shot-cards/{id}` | 查询审核状态和评分 | 2 |
| `POST /api/v1/shot-cards/events/node-completed` | 触发重新评分 | 2 |
| `GET /api/v1/shot-cards/?project_id=&audit_status=` | 批量查询 | 3 |

## 附录 C：颜色方案（Catppuccin Mocha 扩展）

| 语义 | 色值 | 用途 |
|---|---|---|
| Winner 边框 | `#a6e3a1` (Green) | 被选中的优胜节点 |
| Loser 边框 | `#585b70` (Overlay0) | 未选中的候选节点 |
| Awaiting Audit | `#f9e2af` (Yellow) | 等待审核 |
| Approved | `#a6e3a1` (Green) | 审核通过 |
| Rejected | `#f38ba8` (Red) | 驳回 |
| 评分高 | `#a6e3a1` (Green) | >=0.8 |
| 评分中 | `#f9e2af` (Yellow) | 0.5-0.8 |
| 评分低 | `#f38ba8` (Red) | <0.5 |
| 非活跃连线 | `#45475a` (Surface1) | 虚线低透明度 |
| 审核通过勾号 | `#a6e3a1` | ✅ 徽章 |
| 驳回叉号 | `#f38ba8` | ❌ 徽章 |
| 综合分徽章背景 | 同评分色 | 圆形 28px |
