/**
 * src/hooks/useLayout.ts — 包内布局引擎 → React Flow 坐标桥（SPEC-step5 B.7）。
 *
 * 数据流：A 的 store 派生 nodes/edges（graphToViewModel，含包内 layoutFlowGraph
 * 默认几何的 position 缓存）→ 本 hook 重跑 layoutFlowGraph（同一纯函数、确定性）
 * 拿到 lane/slot 语义 → 按 design tokens 泳道几何（逐泳道带高 + 48px 凹槽 +
 * 第 0 列 200px + 2px 分隔线 + 12px 间隙）换算最终 RF 坐标，并给边补
 * 「产物模态色」通道（§6：因果边 = 产物模态色 @40%）。
 *
 * 取舍与优化口：
 *  - 【优化口·增量重布】本期全量重布：graph 引用变化（任何变换）即整体重跑
 *    layoutFlowGraph。fixture 99 节点 / 190 边实测亚毫秒级，可接受。
 *    后续增量方案：只对 stale 下游脏子图（markStaleDownstream 的输出集）重算
 *    slot，其余节点复用旧坐标缓存（脏集 + 受影响泳道 slot 右移链）。
 *  - useMemo 缓存：boxes / geometry / layoutedNodes / enrichedEdges 各自 memo，
 *    store.nodes 引用不变（socket progress 直改 data 也会换引用，此时仅重映射
 *    坐标，不重跑布局——boxes 只依赖 graph 引用）。
 *  - position 语义（宪法 §7）：position 是布局引擎计算缓存，本 hook 是缓存的
 *    最终权威；用户拖拽不改 canonical，重渲染即回位（与 P7 拓扑分层一致）。
 */
import { useMemo } from 'react'
import type { Edge, Node } from '@xyflow/react'
import {
  layoutFlowGraph,
  type FlowGraphV3,
  type LayoutBox,
} from '@kais/flowgraph-v3'
import { useCanvasStore } from '../store/canvasStore'
import { V3_LAYOUT, V3_NODE_SIZES } from '../constants'
import type { Modality } from '../theme/catppuccin'
import {
  computeCanvasGeometry,
  computeLaneTops,
  globalLaneHeight,
  LANE_H_PKG,
  type CanvasGeometry,
} from '../components/canvas/laneGeometry'

export interface LayoutResult {
  /** 桥接后的 RF 节点（position 已按 tokens 泳道几何换算；selection/hidden 等视图态保留） */
  nodes: Node[]
  /** 富化后的 RF 边（data.productModality = 产物模态色 key，供 CanvasEdge 三态渲染） */
  edges: Edge[]
  /** 泳道/第 0 列/locked zone 几何（LaneBands 消费）；legacy 非 graph 路径为 null */
  geometry: CanvasGeometry | null
}

const CAUSAL_DEFAULT_MODALITY: Modality | undefined = undefined

/** 事件 → 产物模态（首个 role:'output' 边目标资产的 modality，P19 芯片在产出边上）。 */
function buildEventProductModality(graph: FlowGraphV3): Map<string, Modality> {
  const assetModality = new Map<string, Modality>()
  for (const n of graph.nodes) {
    if (n.kind === 'asset') assetModality.set(n.id, n.modality)
  }
  const map = new Map<string, Modality>()
  for (const l of graph.links) {
    if (l.role !== 'output' || map.has(l.source)) continue
    const mod = assetModality.get(l.target)
    if (mod) map.set(l.source, mod)
  }
  return map
}

/** 边 → 产物模态色 key（§6：因果边颜色 = 产物模态色）。 */
export function resolveProductModality(
  edge: Pick<Edge, 'source' | 'target'>,
  graph: FlowGraphV3,
  eventProduct: Map<string, Modality>,
): Modality | undefined {
  // 目标即产物资产（event→asset 的 output 边 / asset→asset 边）
  const target = graph.nodes.find((n) => n.id === edge.target)
  if (target && target.kind === 'asset') return target.modality
  // 目标是事件（asset→event 输入槽位边）→ 事件的产物模态
  const viaEvent = eventProduct.get(edge.target)
  if (viaEvent) return viaEvent
  // 兜底：源资产自身模态（悬挂边防御）
  const source = graph.nodes.find((n) => n.id === edge.source)
  if (source && source.kind === 'asset') return source.modality
  return CAUSAL_DEFAULT_MODALITY
}

