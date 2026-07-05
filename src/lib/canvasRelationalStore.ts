/**
 * canvasRelationalStore.ts — Relational storage for canvas FlowGraph.
 *
 * Replaces the event-sourcing layer (canvasEventStore + canvasReducer) with
 * direct relational tables: canvas_nodes, canvas_links, canvas_branches,
 * canvas_variant_groups, canvas_graph_meta.
 *
 * Each node/link is a ROW, not a serialized JSON blob. UPSERT is O(1) per
 * row. Load is a single SELECT — no replay, no O(N²) recompute.
 */

import { db } from "@/utils/db";
import type {
  FlowGraphV2,
  FlowNodeV2,
  FlowLinkV2,
  FlowBranchV2,
  VariantGroupV2,
} from "@/types/flowgraph-v2";

// ─── Types ────────────────────────────────────────

interface Scope {
  projectId: number;
  episodesId: number;
}

// ─── Internal helpers ─────────────────────────────

function now(): number {
  return Date.now();
}

// ─── Node CRUD ────────────────────────────────────

export async function upsertNode(scope: Scope, node: FlowNodeV2): Promise<void> {
  const ts = now();
  const data = JSON.stringify(node.data ?? {});

  // SQLite UPSERT (ON CONFLICT ... DO UPDATE)
  await db.raw(
    `INSERT INTO canvas_nodes
       (id, project_id, episodes_id, type, branch_id, phase_index, phase_name,
        position_x, position_y, size_width, size_height, data, state,
        review_status, ai_score, is_winner, reject_reason, suggestion,
        variant_of, variant_group_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET
       type=excluded.type,
       branch_id=excluded.branch_id,
       phase_index=excluded.phase_index,
       phase_name=excluded.phase_name,
       position_x=excluded.position_x,
       position_y=excluded.position_y,
       size_width=excluded.size_width,
       size_height=excluded.size_height,
       data=excluded.data,
       state=excluded.state,
       review_status=excluded.review_status,
       ai_score=excluded.ai_score,
       is_winner=excluded.is_winner,
       reject_reason=excluded.reject_reason,
       suggestion=excluded.suggestion,
       variant_of=excluded.variant_of,
       variant_group_id=excluded.variant_group_id,
       updated_at=excluded.updated_at`,
    [
      node.id,
      scope.projectId,
      scope.episodesId,
      node.type,
      node.branchId ?? "main",
      node.phaseIndex ?? 0,
      node.phaseName ?? "",
      node.position?.x ?? 0,
      node.position?.y ?? 0,
      node.size?.width ?? 260,
      node.size?.height ?? 180,
      data,
      node.state ?? "idle",
      node.reviewStatus ?? null,
      node.aiScore != null ? JSON.stringify(node.aiScore) : null,
      node.isWinner ?? 0,
      node.rejectReason ?? null,
      node.suggestion ?? null,
      node.variantOf ?? null,
      node.variantGroupId ?? null,
      ts,
      ts,
    ],
  );
}

export async function deleteNode(scope: Scope, nodeId: string): Promise<void> {
  const { projectId, episodesId } = scope;
  await db.transaction(async (trx) => {
    await trx("canvas_links")
      .where({ project_id: projectId, episodes_id: episodesId })
      .andWhere((b: any) => b.where("source_id", nodeId).orWhere("target_id", nodeId))
      .del();
    await trx("canvas_nodes")
      .where({ id: nodeId, project_id: projectId, episodes_id: episodesId })
      .del();
  });
}

export async function listNodes(scope: Scope): Promise<FlowNodeV2[]> {
  const rows = await db("canvas_nodes")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .select("*");

  return rows.map((r: any): FlowNodeV2 => ({
    id: r.id,
    type: r.type,
    branchId: r.branch_id,
    phaseIndex: r.phase_index,
    phaseName: r.phase_name,
    position: { x: r.position_x, y: r.position_y },
    size: { width: r.size_width, height: r.size_height },
    data: r.data ? JSON.parse(r.data) : {},
    state: r.state,
    ...(r.review_status && { reviewStatus: r.review_status }),
    ...(r.ai_score != null && { aiScore: JSON.parse(r.ai_score) }),
    ...(r.is_winner && { isWinner: true }),
    ...(r.reject_reason && { rejectReason: r.reject_reason }),
    ...(r.suggestion && { suggestion: r.suggestion }),
    ...(r.variant_of && { variantOf: r.variant_of }),
    ...(r.variant_group_id && { variantGroupId: r.variant_group_id }),
  }));
}

