import type { FlowGraphV2, FlowNodeV2, FlowLinkV2, FlowBranchV2, VariantGroupV2, ReviewStatus } from "@/types/flowgraph-v2";

export type CanvasEventType =
  | "node_upsert"
  | "node_delete"
  | "link_upsert"
  | "link_delete"
  | "branch_upsert"
  | "branch_delete"
  | "variant_group_upsert"
  | "review_status"
  | "bootstrap";

export interface CanvasEventBase {
  eventId?: number;
  projectId: number;
  episodesId: number;
  clientId: string;
  source?: string;
  createdAt?: number;
}

export interface NodeUpsertPayload extends Partial<Omit<FlowNodeV2, "id">> {}

export interface ReviewStatusPayload {
  reviewStatus: ReviewStatus;
  rejectReason?: string;
  suggestion?: string;
  isWinner?: boolean;
  aiScore?: unknown;
}

export interface BootstrapPayload {
  graph: FlowGraphV2;
}

export interface CanvasEvent<T extends CanvasEventType = CanvasEventType> extends CanvasEventBase {
  type: T;
  nodeId?: string;
  payload: T extends "node_upsert" ? NodeUpsertPayload
    : T extends "node_delete" ? null
    : T extends "link_upsert" ? Partial<Omit<FlowLinkV2, "id">>
    : T extends "link_delete" ? null
    : T extends "branch_upsert" ? Partial<Omit<FlowBranchV2, "id">>
    : T extends "branch_delete" ? null
    : T extends "variant_group_upsert" ? Partial<Omit<VariantGroupV2, "id">>
    : T extends "review_status" ? ReviewStatusPayload
    : T extends "bootstrap" ? BootstrapPayload
    : unknown;
}

export interface StoredEventRow {
  eventId: number;
  projectId: number;
  episodesId: number;
  clientId: string;
  type: CanvasEventType;
  nodeId: string | null;
  payload: string;
  source: string | null;
  createdAt: number;
}

export function parseStoredRow(row: StoredEventRow): CanvasEvent {
  return {
    eventId: row.eventId,
    projectId: row.projectId,
    episodesId: row.episodesId,
    clientId: row.clientId,
    type: row.type,
    nodeId: row.nodeId ?? undefined,
    payload: JSON.parse(row.payload),
    source: row.source ?? undefined,
    createdAt: row.createdAt,
  };
}
