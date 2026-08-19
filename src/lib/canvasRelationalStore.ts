/**
 * canvasRelationalStore.ts — Relational storage for canvas FlowGraph.
 *
 * Replaces the event-sourcing layer (canvasEventStore + canvasReducer) with
 * direct relational tables: canvas_nodes, canvas_links, canvas_branches,
 * canvas_variant_groups, canvas_graph_meta.
 *
 * Each node/link is a ROW, not a serialized JSON blob. UPSERT is O(1) per
 * row. Load is a single SELECT — no replay, no O(N²) recompute.
 *
 * Winner selection truth source (Phase 49, D-01): the selection is persisted
 * ONLY in canvas_variant_groups.winner_node_id + canvas_nodes.is_winner. The
 * node `data` JSON blob is deliberately NOT rewritten on selection — the v3
 * adapter treats the group-level winnerNodeId as authoritative, and avoiding
 * the whole-blob rewrite prevents clobbering concurrent data edits.
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

// ─── Internal helpers ─────────────────────────────────────

function now(): number {
  return Date.now();
}

// ─── Batch chunking (SQLite compound-SELECT safety) ────────────
//
// Knex compiles a batch `.insert(rows)` against SQLite3 as
//   INSERT INTO t (...) SELECT ... UNION ALL SELECT ... UNION ALL ...
// SQLite caps compound SELECT terms at SQLITE_MAX_COMPOUND_SELECT (500).
// Exceeding it throws `too many terms in compound SELECT` and rolls the
// whole transaction back — silently losing the save on large pipelines.
// Chunk size 400 stays safely under the 500 limit (and, at 22 cols × 400
// = 8800 bound params, well under modern SQLite's 32766-variable limit).
const SQLITE_CHUNK_SIZE = 400;

/**
 * Insert `rows` into `tableName` in chunks of SQLITE_CHUNK_SIZE, UPSERTing
 * on `conflictTarget` and merging `mergeColumns`. Splits one oversized
 * INSERT … UNION ALL chain into several safe ones without changing the
 * transaction boundary (caller still wraps in a single trx).
 */
async function chunkedInsert(
  trx: any,
  tableName: string,
  rows: any[],
  conflictTarget: string[],
  mergeColumns: string[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += SQLITE_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + SQLITE_CHUNK_SIZE);
    await trx(tableName)
      .insert(chunk)
      .onConflict(conflictTarget)
      .merge(mergeColumns);
  }
}

/**
 * Delete rows matching `where` whose id is in `ids`, chunked so a large
 * stale-id list never overflows SQLite's variable / compound limits.
 */
async function chunkedDelete(
  trx: any,
  tableName: string,
  where: any,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += SQLITE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + SQLITE_CHUNK_SIZE);
    await trx(tableName).where(where).whereIn("id", chunk).del();
  }
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
        branch_id, data_type, link_type, ref_type, is_explore, is_inactive,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, project_id, episodes_id) DO UPDATE SET
       source_id=excluded.source_id,
       target_id=excluded.target_id,
       branch_id=excluded.branch_id,
       data_type=excluded.data_type,
       link_type=excluded.link_type,
       ref_type=excluded.ref_type,
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
      link.linkType ?? null,
      link.refType ?? null,
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
    ...(r.link_type && { linkType: r.link_type }),
    ...(r.ref_type && { refType: r.ref_type }),
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

// ─── Winner Selection (Phase 49 — SELECT-01, D-01/D-03/D-07) ───────────────

/**
 * Result of a selectWinnerInGroup call. The db handle is a PARAMETER (48-02
 * "db handle as parameter" decision) so verify scripts and future plans can
 * inject their own knex instance.
 */
export interface SelectWinnerResult {
  status: "updated" | "idempotent" | "not_found" | "not_in_group" | "multi_mode";
  groupId: string;
  winnerNodeId: string;
  /** 1-based position of the winner inside group.variantNodeIds; 0 unless status is updated/idempotent. */
  variantIndex: number;
  /** Winner node phase_name (e.g. "p11_first_last_frames") for the 49-02 review bridge; null when unknown. */
  winnerPhaseName: string | null;
  /** o_assets.id the winner node maps to (data.oAssetId, or the a-oasset-<id> prefix); null when unmapped. */
  winnerOAssetId: number | null;
  /** All mapped o_assets ids of the group members (winner included when mapped); consumed by the D-07 swap. */
  memberOAssetIds: number[];
  /** o_assets ids whose isPrimaryView was swapped by the endpoint (D-07); [] unless the endpoint filled it. */
  swappedAssetIds: number[];
}

