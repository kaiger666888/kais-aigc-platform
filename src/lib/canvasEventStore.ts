import u from "@/utils";
import { db } from "@/utils/db";
import type { FlowGraphV2 } from "@/types/flowgraph-v2";
import type { CanvasEvent, CanvasEventType } from "@/lib/canvasEventTypes";
import { parseStoredRow } from "@/lib/canvasEventTypes";
import { reduceAll } from "@/lib/canvasReducer";

const CANVAS_GRAPH_KEY = "canvasGraph";
const REPLAY_LIMIT = 500;

interface AppendInput {
  projectId: number;
  episodesId: number;
  clientId: string;
  source?: string;
  events: Array<{ type: CanvasEventType; nodeId?: string; payload: unknown }>;
}

interface AppendResult {
  eventIds: number[];
  duplicated: boolean;
  lastEventId: number | null;
}

const recomputePending = new Map<string, Promise<FlowGraphV2>>();

function scopeKey(projectId: number, episodesId: number) {
  return `${projectId}:${episodesId}`;
}

async function loadSnapshotRow(projectId: number, episodesId: number) {
  return u
    .db("o_agentWorkData")
    .where("projectId", String(projectId))
    .andWhere("episodesId", String(episodesId))
    .andWhere("key", CANVAS_GRAPH_KEY)
    .first();
}

async function readSnapshot(projectId: number, episodesId: number): Promise<FlowGraphV2 | null> {
  const row = await loadSnapshotRow(projectId, episodesId);
  if (!row?.data) return null;
  try {
    const parsed = JSON.parse(row.data);
    if (parsed?.meta?.version === "2") return parsed as FlowGraphV2;
  } catch {
    return null;
  }
  return null;
}

async function writeSnapshot(projectId: number, episodesId: number, graph: FlowGraphV2): Promise<void> {
  const existing = await loadSnapshotRow(projectId, episodesId);
  const data = JSON.stringify(graph);
  const now = Date.now();
  graph.meta.updatedAt = now;

  if (!existing) {
    await u.db("o_agentWorkData").insert({
      projectId,
      episodesId,
      key: CANVAS_GRAPH_KEY,
      data,
      createTime: now,
      updateTime: now,
    });
  } else {
    await u
      .db("o_agentWorkData")
      .where("id", existing.id)
      .update({ data, updateTime: now });
  }
}

export async function getLastEventId(projectId: number, episodesId: number): Promise<number | null> {
  const row = await u
    .db("kv_canvasEvent")
    .where("projectId", projectId)
    .andWhere("episodesId", episodesId)
    .max("eventId as maxId")
    .first();
  return (row as any)?.maxId ?? null;
}

export async function listEvents(
  projectId: number,
  episodesId: number,
  since?: number,
  limit: number = REPLAY_LIMIT,
): Promise<CanvasEvent[]> {
  const query = u
    .db("kv_canvasEvent")
    .where("projectId", projectId)
    .andWhere("episodesId", episodesId)
    .orderBy("eventId", "asc")
    .limit(limit);

  if (since !== undefined) {
    query.andWhere("eventId", ">", since);
  }

  const rows = await query;
  return rows.map((row: any) => parseStoredRow(row));
}

export async function ensureBootstrap(projectId: number, episodesId: number): Promise<boolean> {
  const lastId = await getLastEventId(projectId, episodesId);
  if (lastId !== null) return false;

  const snapshot = await readSnapshot(projectId, episodesId);
  if (!snapshot) return false;

  const now = Date.now();
  const clientId = `bootstrap:${projectId}:${episodesId}:${now}`;
  await u.db("kv_canvasEvent").insert({
    projectId,
    episodesId,
    clientId,
    type: "bootstrap",
    nodeId: null,
    payload: JSON.stringify({ graph: snapshot }),
    source: "migration",
    createdAt: now,
  });
  return true;
}

export async function recomputeGraph(projectId: number, episodesId: number): Promise<FlowGraphV2> {
  const key = scopeKey(projectId, episodesId);
  const inflight = recomputePending.get(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const events = await listEvents(projectId, episodesId, undefined, Number.MAX_SAFE_INTEGER);
      const graph = reduceAll(events, projectId, episodesId);
      await writeSnapshot(projectId, episodesId, graph);
      return graph;
    } finally {
      recomputePending.delete(key);
    }
  })();

  recomputePending.set(key, promise);
  return promise;
}

export async function appendEvents(input: AppendInput): Promise<AppendResult> {
  const { projectId, episodesId, clientId, source = "agent", events } = input;

  return await db.transaction(async (trx) => {
    const prior = await trx("kv_canvasEvent")
      .where("projectId", projectId)
      .andWhere("episodesId", episodesId)
      .where((builder: any) => {
        for (const ev of events) {
          builder.orWhere("clientId", `${clientId}::${ev.type}::${ev.nodeId ?? ""}`);
        }
      })
      .select("eventId", "clientId", "type", "nodeId");

    const priorKeys = new Set(prior.map((r: any) => `${r.clientId}|${r.type}|${r.nodeId ?? ""}`));
    const allAlreadyPresent = events.every(
      (ev) => priorKeys.has(`${clientId}::${ev.type}::${ev.nodeId ?? ""}`),
    );

    if (allAlreadyPresent && events.length > 0) {
      const eventIds = prior
        .filter((r: any) => events.some((ev) => r.type === ev.type && (r.nodeId ?? "") === (ev.nodeId ?? "")))
        .map((r: any) => r.eventId);
      const lastId = await trx("kv_canvasEvent")
        .where("projectId", projectId)
        .andWhere("episodesId", episodesId)
        .max("eventId as maxId")
        .first();
      return { eventIds, duplicated: true, lastEventId: lastId?.maxId ?? null };
    }

    const now = Date.now();
    const rowsToInsert = events.map((ev) => ({
      projectId,
      episodesId,
      clientId: `${clientId}::${ev.type}::${ev.nodeId ?? ""}`,
      type: ev.type,
      nodeId: ev.nodeId ?? null,
      payload: JSON.stringify(ev.payload ?? null),
      source,
      createdAt: now,
    }));

    const inserted = await trx("kv_canvasEvent").insert(rowsToInsert, "eventId");
    const rawInserted = (Array.isArray(inserted) ? inserted : [inserted]).flat();
    // better-sqlite3 returns [{ eventId: N }] instead of [N]; normalize to plain numbers
    const eventIds = rawInserted.map((row: any) =>
      typeof row === "object" && row !== null ? Number(row.eventId) : Number(row),
    );
    const lastId = eventIds.length > 0 ? eventIds[eventIds.length - 1] : null;

    return { eventIds, duplicated: false, lastEventId: lastId };
  });
}

export async function appendAndSync(input: AppendInput): Promise<AppendResult> {
  const result = await appendEvents(input);
  if (!result.duplicated) {
    await recomputeGraph(input.projectId, input.episodesId);
  }
  return result;
}

export async function loadGraph(projectId: number, episodesId: number): Promise<FlowGraphV2 | null> {
  await ensureBootstrap(projectId, episodesId);
  const pending = recomputePending.get(scopeKey(projectId, episodesId));
  if (pending) {
    await pending;
  }
  return readSnapshot(projectId, episodesId);
}
