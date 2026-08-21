import type { Edge, Node } from '@xyflow/react'
import type {
  VariantGroup,
  VariantGroupId,
  VariantMemberStatus,
  NodeId,
} from '../types/canvas'
import { asNodeId, deriveVariantMemberStatus } from '../types/canvas'

// ─── 选择器 (纯函数,可单测) ─────────────────────────────────

/** 查找节点所属的变体组 — 不存在时返回 null */
export function findVariantGroupForNode(
  groups: VariantGroup[],
  nodeId: string,
): VariantGroup | null {
  const id = asNodeId(nodeId)
  for (const g of groups) {
    if (g.winnerNodeId === id) return g
    if (g.variantNodeIds.includes(id)) return g
    if (g.parentNodeId === id) return g
  }
  return null
}

/** 取出某组的所有成员节点 (按 variantNodeIds 顺序) */
export function getVariantMemberNodes(
  nodes: Node[],
  group: VariantGroup,
): Node[] {
  const idSet = new Set<string>(group.variantNodeIds)
  if (group.winnerNodeId) idSet.add(group.winnerNodeId)
  return nodes.filter((n) => idSet.has(n.id))
}

/** 计算节点在变体组中的成员状态 — 不属于任何组时返回 null */
export function getVariantMemberStatus(
  node: Node,
  group: VariantGroup | null,
): VariantMemberStatus | null {
  if (!group) return null
  const isWinner = Boolean(node.data?.isWinner)
  return deriveVariantMemberStatus(isWinner, !!group.winnerNodeId)
}

// ─── 审片流水线纯函数 (Phase 53-05,零 React/IO) ─────────────────

/** 审片排序所需的最小组结构(V3 VariantGroupV3 与 RF VariantGroup 均满足)。 */
interface ReviewGroupLike {
  id: string
  winnerNodeId?: string | null
}

/**
 * groupKey → frameSlot 推导(D-11 前端半部)。
 * 输入为组 id 或 groupKey(均接受,`cand:` 机器前缀自动剥离):
 * `shot:{sid}:first` → 'first';`:last` → 'last';其余(name: 组/G14 组)
 * → undefined。frameSlot 只从组键后缀推导,不信任 UI 自由输入
 * (T-53-05-01:端点 zod enum 是第二道闸)。
 */
export function frameSlotOfGroup(groupKeyOrId: string): 'first' | 'last' | undefined {
  const key = groupKeyOrId.startsWith('cand:') ? groupKeyOrId.slice('cand:'.length) : groupKeyOrId
  if (key.endsWith(':first')) return 'first'
  if (key.endsWith(':last')) return 'last'
  return undefined
}

/** shot 域排序键:shot 组 (sid 自然序, first<last) 排前,name/其余组排后。 */
function reviewRank(key: string): [number, string, number] {
  const m = /^shot:([A-Za-z0-9_-]+):(first|last)$/.exec(key)
  if (m) return [0, m[1], m[2] === 'first' ? 0 : 1]
  return [1, key, 0]
}

function keyOfGroup(id: string): string {
  return id.startsWith('cand:') ? id.slice('cand:'.length) : id
}

function orderedReviewGroups<T extends ReviewGroupLike>(
  groups: T[],
  includeSelected: boolean,
): T[] {
  return [...groups]
    .filter((g) => includeSelected || !g.winnerNodeId)
    .sort((a, b) => {
      const [ta, ka, sa] = reviewRank(keyOfGroup(a.id))
      const [tb, kb, sb] = reviewRank(keyOfGroup(b.id))
      if (ta !== tb) return ta - tb
      // localeCompare 自然序: shot_002 < shot_010 (D-18)
      const c = ka.localeCompare(kb, undefined, { numeric: true })
      if (c !== 0) return c
      return sa - sb
    })
}

/**
 * 下一待审组(D-17 墙内下一镜 / D-18 shot 序 + 跳已选)。
 * includeSelected 缺省 false 跳过已选定组;true 全列(手动「下一镜」可越)。
 * 返回 currentGroupId 之后的第一个组;到头 null(审完态,不回绕——审片是
 * 线性流,planner 裁定)。当前组被过滤时从头找第一个。
 */
