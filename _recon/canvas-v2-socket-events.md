# Canvas v2 Socket.IO 事件契约

> **目标读者**: 外部编排器（OpenClaw / hermes-agent / 任何 WS 客户端）的实现者
> **目的**: 列出所有 socket 事件、payload schema、触发时机，避免客户端试错
> **版本**: 与 Phase 41 event-sourced canvas 同步

---

## 1. 连接

**Namespace**: `/ws/projects`

**握手 query**: `projectId=<id>` —— 连接时携带，服务端会自动 `socket.join(`project:${projectId}`)`，之后该 project 的所有事件都会推到这个 socket。

```js
import { io } from 'socket.io-client';
const sock = io('http://192.168.71.176:10588/ws/projects', {
  query: { projectId: 123 },
});
```

**重连补发**: 服务端实现了 Phase 41 SYNC-07 resumable replay。客户端重连时发 `subscribe` 事件携带 `since=<lastEventId>`，服务端从 event store 补发所有 `eventId > since` 的事件，最多 500 条；超过则发 `canvas:reset` 让客户端走全量 `load-v2`。

---

## 2. 客户端 → 服务端

### `subscribe`

加入 project room 并触发增量重放。

```ts
{
  projectId?: number;   // 可选，默认用握手 query 中的 projectId
  episodesId?: number;  // 必填（用于 event store 过滤）
  since?: number;       // 可选，lastEventId — 触发 replay
}
```

---

## 3. 服务端 → 客户端

### 3.1 事件流（推荐客户端主用此通道）

#### `canvas:event`

Phase 41 引入的**统一事件广播**。任何走 `appendAndSync` 的写入（events API、nodes、branches、review 等的 legacy 路径）都会触发。

```ts
{
  eventId: number;       // 单调递增，客户端应记住 max(eventId) 作为下次 since
  type: CanvasEventType; // 见下表
  nodeId?: string;
  payload: unknown;      // 与 type 对应
  projectId: number;
  episodesId: number;
  createdAt: number;     // 毫秒时间戳
}
```

`type` 枚举:

| type | nodeId | payload |
|---|---|---|
| `node_upsert` | 必填 | `FlowNodeV2` 字段子集（不含 id） |
| `node_delete` | 必填 | `{}` |
| `link_upsert` | 必填 | `FlowLinkV2` 字段子集 |
| `link_delete` | 必填 | `{}` |
| `branch_upsert` | 必填 | `FlowBranchV2` 字段子集 |
| `branch_delete` | 必填 | `{}` |
| `variant_group_upsert` | 可选 | variant group 定义 |
| `review_status` | 必填 | `{ reviewStatus, isWinner?, rejectReason? }` |
| `bootstrap` | — | `{ graph: FlowGraphV2 }`（v1→v2 迁移时一次性发） |

**Source**: `src/routes/canvas/v2/events.ts` + `src/socket/index.ts:42`

#### `canvas:reset`

服务端判定客户端落后太多（>500 事件），要求走全量重载。

```ts
{ lastEventId: number }
```

客户端收到后应: 调 `POST /api/canvas/v2/load-v2` 拉全量 → 用返回的 `lastEventId` 作为下次 `since`。

**Source**: `src/socket/index.ts:54`

---

### 3.2 审核事件（业务语义）

#### `review:approved`

节点通过审核（也可标记 winnerId）。

```ts
{
  nodeId: string;
  winnerId?: string;  // 若审核的是变体组，标记的胜者节点 id
  timestamp: number;
}
```

**触发**: `POST /api/canvas/review/approve`
**Source**: `src/routes/canvas/review/approve.ts:79`

#### `review:rejected`

节点被驳回。

```ts
{
  nodeId: string;
  reason: string;     // 驳回原因（同步写入 node.rejectReason / suggestion）
  timestamp: number;
}
```

**触发**: `POST /api/canvas/review/reject`
**Source**: `src/routes/canvas/review/reject.ts:73`

---

### 3.3 节点事件（CRUD 通知）

#### `node:created`

```ts
{ node: FlowNodeV2 }
```

