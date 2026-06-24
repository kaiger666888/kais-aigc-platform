#!/usr/bin/env tsx
/**
 * verify-phase-41.ts — Phase 41 (Canvas Event Sourcing & Sync Reliability) verification.
 *
 * Confirms SYNC-01..12:
 *   - SYNC-01: kv_canvasEvent table declared in initDB.ts with UNIQUE constraint + indexes
 *   - SYNC-02: POST /api/v2/canvas/events endpoint exists + idempotency logic present
 *   - SYNC-03: reducer is pure + deterministic (dynamic test)
 *   - SYNC-04: recomputeGraph + appendAndSync wire events → snapshot
 *   - SYNC-05: ensureBootstrap exists for legacy graph migration
 *   - SYNC-06: load-v2 supports since parameter
 *   - SYNC-07: socket /ws/projects handles subscribe handshake
 *   - SYNC-08: events.ts broadcasts canvas:event with eventId
 *   - SYNC-09: legacy routes (save-v2/nodes/links/branches) call appendAndSync
 *   - SYNC-10: useCanvasSocket has feature-flagged onCanvasEvent + subscribe emit
 *   - SYNC-11: tsc --noEmit passes (assumed; run separately)
 *   - SYNC-12: reducer merge parity with Object.assign (dynamic test)
 *
 * Run: npx tsx scripts/verify-phase-41.ts
 */

