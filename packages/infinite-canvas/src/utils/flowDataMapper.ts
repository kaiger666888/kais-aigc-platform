import type { Node, Edge } from '@xyflow/react'
import type {
  ScriptNodeData,
  AssetNodeData,
  StoryboardNodeData,
  VideoNodeData,
  AudioNodeData,
  NodeState,
  LegacyFlowData,
  FlowGraph,
  FlowGraphNode,
} from '../types/canvas'
import { LAYOUT, NODE_SIZES } from '../constants'

/** 同 viewGroup 内成员的 Y 间距（紧凑），与默认 ASSET_GAP_Y(220) 区分 */
const VIEWGROUP_TIGHT_GAP_Y = 160

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

  // 2. 资产节点
  // 布局规则：维持原有 4-per-row 网格；当相邻资产共享 viewGroup 时，
  // 锁定在同一列、Y 方向紧凑堆叠（间距 160）。
  const assetNodesMap = new Map<number, string>()
  const VARIANT_GROUP_ID = 'vg-char-role'
  const GRID_COLS = 4

  let layoutCol = 0
  let layoutRow = 0
  let layoutY = LAYOUT.ASSET_Y
  let prevViewGroup: string | undefined

  flowData.assets?.forEach((asset, i) => {
    const nodeId = `asset-${asset.id}`
    assetNodesMap.set(asset.id, nodeId)

    const deriveState = asset.derive?.[0]?.state
    const state: NodeState = deriveState === '已完成' ? 'success'
      : deriveState === '生成中' ? 'running'
      : deriveState === '生成失败' ? 'error'
      : 'idle'

    // 变体组标记：前2个资产组成变体组（演示用）
    const isVariant = asset.type === 'role' && i < 2

    // 角色多角度视图字段（向后兼容，旧数据无此字段时为 undefined）
    const characterId = asset.characterId
    const viewAngle = asset.viewAngle
    const viewGroup = asset.viewGroup
    const isPrimaryView = asset.isPrimaryView

    // 布局计算：同 viewGroup 紧凑堆叠，否则进入下一列
    if (viewGroup != null && viewGroup === prevViewGroup) {
      layoutY += VIEWGROUP_TIGHT_GAP_Y
    } else {
      if (i > 0) {
        layoutCol++
        if (layoutCol >= GRID_COLS) { layoutCol = 0; layoutRow++ }
      }
      layoutY = LAYOUT.ASSET_Y + layoutRow * LAYOUT.ASSET_GAP_Y
    }
    prevViewGroup = viewGroup

    const x = LAYOUT.ASSET_START_X + layoutCol * LAYOUT.ASSET_GAP_X
    const y = layoutY

    const data: AssetNodeData = {
      label: asset.name,
      type: 'asset',
      assetType: asset.type,
      assetId: asset.id,
      prompt: asset.prompt,
      filePath: null,
      thumbnailUrl: asset.derive?.[0]?.src ?? null,
      state,
      characterId,
      viewAngle,
      viewGroup,
      isPrimaryView,
      ...(isVariant && {
        variantGroupId: VARIANT_GROUP_ID,
        variantIndex: i,
        isWinner: i === 0, // 第一个为优胜者
        reviewStatus: i === 0 ? 'approved' : 'pending',
      }),
    }
    nodes.push({
      id: nodeId,
      type: 'asset',
      position: { x, y },
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

    // 分镜顺序连线：相邻分镜之间插入 sequence link
    if (i > 0) {
      const prevNodeId = `storyboard-${sortedSb[i - 1].id}`
      edges.push({
        id: `seq-${edgeId++}`,
        source: prevNodeId,
        target: nodeId,
        data: { dataType: 'data', linkType: 'sequence' },
      })
    }
  })

  // 4. 视频节点（横向排列）
  const storyboardNodesMap = new Map<number, string>()
  sortedSb.forEach((sb) => {
    storyboardNodesMap.set(sb.id, `storyboard-${sb.id}`)
  })

  const sortedVideos = [...(flowData.videos ?? [])]
  sortedVideos.forEach((v, i) => {
    const nodeId = `video-${v.id}`
    const state: NodeState = v.state === '已完成' ? 'success'
      : v.state === '生成中' ? 'running'
      : v.state === '生成失败' ? 'error'
      : 'idle'

    // 多对一引用：linkedAssetIds 缺失时从 trackId 关联的分镜继承（向后兼容）
    let linkedAssetIds = v.linkedAssetIds
    if ((!linkedAssetIds || linkedAssetIds.length === 0) && v.trackId != null) {
      const linkedSb = flowData.storyboard?.find((s) => s.id === v.trackId)
      const inherited = linkedSb?.associateAssetsIds ?? []
      if (inherited.length > 0) linkedAssetIds = inherited
    }

    const data: VideoNodeData = {
      label: `视频 ${i + 1}`,
      type: 'video',
      videoId: v.id,
      filePath: v.filePath ?? null,
      thumbnailUrl: v.thumbnailUrl ?? null,
      duration: v.duration,
      state,
      ...(linkedAssetIds && linkedAssetIds.length > 0 ? { linkedAssetIds } : {}),
    }
    nodes.push({
      id: nodeId,
      type: 'video',
      position: { x: LAYOUT.SB_START_X + i * LAYOUT.SB_GAP_X, y: LAYOUT.VIDEO_START_Y },
      data,
    })

    // 连接分镜 → 视频（主数据流，使用默认 handle）
    if (v.trackId) {
      const sourceId = storyboardNodesMap.get(v.trackId)
      if (sourceId) {
        edges.push({
          id: `e-${edgeId++}`,
          source: sourceId,
          target: nodeId,
          data: { dataType: 'video' },
        })
      }
    }

    // 多对一引用：linkedAssetIds → video 的 ref-input handle
    if (linkedAssetIds && linkedAssetIds.length > 0) {
      for (const aid of linkedAssetIds) {
        const refSourceId = assetNodesMap.get(aid)
        if (refSourceId) {
          edges.push({
            id: `ref-${edgeId++}`,
            source: refSourceId,
            target: nodeId,
            targetHandle: 'ref-input',
            data: { dataType: 'image', refType: 'reference' },
          })
        }
      }
    }
  })

  // 5. 音频节点（横向排列）
  const sortedAudios = [...(flowData.audios ?? [])]
  sortedAudios.forEach((a, i) => {
    const nodeId = `audio-${a.id}`
    const state: NodeState = a.state === '已完成' ? 'success'
      : a.state === '生成中' ? 'running'
      : a.state === '生成失败' ? 'error'
      : 'idle'

    const data: AudioNodeData = {
      label: a.name ?? `音频 ${i + 1}`,
      type: 'audio',
      audioId: a.id,
      filePath: a.filePath ?? null,
      duration: a.duration,
      state,
    }
    nodes.push({
      id: nodeId,
      type: 'audio',
      position: { x: LAYOUT.SB_START_X + i * LAYOUT.SB_GAP_X, y: LAYOUT.AUDIO_START_Y },
      data,
    })

    // 连接资产 → 音频
    if (a.assetsRoleId) {
      const sourceId = assetNodesMap.get(a.assetsRoleId)
      if (sourceId) {
        edges.push({
          id: `e-${edgeId++}`,
          source: sourceId,
          target: nodeId,
          data: { dataType: 'audio' },
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
    nodes: nodes.map((n) => {
      const d = n.data as any
      return {
        id: n.id,
        type: d?.type ?? n.type ?? 'asset',
        position: n.position,
        size: { width: NODE_SIZES.defaultPersistSize.width, height: NODE_SIZES.defaultPersistSize.height },
        data: n.data as Record<string, unknown>,
        state: d?.state ?? 'idle',
        progress: d?.progress,
        // 分支字段：节点 data → FlowGraphNode 顶层（持久化）
        branchId: d?.branchId,
        phaseIndex: d?.phaseIndex,
        phaseName: d?.phaseName,
        suggestion: d?.suggestion,
        variantOf: d?.variantOf,
      }
    }),
    links: edges.map((e) => {
      const d = e.data as any
      return {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? undefined,
        target: e.target,
        targetHandle: e.targetHandle ?? undefined,
        dataType: d?.dataType ?? 'data',
        branchId: d?.branchId,
        isExplore: d?.isExplore,
        isInactive: d?.isInactive,
        linkType: d?.linkType,
        refType: d?.refType,
      }
    }),
    groups: [],
    viewport,
  }
}

/** FlowGraph → React Flow 节点/边 */
export function flowGraphToCanvas(graph: FlowGraph): { nodes: Node[]; edges: Edge[] } {
  const mapNode = (gn: FlowGraphNode): Node => {
    // ─── reviewStatus 边界归一化 ────────────────────────────
    // 旧 blob（含 awaiting_audit）→ 新 canonical (pending)。
    // v1.9 临时兼容层；下一里程碑去掉。
    const incomingReviewStatus = gn.data?.reviewStatus ?? gn.reviewStatus
    const normalizedReviewStatus =
      incomingReviewStatus === 'awaiting_audit' ? 'pending' : incomingReviewStatus

    return {
      id: gn.id,
      type: gn.type,
      position: gn.position,
      // Zone (ellipse) nodes: rendered behind, non-interactive background
      ...(gn.type === 'zone' ? {
        draggable: false,
        selectable: false,
        deletable: false,
        connectable: true,
        focusable: false,
        zIndex: 0,
      } : {}),
      data: {
        ...gn.data,
        ...(gn.data?.detail && !gn.data?.content ? { content: gn.data.detail } : {}),
        ...(normalizedReviewStatus ? { reviewStatus: normalizedReviewStatus } : {}),
        state: gn.state,
        progress: gn.progress,
        branchId: gn.branchId,
        phaseIndex: gn.phaseIndex,
        phaseName: gn.phaseName,
        suggestion: gn.suggestion,
        variantOf: gn.variantOf,
      },
    }
  }

  const nodes: Node[] = (graph.nodes ?? []).map(mapNode)

  // Backward compat: backend canvas/load returns {nodes, edges}, but FlowGraph
  // type uses `links`. Accept either to avoid undefined.map() crash.
  const links = graph.links ?? (graph as any).edges ?? []

  const edges: Edge[] = links.map((gl) => ({
    id: gl.id,
    type: 'canvas',
    source: gl.source,
    sourceHandle: gl.sourceHandle,
    target: gl.target,
    targetHandle: gl.targetHandle,
    data: {
      dataType: gl.dataType,
      branchId: gl.branchId,
      isExplore: gl.isExplore,
      isInactive: gl.isInactive,
      linkType: gl.linkType,
      refType: gl.refType,
    },
  }))

  return { nodes, edges }
}
