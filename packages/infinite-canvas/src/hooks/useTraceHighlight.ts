/**
 * src/hooks/useTraceHighlight.ts — P18 溯源高亮（设计 §5 / 宪法 P18）。
 *
 * 选中一个资产节点 → 沿因果边求「祖先链（向后全闭包）+ 后代链（向前全闭包）」，
 * 即该节点所在整条血脉线（一条链），其余节点压暗 0.28 + desaturate。
 * sequence 邻居不算祖先（P11：排序非因果）；isInactive 边（非优胜变体下游）不参与溯源（P12×P18）。
 *
 * 【修订】下游原为「向前一跳」，点链中根/中段节点时只高亮 2 个节点（「仅仅两个之间」）；
 * 现改为向前全闭包，使点链上任一节点都点亮整条链（祖先 + 后代）。
 *
 * 实现为纯函数 computeTraceHighlight（可单测）+ 订阅 store 的 hook useTraceHighlight。
 * FlowCanvas 据返回的集合把 data.traceState（节点）/ data.highlighted（边）盖到派生模型上
 * （AssetCardNode / CanvasEdge 已读这俩字段，无需改 B）。
 */
import { useMemo } from 'react'
import type { FlowGraphV3 } from '@kais/flowgraph-v3'
import { useCanvasStore } from '../store/canvasStore'

export interface TraceResult {
  active: boolean
  /** 应提亮的节点 id（自身 + 祖先 + 直接下游）。 */
  highlightedIds: Set<string>
  /** 应提亮的边 id（两端均在 highlightedIds 内的因果边）。 */
  highlightedEdges: Set<string>
}

const EMPTY: TraceResult = { active: false, highlightedIds: new Set(), highlightedEdges: new Set() }

/**
 * 纯函数：给定 graph + 选中 id，求溯源集合。
 *  - 因果边定义：role !== 'sequence' 且 isInactive !== true。
 *  - 祖先：沿「谁指向我」反向 BFS 全闭包。
 *  - 后代：沿「我指向谁」正向 BFS 全闭包（点链中任一节点都点亮整条链）。
 */
export function computeTraceHighlight(graph: FlowGraphV3 | null, selectedId: string | null): TraceResult {
  if (!graph || !selectedId) return EMPTY
  // 选中节点不存在于图（结构节点等也允许，按 id 通用处理）
  if (!graph.nodes.some((n) => n.id === selectedId)) return EMPTY

  const causal = graph.links.filter((l) => l.role !== 'sequence' && l.isInactive !== true)

  // 反向邻接（target → sources）求祖先；正向邻接（source → targets）求后代
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const l of causal) {
    if (!preds.has(l.target)) preds.set(l.target, [])
    preds.get(l.target)!.push(l.source)
    if (!succs.has(l.source)) succs.set(l.source, [])
    succs.get(l.source)!.push(l.target)
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
  // 后代：正向 BFS 全闭包（修订：原仅一跳，点根/中段节点只亮 2 个；现整条链）
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
  for (const l of causal) {
    if (highlightedIds.has(l.source) && highlightedIds.has(l.target)) highlightedEdges.add(l.id)
  }

  return { active: true, highlightedIds, highlightedEdges }
}

/** 订阅 store（selectedNode + graph），memo 化溯源集合。 */
export function useTraceHighlight(): TraceResult {
  const selectedId = useCanvasStore((s) => s.selectedNode?.id ?? null)
  const graph = useCanvasStore((s) => s.graph)
  return useMemo(() => computeTraceHighlight(graph, selectedId), [graph, selectedId])
}