// ─── Link CRUD ────────────────────────────────────

export async function upsertLink(scope: Scope, link: FlowLinkV2): Promise<void> {
  const ts = now();
  await db.raw(
    `INSERT INTO canvas_links
       (id, project_id, episodes_id, source_id, target_id,
        branch_id, data_type, is_explore, is_inactive, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET
       source_id=excluded.source_id,
       target_id=excluded.target_id,
       branch_id=excluded.branch_id,
       data_type=excluded.data_type,
       is_explore=excluded.is_explore,
       is_inactive=excluded.is_inactive,
       updated_at=excluded.updated_at`,
    [
      link.id,
      scope.projectId,
      scope.episodesId,
      link.source,
      link.target,
      link.branchId ?? "main",
      link.dataType ?? "text",
      link.isExplore ? 1 : 0,
      link.isInactive ? 1 : 0,
      ts,
      ts,
    ],
  );
}

export async function deleteLink(scope: Scope, linkId: string): Promise<void> {
  await db("canvas_links")
    .where({
      id: linkId,
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .del();
}

export async function listLinks(scope: Scope): Promise<FlowLinkV2[]> {
  const rows = await db("canvas_links")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .select("*");

  return rows.map((r: any): FlowLinkV2 => ({
    id: r.id,
    source: r.source_id,
    target: r.target_id,
    branchId: r.branch_id,
    dataType: r.data_type,
    ...(r.is_explore && { isExplore: true }),
    ...(r.is_inactive && { isInactive: true }),
  }));
}

// ─── Branch CRUD ──────────────────────────────────

export async function upsertBranch(scope: Scope, branch: FlowBranchV2): Promise<void> {
  const ts = now();
  const metadata = branch.metadata ? JSON.stringify(branch.metadata) : null;
  await db.raw(
    `INSERT INTO canvas_branches
       (id, project_id, episodes_id, label, parent_id, parent_node_id,
        status, fork_reason, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET
       label=excluded.label,
       parent_id=excluded.parent_id,
       parent_node_id=excluded.parent_node_id,
       status=excluded.status,
       fork_reason=excluded.fork_reason,
       metadata=excluded.metadata,
       updated_at=excluded.updated_at`,
    [
      branch.id,
      scope.projectId,
      scope.episodesId,
      branch.label,
      branch.parentId ?? null,
      branch.parentNodeId ?? null,
      branch.status ?? "active",
      branch.forkReason ?? null,
      metadata,
      branch.createdAt ?? ts,
      branch.updatedAt ?? ts,
    ],
  );
}

export async function listBranches(scope: Scope): Promise<FlowBranchV2[]> {
  const rows = await db("canvas_branches")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .select("*");

  return rows.map((r: any): FlowBranchV2 => ({
    id: r.id,
    label: r.label,
    status: r.status,
    ...(r.parent_id && { parentId: r.parent_id }),
    ...(r.parent_node_id && { parentNodeId: r.parent_node_id }),
    ...(r.fork_reason && { forkReason: r.fork_reason }),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.metadata && { metadata: JSON.parse(r.metadata) }),
  }));
}

// ─── Variant Group CRUD ───────────────────────────

export async function upsertVariantGroup(scope: Scope, vg: VariantGroupV2): Promise<void> {
  const variantNodeIds = JSON.stringify(vg.variantNodeIds ?? []);
  const ts = now();
  await db.raw(
    `INSERT INTO canvas_variant_groups
       (id, project_id, episodes_id, phase_index, branch_id,
        variant_node_ids, winner_node_id, select_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET
       phase_index=excluded.phase_index,
       branch_id=excluded.branch_id,
       variant_node_ids=excluded.variant_node_ids,
       winner_node_id=excluded.winner_node_id,
       select_mode=excluded.select_mode,
       updated_at=excluded.updated_at`,
    [
      vg.id,
      scope.projectId,
      scope.episodesId,
      vg.phaseIndex ?? 0,
      vg.branchId ?? "main",
      variantNodeIds,
      vg.winnerNodeId ?? null,
      vg.selectMode ?? "single",
      ts,
      ts,
    ],
  );
}

export async function listVariantGroups(scope: Scope): Promise<VariantGroupV2[]> {
  const rows = await db("canvas_variant_groups")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .select("*");

  return rows.map((r: any): VariantGroupV2 => ({
    id: r.id,
    phaseIndex: r.phase_index,
    branchId: r.branch_id,
    variantNodeIds: r.variant_node_ids ? JSON.parse(r.variant_node_ids) : [],
    ...(r.winner_node_id && { winnerNodeId: r.winner_node_id }),
    selectMode: r.select_mode ?? "single",
  }));
}

// ─── Meta ─────────────────────────────────────────

export async function getMeta(scope: Scope): Promise<{ createdAt: number; updatedAt: number; lastEventId: number } | null> {
  const row = await db("canvas_graph_meta")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .first();
  if (!row) return null;
  return {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastEventId: row.last_event_id ?? 0,
  };
}

export async function touchMeta(scope: Scope): Promise<number> {
  const ts = now();
  const existing = await db("canvas_graph_meta")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .first();

  // Increment last_event_id atomically
  if (!existing) {
    await db("canvas_graph_meta").insert({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
      created_at: ts,
      updated_at: ts,
      last_event_id: 1,
    });
    return 1;
  } else {
    const nextId = (existing.last_event_id ?? 0) + 1;
    await db("canvas_graph_meta")
      .where({
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
      })
      .update({ updated_at: ts, last_event_id: nextId });
    return nextId;
  }
}

export async function ensureMeta(scope: Scope): Promise<void> {
  const existing = await db("canvas_graph_meta")
    .where({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    })
    .first();
  if (!existing) {
    const ts = now();
    await db("canvas_graph_meta").insert({
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
      created_at: ts,
      updated_at: ts,
      last_event_id: 0,
    });
  }
}

// ─── Full Graph Save (batch UPSERT) ───────────────

export async function saveFullGraph(scope: Scope, graph: FlowGraphV2): Promise<void> {
  const nodes = graph.nodes ?? [];
  const links = graph.links ?? [];
  const branches = graph.branches ?? [];
  const variantGroups = graph.variantGroups ?? [];

  // Ensure default main branch exists
  if (!branches.some((b) => b.id === "main")) {
    const ts = now();
    branches.unshift({
      id: "main",
      label: "主线",
      status: "active",
      createdAt: ts,
      updatedAt: ts,
    });
  }

  await db.transaction(async (trx) => {
    // Clear existing data for this scope, then re-insert.
    // This is simpler than diffing and is safe within a transaction.
    const where = {
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    };
    await trx("canvas_nodes").where(where).del();
    await trx("canvas_links").where(where).del();
    await trx("canvas_branches").where(where).del();
    await trx("canvas_variant_groups").where(where).del();

    // Batch insert nodes
    if (nodes.length > 0) {
      const ts = now();
      const nodeRows = nodes.map((n) => ({
        id: n.id,
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
        type: n.type,
        branch_id: n.branchId ?? "main",
        phase_index: n.phaseIndex ?? 0,
        phase_name: n.phaseName ?? "",
        position_x: n.position?.x ?? 0,
        position_y: n.position?.y ?? 0,
        size_width: n.size?.width ?? 260,
        size_height: n.size?.height ?? 180,
        data: JSON.stringify(n.data ?? {}),
        state: n.state ?? "idle",
        review_status: n.reviewStatus ?? null,
        ai_score: n.aiScore != null ? JSON.stringify(n.aiScore) : null,
        is_winner: n.isWinner ? 1 : 0,
        reject_reason: n.rejectReason ?? null,
        suggestion: n.suggestion ?? null,
        variant_of: n.variantOf ?? null,
        variant_group_id: n.variantGroupId ?? null,
        created_at: ts,
        updated_at: ts,
      }));
      await trx("canvas_nodes").insert(nodeRows);
    }

    // Batch insert links
    if (links.length > 0) {
      const ts = now();
      const linkRows = links.map((l) => ({
        id: l.id,
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
        source_id: l.source,
        target_id: l.target,
        branch_id: l.branchId ?? "main",
        data_type: l.dataType ?? "text",
        is_explore: l.isExplore ? 1 : 0,
        is_inactive: l.isInactive ? 1 : 0,
        created_at: ts,
        updated_at: ts,
      }));
      await trx("canvas_links").insert(linkRows);
    }

    // Batch insert branches
    if (branches.length > 0) {
      const ts = now();
      const branchRows = branches.map((b) => ({
        id: b.id,
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
        label: b.label,
        parent_id: b.parentId ?? null,
        parent_node_id: b.parentNodeId ?? null,
        status: b.status ?? "active",
        fork_reason: b.forkReason ?? null,
        metadata: b.metadata ? JSON.stringify(b.metadata) : null,
        created_at: b.createdAt ?? ts,
        updated_at: b.updatedAt ?? ts,
      }));
      await trx("canvas_branches").insert(branchRows);
    }

    // Batch insert variant groups
    if (variantGroups.length > 0) {
      const ts = now();
      const vgRows = variantGroups.map((vg) => ({
        id: vg.id,
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
        phase_index: vg.phaseIndex ?? 0,
        branch_id: vg.branchId ?? "main",
        variant_node_ids: JSON.stringify(vg.variantNodeIds ?? []),
        winner_node_id: vg.winnerNodeId ?? null,
        select_mode: vg.selectMode ?? "single",
        created_at: ts,
        updated_at: ts,
      }));
      await trx("canvas_variant_groups").insert(vgRows);
    }

    // Touch meta
    const ts2 = now();
    const existingMeta = await trx("canvas_graph_meta").where(where).first();
    const nextEventId = (existingMeta?.last_event_id ?? 0) + 1;
    if (!existingMeta) {
      await trx("canvas_graph_meta").insert({
        ...where,
        created_at: ts2,
        updated_at: ts2,
        last_event_id: 1,
      });
    } else {
      await trx("canvas_graph_meta").where(where).update({
        updated_at: ts2,
        last_event_id: nextEventId,
      });
    }
  });
}

// ─── Full Graph Load ──────────────────────────────

export async function loadFullGraph(scope: Scope): Promise<FlowGraphV2 | null> {
  await ensureMeta(scope);
  const meta = await getMeta(scope);
  const [nodes, links, branches, variantGroups] = await Promise.all([
    listNodes(scope),
    listLinks(scope),
    listBranches(scope),
    listVariantGroups(scope),
  ]);

  // If completely empty, return null (no data yet)
  if (nodes.length === 0 && links.length === 0 && branches.length <= 1) {
    return null;
  }

  const nowTs = now();
  return {
    meta: {
      version: "2" as const,
      projectId: scope.projectId,
      episodesId: scope.episodesId,
      createdAt: meta?.createdAt ?? nowTs,
      updatedAt: meta?.updatedAt ?? nowTs,
      lastEventId: meta?.lastEventId ?? 0,
    },
    nodes,
    links,
    branches: branches.length > 0 ? branches : [{
      id: "main",
      label: "主线",
      status: "active" as const,
      createdAt: nowTs,
      updatedAt: nowTs,
    }],
    variantGroups,
  };
}

// ─── Health / Stats ───────────────────────────────

export async function getScopeStats(scope: Scope): Promise<{ nodeCount: number; linkCount: number; lastEventId: number; updatedAt: number | null }> {
  const [nodeRow, linkRow, meta] = await Promise.all([
    db("canvas_nodes").where({ project_id: scope.projectId, episodes_id: scope.episodesId }).count("* as cnt").first() as Promise<any>,
    db("canvas_links").where({ project_id: scope.projectId, episodes_id: scope.episodesId }).count("* as cnt").first() as Promise<any>,
    getMeta(scope),
  ]);
  return {
    nodeCount: Number(nodeRow?.cnt ?? 0),
    linkCount: Number(linkRow?.cnt ?? 0),
    lastEventId: meta?.lastEventId ?? 0,
    updatedAt: meta?.updatedAt ?? null,
  };
}

export async function getAllScopes(): Promise<Array<{ projectId: number; episodesId: number; nodeCount: number; linkCount: number; lastEventId: number; updatedAt: number }>> {
  const rows: any[] = await db("canvas_graph_meta")
    .select("project_id", "episodes_id", "last_event_id", "updated_at")
    .orderBy("updated_at", "desc");
  const result: Array<{ projectId: number; episodesId: number; nodeCount: number; linkCount: number; lastEventId: number; updatedAt: number }> = [];
  for (const r of rows) {
    const [nc, lc] = await Promise.all([
      db("canvas_nodes").where({ project_id: r.project_id, episodes_id: r.episodes_id }).count("* as c").first() as Promise<any>,
      db("canvas_links").where({ project_id: r.project_id, episodes_id: r.episodes_id }).count("* as c").first() as Promise<any>,
    ]);
    result.push({
      projectId: Number(r.project_id),
      episodesId: Number(r.episodes_id),
      nodeCount: Number(nc?.c ?? 0),
      linkCount: Number(lc?.c ?? 0),
      lastEventId: r.last_event_id ?? 0,
      updatedAt: r.updated_at,
    });
  }
  return result;
}
