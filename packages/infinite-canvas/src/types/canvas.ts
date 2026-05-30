/** 节点执行状态 */
export type NodeState = 'idle' | 'pending' | 'running' | 'success' | 'error' | 'cached'

/** 连线数据类型，用于着色 */
export type LinkDataType = 'text' | 'image' | 'video' | 'data'

/** 画布节点类型枚举 */
export type CanvasNodeType = 'script' | 'asset' | 'storyboard' | 'video'

// ─── 自定义节点数据（带索引签名以兼容 React Flow v12） ──────────

/** 剧本节点数据 */
export interface ScriptNodeData {
  [key: string]: unknown
  label: string
  type: 'script'
  content: string
  state: NodeState
}

/** 资产节点数据 */
export interface AssetNodeData {
  [key: string]: unknown
  label: string
  type: 'asset'
  assetType: 'role' | 'tool' | 'scene' | 'clip'
  assetId: number
  prompt: string
  thumbnailUrl: string | null
  state: NodeState
  progress?: number
}

/** 分镜节点数据 */
export interface StoryboardNodeData {
  [key: string]: unknown
  label: string
  type: 'storyboard'
  storyboardId: number
  duration: number
  prompt: string
  thumbnailUrl: string | null
  state: NodeState
  linkedAssetIds: number[]
}

/** 视频节点数据 */
export interface VideoNodeData {
  [key: string]: unknown
  label: string
  type: 'video'
  videoId: number
  thumbnailUrl: string | null
  state: NodeState
  duration?: number
}

/** 连线数据 */
export interface CanvasEdgeData {
  [key: string]: unknown
  dataType: LinkDataType
}

// ─── 现有 FlowData 兼容接口（映射用） ─────────────────────────

export interface LegacyAssetItem {
  id: number
  name: string
  type: 'role' | 'tool' | 'scene' | 'clip'
  prompt: string
  desc: string
  derive: {
    id: number
    assetsId: number
    name: string
    prompt: string
    desc: string
    src: string | null
    state: string
    type: 'role' | 'tool' | 'scene' | 'clip'
  }[]
}

export interface LegacyStoryboardItem {
  id: number
  duration: number
  prompt: string
  associateAssetsIds: number[]
  src: string | null
  index: number | null
  state?: string
}

export interface LegacyFlowData {
  script: string
  scriptPlan: string
  assets: LegacyAssetItem[]
  storyboardTable: string
  storyboard: LegacyStoryboardItem[]
}

// ─── 画布图模型（持久化用） ───────────────────────────────────

export interface FlowGraph {
  nodes: FlowGraphNode[]
  links: FlowGraphLink[]
  groups: FlowGraphGroup[]
  viewport?: { x: number; y: number; zoom: number }
}

export interface FlowGraphNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  size: { width: number; height: number }
  data: Record<string, unknown>
  state: NodeState
  progress?: number
  groupId?: string
}

export interface FlowGraphLink {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
  dataType: LinkDataType
}

export interface FlowGraphGroup {
  id: string
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  childNodeIds: string[]
}
