/**
 * src/hooks/useTraceHighlight.ts — P18 溯源高亮（设计 §5 / 宪法 P18）。
 *
 * 选中一个资产节点 → 沿因果边求「祖先链（向后全闭包）+ 后代链（向前全闭包）」，
 * 即该节点所在整条血脉线（一条链），其余节点压暗 0.28 + desaturate。
 * sequence 邻居不算祖先（P11：排序非因果）；isInactive 边（非优胜变体下游）不参与溯源（P12×P18）。
 *
 * 【修订 1】下游原为「向前一跳」，点链中根/中段节点时只高亮 2 个节点（「仅仅两个之间」）；
 * 现改为向前全闭包，使点链上任一节点都点亮整条链（祖先 + 后代）。
 *
 * 【修订 2】原先在 graph.links（canonical）上求闭包，但画布实际渲染的拓扑里还有
 * useLayout.deriveShotLevelEdges 在视图期补的「镜头级」边（storyboard↔video 的 shot_link、
 * character→storyboard 的 reference）——这些不在 graph.links，导致点视频时只亮剧本链，
 * 看得见的分镜/角色连线不被遍历。现改为在**渲染边集**（adapter 折叠边 + 派生边）上求闭包，
 * 与用户实际看到的拓扑一致。
 *
 * 实现为纯函数 computeTraceHighlight（可单测，接边列表）+ 订阅 store 的 hook useTraceHighlight。
 * FlowCanvas 据返回的集合把 data.traceState（节点）/ data.highlighted（边）盖到派生模型上
 * （AssetCardNode / CanvasEdge 已读这俩字段，无需改 B）。
 */
import { useMemo } from 'react'
import type { Edge } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'

export interface TraceResult {
  active: boolean
  /** 应提亮的节点 id（自身 + 祖先 + 后代）。 */
  highlightedIds: Set<string>
  /** 应提亮的边 id（两端均在 highlightedIds 内的因果边）。 */
  highlightedEdges: Set<string>
}

/** 溯源消费的边归一形态（从 RF edge.data 抽出 role/isInactive）。 */
export interface TraceEdge {
  id: string
  source: string
  target: string
  role?: string
  isInactive?: boolean
}

const EMPTY: TraceResult = { active: false, highlightedIds: new Set(), highlightedEdges: new Set() }

/** sequence 边（排序约束，非因果）不参与溯源。 */
function isCausal(e: TraceEdge): boolean {
  return e.role !== 'sequence' && e.isInactive !== true
}

/**
 * 纯函数：给定渲染边集 + 节点 id 集 + 选中 id，求溯源集合。
 *  - 因果边定义：role !== 'sequence' 且 isInactive !== true。
 *  - 祖先：沿「谁指向我」反向 BFS 全闭包。
 *  - 后代：沿「我指向谁」正向 BFS 全闭包（点链中任一节点都点亮整条链）。
 */
export function computeTraceHighlight(
  edges: TraceEdge[],
  nodeIds: Set<string>,
  selectedId: string | null,
): TraceResult {
  if (!selectedId || !nodeIds.has(selectedId)) return EMPTY

  const causal = edges.filter(isCausal)

  // 反向邻接（target → sources）求祖先；正向邻接（source → targets）求后代
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const e of causal) {
    if (!preds.has(e.target)) preds.set(e.target, [])
    preds.get(e.target)!.push(e.source)
    if (!succs.has(e.source)) succs.set(e.source, [])
    succs.get(e.source)!.push(e.target)
  }

  const highlightedIds = new Set<string>([selectedId])

  // 祖先：反向 BFS 全闭包
  const stackUp = [selectedId]
  while (stackUp.length > 0) {
    const cur = stackUp.pop()!
    for (const p of preds.get(cur) ?? []) {
      if (!highlightedIds.has(p)) {
        highlightedIds.add(p)
        stackUp.push(p)
      }
    }
  }
  // 后代：正向 BFS 全闭包
  const stackDown = [selectedId]
  while (stackDown.length > 0) {
    const cur = stackDown.pop()!
    for (const s of succs.get(cur) ?? []) {
      if (!highlightedIds.has(s)) {
        highlightedIds.add(s)
        stackDown.push(s)
      }
    }
  }

  // 边：两端均在集合内的因果边
  const highlightedEdges = new Set<string>()
  for (const e of causal) {
    if (highlightedIds.has(e.source) && highlightedIds.has(e.target)) highlightedEdges.add(e.id)
  }

  return { active: true, highlightedIds, highlightedEdges }
}

/**
 * 订阅 store（selectedNode + nodes）+ 接渲染边集，memo 化溯源集合。
 * 传入的 edges 应为画布实际渲染的边（adapter 折叠边 + 派生的镜头级边），与用户所见拓扑一致。
 */
export function useTraceHighlight(edges: Edge[]): TraceResult {
  const selectedId = useCanvasStore((s) => s.selectedNode?.id ?? null)
  const nodes = useCanvasStore((s) => s.nodes)
  return useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id))
    const traceEdges: TraceEdge[] = edges.map((e) => {
      const d = (e.data ?? {}) as { role?: string; isInactive?: boolean }
      return { id: e.id, source: String(e.source), target: String(e.target), role: d.role, isInactive: d.isInactive }
    })
    return computeTraceHighlight(traceEdges, nodeIds, selectedId)
  }, [edges, nodes, selectedId])
}
