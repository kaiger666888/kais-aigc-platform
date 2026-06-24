import type { FlowGraphV2, FlowNodeV2, FlowLinkV2, FlowBranchV2, VariantGroupV2 } from "@/types/flowgraph-v2";
import type { CanvasEvent } from "@/lib/canvasEventTypes";

function emptyGraph(projectId: number, episodesId: number): FlowGraphV2 {
  const now = Date.now();
  return {
    meta: {
      version: "2",
      projectId,
      episodesId,
      createdAt: now,
      updatedAt: now,
    },
    nodes: [],
    links: [],
    branches: [],
    variantGroups: [],
  };
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function reduce(state: FlowGraphV2, event: CanvasEvent): FlowGraphV2 {
  const next = clone(state);
  next.meta.updatedAt = event.createdAt ?? Date.now();

  switch (event.type) {
    case "bootstrap": {
      const incoming = (event.payload as { graph: FlowGraphV2 }).graph;
      return {
        ...incoming,
        meta: {
          ...incoming.meta,
          projectId: state.meta.projectId,
          episodesId: state.meta.episodesId,
          updatedAt: next.meta.updatedAt,
        },
      };
    }

    case "node_upsert": {
      if (!event.nodeId) break;
      const payload = event.payload as Partial<FlowNodeV2>;
      const idx = next.nodes.findIndex((n) => n.id === event.nodeId);
      if (idx >= 0) {
        next.nodes[idx] = { ...next.nodes[idx], ...payload };
      } else {
        next.nodes.push({ id: event.nodeId, ...payload } as FlowNodeV2);
      }
      break;
    }

    case "node_delete": {
      if (!event.nodeId) break;
      next.nodes = next.nodes.filter((n) => n.id !== event.nodeId);
      next.links = next.links.filter((l) => l.source !== event.nodeId && l.target !== event.nodeId);
      break;
    }

    case "link_upsert": {
      if (!event.nodeId) break;
      const payload = event.payload as Partial<FlowLinkV2>;
      const idx = next.links.findIndex((l) => l.id === event.nodeId);
      if (idx >= 0) {
        next.links[idx] = { ...next.links[idx], ...payload };
      } else {
        next.links.push({ id: event.nodeId, ...payload } as FlowLinkV2);
      }
      break;
    }

    case "link_delete": {
      if (!event.nodeId) break;
      next.links = next.links.filter((l) => l.id !== event.nodeId);
      break;
    }

    case "branch_upsert": {
      if (!event.nodeId) break;
      const payload = event.payload as Partial<FlowBranchV2>;
      const idx = next.branches.findIndex((b) => b.id === event.nodeId);
      if (idx >= 0) {
        next.branches[idx] = { ...next.branches[idx], ...payload };
      } else {
        next.branches.push({ id: event.nodeId, ...payload } as FlowBranchV2);
      }
      break;
    }

    case "branch_delete": {
      if (!event.nodeId) break;
      next.branches = next.branches.filter((b) => b.id !== event.nodeId);
      next.nodes = next.nodes.filter((n) => n.branchId !== event.nodeId);
      next.links = next.links.filter((l) => l.branchId !== event.nodeId);
      break;
    }

    case "variant_group_upsert": {
      if (!event.nodeId) break;
      const payload = event.payload as Partial<VariantGroupV2>;
      const idx = next.variantGroups.findIndex((g) => g.id === event.nodeId);
      if (idx >= 0) {
        next.variantGroups[idx] = { ...next.variantGroups[idx], ...payload };
      } else {
        next.variantGroups.push({ id: event.nodeId, ...payload } as VariantGroupV2);
      }
      break;
    }

    case "review_status": {
      if (!event.nodeId) break;
      const payload = event.payload as {
        reviewStatus: FlowNodeV2["reviewStatus"];
        rejectReason?: string;
        suggestion?: string;
        isWinner?: boolean;
        aiScore?: unknown;
      };
      const node = next.nodes.find((n) => n.id === event.nodeId);
      if (node) {
        node.reviewStatus = payload.reviewStatus;
        if (payload.rejectReason !== undefined) node.rejectReason = payload.rejectReason;
        if (payload.suggestion !== undefined) node.suggestion = payload.suggestion;
        if (payload.isWinner !== undefined) node.isWinner = payload.isWinner;
        if (payload.aiScore !== undefined) node.aiScore = payload.aiScore;
      }
      break;
    }

    default:
      break;
  }

  return next;
}

export function reduceAll(events: CanvasEvent[], projectId: number, episodesId: number): FlowGraphV2 {
  let state = emptyGraph(projectId, episodesId);
  for (const ev of events) {
    state = reduce(state, ev);
  }
  return state;
}