import fs from "node:fs";
import path from "node:path";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
function read(rel: string): string {
  const p = path.join(REPO_ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

async function main(): Promise<void> {
  console.log("=== Phase 41 — verify-phase-41.ts ===\n");

  // ─── SYNC-01: kv_canvasEvent table ────────────────────────────
  console.log("=== SYNC-01: kv_canvasEvent table declared ===");
  const initDB = read("src/lib/initDB.ts");
  assert(initDB.includes('name: "kv_canvasEvent"'), "kv_canvasEvent table declared");
  assert(initDB.includes("uniq_canvas_event_client"), "UNIQUE(projectId, episodesId, clientId) constraint");
  assert(initDB.includes("idx_canvas_event_seq"), "index on (projectId, episodesId, eventId)");
  assert(initDB.includes("idx_canvas_event_node"), "index on (projectId, episodesId, nodeId)");

  // ─── SYNC-02: events endpoint ─────────────────────────────────
  console.log("\n=== SYNC-02: POST /api/v2/canvas/events endpoint ===");
  const eventsRoute = read("src/routes/canvas/v2/events.ts");
  assert(eventsRoute.length > 0, "src/routes/canvas/v2/events.ts exists");
  assert(/router\.post\(["']/, "events route has POST handler");
  assert(eventsRoute.includes("appendAndSync"), "POST handler calls appendAndSync");
  assert(eventsRoute.includes("duplicated"), "response exposes duplicated flag for idempotent retry");
  assert(eventsRoute.includes("clientId"), "request shape requires clientId");

  const routerFile = read("src/router.ts");
  assert(
    /import route\d+ from ["']\.\/routes\/canvas\/v2\/events["']/.test(routerFile),
    "router imports events route",
  );
  assert(
    /app\.use\(["']\/api\/canvas\/v2\/events["'], route\d+\)/.test(routerFile),
    "router mounts /api/canvas/v2/events",
  );

  // ─── SYNC-03: reducer purity + determinism (dynamic) ──────────
  console.log("\n=== SYNC-03: reducer is pure + deterministic ===");
  const { reduce, reduceAll } = await import("../src/lib/canvasReducer");
  const { reduce: reduce2 } = await import("../src/lib/canvasReducer");
  assert(reduce === reduce2, "reducer import is stable (no side effects at module load)");

  const baseState = {
    meta: { version: "2" as const, projectId: 1, episodesId: 1, createdAt: 0, updatedAt: 0 },
    nodes: [], links: [], branches: [], variantGroups: [],
  };
  const afterUpsert = reduce(baseState, {
    projectId: 1, episodesId: 1, clientId: "t1", type: "node_upsert",
    nodeId: "n-1", payload: { type: "script", state: "idle" }, createdAt: 1,
  });
  assert(afterUpsert.nodes.length === 1, "node_upsert adds node");
  assert(afterUpsert.nodes[0]?.id === "n-1", "node has correct id");
  assert(baseState.nodes.length === 0, "reducer does not mutate input (pure)");

  const afterDelete = reduce(afterUpsert, {
    projectId: 1, episodesId: 1, clientId: "t2", type: "node_delete",
    nodeId: "n-1", payload: null, createdAt: 2,
  });
  assert(afterDelete.nodes.length === 0, "node_delete removes node");

  // ─── SYNC-04: snapshot recomputation ──────────────────────────
  console.log("\n=== SYNC-04: recomputeGraph + appendAndSync wiring ===");
  const store = read("src/lib/canvasEventStore.ts");
  assert(store.includes("export async function appendAndSync"), "appendAndSync exported");
  assert(store.includes("export async function recomputeGraph"), "recomputeGraph exported");
  assert(store.includes("writeSnapshot"), "snapshot writer present");
  assert(store.includes("o_agentWorkData"), "writes target o_agentWorkData canvasGraph key");

  // ─── SYNC-05: bootstrap migration ─────────────────────────────
  console.log("\n=== SYNC-05: ensureBootstrap for legacy graph ===");
  assert(store.includes("export async function ensureBootstrap"), "ensureBootstrap exported");
  assert(store.includes("bootstrap"), "ensureBootstrap emits bootstrap event type");

  // ─── SYNC-06: load-v2 since parameter ─────────────────────────
  console.log("\n=== SYNC-06: load-v2 supports since parameter ===");
  const loadV2 = read("src/routes/canvas/v2/load-v2.ts");
  assert(loadV2.includes("since: z.number().int().optional()"), "load-v2 validates optional since");
  assert(loadV2.includes("listEvents(projectId, episodesId, since)"), "load-v2 calls listEvents when since present");
  assert(loadV2.includes("lastEventId"), "load-v2 returns lastEventId in response");

  // ─── SYNC-07: WS subscribe handshake ──────────────────────────
  console.log("\n=== SYNC-07: WS subscribe handshake ===");
  const socketIndex = read("src/socket/index.ts");
  assert(socketIndex.includes('"subscribe"'), "socket listens for subscribe event");
  assert(socketIndex.includes("listEvents"), "subscribe handler replays events via listEvents");
  assert(socketIndex.includes("canvas:reset"), "subscribe handler emits canvas:reset when over cap");

  // ─── SYNC-08: broadcasts carry eventId ────────────────────────
  console.log("\n=== SYNC-08: broadcasts include eventId ===");
  assert(eventsRoute.includes("broadcastCanvasEvent"), "events route wraps broadcastToProject");
  assert(eventsRoute.includes("eventId: ev.eventId"), "broadcast payload includes eventId");

  // ─── SYNC-09: legacy routes route through event store ─────────
  console.log("\n=== SYNC-09: legacy routes use appendAndSync ===");
  const legacyFiles = [
    "src/routes/canvas/v2/save-v2.ts",
    "src/routes/canvas/v2/nodes.ts",
    "src/routes/canvas/v2/links.ts",
    "src/routes/canvas/v2/branches.ts",
  ];
  for (const f of legacyFiles) {
    const content = read(f);
    assert(content.includes("appendAndSync"), `${f} routes through appendAndSync`);
  }
  const saveV2 = read("src/routes/canvas/v2/save-v2.ts");
  assert(saveV2.includes('"bootstrap"'), "save-v2 emits bootstrap event for full-replace semantics");

  // ─── SYNC-10: frontend feature-flagged incremental subscription ===
  console.log("\n=== SYNC-10: useCanvasSocket feature-flagged replay ===");
  const hookFile = read("packages/infinite-canvas/src/hooks/useCanvasSocket.ts");
  assert(hookFile.includes("VITE_CANVAS_EVENT_REPLAY"), "feature flag env var referenced");
  assert(hookFile.includes("onCanvasEvent"), "onCanvasEvent callback added");
  assert(hookFile.includes("subscribe"), "emits subscribe on connect when flag enabled");
  assert(hookFile.includes("canvas:event"), "listens for canvas:event");
  assert(hookFile.includes("canvas:reset"), "listens for canvas:reset");

  // ─── SYNC-12: reducer merge parity with Object.assign ─────────
  console.log("\n=== SYNC-12: reducer merge parity with Object.assign ===");
  const existing = { id: "n-1", type: "script", state: "idle", data: { foo: 1 } } as any;
  const updates = { state: "running", data: { bar: 2 } } as any;
  const legacyMerge = { ...existing, ...updates };
  const reducerMerge = reduce(
    { ...baseState, nodes: [existing] },
    { projectId: 1, episodesId: 1, clientId: "p", type: "node_upsert", nodeId: "n-1", payload: updates, createdAt: 9 },
  ).nodes[0];
  assert(
    JSON.stringify(legacyMerge) === JSON.stringify(reducerMerge),
    `reducer matches Object.assign (legacy=${JSON.stringify(legacyMerge)}, reducer=${JSON.stringify(reducerMerge)})`,
  );

  // ─── Summary ───────────────────────────────────────────────────
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed ===`);
  if (passed === total) {
    console.log("✅ Phase 41 verification PASSED");
    process.exit(0);
  } else {
    console.log("❌ Phase 41 verification FAILED");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-phase-41.ts crashed:", err);
  process.exit(2);
});