/** Parse a canvas node `data` JSON column (string or object) defensively. */
function parseNodeData(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Resolve the o_assets id a canvas node maps to (verified_fact 1):
 * data.oAssetId first (sync-assets.ts writes it), then the `a-oasset-<id>`
 * node-id prefix. Returns null when the node maps to no asset.
 */
function extractOAssetIdFromNode(nodeId: string, data: Record<string, any>): number | null {
  const raw = data?.oAssetId;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string" && raw !== "" && Number.isInteger(Number(raw))) return Number(raw);
  if (nodeId.startsWith("a-oasset-")) {
    const parsed = Number.parseInt(nodeId.slice("a-oasset-".length), 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

/**
 * SELECT-01 / D-01 / D-03: transactional winner selection for a variant
 * group, writing the two truth columns (winner_node_id + is_winner).
 *
 * Semantics (order matters — first match short-circuits, no writes on any
 * non-updated branch):
 *   not_found    — no canvas_variant_groups row for (scope, groupId)
 *   multi_mode   — group.select_mode !== "single" (a multi group refuses a
 *                  single winner instead of corrupting it with one)
 *   not_in_group — winnerNodeId not inside the group's variant_node_ids
 *   idempotent   — winner_node_id already equals winnerNodeId → ZERO writes
 *   updated      — single transaction: ① group.winner_node_id ② per-member
 *                  canvas_nodes.is_winner (winner=true, siblings=false).
 *                  Dangling variant_node_ids entries (no canvas_nodes row)
 *                  are tolerated: is_winner is only written to existing rows.
 *
 * The node `data` blob is intentionally untouched (see file header). This
 * function performs NO o_assets writes — the D-07 swap lives in
 * syncAssetPrimaryForWinner and must stay outside this transaction so its
 * failure can never roll back the canvas truth.
 */
export async function selectWinnerInGroup(
  trxDb: any,
  scope: { projectId: number; episodesId: number },
  groupId: string,
  winnerNodeId: string,
): Promise<SelectWinnerResult> {
  const groupWhere = {
    id: groupId,
    project_id: scope.projectId,
    episodes_id: scope.episodesId,
  };

  const reject = (status: SelectWinnerResult["status"]): SelectWinnerResult => ({
    status,
    groupId,
    winnerNodeId,
    variantIndex: 0,
    winnerPhaseName: null,
    winnerOAssetId: null,
    memberOAssetIds: [],
    swappedAssetIds: [],
  });

  const group = await trxDb("canvas_variant_groups").where(groupWhere).first();
  if (!group) return reject("not_found");
  if ((group.select_mode ?? "single") !== "single") return reject("multi_mode");

  let variantNodeIds: string[] = [];
  try {
    const parsed = group.variant_node_ids ? JSON.parse(group.variant_node_ids) : [];
    if (Array.isArray(parsed)) variantNodeIds = parsed.filter((id: unknown) => typeof id === "string");
  } catch {
    variantNodeIds = [];
  }
  const variantIndex = variantNodeIds.indexOf(winnerNodeId) + 1;
  if (variantIndex === 0) return reject("not_in_group");

  // Read member rows for the derived fields (phase_name + o_assets mapping).
  // Rows may be missing for dangling variant_node_ids entries — tolerated.
  const memberRows: any[] = await trxDb("canvas_nodes")
    .where({ project_id: scope.projectId, episodes_id: scope.episodesId })
    .whereIn("id", variantNodeIds)
    .select("id", "data", "phase_name");

  const memberOAssetIds: number[] = [];
  let winnerPhaseName: string | null = null;
  let winnerOAssetId: number | null = null;
  for (const memberId of variantNodeIds) {
    const row = memberRows.find((r) => r.id === memberId);
    if (!row) continue;
    const oAssetId = extractOAssetIdFromNode(row.id, parseNodeData(row.data));
    if (oAssetId != null && !memberOAssetIds.includes(oAssetId)) memberOAssetIds.push(oAssetId);
    if (memberId === winnerNodeId) {
      winnerPhaseName = row.phase_name ?? null;
      winnerOAssetId = oAssetId;
    }
  }

  // D-03: re-selecting the current winner is a no-op — return BEFORE any
  // UPDATE statement can run.
  if (group.winner_node_id === winnerNodeId) {
    return {
      status: "idempotent",
      groupId,
      winnerNodeId,
      variantIndex,
      winnerPhaseName,
      winnerOAssetId,
      memberOAssetIds,
      swappedAssetIds: [],
    };
  }

  const ts = now();
  await trxDb.transaction(async (trx: any) => {
    // ① Group truth column
    await trx("canvas_variant_groups")
      .where(groupWhere)
      .update({ winner_node_id: winnerNodeId, updated_at: ts });
    // ② Per-member is_winner — all mapped rows exist-or-not; missing rows
    // simply match nothing (dangling tolerance). Two statements keep every
    // value parameterized through the knex builder.
    await trx("canvas_nodes")
      .where({ project_id: scope.projectId, episodes_id: scope.episodesId })
      .whereIn("id", variantNodeIds)
      .update({ is_winner: false, updated_at: ts });
    await trx("canvas_nodes")
      .where({
        id: winnerNodeId,
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
      })
      .update({ is_winner: true, updated_at: ts });
  });

  return {
    status: "updated",
    groupId,
    winnerNodeId,
    variantIndex,
    winnerPhaseName,
    winnerOAssetId,
    memberOAssetIds,
    swappedAssetIds: [],
  };
}

/**
 * D-07: after a canvas winner selection, swap o_assets.isPrimaryView so the
 * asset center reflects the same choice. Runs OUTSIDE the selection
 * transaction — the caller wraps it in try/catch and only warns on failure
 * (canvas is the truth source of this endpoint; o_assets is downstream).
 *
 * Swap scope (T-49-04): same projectId AND (same underlying assetsId family
 * OR one of the group's member assets). Never touches cross-group or
 * cross-project rows.
 *
 * Returns the ids whose isPrimaryView actually changed.
 */
export async function syncAssetPrimaryForWinner(
  trxDb: any,
  projectId: number,
  winnerOAssetId: number | null,
  memberOAssetIds: number[],
): Promise<number[]> {
  if (winnerOAssetId == null) return [];

  const winnerRow = await trxDb("o_assets")
    .where({ id: winnerOAssetId, projectId })
    .first();
  if (!winnerRow) return [];

  const familyAssetsId =
    winnerRow.assetsId != null ? Number(winnerRow.assetsId) : null;
  const members = Array.from(
    new Set((memberOAssetIds ?? []).filter((id) => Number.isInteger(id))),
  );

  // Demotion candidate scope — same projectId, currently primary, NOT the
  // winner, and inside the sibling family (shared assetsId / the family
  // primary's own id) or the explicit member set.
  const demoteScope = (b: any) => {
    if (familyAssetsId != null) {
      b.orWhere("assetsId", familyAssetsId).orWhere("id", familyAssetsId);
    }
    if (members.length > 0) {
      b.orWhereIn("id", members);
    }
  };

  // Guard: with no family and no members there is NO sibling scope at all —
  // demoting "every primary in the project" would be a cross-group attack.
  if (familyAssetsId == null && members.length === 0) {
    const changed = winnerRow.isPrimaryView === 1 ? [] : [winnerOAssetId];
    await trxDb("o_assets")
      .where({ id: winnerOAssetId, projectId })
      .update({ isPrimaryView: 1 });
    return changed;
  }

  const swapped: number[] = [];
  await trxDb.transaction(async (trx: any) => {
    const demoteRows: any[] = await trx("o_assets")
      .where({ projectId })
      .where("isPrimaryView", 1)
      .where("id", "!=", winnerOAssetId)
      .where(demoteScope)
      .select("id");
    if (demoteRows.length > 0) {
      await trx("o_assets")
        .where({ projectId })
        .where("isPrimaryView", 1)
        .where("id", "!=", winnerOAssetId)
        .where(demoteScope)
        .update({ isPrimaryView: 0 });
      swapped.push(...demoteRows.map((r) => r.id));
    }
    await trx("o_assets")
      .where({ id: winnerOAssetId, projectId })
      .update({ isPrimaryView: 1 });
    if (winnerRow.isPrimaryView !== 1) swapped.push(winnerOAssetId);
  });
  return swapped;
}

/**
 * WR-03: demotion-only half of the D-07 swap — used when a selection's
 * winner maps to NO o_assets row (unmapped canvas node) or its row lives
 * under a different projectId, so syncAssetPrimaryForWinner can promote
 * nothing. The previous winner's asset must still LOSE isPrimaryView —
 * otherwise o_assets keeps a stale primary that canvas no longer endorses
 * (the registry/canvas truth sources silently diverge). Demotes ONLY the
 * given ids under the given projectId; promotes nothing; never touches
 * cross-project rows. Returns the ids whose isPrimaryView actually changed.
 */
export async function demoteAssets(
  trxDb: any,
  projectId: number,
  assetIds: number[],
): Promise<number[]> {
  const ids = Array.from(
    new Set((assetIds ?? []).filter((id) => Number.isInteger(id))),
  );
  if (ids.length === 0) return [];

  const rows: any[] = await trxDb("o_assets")
    .where({ projectId })
    .where("isPrimaryView", 1)
    .whereIn("id", ids)
    .select("id");
  if (rows.length === 0) return [];

  await trxDb("o_assets")
    .where({ projectId })
    .where("isPrimaryView", 1)
    .whereIn("id", ids)
    .update({ isPrimaryView: 0 });
  return rows.map((r) => r.id);
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

  // ── Incremental upsert strategy (fixes race condition B-1) ──────────
  // Previously this used DELETE ALL + INSERT ALL, which loses concurrent
  // writes: two load-modify-save transactions racing each other would wipe
  // out nodes/links that the other transaction had just inserted. Instead we
  // now (1) UPSERT every row in the new graph and (2) DELETE only the rows
  // that are present in the DB but absent from the new graph. Concurrent
  // saves to *different* rows no longer clobber each other, and the whole
  // operation stays inside a single transaction.
  await db.transaction(async (trx) => {
    const where = {
      project_id: scope.projectId,
      episodes_id: scope.episodesId,
    };
    const conflictTarget = ["id", "project_id", "episodes_id"];
    const ts = now();

    // ── 1. Upsert nodes ──
    const newNodeIds = new Set(nodes.map((n) => n.id));
    if (nodes.length > 0) {
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
      await chunkedInsert(
        trx,
        "canvas_nodes",
        nodeRows,
        conflictTarget,
        // Only merge mutable columns — preserve created_at on existing rows.
        [
          "type",
          "branch_id",
          "phase_index",
          "phase_name",
          "position_x",
          "position_y",
          "size_width",
          "size_height",
          "data",
          "state",
          "review_status",
          "ai_score",
          "is_winner",
          "reject_reason",
          "suggestion",
          "variant_of",
          "variant_group_id",
          "updated_at",
        ],
      );
    }
    // Delete nodes that no longer exist in the new graph
    const existingNodeRows: any[] = await trx("canvas_nodes").where(where).select("id");
    const nodeIdsToDelete = existingNodeRows
      .map((r) => r.id)
      .filter((id: string) => !newNodeIds.has(id));
    if (nodeIdsToDelete.length > 0) {
      await chunkedDelete(trx, "canvas_nodes", where, nodeIdsToDelete);
    }

    // ── 2. Upsert links ──
    const newLinkIds = new Set(links.map((l) => l.id));
    if (links.length > 0) {
      const linkRows = links.map((l) => ({
        id: l.id,
        project_id: scope.projectId,
        episodes_id: scope.episodesId,
        source_id: l.source,
        target_id: l.target,
        branch_id: l.branchId ?? "main",
        data_type: l.dataType ?? "text",
        link_type: l.linkType ?? null,
        ref_type: l.refType ?? null,
        is_explore: l.isExplore ? 1 : 0,
        is_inactive: l.isInactive ? 1 : 0,
        created_at: ts,
        updated_at: ts,
      }));
      await chunkedInsert(
        trx,
        "canvas_links",
        linkRows,
        conflictTarget,
        [
          "source_id",
          "target_id",
          "branch_id",
          "data_type",
          "link_type",
          "ref_type",
          "is_explore",
          "is_inactive",
          "updated_at",
        ],
      );
    }
    // Delete links that no longer exist in the new graph
    const existingLinkRows: any[] = await trx("canvas_links").where(where).select("id");
    const linkIdsToDelete = existingLinkRows
      .map((r) => r.id)
      .filter((id: string) => !newLinkIds.has(id));
    if (linkIdsToDelete.length > 0) {
      await chunkedDelete(trx, "canvas_links", where, linkIdsToDelete);
    }

    // ── 3. Upsert branches ──
    const newBranchIds = new Set(branches.map((b) => b.id));
    if (branches.length > 0) {
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
      await chunkedInsert(
        trx,
        "canvas_branches",
        branchRows,
        conflictTarget,
        [
          "label",
          "parent_id",
          "parent_node_id",
          "status",
          "fork_reason",
          "metadata",
          "updated_at",
        ],
      );
    }
    // Delete branches that no longer exist in the new graph
    // (never delete the implicit "main" branch)
    const existingBranchRows: any[] = await trx("canvas_branches").where(where).select("id");
    const branchIdsToDelete = existingBranchRows
      .map((r) => r.id)
      .filter((id: string) => !newBranchIds.has(id) && id !== "main");
    if (branchIdsToDelete.length > 0) {
      await chunkedDelete(trx, "canvas_branches", where, branchIdsToDelete);
    }

    // ── 4. Upsert variant groups ──
    const newVgIds = new Set(variantGroups.map((vg) => vg.id));
    if (variantGroups.length > 0) {
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
      await chunkedInsert(
        trx,
        "canvas_variant_groups",
        vgRows,
        conflictTarget,
        [
          "phase_index",
          "branch_id",
          "variant_node_ids",
          "winner_node_id",
          "select_mode",
          "updated_at",
        ],
      );
    }
    // Delete variant groups that no longer exist in the new graph
    const existingVgRows: any[] = await trx("canvas_variant_groups").where(where).select("id");
    const vgIdsToDelete = existingVgRows
      .map((r) => r.id)
      .filter((id: string) => !newVgIds.has(id));
    if (vgIdsToDelete.length > 0) {
      await chunkedDelete(trx, "canvas_variant_groups", where, vgIdsToDelete);
    }

    // ── 5. Touch meta ──
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
