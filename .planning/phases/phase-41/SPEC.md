# Phase 41 — Canvas Event Sourcing & Sync Reliability

**Milestone:** v1.9
**Status:** planning
**Goal:** Eliminate the silent-data-loss class of bugs in kais-movie-agent ↔ kais-aigc-platform canvas sync by replacing the fire-and-forget + read-modify-write + whole-graph-overwrite pattern with an append-only event log + monotonic reducer + idempotent write API + resumable WebSocket subscription.

## Problem Statement

Field symptom: 节点生成物 / 审核状态经常无法同步到无限画布。Root causes (verified against source):

1. **Read-modify-write race on whole-graph blob** — `save-v2.ts:49` updates `o_agentWorkData.data` (entire serialized graph) without any CAS/version check. Concurrent calls (one phase fires `onProgress` + `onPhaseComplete` + `onCanvasPush` concurrently in `canvas-sync-hook.js`) load-mutate-save in parallel; last writer wins, earlier mutations evaporate silently.
2. **Fire-and-forget + empty catch** — `upsertNode({...}).catch(() => {})` appears 4× in `canvas-sync-hook.js`. HTTP failures, timeouts, 5xx are swallowed permanently.
3. **No event replay** — `ws.ts:broadcastToProject` emits and forgets. Frontend that was disconnecting at emit time misses the event forever (socket.io reconnection does NOT replay).
4. **No idempotency on receiver** — `/api/v1/sync/batch` and `/api/v2/canvas/save-v2` accept no client-supplied deduplication key; agent retries = duplicate writes.
5. **No reconciliation** — only pipeline-level `kv_syncStatus`; no per-artifact tracking. Agent's local `.pipeline-state.json` and canvas SQLite drift apart silently.

## Outcome (what is true after this phase)

- An agent retry with the same `clientId` is a no-op (returns the previously assigned `eventId`s).
- Two concurrent writes from different processes NEVER lose data — both events land in the log; reducer merges them deterministically.
- A frontend that disconnects for 30s during a pipeline run and reconnects sees every canvas change that happened while it was gone, in order.
- All canvas writes — agent HTTP, UI HTTP, review callbacks — flow through a single typed event API.
- The legacy `save-v2` / `nodes` / `links` write routes remain functional for the duration of v1.9 (deprecation log only), so existing UI code paths don't break. Removal is a separate phase.

## Requirements

### SYNC — Write Path (event log + reducer)

- **SYNC-01**: New table `kv_canvasEvent(eventId PK autoincrement, projectId, episodesId, clientId, type, nodeId, payload JSON, source, createdAt)` with `UNIQUE(projectId, episodesId, clientId)` and index on `(projectId, episodesId, eventId)`.
- **SYNC-02**: `POST /api/v2/canvas/events` accepts `{projectId, episodesId, clientId, events[]}` and appends each event atomically inside a Knex transaction. Duplicate `clientId` returns the previously-assigned `eventId`s with `duplicated: true` and writes nothing.
- **SYNC-03**: Pure-function reducer `reduce(state, event): state` covers event types `node_upsert` / `node_delete` / `link_upsert` / `link_delete` / `branch_upsert` / `variant_group_upsert` / `review_status`. Output is deterministic given identical event sequence.
- **SYNC-04**: Materialized view in `o_agentWorkData` (key=`canvasGraph`) is recomputed from the event log; recomputation is triggered after every successful append (debounced per project+episode, flushed before any `loadGraph` read returns).
- **SYNC-05**: Initial-bootstrap: if `o_agentWorkData.canvasGraph` exists but `kv_canvasEvent` is empty for that (project, episode), a one-time migration emits a synthetic `bootstrap` event sequence capturing the current graph. Idempotent across restarts.

### REPLAY — Read Path (resumable subscriptions)

- **SYNC-06**: `GET /api/v2/canvas/load-v2` accepts optional `?since=<eventId>` query. Without `since`: returns current graph + `lastEventId`. With `since`: returns the event stream from `since+1` to current + `lastEventId`.
- **SYNC-07**: WebSocket namespace `/ws/projects` accepts a `subscribe` handshake `{projectId, since?}` from the client. Server immediately replays all events after `since` to that socket, then continues live emission. Default behavior (no `subscribe`) preserved for back-compat.
- **SYNC-08**: All canvas WS broadcasts carry `{eventId, type, payload, projectId, episodesId}` so clients can stamp their high-water mark.

### COMPAT — Backwards Compatibility

- **SYNC-09**: Legacy routes `save-v2` / `nodes POST` / `nodes PATCH /batch` / `nodes PATCH /:id` / `links` / `branches` continue to work by internally translating writes into event appends (single-event, generated `clientId`). Visible behavior unchanged from caller's perspective.
- **SYNC-10**: Frontend `useCanvasSocket` retains all existing event listeners (`node:state`, `orchestrate:*`, `branch:*`, `review:*`) AND gains optional `subscribe`+incremental handling behind a feature flag (`VITE_CANVAS_EVENT_REPLAY=1`), defaulting OFF for v1.9 to allow staged rollout.

### VERIFY — Static Verification

- **SYNC-11**: `tsc --noEmit` (root) and `tsc -b` (packages/infinite-canvas) both pass with zero errors.
- **SYNC-12**: `scripts/verify-phase-41.ts` exercises: (a) idempotent append via duplicate `clientId`; (b) reducer determinism on permuted-but-ordered event sequences; (c) `load-v2?since=N` returns exactly events N+1..last; (d) legacy `save-v2` write still persists a graph readable by `load-v2`.

## Out of Scope

- Agent-side outbox + retry (will become Phase 42 — independent of canvas receiver).
- Removing legacy `save-v2` / `nodes` write routes (deferred to v1.10 after agent + UI fully migrated).
- Multi-replica canvas-backend horizontal scaling (single-process append is sufficient for current load; only matters if we shard).
- Frontend CRDT for multi-user editing (still out of scope, as in v1.7).
- Auth on v1 endpoints (already intentionally open for internal mesh — separate security phase).

## Risks

- **R1 — Reducer semantics drift from old `saveGraph` semantics.** Old code did `Object.assign(existing, updates)` (shallow merge with overwrite); reducer must match exactly or UI sees subtle differences. Mitigation: SYNC-12 (b) covers merge-parity tests.
- **R2 — Migration on first read is slow for large graphs.** A 500-node graph → 500 bootstrap events on first read. Mitigation: emit bootstrap in a single transaction, debounce reducer recompute.
- **R3 — WS replay floods a reconnecting client.** If client was offline for hours and thousands of events accumulated, replay could stall the browser. Mitigation: cap replay at most recent N=500 events; if more, fall back to full snapshot + lastEventId (client effectively resets).
- **R4 — Frontend feature flag default OFF means no production benefit until flipped.** Acceptable: backend changes ship value to agent (idempotent writes) even without frontend opt-in.

## Dependencies

- None blocking. Builds on Phase 39 v2 canvas routes (already on master) and Phase 40 review-status normalization.
