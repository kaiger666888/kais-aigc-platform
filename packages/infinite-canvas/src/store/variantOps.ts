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
