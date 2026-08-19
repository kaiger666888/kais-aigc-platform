#!/usr/bin/env tsx
/**
 * verify-phase-49-bridge.ts — Phase 49 Plan 49-02 (SELECT-04) behavioral gate.
 *
 * Asserts the kap → review-platform resolve bridge (src/lib/reviewBridge.ts —
 * resolveOpenReviewForSelection) against a LOCAL node:http mock of the
 * review-platform API bound to 127.0.0.1 on a random port. The real service
 * is never contacted (isolation requirement — this file deliberately
 * contains no literal pointing at the real review-platform address/port).
 *
 * Mock surface (mirrors the verified platform contract):
 *   GET  /api/v1/reviews             → { data: { items, next_cursor, has_more } }
 *   POST /api/v1/reviews/:id/approve → recorded body + configured status
 * Behavior knobs are per-case: items[], approveStatus, hangGet (GET never
 * answers → exercises the client-side AbortSignal timeout).
 *
 * This file REPLACES the 49-01 scaffold (plan 49-01 registered the npm entry
 * once for the whole wave; package.json is untouched here).
 *
 * Run: npm run verify:phase-49-bridge   (or: npx tsx scripts/verify-phase-49-bridge.ts)
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
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

// ─── Mock review-platform (127.0.0.1, random port — never the real service) ──

interface MockReviewItem {
  id: number;
  type: string;
  content_ref: string;
  state?: string;
  source_system?: string;
}
interface MockConfig {
  items: MockReviewItem[];
  approveStatus: number;
  hangGet: boolean;
  /** WR-02: when set, serve page-by-page keyed by the `cursor` query param
   *  (page 0 = no cursor). Overrides `items`. */
  pages?: MockReviewItem[][];
}
let mockConfig: MockConfig = { items: [], approveStatus: 200, hangGet: false };
const requests: Array<{ method: string; url: string; body?: string }> = [];

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    requests.push({
      method: req.method ?? "?",
      url: req.url ?? "?",
      body: Buffer.concat(chunks).toString("utf8") || undefined,
    });
    if (req.method === "GET") {
      if (mockConfig.hangGet) return; // never respond → client AbortSignal.timeout
      res.writeHead(200, { "Content-Type": "application/json" });
      if (mockConfig.pages) {
        // Paginated envelope: cursor = page index; next_cursor points at the
        // next page while has_more is true (mirrors the platform envelope).
        const u = new URL(req.url ?? "/", "http://mock.local");
        const rawCursor = u.searchParams.get("cursor");
        const idx = rawCursor == null || rawCursor === "" ? 0 : Number.parseInt(rawCursor, 10);
        const pageIdx =
          Number.isInteger(idx) && idx >= 0 && idx < mockConfig.pages.length ? idx : 0;
        const hasMore = pageIdx + 1 < mockConfig.pages.length;
        res.end(
          JSON.stringify({
            data: {
              items: mockConfig.pages[pageIdx],
              next_cursor: hasMore ? String(pageIdx + 1) : null,
              has_more: hasMore,
            },
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({ data: { items: mockConfig.items, next_cursor: null, has_more: false } }),
      );
      return;
    }
    if (req.method === "POST") {
      res.writeHead(mockConfig.approveStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { ok: true } }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
});

// ─── Logger capture (the bridge takes its logger as an injected dep) ─────────

interface CapturedLogger {
  infos: string[];
  warns: string[];
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
}
function captureLogger(): CapturedLogger {
  const l = { infos: [] as string[], warns: [] as string[] } as CapturedLogger;
  l.info = (...a: unknown[]) => { l.infos.push(a.map(String).join(" ")); };
  l.warn = (...a: unknown[]) => { l.warns.push(a.map(String).join(" ")); };
  return l;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Phase 49 — verify-phase-49-bridge.ts (SELECT-04 resolve bridge) ===\n");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const mockUrl = `http://127.0.0.1:${addr.port}`;

  // RED pivot: the module must exist and export the bridge
  let bridge: any = null;
  let importErr = "";
  try {
    bridge = await import("../src/lib/reviewBridge");
  } catch (err) {
    importErr = String(err);
  }
  assert(
    !!bridge && typeof bridge.resolveOpenReviewForSelection === "function",
    "bridge: src/lib/reviewBridge exports resolveOpenReviewForSelection",
    importErr.split("\n")[0] || undefined,
  );

  // Source-shape assertions on the bridge library (Task 1 acceptance criteria)
  const bridgeSrc = read("src/lib/reviewBridge.ts");
  assert(!bridgeSrc.includes("@/utils"), "bridge lib: no @/utils import (deps fully injected)");
  assert(
    (bridgeSrc.match(/AbortSignal\.timeout/g) ?? []).length >= 2,
    "bridge lib: every fetch carries AbortSignal.timeout (>= 2 call sites)",
    `${(bridgeSrc.match(/AbortSignal\.timeout/g) ?? []).length} found`,
  );
  assert(
    (bridgeSrc.match(/startsWith\(phaseToken\)/g) ?? []).length === 0,
    "bridge lib (WR-01): NO prefix startsWith(phaseToken) filter remains — exact leading p\\d+ token equality only",
    `${(bridgeSrc.match(/startsWith\(phaseToken\)/g) ?? []).length} startsWith(phaseToken) found`,
  );
  assert(
    bridgeSrc.includes("ep${params.episodesId}") && bridgeSrc.includes("String(params.episodesId)"),
    "bridge lib (CR-01): episode scoping compares both `ep{N}` and bare `{N}` content_ref forms",
  );
  assert(
    bridgeSrc.includes("MAX_LIST_PAGES") && bridgeSrc.includes("next_cursor"),
    "bridge lib (WR-02): bounded next_cursor pagination present",
  );
  assert(
    bridgeSrc.includes("choose:v${"),
    "bridge lib: comment embeds the choose:v{N} marker template",
  );
  assert(
    bridgeSrc.includes("selected: ["),
    "bridge lib: approve body carries the result.selected array",
  );
  assert(
    bridgeSrc.includes("COMPLETE") && bridgeSrc.includes("resolved"),
    "bridge lib: header documents the COMPLETE vs resolved/closed vocabulary gap",
  );

  if (!bridge || typeof bridge.resolveOpenReviewForSelection !== "function") {
    return finish(); // RED state — module not implemented yet
  }

  const baseParams = {
    projectId: 101,
    episodesId: 7,
    groupId: "g1",
    winnerNodeId: "node-b",
    variantIndex: 2,
    winnerPhaseName: "p11_first_last_frames", // → phaseToken "p11"
  };
  async function runCase(
    cfg: Partial<MockConfig>,
    overrides: Record<string, unknown> = {},
    timeoutMs = 1500,
    baseUrl: string = mockUrl,
  ) {
    mockConfig = { items: [], approveStatus: 200, hangGet: false, ...cfg };
    requests.length = 0;
    const log = captureLogger();
    const t0 = Date.now();
    let threw = false;
    let throwMsg = "";
    try {
      await bridge.resolveOpenReviewForSelection({ ...baseParams, ...overrides }, {
        baseUrl,
        timeoutMs,
        logger: log,
      });
    } catch (err) {
      threw = true;
      throwMsg = String(err);
    }
    return { log, threw, throwMsg, elapsedMs: Date.now() - t0 };
  }
  const posts = () => requests.filter((r) => r.method === "POST");
  const gets = () => requests.filter((r) => r.method === "GET");
  const approving = (id: number, type: string, content_ref: string): MockReviewItem => ({
    id,
    type,
    content_ref,
    state: "APPROVING",
    source_system: "kais-movie-agent",
  });

  // (0) null winnerPhaseName → info skip, zero HTTP
  console.log("\n=== (0) null winnerPhaseName → info skip, zero HTTP ===");
  const r0 = await runCase({}, { winnerPhaseName: null });
  assert(!r0.threw, "(0) null phase: resolves without throw", r0.throwMsg);
  assert(requests.length === 0, "(0) null phase: NO HTTP request at all", `${requests.length} requests`);
  assert(r0.log.infos.length >= 1, "(0) null phase: skip is info-logged");

  // (a) zero open reviews → GET with source+status filters, no POST
  console.log("\n=== (a) zero open reviews → GET query filters, no POST ===");
  const ra = await runCase({ items: [] }, {}, 1500, `${mockUrl}/`); // trailing slash: normalization check
  assert(!ra.threw, "(a) empty list: resolves without throw", ra.throwMsg);
  assert(gets().length === 1, "(a) exactly one GET issued", `${gets().length}`);
  const getUrl = new URL(gets()[0].url, "http://mock.local");
  assert(
    getUrl.pathname === "/api/v1/reviews",
    "(a) GET path = /api/v1/reviews (path appended after baseUrl normalization)",
    getUrl.pathname,
  );
  assert(
    getUrl.searchParams.get("source") === "kais-movie-agent",
    "(a) GET query source = kais-movie-agent",
    String(getUrl.searchParams.get("source")),
  );
  assert(
    getUrl.searchParams.get("status") === "APPROVING",
    "(a) GET query status = APPROVING (open-review state)",
    String(getUrl.searchParams.get("status")),
  );
  assert(posts().length === 0, "(a) zero open reviews → NO approve POST");
  assert(
    ra.log.infos.some((m) => m.includes("无挂起 gate")),
    "(a) 0-hit skip is info-logged (常态)",
  );

  // (b) exactly one match → approve POST with choose:v2 + selected=[2]
  console.log("\n=== (b) exactly one match → approve with choose:v2 + selected=[2] ===");
  const rb = await runCase({ items: [approving(7, "p11a0", "ep7/p11a0")] });
  assert(!rb.threw, "(b) one hit: resolves without throw", rb.throwMsg);
  assert(posts().length === 1, "(b) exactly one approve POST", `${posts().length}`);
  assert(
    posts()[0].url === "/api/v1/reviews/7/approve",
    "(b) POST path = /api/v1/reviews/7/approve",
    posts()[0].url,
  );
  const bBody = JSON.parse(posts()[0].body ?? "{}");
  assert(
    JSON.stringify(bBody?.result?.selected) === "[2]",
    "(b) body.result.selected = [2] (1-based variantIndex)",
    JSON.stringify(bBody?.result?.selected),
  );
  assert(
    typeof bBody?.comment === "string" && bBody.comment.includes("choose:v2"),
    "(b) body.comment embeds the choose:v2 marker",
    JSON.stringify(bBody?.comment),
  );
  assert(
    typeof bBody?.comment === "string" &&
      bBody.comment.includes("g1") && bBody.comment.includes("node-b"),
    "(b) body.comment carries group/winner context",
    JSON.stringify(bBody?.comment),
  );
  assert(rb.log.infos.length >= 1, "(b) success is info-logged");

  // (c) type does not match the phase token → filtered out, no POST
  console.log("\n=== (c) type filter: 'p04x' vs token 'p11' → no POST ===");
  const rc = await runCase({ items: [approving(9, "p04x", "ep7/p04x")] });
  assert(!rc.threw, "(c) type mismatch: resolves without throw", rc.throwMsg);
  assert(posts().length === 0, "(c) type 'p04x' ≠ token 'p11' → NO approve POST");
  assert(
    rc.log.infos.some((m) => m.includes("无挂起 gate")),
    "(c) filtered-out behaves like zero-hit (info skip)",
  );

  // (c2) type matches but content_ref phase segment does not → filtered out
  console.log("\n=== (c2) content_ref filter: phase segment 'p04z' vs token 'p11' → no POST ===");
  const rc2 = await runCase({ items: [approving(10, "p11b2", "ep7/p04z")] });
  assert(!rc2.threw, "(c2) content_ref mismatch: resolves without throw", rc2.throwMsg);
  assert(
    posts().length === 0,
    "(c2) type matches but content_ref 'ep7/p04z' phase ≠ p11 → NO approve POST (double filter)",
  );

  // (d) two matches → ambiguity guard, no POST
  console.log("\n=== (d) two matches → ambiguity guard, no POST ===");
  const rd = await runCase({
    items: [approving(7, "p11a0", "ep7/p11a0"), approving(8, "p11a1", "ep7/p11a1")],
  });
  assert(!rd.threw, "(d) ambiguity: resolves without throw", rd.throwMsg);
  assert(
    posts().length === 0,
    "(d) 2 hits → NO approve POST (never resolve someone else's gate)",
  );
  assert(rd.log.warns.some((m) => m.includes("歧义")), "(d) ambiguity is warn-logged");

  // (e) approve 409 → treated as resolved-elsewhere, warn + no throw
  console.log("\n=== (e) approve 409 → resolved-elsewhere, warn + no throw ===");
  const re = await runCase(
    { items: [approving(7, "p11a0", "ep7/p11a0")], approveStatus: 409 },
  );
  assert(!re.threw, "(e) 409: resolves without throw (已被别处 resolve)", re.throwMsg);
  assert(posts().length === 1, "(e) the approve POST was attempted");
  assert(
    re.log.warns.some((m) => m.includes("别处") || m.includes("409")),
    "(e) 409 is warn-logged",
  );

  // (e2) approve non-2xx → warn, no throw
  console.log("\n=== (e2) approve 500 → warn, no throw ===");
  const re2 = await runCase(
    { items: [approving(7, "p11a0", "ep7/p11a0")], approveStatus: 500 },
  );
  assert(!re2.threw, "(e2) non-2xx approve: resolves without throw", re2.throwMsg);
  assert(re2.log.warns.length >= 1, "(e2) non-2xx approve is warn-logged");

  // (f) hanging mock → AbortSignal timeout, no throw
  console.log("\n=== (f) hanging mock → AbortSignal timeout, no throw ===");
  const rf = await runCase({ hangGet: true }, {}, 250);
  assert(!rf.threw, "(f) timeout: resolves without throw", rf.throwMsg);
  assert(
    rf.elapsedMs < 5000,
    "(f) the injected timeoutMs is honored (no 5s default hang)",
    `${rf.elapsedMs}ms`,
  );
  assert(rf.log.warns.length >= 1, "(f) timeout is warn-logged (swallowed exception)");
  assert(gets().length === 1, "(f) the GET was attempted before the abort");

  // (g) CR-01: a phase-matching gate from ANOTHER episode must never be approved
  console.log("\n=== (g) wrong-episode gate (CR-01) → fail closed, no POST ===");
  const rg = await runCase({ items: [approving(21, "p11a0", "ep-OTHER/p11a0")] });
  assert(!rg.threw, "(g) foreign episode: resolves without throw", rg.throwMsg);
  assert(
    posts().length === 0,
    "(g) content_ref episode 'ep-OTHER' ≠ episodesId 7 → NO approve POST",
  );
  assert(
    rg.log.infos.some((m) => m.includes("无挂起 gate")),
    "(g) foreign-episode gate is indistinguishable from zero-hit (fail closed)",
  );
  assert(
    rg.log.warns.length === 0,
    "(g) wrong-episode skip stays info-level (a foreign gate is not OUR ambiguity)",
  );

  // (g2) CR-01 positive: the bare-numeric episode form "7/p11a0" also matches
  console.log("\n=== (g2) bare episode id form '7/p11a0' matches episodesId 7 ===");
  const rg2 = await runCase({ items: [approving(22, "p11a0", "7/p11a0")] });
  assert(
    posts().length === 1 && posts()[0].url === "/api/v1/reviews/22/approve",
    "(g2) bare episode id form '7/p11a0' → approve POST (both id forms accepted)",
    `${posts().length} posts`,
  );

  // (h) WR-01: token 'p1' must not prefix-collide with gate 'p11a0'
  console.log("\n=== (h) phase-token prefix collision (WR-01) → no POST ===");
  const rh = await runCase(
    { items: [approving(23, "p11a0", "ep7/p11a0")] },
    { winnerPhaseName: "p1_tone" },
  );
  assert(!rh.threw, "(h) p1_tone selection: resolves without throw", rh.throwMsg);
  assert(
    posts().length === 0,
    "(h) token 'p1' vs gate 'p11a0' → NO approve POST (exact boundary match)",
  );

  // (i) WR-02: the matching gate sits beyond page 1 — next_cursor must be followed
  console.log("\n=== (i) multi-page list (WR-02) → next_cursor followed ===");
  const filler = Array.from({ length: 3 }, (_, k) => approving(100 + k, "p04z", `ep7/p04z-${k}`));
  const ri = await runCase({ pages: [filler, [approving(7, "p11a0", "ep7/p11a0")]] });
  assert(!ri.threw, "(i) paginated list: resolves without throw", ri.throwMsg);
  assert(gets().length === 2, "(i) two GETs issued — next_cursor followed to page 2", `${gets().length}`);
  const iUrls = gets().map((r) => new URL(r.url, "http://mock.local"));
  assert(
    iUrls.length === 2 && iUrls[1].searchParams.get("cursor") === "1",
    "(i) page-2 GET carries cursor=1 (page-1 next_cursor)",
    iUrls.length === 2 ? String(iUrls[1].searchParams.get("cursor")) : "n/a",
  );
  assert(
    posts().length === 1 && posts()[0].url === "/api/v1/reviews/7/approve",
    "(i) page-2 gate approved (would be MISSED by the old first-page-only read)",
  );

  // (i2) WR-02: pagination is bounded — an unbounded list fails closed, no POST
  console.log("\n=== (i2) list longer than the page bound → fail closed ===");
  const manyPages = Array.from({ length: 12 }, () => [] as MockReviewItem[]);
  const ri2 = await runCase({ pages: manyPages });
  assert(!ri2.threw, "(i2) truncated list: resolves without throw", ri2.throwMsg);
  assert(posts().length === 0, "(i2) >10 pages with has_more still true → NO approve POST");
  assert(
    gets().length === 10,
    "(i2) pagination bounded at 10 GETs (MAX_LIST_PAGES)",
    `${gets().length}`,
  );
  assert(
    ri2.log.warns.some((m) => m.includes("页")),
    "(i2) truncation is warn-logged",
  );

  // ── select-winner route wiring (Task 2) ──────────────────────────────────
  console.log("\n=== select-winner route wiring (fire-and-forget mount) ===");
  const routeSrc = read("src/routes/canvas/v2/select-winner.ts");
  assert(
    routeSrc.includes("resolveOpenReviewForSelection"),
    "route: bridge call present in select-winner.ts",
  );
  assert(
    /void\s+resolveOpenReviewForSelection\(/.test(routeSrc),
    "route: call is void-prefixed — the response never awaits the bridge (T-49-06)",
  );
  assert(
    /resolveOpenReviewForSelection\([\s\S]*?\}\)\s*\.catch\(/.test(routeSrc),
    "route: call carries a .catch backstop",
  );
  assert(
    routeSrc.indexOf("applied: false") < routeSrc.indexOf("void resolveOpenReviewForSelection"),
    "route: idempotent branch (applied:false) returns BEFORE the bridge call — idempotent path never bridges",
  );
  assert(
    routeSrc.indexOf("await syncAssetPrimaryForWinner") < routeSrc.indexOf("void resolveOpenReviewForSelection"),
    "route: bridge fires at the 49-01 seam, after the D-07 o_assets swap",
  );

  return finish();
}

// ─── Summary ────────────────────────────────────────────────────────────────

async function finish(): Promise<void> {
  server.close();
  server.closeAllConnections?.();
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} ===`);
  if (passed === total) {
    console.log("✅ Phase 49 bridge verification PASSED (SELECT-04)");
    process.exit(0);
  } else {
    console.log("❌ Phase 49 bridge verification FAILED");
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-phase-49-bridge.ts crashed:", err);
  server.close();
  server.closeAllConnections?.();
  process.exit(2);
});
