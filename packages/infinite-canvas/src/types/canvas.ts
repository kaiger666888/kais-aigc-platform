// ─── 品牌类型 (Branded types) ───────────────────────────────
// 用于在编译期区分 string ID 的语义,避免把 projectId 误传成 nodeId。
// 实现遵循 branding idiom:一个 symbol 字段使 TS 把不同的 brand 视为不兼容。

declare const __brand: unique symbol
export type Brand<T extends string> = { readonly [__brand]: T }

/** 画布节点 ID (例如 'asset-12', 'storyboard-3') */
export type NodeId = string & Brand<'NodeId'>
/** 变体组 ID (例如 'vg-char-role') */
export type VariantGroupId = string & Brand<'VariantGroupId'>
/** 画布边 ID */
export type EdgeId = string & Brand<'EdgeId'>

// 构造辅助:在边界处(读外部数据时)用这些函数把普通 string 提升为 branded ID。
export const asNodeId = (s: string): NodeId => s as NodeId
export const asVariantGroupId = (s: string): VariantGroupId => s as VariantGroupId
export const asEdgeId = (s: string): EdgeId => s as EdgeId

/** 节点执行状态 */
export type NodeState = 'idle' | 'pending' | 'running' | 'success' | 'error' | 'cached'

/** 审核状态 — 与 v2 zod schema (pending | approved | rejected) 对齐。
 * 旧的 'awaiting_audit' 值在 flowDataMapper 边界被归一化为 'pending'。 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected'

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

/** 变体组成员状态 — 显式区分优胜 / 落选 / 待审,避免用 !isWinner 表达"落选" */
export type VariantMemberStatus = 'winner' | 'loser' | 'pending'

/** 计算单个变体节点的状态 — 用于 UI 着色和 ARIA 标签 */
export function deriveVariantMemberStatus(
  isWinner: boolean | undefined,
  hasWinnerInGroup: boolean,
): VariantMemberStatus {
  if (isWinner) return 'winner'
  if (hasWinnerInGroup) return 'loser'
  return 'pending'
}

/** 变体组 — 同一父节点下的多个候选资产 / 分镜 / 视频 */
export interface VariantGroup {
  /** 组 ID (例如 'vg-char-role') — 用于在节点 data.variantGroupId 上做关联 */
  groupId: VariantGroupId
  /** 触发变体的父节点 ID (通常是上游分镜或剧本审核节点) */
  parentNodeId: NodeId
  /** 组内所有变体节点 ID (顺序即 variantIndex) */
  variantNodeIds: NodeId[]
  /** 当前优胜节点 ID;在 selectWinner 成功后写入 */
  winnerNodeId?: NodeId
  /** 创建时间 (ISO) — 用于审计和回滚 */
  createdAt: string
}

/** 创建一个新 VariantGroup 的工厂 — 自动填入时间戳与 branded IDs */
export function createVariantGroup(input: {
  groupId: string
  parentNodeId: string
  variantNodeIds: string[]
  winnerNodeId?: string
}): VariantGroup {
  return {
    groupId: asVariantGroupId(input.groupId),
    parentNodeId: asNodeId(input.parentNodeId),
    variantNodeIds: input.variantNodeIds.map(asNodeId),
    ...(input.winnerNodeId ? { winnerNodeId: asNodeId(input.winnerNodeId) } : {}),
    createdAt: new Date().toISOString(),
  }
}

// ─── 候选审核 (剧本节点 category='variant_group') ──────────────
//
// 这些类型此前散落在 src/components/NodeDetailPanel.tsx 内部 (EpisodeInfo,
// EpisodeScene, Candidate, VariantGroupData),作为 inline 类型存在。
// 提取到 types 层后,store 和多个组件可以共享同一形态。

/** 剧集中的单个场景 — 兼容字符串形式(旧数据)和结构化对象(新数据) */
export interface EpisodeScene {
  content?: string
  [k: string]: unknown
}

/** 候选列表中单条剧集的元信息 */
export interface EpisodeInfo {
  ep?: string | number
  title?: string
  logline?: string
  fantasy?: string
  signature_shot?: string
  hook_ending?: string
  plot_twist?: string
  scenes?: EpisodeScene[] | string[]
}

/** 变体候选 — 来自节点 data.candidates 或同组变体子节点 */
export interface VariantCandidate {
  id: string
  label?: string
  score?: number
  description?: string
  tags?: string[]
  topic_kernel?: string
  highlight?: string
  emotional_resonance?: string
  safety_score?: number
  genre_tag?: string
  episodes?: EpisodeInfo[]
  [k: string]: unknown
}

/** variant_group 类型剧本节点的 data 形态 */
export interface VariantGroupNodeData {
  label?: string
  candidates?: VariantCandidate[]
  variantNodeIds?: string[]
  reviewStatus?: ReviewStatus | string
}

/** 变体风格 (alpha / beta / gamma) — 仅用于 UI 着色,不影响业务 */
export type VariantStyleTag = 'alpha' | 'beta' | 'gamma'

/** 从候选 label 中检测风格 tag */
export function detectVariantStyle(label: string | undefined): VariantStyleTag | null {
  if (!label) return null
  if (label.includes('alpha')) return 'alpha'
  if (label.includes('beta')) return 'beta'
  if (label.includes('gamma')) return 'gamma'
  return null
}

/** VariantGroupDetail 的本地 UI 状态机 — 替代散落的 useState */
export type VariantReviewLoadingState = 'idle' | 'approving' | 'rejecting' | 'confirming'

export interface VariantGroupUIState {
  selectedId: string | null
  selectedForReview: string | null
  confirmed: boolean
  reviewLoading: VariantReviewLoadingState
  error: string | null
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
