// ─── 枚举 ──────────────────────────────────────

export type NodeState = "idle" | "pending" | "running" | "success" | "error" | "skipped";
export type BranchStatus = "draft" | "active" | "paused" | "completed" | "archived" | "rejected";
export type ReviewStatus = "pending" | "approved" | "rejected";
export type NodeType =
  | "script" | "asset" | "storyboard" | "video" | "audio"
  | "3d" | "variant" | "reference" | "upscale" | "face_restore"
  | "suggestion" | "zone" | "phase";

// ─── AI 建议结构 ───────────────────────────────

export interface Suggestion {
  type: "create_node" | "modify_param" | "branch_split" | "merge_branch";
  label: string;
  confidence: number;
  payload: Record<string, any>;
}

// ─── 节点 ──────────────────────────────────────

export interface FlowNodeV2 {
  id: string;
  type: NodeType;
  branchId: string;
  phaseIndex: number;
  phaseName: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: Record<string, any>;
  state: NodeState;

  reviewStatus?: ReviewStatus;
  aiScore?: any;
  isWinner?: boolean;
  rejectReason?: string;
  suggestion?: string;

  variantOf?: string;
  variantGroupId?: string;
}

// ─── 边 ────────────────────────────────────────

export interface FlowLinkV2 {
  id: string;
  source: string;
  target: string;
  branchId: string;
  dataType: string;
  isExplore?: boolean;
  isInactive?: boolean;
  /** 连线语义类型：data_flow | sequence | parallel | reference (LinkSemanticType) */
  linkType?: string;
  /** 引用类型：KMC 11 种 ref_type (input / character_ref / scene_ref / ...) */
  refType?: string;
  /**
   * 71-05 (v3.2 F37):前端兼容 data 袋——CanvasEdge 读 data?.linkType 画
   * 序列蓝线。关系层持久位是顶层 link_type 列,listLinks 读时重建本袋。
   */
  data?: { linkType?: string } & Record<string, unknown>;
}

// ─── 分支 ──────────────────────────────────────

export interface FlowBranchV2 {
  id: string;
  label: string;
  parentId?: string;
  parentNodeId?: string;
  status: BranchStatus;
  forkReason?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, any>;
}

// ─── 变体组 ────────────────────────────────────

export interface VariantGroupV2 {
  id: string;
  phaseIndex: number;
  branchId: string;
  variantNodeIds: string[];
  winnerNodeId?: string;
  selectMode: "single" | "multi";
}

// ─── 元信息 ────────────────────────────────────

export interface FlowMetaV2 {
  version: "2";
  projectId: number;
  episodesId: number;
  pipelineId?: string;
  createdAt: number;
  updatedAt: number;
  viewport?: { x: number; y: number; zoom: number };
  lastEventId?: number;
}

// ─── 完整 FlowGraph v2 ──────────────────────────

export interface FlowGraphV2 {
  meta: FlowMetaV2;
  nodes: FlowNodeV2[];
  links: FlowLinkV2[];
  branches: FlowBranchV2[];
  variantGroups: VariantGroupV2[];
}
