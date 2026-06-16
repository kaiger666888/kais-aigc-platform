import { z } from "zod";

// ─── 枚举 schema ────────────────────────────────

export const NodeStateSchema = z.enum([
  "idle", "pending", "running", "success", "error", "skipped",
]);

export const BranchStatusSchema = z.enum([
  "draft", "active", "paused", "completed", "archived", "rejected",
]);

export const ReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const NodeTypeSchema = z.enum([
  "script", "asset", "storyboard", "video", "audio",
  "3d", "variant", "reference", "upscale", "face_restore",
  "suggestion",
]);

// ─── AI 建议 schema ────────────────────────────

export const SuggestionSchema = z.object({
  type: z.enum(["create_node", "modify_param", "branch_split", "merge_branch"]),
  label: z.string(),
  confidence: z.number().min(0).max(1),
  payload: z.record(z.string(), z.any()),
});

// ─── 节点 schema ───────────────────────────────

export const FlowNodeV2Schema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  branchId: z.string(),
  phaseIndex: z.number().int().min(0),
  phaseName: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }),
  data: z.record(z.string(), z.any()),
  state: NodeStateSchema,
  reviewStatus: ReviewStatusSchema.optional(),
  aiScore: z.any().optional(),
  isWinner: z.boolean().optional(),
  rejectReason: z.string().optional(),
  suggestion: z.string().optional(),
  variantOf: z.string().optional(),
  variantGroupId: z.string().optional(),
});

// ─── 边 schema ─────────────────────────────────

export const FlowLinkV2Schema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  branchId: z.string(),
  dataType: z.string(),
  isExplore: z.boolean().optional(),
  isInactive: z.boolean().optional(),
});

// ─── 分支 schema ───────────────────────────────

export const FlowBranchV2Schema = z.object({
  id: z.string(),
  label: z.string(),
  parentId: z.string().optional(),
  parentNodeId: z.string().optional(),
  status: BranchStatusSchema,
  forkReason: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.string(), z.any()).optional(),
});

// ─── 变体组 schema ─────────────────────────────

export const VariantGroupV2Schema = z.object({
  id: z.string(),
  phaseIndex: z.number().int().min(0),
  branchId: z.string(),
  variantNodeIds: z.array(z.string()),
  winnerNodeId: z.string().optional(),
  selectMode: z.enum(["single", "multi"]),
});

// ─── 元信息 schema ──────────────────────────────

export const FlowMetaV2Schema = z.object({
  version: z.literal("2"),
  projectId: z.number(),
  episodesId: z.number(),
  pipelineId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
});

// ─── 完整 FlowGraph v2 schema ──────────────────

export const FlowGraphV2Schema = z.object({
  meta: FlowMetaV2Schema,
  nodes: z.array(FlowNodeV2Schema),
  links: z.array(FlowLinkV2Schema),
  branches: z.array(FlowBranchV2Schema),
  variantGroups: z.array(VariantGroupV2Schema),
});
