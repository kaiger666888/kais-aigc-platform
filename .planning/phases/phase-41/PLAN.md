# Phase 41 — Implementation Plan

**Branch:** `feature/v1.9-canvas-event-sourcing`
**Strategy:** Three waves, additive-first. Wave 1 ships pure additions (zero risk to existing routes). Wave 2 wraps legacy routes onto the new pipeline (behavior-preserving). Wave 3 adds replay + verification.

```
Wave 1 (CORE) ──► Wave 2 (COMPAT) ──► Wave 3 (REPLAY + VERIFY)
  event log         legacy shim          since-param + WS subscribe + verify
  reducer           migration            tsc + verify-phase-41
```

Each wave is one atomic commit. Wave 1 alone already delivers agent-side idempotency wins.

---

## Wave 1 — CORE: event log + reducer + write endpoint

### T1.1 — Database table

**File:** `src/lib/initDB.ts` (insert near line 1063, after `kv_syncEvent`)

Add `kv_canvasEvent`:

```ts
{
  name: "kv_canvasEvent",
  builder: (table) => {
    table.increments("eventId").primary();          // monotonic cursor for replay
    table.integer("projectId").notNullable();
    table.integer("episodesId").notNullable();
    table.string("clientId", 128).notNullable();     // agent-supplied idempotency key
    table.string("type", 48).notNullable();
    table.text("nodeId");
    table.text("payload").notNullable();             // JSON
    table.string("source", 32);                      // "agent" | "canvas-ui" | "review-callback" | "migration"
    table.bigInteger("createdAt").notNullable();
    table.unique(["projectId", "episodesId", "clientId"], "uniq_canvas_event_client");
    table.index(["projectId", "episodesId", "eventId"], "idx_canvas_event_seq");
    table.index(["projectId", "episodesId", "nodeId"], "idx_canvas_event_node");
  },
},
```

**Verify:** app boots, table exists.

### T1.2 — Event types + reducer

**File (new):** `src/lib/canvasEventTypes.ts`
**File (new):** `src/lib/canvasReducer.ts`

`canvasEventTypes.ts` — discriminated union:

```ts
export type CanvasEventType =
  | "node_upsert" | "node_delete"
  | "link_upsert" | "link_delete"
  | "branch_upsert" | "variant_group_upsert"
  | "review_status" | "bootstrap";

export interface CanvasEvent<T extends CanvasEventType = CanvasEventType, P = unknown> {
  eventId?: number;
  projectId: number;
  episodesId: number;
  clientId: string;
  type: T;
  nodeId?: string;
  payload: P;
  source?: string;
  createdAt?: number;
}
```

`canvasReducer.ts` — pure function:

```ts
export function reduce(state: FlowGraphV2, event: CanvasEvent): FlowGraphV2
export function reduceAll(events: CanvasEvent[]): FlowGraphV2  // builds from empty graph
```

Merge semantics must match `nodes.ts:172` (`Object.assign(existing, updates)`) and `nodes.ts:226` exactly — shallow merge, last-write-wins per field, deletions splice.

**Verify:** unit-level deterministic test in `scripts/verify-phase-41.ts`.

### T1.3 — Event store (transactional append + recompute)

**File (new):** `src/lib/canvasEventStore.ts`

Exposes:

```ts
appendEvents(input: { projectId, episodesId, clientId, events[], source? }): Promise<{ eventIds: number[], duplicated: boolean }>
listEvents(input: { projectId, episodesId, since?: number, limit?: number }): Promise<CanvasEvent[]>
getLastEventId(projectId, episodesId): Promise<number | null>
recomputeGraph(projectId, episodesId): Promise<FlowGraphV2>   // also writes o_agentWorkData snapshot
ensureBootstrap(projectId, episodesId): Promise<void>         // SYNC-05
```