export function nextReviewGroup<T extends ReviewGroupLike>(
  graph: { variantGroups: T[] } | null,
  currentGroupId: string,
  opts?: { includeSelected?: boolean },
): T | null {
  if (!graph) return null
  const sorted = orderedReviewGroups(graph.variantGroups, opts?.includeSelected ?? false)
  const idx = sorted.findIndex((g) => g.id === currentGroupId)
  if (idx < 0) return sorted.length > 0 ? sorted[0] : null
  return idx + 1 < sorted.length ? sorted[idx + 1] : null
}

/** 排序序列中的前一个组(←/→ 键盘对称;恒 includeSelected——回看不设限)。 */
export function prevReviewGroup<T extends ReviewGroupLike>(
  graph: { variantGroups: T[] } | null,
  currentGroupId: string,
): T | null {
  if (!graph) return null
  const all = orderedReviewGroups(graph.variantGroups, true)
  const idx = all.findIndex((g) => g.id === currentGroupId)
  if (idx <= 0) return null
  return all[idx - 1]
}

// ─── 状态变换 (返回新数组,不修改入参) ─────────────────────

/** selectWinner 的纯函数变换 — 同时更新 nodes 和 edges。
 *
 *  - 目标节点: isWinner=true, reviewStatus='approved'
 *  - 同组其他节点: isWinner=false (reviewStatus 保持)
 *  - 指向非优胜节点的边: isInactive=true (优胜边恢复)
 *
 *  返回的 outcome 也带上 prevSnapshot 以便调用方在 API 失败时回滚。
 */
export interface WinnerUpdateOutcome {
  nextNodes: Node[]
  nextEdges: Edge[]
  prevSnapshot: {
    nodes: Node[]
    edges: Edge[]
    winnerNodeId?: NodeId
  }
}

export function applyWinnerSelection(args: {
  nodes: Node[]
  edges: Edge[]
  variantGroupId: VariantGroupId
  winnerNodeId: string
}): WinnerUpdateOutcome {
  const { nodes, edges, variantGroupId, winnerNodeId } = args

  // 先找出本组成员 ID 集,只对本组节点做变换,避免误伤其它组的同名节点。
  const memberIds = new Set<string>()
  for (const n of nodes) {
    if ((n.data?.variantGroupId as string) === variantGroupId) {
      memberIds.add(n.id)
    }
  }
  if (memberIds.size === 0) {
    // 没找到任何成员 — 返回原状
    return {
      nextNodes: nodes,
      nextEdges: edges,
      prevSnapshot: { nodes, edges },
    }
  }

  const nextNodes: Node[] = nodes.map((n) => {
    if (!memberIds.has(n.id)) return n
    if (n.id === winnerNodeId) {
      return {
        ...n,
        data: { ...n.data, isWinner: true, reviewStatus: 'approved' },
      }
    }
    return {
      ...n,
      data: {
        ...n.data,
        isWinner: false,
        // 落选的边视觉上变灰,但 reviewStatus 不强制改 — 让审核流自洽。
      },
    }
  })

  // 边:指向同组非优胜节点的边 → isInactive=true;指向优胜的 → false。
  const nextEdges: Edge[] = edges.map((e) => {
    if (!memberIds.has(e.target)) return e
    const shouldInactive = e.target !== winnerNodeId
    return {
      ...e,
      data: {
        ...e.data,
        isInactive: shouldInactive,
      },
    }
  })

  // 旧 winner (若有) — 用于回滚
  const prevWinner = nodes.find(
    (n) =>
      memberIds.has(n.id) &&
      n.id !== winnerNodeId &&
      n.data?.isWinner === true,
  )

  return {
    nextNodes,
    nextEdges,
    prevSnapshot: {
      nodes,
      edges,
      ...(prevWinner ? { winnerNodeId: asNodeId(prevWinner.id) } : {}),
    },
  }
}

/** 把 applyWinnerSelection 的结果回滚回 prevSnapshot */
export function rollbackWinnerSelection(outcome: WinnerUpdateOutcome): {
  nodes: Node[]
  edges: Edge[]
} {
  return {
    nodes: outcome.prevSnapshot.nodes,
    edges: outcome.prevSnapshot.edges,
  }
}

// ─── VariantGroup 数组维护 (持久化层使用) ──────────────────

/** 把 winner 选择同步写入 VariantGroup[] 的 winnerNodeId 字段 */
export function syncWinnerToGroups(
  groups: VariantGroup[],
  variantGroupId: VariantGroupId,
  winnerNodeId: string,
): VariantGroup[] {
  return groups.map((g) =>
    g.groupId === variantGroupId
      ? { ...g, winnerNodeId: asNodeId(winnerNodeId) }
      : g,
  )
}