/** 单节点 RF 坐标换算（纯函数，可测）。 */
export function bridgePosition(input: {
  nodeId: string
  scope: 'episode' | 'global' | undefined
  box: LayoutBox | undefined
  laneTops: readonly number[]
  globalSlotIndex: number
}): { x: number; y: number } | null {
  const { scope, box, laneTops, globalSlotIndex } = input
  // P9/§3.4：global 资产钉第 0 列——列内边距 16，列头 40 之下按 120+16 纵排
  if (scope === 'global') {
    return {
      x: V3_LAYOUT.GLOBAL_COL_PAD,
      y: 40 + globalSlotIndex * (V3_NODE_SIZES.globalCard.height + 16),
    }
  }
  if (!box) return null
  // 带内偏移（包内 y = lane × LANE_H_PKG + offset）平移到 tokens 带顶 + 顶部留白
  const inLaneOffset = box.y - box.lane * LANE_H_PKG
  const y = (laneTops[box.lane] ?? box.lane * (LANE_H_PKG + V3_LAYOUT.LANE_GAP)) + V3_LAYOUT.LANE_TOP_INSET + inLaneOffset
  // 入种口芯片（x<0）留在第 0 列左侧；其余整体右移主区起点
  const x = box.x < 0 ? box.x : box.x + V3_LAYOUT.MAIN_X
  return { x, y }
}

export function useLayout(): LayoutResult {
  const graph = useCanvasStore((s) => s.graph)
  const storeNodes = useCanvasStore((s) => s.nodes)
  const storeEdges = useCanvasStore((s) => s.edges)

  // 包内布局（同一 graph 引用 → 同一结果；节点水平间隙收编进 4px 网格最大档 48）
  const boxes = useMemo(
    () => (graph ? layoutFlowGraph(graph, { gap: V3_LAYOUT.NODE_GAP_X }) : null),
    [graph],
  )

  // global 第 0 列纵排序（与包内一致：id 序；deprecated 折叠成员不渲染故不参与）
  const globalSlotIndexById = useMemo(() => {
    const map = new Map<string, number>()
    if (!graph) return map
    const globals = graph.nodes
      .filter((n) => n.kind === 'asset' && n.scope === 'global' && n.curation !== 'deprecated')
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    globals.forEach((n, i) => map.set(n.id, i))
    return map
  }, [graph])

  // 泳道几何（带高/带顶/第 0 列/locked zone 的范围输入）
  const laneTops = useMemo(() => {
    const heights = V3_LAYOUT.LANE_HEIGHTS.map((h, i) =>
      i === 0 ? globalLaneHeight(globalSlotIndexById.size) : h,
    )
    return computeLaneTops(heights)
  }, [globalSlotIndexById.size])

  const nodes = useMemo(() => {
    if (!graph || !boxes) return storeNodes
    return storeNodes.map((n) => {
      const v3 = n.data?.v3 as { kind?: string; scope?: 'episode' | 'global' } | undefined
      const pos = bridgePosition({
        nodeId: n.id,
        scope: v3?.kind === 'asset' ? v3.scope : undefined,
        box: boxes.get(n.id),
        laneTops,
        globalSlotIndex: globalSlotIndexById.get(n.id) ?? 0,
      })
      return pos ? { ...n, position: pos } : n
    })
  }, [graph, boxes, storeNodes, laneTops, globalSlotIndexById])

  const geometry = useMemo(() => {
    if (!graph) return null
    return computeCanvasGeometry({
      globalAssetCount: globalSlotIndexById.size,
      boxes: nodes.map((n) => ({
        x: n.position.x,
        y: n.position.y,
        width: n.width ?? V3_NODE_SIZES.card.width,
        height: n.height ?? V3_NODE_SIZES.card.height,
        locked: (n.data?.curation as string | undefined) === 'locked',
      })),
    })
  }, [graph, nodes, globalSlotIndexById.size])

  const eventProduct = useMemo(() => (graph ? buildEventProductModality(graph) : new Map<string, Modality>()), [graph])

  const edges = useMemo(() => {
    if (!graph) return storeEdges
    return storeEdges.map((e) => {
      const role = (e.data as { role?: string } | undefined)?.role
      // sequence / reference 族走中性灰族，不算产物模态
      if (!role || role === 'sequence' || role === 'reference' || role === 'lora_ref' || role === 'prompt_ref') {
        return e
      }
      const mod = resolveProductModality(e, graph, eventProduct)
      return mod ? { ...e, data: { ...e.data, productModality: mod } } : e
    })
  }, [graph, storeEdges, eventProduct])

  return { nodes, edges, geometry }
}
