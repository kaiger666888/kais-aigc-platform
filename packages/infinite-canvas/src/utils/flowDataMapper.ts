import type { Node, Edge } from '@xyflow/react'
import type {
  ScriptNodeData,
  AssetNodeData,
  StoryboardNodeData,
  NodeState,
  LegacyFlowData,
  FlowGraph,
} from '../types/canvas'
import { LAYOUT, NODE_SIZES } from '../constants'

/** 将现有 FlowData 转换为画布节点和边 */
export function flowDataToCanvas(
  flowData: LegacyFlowData,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let edgeId = 0

  // 1. 剧本节点
  const scriptNodeId = 'script-0'
  const scriptData: ScriptNodeData = {
    label: '剧本',
    type: 'script',
    content: flowData.script?.slice(0, 200) ?? '',
    state: flowData.script ? 'success' : 'idle',
  }
  nodes.push({
    id: scriptNodeId,
    type: 'script',
    position: { x: LAYOUT.SCRIPT_X, y: LAYOUT.SCRIPT_Y },
    data: scriptData,
  })

  // 2. 资产节点（网格布局）
  const assetNodesMap = new Map<number, string>()
  const VARIANT_GROUP_ID = 'vg-char-role'
  flowData.assets?.forEach((asset, i) => {
    const nodeId = `asset-${asset.id}`
    assetNodesMap.set(asset.id, nodeId)

    const col = i % 4
    const row = Math.floor(i / 4)
    const deriveState = asset.derive?.[0]?.state
    const state: NodeState = deriveState === '已完成' ? 'success'
      : deriveState === '生成中' ? 'running'
      : deriveState === '生成失败' ? 'error'
      : 'idle'

    // 变体组标记：前2个资产组成变体组（演示用）
    const isVariant = asset.type === 'role' && i < 2
    const data: AssetNodeData = {
      label: asset.name,
      type: 'asset',
      assetType: asset.type,
      assetId: asset.id,
      prompt: asset.prompt,
      filePath: null,
      thumbnailUrl: asset.derive?.[0]?.src ?? null,
      state,
      ...(isVariant && {
        variantGroupId: VARIANT_GROUP_ID,
        variantIndex: i,
        isWinner: i === 0, // 第一个为优胜者
        reviewStatus: i === 0 ? 'approved' : 'awaiting_audit',
      }),
    }
    nodes.push({
      id: nodeId,
      type: 'asset',
      position: { x: LAYOUT.ASSET_START_X + col * LAYOUT.ASSET_GAP_X, y: LAYOUT.ASSET_Y + row * LAYOUT.ASSET_GAP_Y },
      data,
    })

    edges.push({
      id: `e-${edgeId++}`,
      source: scriptNodeId,
      target: nodeId,
      data: { dataType: 'text' },
    })
  })

  // 3. 分镜节点（横向排列）
  const sortedSb = [...(flowData.storyboard ?? [])].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0),
  )
  sortedSb.forEach((sb, i) => {
    const nodeId = `storyboard-${sb.id}`
    const state: NodeState = sb.state === '已完成' ? 'success'
      : sb.state === '生成中' ? 'running'
      : sb.state === '生成失败' ? 'error'
      : 'idle'

    const data: StoryboardNodeData = {
      label: `分镜 ${sb.index ?? i + 1}`,
      type: 'storyboard',
      storyboardId: sb.id,
      duration: sb.duration,
      prompt: sb.prompt,
      filePath: null,
      thumbnailUrl: sb.src ?? null,
      state,
      linkedAssetIds: sb.associateAssetsIds ?? [],
    }
    nodes.push({
      id: nodeId,
      type: 'storyboard',
      position: { x: LAYOUT.SB_START_X + i * LAYOUT.SB_GAP_X, y: LAYOUT.SB_START_Y },
      data,
    })

    for (const aid of sb.associateAssetsIds ?? []) {
      const sourceId = assetNodesMap.get(aid)
      if (sourceId) {
        edges.push({
          id: `e-${edgeId++}`,
          source: sourceId,
          target: nodeId,
          data: { dataType: 'image' },
        })
      }
    }
  })

  return { nodes, edges }
}

// ─── React Flow → FlowGraph 持久化格式 ─────────────────────

export function canvasToFlowGraph(
  nodes: Node[],
  edges: Edge[],
  viewport?: { x: number; y: number; zoom: number },
): FlowGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.data as any)?.type ?? n.type ?? 'asset',
      position: n.position,
      size: { width: NODE_SIZES.defaultPersistSize.width, height: NODE_SIZES.defaultPersistSize.height },
      data: n.data as Record<string, unknown>,
      state: (n.data as any)?.state ?? 'idle',
      progress: (n.data as any)?.progress,
    })),
    links: edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle ?? undefined,
      target: e.target,
      targetHandle: e.targetHandle ?? undefined,
      dataType: (e.data as any)?.dataType ?? 'data',
    })),
    groups: [],
    viewport,
  }
}

/** FlowGraph → React Flow 节点/边 */
export function flowGraphToCanvas(graph: FlowGraph): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = graph.nodes.map((gn) => ({
    id: gn.id,
    type: gn.type,
    position: gn.position,
    data: {
      ...gn.data,
      state: gn.state,
      progress: gn.progress,
    },
  }))

  const edges: Edge[] = graph.links.map((gl) => ({
    id: gl.id,
    source: gl.source,
    sourceHandle: gl.sourceHandle,
    target: gl.target,
    targetHandle: gl.targetHandle,
    data: { dataType: gl.dataType },
  }))

  return { nodes, edges }
}
