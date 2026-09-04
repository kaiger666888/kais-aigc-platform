/**
 * src/components/pipeline/dagLayout.ts — dagre 分层布局封装。
 *
 * 把 DAG_NODES + DAG_EDGES 喂给 dagre（LR 方向，network-simplex 排序），
 * 产出每个节点的 {x, y, width, height}（左上角坐标）与每条边的贝塞尔控制点。
 * 渲染层（PipelineStateMachine）用这些坐标在变换容器里铺 HTML 节点卡 + SVG 边。
 *
 * 复用 @dagrejs/dagre（autoLayout.ts 已依赖，无需新装）。
 */
import dagre from '@dagrejs/dagre'

/** 节点卡固定宽度（BlueOcean 风格小卡）。 */
export const NODE_WIDTH = 188
/** 节点卡基础高度（有进度条时 +8）。 */
export const NODE_HEIGHT = 46
/** 层间距（rank 之间，LR = 水平间距）。 */
const RANK_SEP = 70
/** 同层节点间距（垂直）。 */
const NODE_SEP = 18

export interface LayoutNode {
  id: string
  /** 左上角 x（已从 dagre 中心坐标换算）。 */
  x: number
  /** 左上角 y。 */
  y: number
  width: number
  height: number
}

export interface LayoutEdge {
  from: string
  to: string
  /** 贝塞尔控制点（dagre 给出，含起止端点；SVG path 用）。 */
  points: Array<{ x: number; y: number }>
}

export interface LayoutResult {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  /** 内容包围盒（含 margin），用于 fit-to-screen 与 SVG 画布尺寸。 */
  width: number
  height: number
}

/** 布局可选参数（逆向工程 DAG 视图用：rankdir 'RL' = 从右往左）。缺省 'LR' 保持原管线零变化。 */
export interface LayoutDagOpts {
  rankdir?: 'LR' | 'RL'
}

/**
 * 计算 DAG 分层布局。
 * @param nodeIds 参与布局的节点 id（通常 = DAG_NODES 全集；缺失的边缘端点会被跳过）
 * @param edges 依赖边 {from,to}
 * @param opts 可选参数：rankdir（默认 'LR'，与历史调用零差异）
 */
export function layoutDag(
  nodeIds: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string }>,
  opts?: LayoutDagOpts,
): LayoutResult {
  const idSet = new Set(nodeIds)

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: opts?.rankdir ?? 'LR',
    ranksep: RANK_SEP,
    nodesep: NODE_SEP,
    marginx: 24,
    marginy: 24,
    ranker: 'network-simplex',
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const id of nodeIds) {
    g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const e of edges) {
    // 仅保留两端都在节点集中的边（防孤儿引用）
    if (idSet.has(e.from) && idSet.has(e.to)) g.setEdge(e.from, e.to)
  }

  dagre.layout(g)

  const nodes: LayoutNode[] = []
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of nodeIds) {
    const pos = g.node(id)
    if (!pos) continue
    const x = pos.x - NODE_WIDTH / 2
    const y = pos.y - NODE_HEIGHT / 2
    nodes.push({ id, x, y, width: NODE_WIDTH, height: NODE_HEIGHT })
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + NODE_WIDTH)
    maxY = Math.max(maxY, y + NODE_HEIGHT)
  }

  const layoutEdges: LayoutEdge[] = []
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    const edge = g.edge(e.from, e.to)
    if (!edge || !Array.isArray(edge.points)) continue
    layoutEdges.push({
      from: e.from,
      to: e.to,
      points: edge.points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })),
    })
  }

  return {
    nodes,
    edges: layoutEdges,
    width: Number.isFinite(minX) ? maxX - minX : 0,
    height: Number.isFinite(minY) ? maxY - minY : 0,
  }
}

/**
 * 把边端点吸附到节点边界中点（左右出入），生成更整齐的贝塞尔路径。
 * dagre 的 points 已近似如此，这里二次规整：起点 = 源节点右边中点，终点 = 目标节点左边中点。
 */
export function edgePathD(
  edge: LayoutEdge,
  nodeById: Map<string, LayoutNode>,
): string {
  const src = nodeById.get(edge.from)
  const tgt = nodeById.get(edge.to)
  const pts = edge.points
  if (!pts.length) return ''
  // 起点/终点优先用节点边界吸附，中间控制点保留 dagre 输出
  const start = src
    ? { x: src.x + src.width, y: src.y + src.height / 2 }
    : pts[0]!
  const end = tgt
    ? { x: tgt.x, y: tgt.y + tgt.height / 2 }
    : pts[pts.length - 1]!
  const midPts = pts.slice(1, -1)
  // 三次贝塞尔：用源/目 x 差的一半作控制点水平偏移，得到平滑 S 曲线
  const dx = Math.max(28, Math.abs(end.x - start.x) * 0.45)
  const c1 = { x: start.x + dx, y: start.y }
  const c2 = { x: end.x - dx, y: end.y }
  // 若 dagre 给了中间折点（多段），退化为折线 + 圆角（罕见，多为长跨层边）
  if (midPts.length >= 2) {
    const all = [start, ...midPts, end]
    return all.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  }
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
}
