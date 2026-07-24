/**
 * autoLayout.ts — Dagre-based automatic graph layout for React Flow v12
 *
 * Organizes pipeline DAG nodes into a compact, left-to-right layered layout.
 * Referenced by the "整理布局" toolbar button in FlowCanvas.
 *
 * Design:
 * - LR (left-to-right) direction matches pipeline flow
 * - nodesep/ranksep tuned for our node sizes (~240×180px)
 * - Uses measured dimensions when available (post-render), falls back to defaults
 * - Excludes zone nodes (type='zone') from layout—they're computed from child bounds
 */

import dagre from '@dagrejs/dagre'
import { Position, type Node, type Edge } from '@xyflow/react'

/** Default node dimensions if not measured yet */
const DEFAULT_NODE_WIDTH = 260
const DEFAULT_NODE_HEIGHT = 180

/** Zone/label nodes that should not participate in auto-layout */
function isLayoutable(node: Node): boolean {
  return node.type !== 'zone' && !(node as any).hidden
}

/**
 * getLayoutedElements — compute dagre positions for all layoutable nodes.
 * Zone nodes are re-positioned to wrap their children after layout.
 */
export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): { nodes: Node[]; edges: Edge[] } {
  const isHorizontal = direction === 'LR'

  // Separate layoutable vs static nodes
  const layoutable = nodes.filter(isLayoutable)
  const staticNodes = nodes.filter((n) => !isLayoutable(n))

  // Filter edges to only those between layoutable nodes
  const layoutableIds = new Set(layoutable.map((n) => n.id))
  const layoutEdges = edges.filter(
    (e) => layoutableIds.has(e.source) && layoutableIds.has(e.target),
  )

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: 50,       // gap between nodes in same rank
    ranksep: 120,      // gap between ranks (layers)
    marginx: 40,
    marginy: 40,
    ranker: 'network-simplex',
  })

  // Add nodes with measured dimensions
  for (const node of layoutable) {
    const w = (node.measured as any)?.width ?? node.width ?? DEFAULT_NODE_WIDTH
    const h = (node.measured as any)?.height ?? node.height ?? DEFAULT_NODE_HEIGHT
    g.setNode(node.id, { width: w, height: h })
  }

  // Add edges
  for (const edge of layoutEdges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  // Map dagre positions back to React Flow nodes
  const layoutedNodes: Node[] = layoutable.map((node) => {
    const pos = g.node(node.id)
    const w = pos?.width ?? DEFAULT_NODE_WIDTH
    const h = pos?.height ?? DEFAULT_NODE_HEIGHT
    return {
      ...node,
      // dagre returns center coordinates; React Flow expects top-left
      position: {
        x: (pos?.x ?? 0) - w / 2,
        y: (pos?.y ?? 0) - h / 2,
      },
      // Set handle positions based on direction
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
    }
  })

  // Re-compute zone node positions based on their children
  const layoutedById = new Map(layoutedNodes.map((n) => [n.id, n]))
  const repositionedStatic = staticNodes.map((node) => {
    if (node.type === 'zone') {
      // Find children by phase (stored in zone data)
      const phase = (node.data as any)?.phase
      if (!phase) return node
      const children = layoutedNodes.filter(
        (n) => (n.data as any)?.phase === phase,
      )
      if (children.length === 0) return node

      const xs = children.map((n) => n.position.x)
      const ys = children.map((n) => n.position.y)
      const w = children.map((n) => (n.measured as any)?.width ?? DEFAULT_NODE_WIDTH)
      const hs = children.map((n) => (n.measured as any)?.height ?? DEFAULT_NODE_HEIGHT)

      const minX = Math.min(...xs) - 60
      const minY = Math.min(...ys) - 50
      const maxX = Math.max(...xs.map((x, i) => x + w[i])) + 60
      const maxY = Math.max(...ys.map((y, i) => y + hs[i])) + 50

      return {
        ...node,
        position: { x: minX, y: minY },
        style: {
          ...node.style,
          width: maxX - minX,
          height: maxY - minY,
        },
      }
    }
    return node
  })

  return {
    nodes: [...repositionedStatic, ...layoutedNodes],
    edges,
  }
}
