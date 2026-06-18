/** 节点执行状态 */
export type NodeState = 'idle' | 'pending' | 'running' | 'success' | 'error' | 'cached'

/** 审核状态 */
export type ReviewStatus = 'awaiting_audit' | 'approved' | 'rejected'

/** Phase 35 — 分镜镜头意图元数据 (借鉴小云雀) */
export type CameraMovement = 'static' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'tilt_up' | 'tilt_down' | 'dolly' | 'tracking'
export type Framing = 'wide' | 'medium' | 'close_up' | 'extreme_close_up' | 'over_the_shoulder' | 'aerial'
export type Composition = 'rule_of_thirds' | 'centered' | 'golden_ratio' | 'symmetrical' | 'leading_lines'
export type Pacing = 'slow' | 'medium' | 'fast' | 'montage'

/** 路由决策 — 决定审核方式 */
export type RoutingDecision = 'AUTO' | 'HUMAN' | 'AI_AUDIT' | 'BLOCK'

/** 5维 AI 评分 */
export interface AIScore {
  aesthetics: number | null
  consistency: number | null
  compliance: number | null
  technicalQuality: number | null
  audioMatch: number | null
  overall: number | null
  source: string | null
}

/** 连线数据类型，用于着色 */
export type LinkDataType = 'text' | 'image' | 'video' | 'audio' | 'data'

/** 连线语义类型（决定渲染样式） */
export type LinkSemanticType = 'data_flow' | 'sequence' | 'parallel' | 'reference'

/** 连线引用类型（标识 ref-input / reference 通道） */
export type LinkRefType = 'input' | 'reference'

/** 画布节点类型枚举 */
export type CanvasNodeType = 'script' | 'asset' | 'storyboard' | 'video' | 'audio'

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
  filePath: string | null
  thumbnailUrl: string | null
  state: NodeState
  progress?: number
  reviewStatus?: ReviewStatus
  aiScore?: AIScore | null
  isWinner?: boolean
  routingDecision?: RoutingDecision
  variantGroupId?: string
  variantIndex?: number
  /** 角色多角度视图：所属角色 ID（同一角色的多张视图共享此 ID） */
  characterId?: string
  /** 视图角度：front | side | back | 3quarter | detail | full */
  viewAngle?: string
  /** 视图组名（通常显示为角色名 subtitle） */
  viewGroup?: string
  /** 是否为主视图（同一角色的代表视图） */
  isPrimaryView?: boolean
}

/** 分镜节点数据 */
export interface StoryboardNodeData {
  [key: string]: unknown
  label: string
  type: 'storyboard'
  storyboardId: number
  duration: number
  prompt: string
  filePath: string | null
  thumbnailUrl: string | null
  state: NodeState
  linkedAssetIds: number[]
  /** Phase 35 — 镜头意图元数据 */
  cameraMovement?: CameraMovement
  framing?: Framing
  composition?: Composition
  pacing?: Pacing
  reviewStatus?: ReviewStatus
  aiScore?: AIScore | null
  isWinner?: boolean
  routingDecision?: RoutingDecision
  variantGroupId?: string
  variantIndex?: number
}

/** 视频节点数据 */
export interface VideoNodeData {
  [key: string]: unknown
  label: string
  type: 'video'
  videoId: number
  filePath: string | null
  thumbnailUrl: string | null
  state: NodeState
  duration?: number
  reviewStatus?: ReviewStatus
  aiScore?: AIScore | null
  isWinner?: boolean
  routingDecision?: RoutingDecision
  variantGroupId?: string
  variantIndex?: number
  /** 多对一引用：视频引用的资产 ID 列表（通过 ref-input handle 接入） */
  linkedAssetIds?: number[]
}

/** 音频节点数据 */
export interface AudioNodeData {
  [key: string]: unknown
  label: string
  type: 'audio'
  audioId: number
  filePath?: string | null
  thumbnailUrl?: string | null
  state: NodeState
  duration?: number
  reviewStatus?: ReviewStatus
  aiScore?: AIScore | null
  isWinner?: boolean
  routingDecision?: RoutingDecision
  variantGroupId?: string
  variantIndex?: number
}

/** 分支状态 */
export type BranchStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived' | 'rejected'

/** 分支 */
export interface FlowBranch {
  id: string
  label: string
  parentId: string | null
  parentNodeId: string | null
  status: BranchStatus
  forkReason: string
  createdAt: string
  updatedAt: string
}

/** 变体组 — 同一分镜下的多个候选资产 */
export interface VariantGroup {
  groupId: string
  parentNodeId: string
  variantNodeIds: string[]
  winnerNodeId?: string
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
  /** 角色多角度视图扩展（向后兼容，旧数据无此字段） */
  characterId?: string
  viewAngle?: string
  viewGroup?: string
  isPrimaryView?: boolean
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

export interface LegacyVideoItem {
  id: number
  name?: string
  filePath?: string | null
  thumbnailUrl?: string | null
  duration?: number
  state?: string
  trackId?: number
  /** 多对一引用扩展（向后兼容） */
  linkedAssetIds?: number[]
}

export interface LegacyAudioItem {
  id: number
  name?: string
  filePath?: string | null
  duration?: number
  state?: string
  assetsRoleId?: number
}

export interface LegacyFlowData {
  script: string
  scriptPlan: string
  assets: LegacyAssetItem[]
  storyboardTable: string
  storyboard: LegacyStoryboardItem[]
  videos?: LegacyVideoItem[]
  audios?: LegacyAudioItem[]
}

// ─── 画布图模型（持久化用） ───────────────────────────────────

export interface FlowGraph {
  nodes: FlowGraphNode[]
  links: FlowGraphLink[]
  groups: FlowGraphGroup[]
  variantGroups?: VariantGroup[]
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
  reviewStatus?: ReviewStatus
  aiScore?: AIScore | null
  isWinner?: boolean
  routingDecision?: RoutingDecision
  variantGroupId?: string
  variantIndex?: number
  branchId?: string
  phaseIndex?: number
  phaseName?: string
  suggestion?: string
  variantOf?: string
}

export interface FlowGraphLink {
  id: string
  source: string
  sourceHandle?: string
  target: string
  targetHandle?: string
  dataType: LinkDataType
  isInactive?: boolean
  branchId?: string
  isExplore?: boolean
  /** 连线语义类型：data_flow | sequence | parallel | reference */
  linkType?: LinkSemanticType
  /** 引用类型：input（常规输入） | reference（参考引用） */
  refType?: LinkRefType
}

export interface FlowGraphGroup {
  id: string
  title: string
  position: { x: number; y: number }
  size: { width: number; height: number }
  childNodeIds: string[]
}

// ─── V2 画布图模型（分支支持） ────────────────────────────────

export interface FlowGraphMeta {
  version: '2'
  projectId: number
  episodesId: number
  createdAt: string
  updatedAt: string
  viewport?: { x: number; y: number; zoom: number }
}

export interface FlowGraphV2 {
  meta: FlowGraphMeta
  nodes: FlowGraphNode[]
  links: FlowGraphLink[]
  branches: FlowBranch[]
  variantGroups?: VariantGroup[]
}