Internals:
- `appendEvents` opens a Knex transaction; for each event, attempts insert. On `UNIQUE` violation (clientId collision), short-circuits and returns the previously-stored eventIds for that clientId with `duplicated: true`.
- After successful append, calls `recomputeGraph` (debounced via in-process Map keyed by `projectId:episodesId`, flushed synchronously when `loadGraph` is about to read).
- `ensureBootstrap` is idempotent: if `getLastEventId` is null AND `o_agentWorkData.canvasGraph` exists, dumps current graph as one synthetic `bootstrap` event whose payload IS the entire graph; reducer handles `bootstrap` by replacing state wholesale.

### T1.4 — Write endpoint

**File (new):** `src/routes/canvas/v2/events.ts`

```ts
POST /
  body: { projectId, episodesId, clientId, source?, events: Array<{type, nodeId?, payload}> }
  → 200 { eventIds, duplicated, lastEventId }
```

Wire into `src/router.ts` (or wherever canvas v2 is mounted — grep `v2/canvas`) under `/api/v2/canvas/events`.

Broadcast after commit: `broadcastToProject(projectId, "canvas:event", { eventId, type, payload, projectId, episodesId })` for each new eventId.

**Verify:** `curl POST /api/v2/canvas/events` with duplicate `clientId` returns same `eventIds` and `duplicated: true`.

---

## Wave 2 — COMPAT: legacy routes translate to events

### T2.1 — `save-v2` routes through event store

**File:** `src/routes/canvas/v2/save-v2.ts`

Current behavior: validates graph, then insert/update `o_agentWorkData` directly.

New behavior: validate graph (unchanged), then:
- If graph exists in `o_agentWorkData` AND no prior events: call `ensureBootstrap` first (one-time).
- Diff current graph vs incoming graph, emit a single `bootstrap` event with the new full graph (we accept the over-write semantic for back-compat — `save-v2` was always full-replace).
- Generated `clientId = "legacy:save-v2:" + Date.now() + ":" + random`.

Visible response unchanged.

### T2.2 — `nodes` POST / PATCH /batch / PATCH /:id / DELETE

**File:** `src/routes/canvas/v2/nodes.ts`

Each route:
- Validates (unchanged).
- Builds the corresponding event(s): `node_upsert` for POST + PATCH /batch (per node), `node_upsert` for PATCH /:id (payload = `updates`), `node_delete` for DELETE.
- Calls `appendEvents` with a generated legacy `clientId`.
- Returns the same response shape as before.
- Broadcast calls preserved (now redundant with event broadcast but kept for back-compat until SYNC-10 flag is on by default).

### T2.3 — `links` / `branches`

**Files:** `src/routes/canvas/v2/links.ts`, `src/routes/canvas/v2/branches.ts`

Same pattern as T2.2: translate writes to `link_upsert` / `link_delete` / `branch_upsert` events.

**Verify:** existing Phase 35-38 playwright suite still green (no behavior regression).

---

## Wave 3 — REPLAY + VERIFY

### T3.1 — `load-v2` supports `since`

**File:** `src/routes/canvas/v2/load-v2.ts`

Add optional `since` query param:

```ts
validateFields({
  projectId: z.number(),
  episodesId: z.number(),
  since: z.number().int().optional(),
})
```

- Without `since`: ensure bootstrap → recompute → return `{ graph, lastEventId }`.
- With `since`: return `{ events: CanvasEvent[], lastEventId }`.

Response shape changes from `success(graph)` to `success({ graph, lastEventId })` — **breaking** for callers expecting raw graph. Mitigation: keep `graph` at top level (just add `lastEventId` alongside); old callers ignore the new field.

### T3.2 — WS subscribe handshake

**Files:** `src/utils/ws.ts`, `src/app.ts` (or wherever socket.io is initialized — find `setIo`).

Add server-side listener for `subscribe`:

```ts
io.of("/ws/projects").on("connection", (socket) => {
  socket.on("subscribe", async ({ projectId, since }) => {
    await socket.join(`project:${projectId}`);
    if (since !== undefined) {
      const events = await listEvents({ projectId, since, limit: 500 });
      for (const ev of events) socket.emit("canvas:event", ev);
      if (events.length === 500) {
        // R3 mitigation: client likely too far behind, send reset signal
        socket.emit("canvas:reset", { lastEventId: await getLastEventId(projectId, ...) });
      }
    }
  });
});
```