**触发**: `POST /api/canvas/v2/nodes` 或 `PATCH /api/canvas/v2/nodes/batch` 中的新增。
**Source**: `src/routes/canvas/v2/nodes.ts:84,140`

#### `node:updated`

```ts
{ node: FlowNodeV2 }   // 合并后的完整节点（不是 diff）
```

**触发**: `PATCH /api/canvas/v2/nodes/:nodeId` 或 batch 中的更新。
**Source**: `src/routes/canvas/v2/nodes.ts:143,193`

#### `node:deleted`

```ts
{
  nodeId: string;
  removedLinkIds: string[];   // 因节点删除而被清理的连线
}
```

**触发**: `DELETE /api/canvas/v2/nodes/:nodeId`
**Source**: `src/routes/canvas/v2/nodes.ts:240`

#### `node:state`

节点执行状态变化（管线运行时高频触发）。

```ts
{
  nodeId: string;
  state: "idle" | "running" | "pending" | "success" | "error" | "skipped" | "scored";
  progress?: number;     // 0..1，仅 running 时通常有
  aiScore?: number;      // 仅 scored 时
}
```

**触发源**:
- `POST /api/canvas/execute` (running → success/error)
- `POST /api/canvas/review/score` (scored)
- `POST /api/canvas/orchestrate` (orchestrate 过程中的状态推进)
- `POST /api/canvas/convert` (批量评分)
- `POST /api/canvas/storyboardPreview` (idle 状态恢复)

**Source**: 多处，主要在 `src/routes/canvas/execute.ts`、`orchestrate.ts`、`review/score.ts`、`convert.ts`

#### `node:preview`

预览图（来自 storyboard preview engine 或 simulate engine）。

```ts
{ nodeId: string; imageUrl: string; /* 其他 engine 特定字段 */ }
```

**Source**: `src/routes/canvas/storyboardPreview.ts`、`_simulate.ts`

---

### 3.4 分支事件

#### `branch:created`

```ts
{ branch: FlowBranchV2 }
```

**Source**: `src/routes/canvas/v2/branches.ts:71`

#### `branch:updated`

```ts
{ branch: FlowBranchV2 }   // 合并后完整对象
```

**Source**: `src/routes/canvas/v2/branches.ts:120`

#### `branch:deleted`

```ts
{
  branchId: string;
  removedNodeIds: string[];
  removedLinkIds: string[];
}
```

**Source**: `src/routes/canvas/v2/branches.ts:176`

---

### 3.5 编排事件（pipeline 顶层流程）

| 事件 | Payload | 触发 |
|---|---|---|
| `orchestrate:start` | `{ runId, total, mode }` | `POST /api/canvas/orchestrate` |
| `orchestrate:progress` | `{ runId, index, nodeId, ... }` | 同上，循环中 |
| `orchestrate:done` | `{ runId, ... }` | 同上，结束 |
| `execution:progress` | `{ ... }` | `_simulate.ts` 中的执行推进 |

**Source**: `src/routes/canvas/orchestrate.ts`、`_simulate.ts`

---

## 4. 客户端实现建议（hermes-agent 视角）

1. **优先用 `canvas:event` 单通道**：Phase 41 之后所有写入都会产生 `canvas:event`，比订阅多个 `node:*`/`branch:*`/`review:*` 更省心。后者的存在主要是为了兼容旧前端。
2. **持久化 `lastEventId`**：每收到一个事件就 `lastEventId = max(lastEventId, ev.eventId)`；重连时发 `subscribe({ since: lastEventId })`。
3. **收到 `canvas:reset` 必须全量重载**：不要忽略，否则会漏数据。
4. **审核决策不要只靠事件**：`review:approved` 触发后建议再 `GET` 一次节点详情确认 `reviewStatus`/`isWinner` 已落库，避免 race。

---

## 5. 验证 / 探活

调 `GET /api/canvas/v2/health` 验证：服务在线 + DB 连通 + projectId 配置匹配 + 事件流活跃度。详见路由 `src/routes/canvas/v2/health.ts`。