Existing `broadcastToProject` unchanged in signature; the new `canvas:event` payload shape includes `eventId`.

### T3.3 — Frontend hook (feature-flagged)

**File:** `packages/infinite-canvas/src/hooks/useCanvasSocket.ts`

Add (behind `import.meta.env.VITE_CANVAS_EVENT_REPLAY === '1'`):
- Local `lastEventIdRef` (initialized from a `load-v2` call).
- On `connect`: `socket.emit('subscribe', { projectId, since: lastEventIdRef.current })`.
- New listener `socket.on('canvas:event', ...)` applies the event via a local reducer copy and stamps `lastEventIdRef`.
- New listener `socket.on('canvas:reset', ...)` triggers a full `load-v2` reload.

Default OFF — existing listeners (`node:state`, `orchestrate:*`, etc.) untouched.

### T3.4 — Verification script

**File (new):** `scripts/verify-phase-41.ts`

Mirrors `verify-phase-39.ts` / `verify-phase-40.ts` pattern. Assertions:

1. **SYNC-01** — `kv_canvasEvent` table exists with expected columns.
2. **SYNC-02** — POST `/api/v2/canvas/events` with `clientId=X` returns `eventIds=[1]`; re-POST with same `clientId=X` returns `duplicated: true, eventIds=[1]` and no new row.
3. **SYNC-03** — Reducer applied to a fixed event list produces a known graph; permuting event order within type-boundaries yields same final state for non-conflicting fields.
4. **SYNC-04** — After appending events, `o_agentWorkData.canvasGraph` reflects the reduced state.
5. **SYNC-05** — Pre-seed `o_agentWorkData.canvasGraph` with a 3-node graph, clear events, call `load-v2`: bootstrap event auto-emitted, returned graph matches seed.
6. **SYNC-06** — `load-v2?since=2` returns exactly events 3..N.
7. **SYNC-09** — POST `/api/v2/canvas/save-v2` with a new graph → subsequent `load-v2` returns that graph (back-compat).
8. **SYNC-12** — Reducer merge parity: direct `Object.assign` vs reducer output on a `node_upsert` with partial fields produce identical node objects.

Register in `package.json` scripts: `"verify:phase-41": "tsx scripts/verify-phase-41.ts"`.

### T3.5 — tsc + build

- `npx tsc --noEmit` at repo root → 0 errors.
- `cd packages/infinite-canvas && yarn build` → success.
- `git status` shows new bundle hash if any frontend change shipped (Wave 3 with flag OFF may produce no bundle change).

---

## Commit Plan

| Wave | Commit message prefix | Files touched |
|------|----------------------|---------------|
| 1 | `feat(canvas/v2): event-sourced write path (kv_canvasEvent + reducer + /events)` | initDB.ts, canvasEventTypes.ts, canvasReducer.ts, canvasEventStore.ts, events.ts, router.ts |
| 2 | `refactor(canvas/v2): route legacy writes through event store` | save-v2.ts, nodes.ts, links.ts, branches.ts |
| 3 | `feat(canvas/v2): resumable WS replay + load-v2 since-param + verify-phase-41` | load-v2.ts, ws.ts, app.ts, useCanvasSocket.ts, scripts/verify-phase-41.ts, package.json |

## Rollback

Each wave is one revert. Wave 2 rollback is the riskiest (legacy routes will revert to direct DB writes; any data written via events stays in event log but won't be re-read by reverted code — `o_agentWorkData` snapshot remains authoritative, so no data loss). Wave 1 rollback requires dropping `kv_canvasEvent` table.

## Out-of-Scope (deferred to Phase 42+)

- Agent-side outbox + retry (independent of canvas receiver).
- Removing legacy write routes.
- Flipping `VITE_CANVAS_EVENT_REPLAY` default to ON (after staging soak).
