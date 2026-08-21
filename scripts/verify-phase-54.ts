#!/usr/bin/env tsx
/**
 * verify-phase-54.ts — Phase 54 (Gate Center + Blocking-State UX) aggregate
 * contract gate (GUARD closing tradition, ROADMAP decision #7).
 *
 *   S-catalog — D-02 zero-drift snapshot: parse the khs authority
 *     (plugins/review_gates/gates.yaml via KAIS_HERMES_SKILLS_PATH) with
 *     js-yaml and diff GATE_CATALOG field-by-field; any khs change to
 *     gates.yaml turns this red. Includes count=16, mode match (p11b
 *     webhook), deriveGateId round-trip per key, redline flags, legacy
 *     alias spot checks. Read-only — never writes khs files.
 *   S-fold — D-04 four-state folding: RESEARCH §E full table (9 branches)
 *     enumerated against foldDisplayState, including the legacy
 *     AUTO/HUMAN-without-decision → approve compat read.
 *   S-forced-fail — proves the gate can go red: mutates the IN-MEMORY parsed
 *     yaml (drop an entry / flip a mode) and re-runs the diff logic; the
 *     mutation MUST be detected. No khs file is ever touched.
 *   S-poller (54-05 Task 1) — GateStateService mechanics with injected
 *     fetchImpl/nodesReader/broadcast: multi-page pagination, truncation
 *     fail-closed, diff no-rebroadcast, change broadcast, fetch-error
 *     degrade keeps snapshot, recovery, redline auto, legacy alias hit,
 *     episode probe, blocking derivation.
 *   S-ops (54-05 Task 2) — spawned-child endpoint dispatch (49-01 pattern):
 *     a stub review-platform (node:http, ephemeral port) + child express app
 *     mounting gate-ops/gate-state; asserts 400 reason-refine, 422
 *     fail-closed scope match, 409→already-resolved idempotent success,
 *     2xx applied:true, 502 platform failure, GET gate-state snapshot
 *     (16 gates + episodeRefs probe + blocking), approve body shape
 *     (result only when selected provided).
 *   S-live — 54-05 Task 3 live 10588-vs-8090 comparison (filled after the
 *     production restart).
 *
 * Self-contained discipline (P7): imports only gateCatalog +
 * gateStateService + js-yaml — no @/utils barrel, no db, no spawn of pytest.
 *
 * Run: npm run verify:phase-54   (or: npx tsx scripts/verify-phase-54.ts)
 * Child mode: npx tsx scripts/verify-phase-54.ts --s-ops-child
 * Exit: 0 all sections pass + self-check behaves / 1 any failure / 2 crash
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import {
  GATE_CATALOG,
  GATE_DISPLAY_NAMES,
  EXPECTED_GATE_COUNT,
  LEGACY_GATE_ID_TO_PHASE_ID,
  deriveGateId,
  foldDisplayState,
  type GateEntry,
} from "../src/lib/gateCatalog";
import {
  GateStateService,
  setGateStateServiceForTest,
  type PlatformReviewItem,
} from "../src/lib/gateStateService";

interface TestResult { name: string; pass: boolean; detail?: string; }
const results: TestResult[] = [];
function assert(cond: boolean, name: string, detail?: string): void {
  results.push({ name, pass: cond, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const KHS_ROOT = process.env.KAIS_HERMES_SKILLS_PATH ?? "/data/workspace/kais-hermes-skills";
const GATES_YAML = path.join(KHS_ROOT, "plugins/review_gates/gates.yaml");

interface YamlGate {
  phase?: unknown
  asset_bus_slots_to_lock?: unknown
  reviewer_role?: unknown
  timeout_sec?: unknown
  callback_url?: unknown
  default_mode?: unknown
  retry_policy?: { max_retries?: unknown; backoff_sec?: unknown }
}

/** The S-catalog diff logic, factored so S-forced-fail can re-run it on a
 *  mutated IN-MEMORY copy (never a mutated file). */
function diffCatalogAgainst(yamlGates: Record<string, YamlGate>): string[] {
  const problems: string[] = [];
  const keys = Object.keys(yamlGates);
  if (keys.length !== EXPECTED_GATE_COUNT) {
    problems.push(`yaml entry count ${keys.length} !== EXPECTED_GATE_COUNT ${EXPECTED_GATE_COUNT}`);
  }
  if (GATE_CATALOG.length !== EXPECTED_GATE_COUNT) {
    problems.push(`GATE_CATALOG length ${GATE_CATALOG.length} !== EXPECTED_GATE_COUNT ${EXPECTED_GATE_COUNT}`);
  }
  const byPhaseId = new Map(GATE_CATALOG.map((g) => [g.phaseId, g]));
  for (const key of keys) {
    const snap = byPhaseId.get(key);
    if (snap == null) {
      problems.push(`yaml key ${key} missing from GATE_CATALOG snapshot`);
      continue;
    }
    const y = yamlGates[key];
    if (String(y.default_mode) !== snap.mode) {
      problems.push(`${key}: mode yaml=${String(y.default_mode)} snap=${snap.mode}`);
    }
    if (deriveGateId(key) !== snap.derivedGateId) {
      problems.push(`${key}: deriveGateId round-trip ${deriveGateId(key)} !== snap ${snap.derivedGateId}`);
    }
    const slots = Array.isArray(y.asset_bus_slots_to_lock)
      ? (y.asset_bus_slots_to_lock as unknown[]).map(String)
      : [];
    if (JSON.stringify(slots) !== JSON.stringify(snap.assetBusSlotsToLock)) {
      problems.push(`${key}: asset_bus_slots_to_lock drift`);
    }
    const roles = Array.isArray(y.reviewer_role)
      ? (y.reviewer_role as unknown[]).map(String)
      : y.reviewer_role != null
        ? [String(y.reviewer_role)]
        : [];
    if (JSON.stringify(roles) !== JSON.stringify(snap.reviewerRole)) {
      problems.push(`${key}: reviewer_role drift`);
    }
    if (Number(y.timeout_sec) !== snap.timeoutSec) {
      problems.push(`${key}: timeout_sec drift (${String(y.timeout_sec)} vs ${snap.timeoutSec})`);
    }
    const retry = `${Number(y.retry_policy?.max_retries)}/${Number(y.retry_policy?.backoff_sec)}`;
    const snapRetry = `${snap.retryPolicy.maxRetries}/${snap.retryPolicy.backoffSec}`;
    if (retry !== snapRetry) {
      problems.push(`${key}: retry_policy drift (${retry} vs ${snapRetry})`);
    }
  }
  for (const g of GATE_CATALOG) {
    if (!(g.phaseId in yamlGates)) problems.push(`snapshot entry ${g.phaseId} missing from yaml`);
  }
  return problems;
}

// ═══════════════════════════════════════════════════════════════════════════
// S-poller — GateStateService mechanics (in-process, deps injected)
// ═══════════════════════════════════════════════════════════════════════════

interface FakePage { items: PlatformReviewItem[]; hasMore: boolean; nextCursor?: string | number | null }

function fakeListFetch(pagesByCursor: Map<string, FakePage>, log?: string[]) {
  return (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    log?.push(url);
    const u = new URL(url);
    const cursor = u.searchParams.get("cursor") ?? "";
    const page = pagesByCursor.get(cursor);
    if (page == null) throw new Error(`unexpected cursor ${JSON.stringify(cursor)}`);
    return new Response(JSON.stringify({
      data: { items: page.items, has_more: page.hasMore, next_cursor: page.nextCursor ?? null },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

const PROBE_NODES = [{ data: { filePath: "/data/episodes/ep-ccport-test01/p13_delivery/master.mp4" } }];

function reviewItem(id: number, type: string, contentRef: string, state: string, extra: Partial<PlatformReviewItem> = {}): PlatformReviewItem {
  return { id, type, content_ref: contentRef, state, disposition: "HUMAN", updated_at: `t${id}`, metadata: {}, ...extra };
}

function makePages(): Map<string, FakePage> {
  return new Map<string, FakePage>([
    ["", {
      items: [
        reviewItem(3, "p13-gate", "ep-ccport-test01/p13_delivery", "APPROVING"),
        reviewItem(2, "p11c-gate", "ep-ccport-test01/p11c_video_qc", "APPROVING"),
      ],
      hasMore: true, nextCursor: 5,
    }],
    ["5", {
      items: [reviewItem(1, "topic-gate", "ep-ccport-test01/p01_hook_topic", "COMPLETE", { metadata: { review_result: { decision: "approve" } } })],
      hasMore: false,
    }],
  ]);
}

async function runSpollerSection(): Promise<void> {
  console.log("=== S-poller: GateStateService mechanics (54-05 Task 1) ===");
  const scope = { projectId: 7, episodesId: 3 };
  const broadcasts: Array<{ pid: number; event: string; data: unknown }> = [];
  const uriLog: string[] = [];
  const svc = new GateStateService({
    fetchImpl: fakeListFetch(makePages(), uriLog),
    nodesReader: async () => PROBE_NODES,
    broadcast: (pid, event, data) => broadcasts.push({ pid, event, data }),
    intervalMs: 1e9,
    logger: { info: () => {}, warn: () => {} },
  });
  try {
    const p1 = await svc.pollNow(scope);
    assert(svc.candidatesFor(scope).length === 3, "S-poller: 多页翻页收集全量(3 items,has_more→next_cursor)", String(svc.candidatesFor(scope).length));
    assert(uriLog.every((u) => u.includes("/api/v1/reviews/?")), "S-poller: 列表 URL 带尾斜杠(54-01 纪律)");
    assert(p1.gates.length === 16, "S-poller: payload gates = 16 门", String(p1.gates.length));
    const redlines = p1.gates.filter((g) => g.phaseId.includes("_redline_"));
    assert(redlines.length === 3 && redlines.every((g) => g.display === "auto"), "S-poller: 红线 3 门恒 display=auto");
    const p13 = p1.gates.find((g) => g.gateId === "p13-gate");
    const p11c = p1.gates.find((g) => g.gateId === "p11c-gate");
    assert(p13?.display === "pending" && p13?.reviewId === 3, "S-poller: p13 APPROVING 折叠 pending + reviewId");
    assert(p11c?.display === "pending" && p11c?.reviewId === 2, "S-poller: p11c pending(review 分派正确)");
    const p01 = p1.gates.find((g) => g.gateId === "p01-gate");
    assert(p01?.display === "approve" && p01?.reviewId === 1, "S-poller: legacy 别名 topic-gate 命中 p01 + fold approve");
    assert(p1.blocking != null && p1.blocking.reviewId === 3 && p1.blocking.gateId === "p13-gate", "S-poller: blocking = pending 中最大 reviewId(p13-gate)");
    const refs = svc.episodeRefsFor(scope);
    assert(refs != null && refs.has("ep-ccport-test01") && refs.has("ep3"), "S-poller: episodeRef 三层(legacy 双形态 + 画布探针)");
    assert(broadcasts.filter((b) => b.event === "gate:state").length === 1 && broadcasts[0]?.pid === 7, "S-poller: 首次 poll 广播 gate:state → project 房间");

    // diff:同内容二次 poll → 不再广播
    await svc.pollNow(scope);
    assert(broadcasts.filter((b) => b.event === "gate:state").length === 1, "S-poller: 同内容重复 poll 零重广播(diff 防线)");

    // change:p13 → COMPLETE + waive → 广播 + display waive
    const changed = makePages();
    const page0 = changed.get("")!;
    page0.items = [reviewItem(3, "p13-gate", "ep-ccport-test01/p13_delivery", "COMPLETE", { metadata: { review_result: { decision: "waive", reason: "x".repeat(100) } } }), reviewItem(2, "p11c-gate", "ep-ccport-test01/p11c_video_qc", "APPROVING")];
    // 换 fetchImpl:直接换服务实例数据源(同一 service 的 fetch 闭包不可换,
    // 用第二个实例验证同一逻辑分支;此处换实现:重建 service 复用 scope 语义)。
    const svc2 = new GateStateService({
      fetchImpl: fakeListFetch(changed),
      nodesReader: async () => PROBE_NODES,
      broadcast: (pid, event, data) => broadcasts.push({ pid, event, data }),
      intervalMs: 1e9,
      logger: { info: () => {}, warn: () => {} },
    });
    const p2 = await svc2.pollNow(scope);
    const p13v2 = p2.gates.find((g) => g.gateId === "p13-gate");
    assert(p13v2?.display === "waive" && p13v2?.note === "x".repeat(80), "S-poller: 决议变化 → display waive + note 截断 80 字符");
    assert(p2.blocking != null && p2.blocking.gateId === "p11c-gate", "S-poller: blocking 随之转移(p11c 为新 pending 焦点)");
    svc2.stop();

    // truncation:恒 has_more → degrade fail-closed(无部分数据)
    const endless = new Map<string, FakePage>([["", { items: [reviewItem(9, "p13-gate", "ep-ccport-test01/p13_delivery", "APPROVING")], hasMore: true, nextCursor: 1 }], ["1", { items: [reviewItem(10, "p13-gate", "ep-ccport-test01/p13_delivery", "APPROVING")], hasMore: true, nextCursor: 2 }]]);
    const svc3 = new GateStateService({
      fetchImpl: fakeListFetch(endless),
      nodesReader: async () => PROBE_NODES,
      broadcast: () => {},
      intervalMs: 1e9,
      logger: { info: () => {}, warn: () => {} },
    });
    const pTrunc = await svc3.pollNow(scope);
    assert(pTrunc.degrade === true && !pTrunc.gates.some((g) => g.reviewId != null), "S-poller: 翻页超限 truncated → degrade + 零部分数据(fail-closed)");
    svc3.stop();

    // fetch error → degrade 保旧快照 + fetchedAt 不更新;恢复 → 广播 degrade=false
    let broken = false;
    const svc4 = new GateStateService({
      fetchImpl: (async (input: string | URL | Request) => {
        if (broken) throw new Error("platform down");
        return fakeListFetch(makePages())(input);
      }) as unknown as typeof fetch,
      nodesReader: async () => PROBE_NODES,
      broadcast: (pid, event, data) => broadcasts.push({ pid, event, data }),
      intervalMs: 1e9,
      logger: { info: () => {}, warn: () => {} },
    });
    const pGood = await svc4.pollNow(scope);
    await new Promise((r) => setTimeout(r, 5));
    broken = true;
    const pBad = await svc4.pollNow(scope);
    assert(pBad.degrade === true && pBad.fetchedAt === pGood.fetchedAt, "S-poller: 平台异常 → degrade + 旧快照保留 + fetchedAt 不更新");
    const keptP13 = pBad.gates.find((g) => g.gateId === "p13-gate");
    assert(keptP13?.display === "pending" && keptP13?.reviewId === 3, "S-poller: degrade 期间 gates 不被清空(绝不折叠为全放行)");
    broken = false;
    const before = broadcasts.filter((b) => b.event === "gate:state").length;
    const pRev = await svc4.pollNow(scope);
    assert(pRev.degrade === false, "S-poller: 平台恢复 → degrade=false");
    svc4.stop();
  } finally {
    svc.stop();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// S-ops — spawned-child endpoint dispatch (49-01 pattern)
// ═══════════════════════════════════════════════════════════════════════════

/** Stub review-platform:列表 + approve/reject/waive 可编程序列 + 记录仪。 */
function makeStubPlatform(): { server: http.Server; port: () => number } {
  const listItems: PlatformReviewItem[] = [
    reviewItem(501, "p13-gate", "ep-ccport-test01/p13_delivery", "APPROVING"),
  ];
  const recorded: Record<string, unknown[]> = { approve: [], reject: [], waive: [] };
  const seq: Record<string, number> = { approve: 0, reject: 0, waive: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    const bodyChunks: Buffer[] = [];
    req.on("data", (c: Buffer) => bodyChunks.push(c));
    req.on("end", () => {
      const body = bodyChunks.length > 0 ? JSON.parse(Buffer.concat(bodyChunks).toString()) : {};
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname === "/api/v1/reviews/" && req.method === "GET") {
        json(200, { data: { items: listItems, has_more: false, next_cursor: null } });
        return;
      }
      const opMatch = /\/api\/v1\/reviews\/(\d+)\/(approve|reject|waive)/.exec(url.pathname);
      if (req.method === "POST" && opMatch != null) {
        const op = opMatch[2]!;
        recorded[op]!.push(body);
        const n = seq[op]!++;
        if (op === "approve" && n === 0) { json(409, { detail: "already resolved" }); return; }
        if (op === "reject" && n === 0) { json(500, { detail: "boom" }); return; }
        json(200, { data: { id: Number(opMatch[1]), state: "COMPLETE" } });
        return;
      }
      if (url.pathname === "/__recorded" && req.method === "GET") {
        json(200, { data: recorded });
        return;
      }
      json(404, { detail: `no stub route ${req.method} ${url.pathname}` });
    });
  });
  return { server, port: () => (server.address() as { port: number }).port };
}

interface ChildResult { name: string; pass: boolean; detail?: string }

async function runSopsSection(): Promise<void> {
  console.log("=== S-ops: gate-ops/gate-state endpoint dispatch (54-05 Task 2, spawned child) ===");
  const stub = makeStubPlatform();
  await new Promise<void>((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
  const stubUrl = `http://127.0.0.1:${stub.port()}`;
  const child = spawn("npx", ["tsx", "scripts/verify-phase-54.ts", "--s-ops-child"], {
    cwd: REPO_ROOT,
    env: { ...process.env, REVIEW_PLATFORM_URL: stubUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
  const exitCode = await new Promise<number | null>((resolve) => {
    const killer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", (code) => { clearTimeout(killer); resolve(code); });
  });
  stub.server.close();
  const childResults: ChildResult[] = out
    .split("\n")
    .filter((l) => l.trim().startsWith("SOPS-RESULT "))
    .map((l) => JSON.parse(l.trim().slice("SOPS-RESULT ".length)) as ChildResult);
  for (const r of childResults) {
    assert(r.pass, `S-ops(child): ${r.name}`, r.detail);
  }
  assert(childResults.length >= 6, "S-ops: 子进程结果 ≥6 条", String(childResults.length));
  assert(exitCode === 0, "S-ops: 子进程退出码 0", `exit=${exitCode}${err ? " stderr: " + err.slice(-300) : ""}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// S-live — 10588 kap 折叠 vs 8090 平台直查 对照(54-05 Task 3)
// ═══════════════════════════════════════════════════════════════════════════

async function runSliveSection(): Promise<void> {
  console.log("=== S-live: 10588 活体对照(对照驱动,防活体漂移误报) ===");
  const scopeParam = process.env.GATE_LIVE_SCOPE ?? "1787033533354:1";
  const [projectIdStr, episodesIdStr] = scopeParam.split(":");
  const projectId = Number(projectIdStr);
  const episodesId = Number(episodesIdStr);
  const kapResp = await fetch(
    `http://localhost:10588/api/canvas/v2/gate-state?projectId=${projectId}&episodesId=${episodesId}`,
    { signal: AbortSignal.timeout(15000) },
  );
  const kapJson = (await kapResp.json()) as { code: number; data: any };
  const snap = kapJson.data ?? {};
  assert(kapResp.status === 200 && Array.isArray(snap.gates) && snap.gates.length === 16, "S-live: 10588 gate-state 200 + 16 门", `status=${kapResp.status} gates=${snap.gates?.length}`);
  assert(snap.degrade === false, "S-live: degrade=false(平台可达)");
  assert(Array.isArray(snap.episodeRefs) && snap.episodeRefs.includes("ep-ccport-test01"), "S-live: episodeRefs 含画布探针 ep-ccport-test01", JSON.stringify(snap.episodeRefs));

  const platResp = await fetch("http://localhost:8090/api/v1/reviews/?source=kais-movie-agent&limit=100", {
    signal: AbortSignal.timeout(10000),
  });
  const platJson = (await platResp.json()) as { data?: { items?: PlatformReviewItem[] } };
  const items = platJson.data?.items ?? [];

  // 独立期望:ep-ccport-test01 的 review → gateId + fold(§E 本地重算)
  const expected = new Map<string, { display: string; reviewId: number }>();
  for (const item of items) {
    const ref = typeof item.content_ref === "string" ? item.content_ref : "";
    if (!ref.split("/").slice(0, -1).includes("ep-ccport-test01")) continue;
    const token = fullPhaseTokenOfItemPub(item);
    if (token == null) continue;
    const meta = (item.metadata ?? {}) as { review_result?: { decision?: unknown } };
    const decision = typeof meta.review_result?.decision === "string" ? meta.review_result.decision : undefined;
    const display = foldDisplayState(String(item.state ?? ""), typeof item.disposition === "string" ? item.disposition : null, decision != null ? { decision } : null);
    const prev = expected.get(`${token}-gate`);
    if (prev == null || Number(item.id) > prev.reviewId) {
      expected.set(`${token}-gate`, { display, reviewId: Number(item.id) });
    }
  }

  console.log("  ── 对照表(platform → 期望 fold → kap 实际)──");
  let allMatch = true;
  for (const g of snap.gates as Array<{ gateId: string; phaseId: string; display: string; reviewId?: number }>) {
    if (g.phaseId.includes("_redline_")) continue;
    const exp = expected.get(g.gateId);
    const expDisplay = exp?.display ?? "pending";
    const expReviewId = exp?.reviewId;
    const ok = g.display === expDisplay && (g.reviewId ?? null) === (expReviewId ?? null);
    if (!ok) allMatch = false;
    console.log(`  ${ok ? "OK " : "DRIFT"} ${g.gateId.padEnd(11)} platform=${exp ? `review#${exp.reviewId}` : "无review"} 期望=${expDisplay} kap=${g.display}${g.reviewId != null ? `(#${g.reviewId})` : ""}`);
  }
  assert(allMatch, "S-live: 逐门对照一致(直查折叠 vs kap payload)");
  const pendingWithId = (snap.gates as Array<{ gateId: string; display: string; reviewId?: number }>).filter((g) => g.display === "pending" && g.reviewId != null);
  const expectedBlocking = pendingWithId.reduce<{ gateId: string; reviewId: number } | null>(
    (acc, g) => (acc == null || (g.reviewId ?? 0) > acc.reviewId ? { gateId: g.gateId, reviewId: g.reviewId! } : acc), null);
  const blockingOk = (snap.blocking == null && expectedBlocking == null)
    || (snap.blocking != null && expectedBlocking != null && snap.blocking.gateId === expectedBlocking.gateId && snap.blocking.reviewId === expectedBlocking.reviewId);
  assert(blockingOk, "S-live: blocking 与 gates 推导一致", `kap=${JSON.stringify(snap.blocking)} 期望=${JSON.stringify(expectedBlocking)}`);
  const redlines = (snap.gates as Array<{ phaseId: string; display: string }>).filter((g) => g.phaseId.includes("_redline_"));
  assert(redlines.length === 3 && redlines.every((g) => g.display === "auto"), "S-live: 红线 3 门 display=auto");
  const smokeIds = new Set([4, 5]); // 54-02 部署冒烟 review(kap-phase54-smoke)
  assert(!(snap.gates as Array<{ reviewId?: number }>).some((g) => g.reviewId != null && smokeIds.has(g.reviewId)), "S-live: 冒烟 review(source 过滤)不出现");
  assert(items.length >= 2, "S-live: 平台直查 kmc 源 review ≥2(活体在案)", String(items.length));
}

/** fullPhaseTokenOfItem 的 verify 侧独立重算(镜像实现,防同源盲区)。 */
function fullPhaseTokenOfItemPub(item: PlatformReviewItem): string | null {
  const type = typeof item.type === "string" ? item.type : null;
  if (type == null) return null;
  const legacy = (LEGACY_GATE_ID_TO_PHASE_ID as Record<string, string>)[type];
  const base = legacy ?? type;
  const m = /^p\d+[a-z0-9]*/.exec(base.trim().toLowerCase());
  return m === null ? null : m[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("=== Phase 54 — verify-phase-54.ts (aggregate contract gate: GATE-01..03) ===\n");

  // ═══ S-catalog — D-02 snapshot zero-drift vs khs authority ═══════════════
  console.log("=== S-catalog: gates.yaml snapshot diff (D-02 zero-drift) ===");
  const yamlText = fs.readFileSync(GATES_YAML, "utf8");
  const parsed = yaml.load(yamlText) as { version?: number; gates?: Record<string, YamlGate> };
  const yamlGates = parsed.gates ?? {};
  assert(parsed.version === 2, "S-catalog: gates.yaml version === 2", String(parsed.version));
  const problems = diffCatalogAgainst(yamlGates);
  assert(problems.length === 0, `S-catalog: field-by-field diff clean (${EXPECTED_GATE_COUNT} entries)`, problems.slice(0, 3).join("; ") || undefined);
  const redlines = GATE_CATALOG.filter((g) => g.isRedline);
  assert(
    redlines.length === 3 && redlines.every((g) => g.platformInvisible),
    "S-catalog: 3 redline keys flagged isRedline + platformInvisible (never submit_review)",
  );
  const webhook = GATE_CATALOG.filter((g) => g.mode === "webhook");
  assert(
    webhook.length === 1 && webhook[0]?.phaseId === "p11b_final_render",
    "S-catalog: exactly one webhook-mode gate (p11b_final_render)",
  );
  assert(
    deriveGateId("p11a0_iframe_qc") === "p11a0-gate",
    "S-catalog: full sub-phase token derivation (p11a0 → p11a0-gate, not p11-gate)",
    deriveGateId("p11a0_iframe_qc"),
  );
  assert(
    deriveGateId("p13_delivery_redline_emotion") === "p13-gate",
    "S-catalog: redline suffix stripped before derivation (→ p13-gate)",
  );
  const aliasChecks: Array<[string, string]> = [
    ["p11-gate", "p11b_final_render"],
    ["topic-gate", "p01_hook_topic"],
    ["delivery-gate", "p13_delivery"],
  ];
  for (const [legacy, phase] of aliasChecks) {
    assert(
      LEGACY_GATE_ID_TO_PHASE_ID[legacy] === phase,
      `S-catalog: legacy alias ${legacy} → ${phase}`,
      String(LEGACY_GATE_ID_TO_PHASE_ID[legacy]),
    );
  }
  assert(
    Object.keys(GATE_DISPLAY_NAMES).length === EXPECTED_GATE_COUNT,
    `S-catalog: GATE_DISPLAY_NAMES covers all ${EXPECTED_GATE_COUNT} (U-06)`,
    String(Object.keys(GATE_DISPLAY_NAMES).length),
  );

  // ═══ S-fold — D-04 §E full table ═════════════════════════════════════════
  console.log("\n=== S-fold: foldDisplayState §E full table (D-04) ===");
  const table: Array<[string, string | null, { decision?: string } | null, string, string]> = [
    ["PENDING", "HUMAN", null, "pending", "PENDING → pending"],
    ["POLICY_EVAL", "AUTO", null, "pending", "POLICY_EVAL → pending"],
    ["APPROVING", "HUMAN", null, "pending", "APPROVING (主路径:人工门停在此) → pending"],
    ["COMPLETE", "HUMAN", { decision: "approve" }, "approve", "COMPLETE+decision approve"],
    ["COMPLETE", "HUMAN", { decision: "reject" }, "reject", "COMPLETE+decision reject"],
    ["COMPLETE", "HUMAN", { decision: "waive" }, "waive", "COMPLETE+decision waive"],
    ["COMPLETE", "BLOCK", null, "reject", "COMPLETE+BLOCK 无 decision → reject(系统拦截)"],
    ["COMPLETE", "AUTO", null, "approve", "COMPLETE+AUTO 无 decision → approve(legacy)"],
    ["COMPLETE", "HUMAN", null, "approve", "COMPLETE+HUMAN 无 decision → approve(legacy 兼容)"],
  ];
  for (const [state, disposition, result, expected, label] of table) {
    const got = foldDisplayState(state, disposition, result);
    assert(got === expected, `S-fold: ${label}`, `got ${got}`);
  }

  // ═══ S-forced-fail — prove the gate can go red (in-memory mutation) ═════
  console.log("\n=== S-forced-fail: in-memory yaml mutation MUST be detected ===");
  const dropped = { ...yamlGates };
  delete dropped["p10c_voice_audit"];
  const p1 = diffCatalogAgainst(dropped);
  assert(p1.some((x) => x.includes("count") || x.includes("p10c")), "forced-fail: dropped entry detected", p1[0]);
  const flipped = { ...yamlGates, p11b_final_render: { ...yamlGates["p11b_final_render"]!, default_mode: "blocking" } };
  const p2 = diffCatalogAgainst(flipped);
  assert(p2.some((x) => x.includes("p11b_final_render") && x.includes("mode")), "forced-fail: flipped mode detected", p2.find((x) => x.includes("p11b")));
  assert(fs.readFileSync(GATES_YAML, "utf8") === yamlText, "forced-fail: khs file untouched (in-memory only)");

  // ═══ S-poller + S-ops ════════════════════════════════════════════════════
  console.log("");
  await runSpollerSection();
  console.log("");
  await runSopsSection();

  // ═══ S-live — 10588 活体对照(54-05 Task 3,生产重启后) ═══════════════════
  console.log("");
  await runSliveSection();

  // ═══ Summary ═════════════════════════════════════════════════════════════
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  const failed = total - passed;
  console.log(`\n=== Summary: ${passed}/${total} assertions passed, FAIL count = ${failed} ===`);
  if (passed === total) {
    console.log("✅ Phase 54 verification PASSED (S-catalog ✓ S-fold ✓ S-forced-fail ✓ S-poller ✓ S-ops ✓ S-live ✓)");
    process.exit(0);
  } else {
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`   FAIL: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    }
    console.log("❌ Phase 54 verification FAILED");
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Child mode: express app + 两路由 + 注入探针,对 stub 平台发真实 HTTP。
// ═══════════════════════════════════════════════════════════════════════════

async function runSopsChild(): Promise<void> {
  /* eslint-disable no-console */
  const childResults: ChildResult[] = [];
  const report = (name: string, pass: boolean, detail?: string) => {
    childResults.push({ name, pass, detail });
    console.log(`SOPS-RESULT ${JSON.stringify({ name, pass, detail })}`);
  };
  try {
    const express = (await import("express")).default;
    const gateOps = (await import("../src/routes/canvas/v2/gate-ops")).default;
    const gateState = (await import("../src/routes/canvas/v2/gate-state")).default;
    // 单例替换:nodesReader 注入探针(零 DB);baseUrl 从 env(父进程指向 stub)。
    setGateStateServiceForTest(new GateStateService({
      nodesReader: async () => [{ data: { filePath: "/data/episodes/ep-ccport-test01/p13_delivery/master.mp4" } }],
      broadcast: () => {},
      intervalMs: 1e9,
      logger: { info: () => {}, warn: () => {} },
    }));
    const app = express();
    app.use(express.json());
    app.use("/api/canvas/v2/gate-ops", gateOps);
    app.use("/api/canvas/v2/gate-state", gateState);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const addr = server.address() as { port: number };
    const base = `http://127.0.0.1:${addr.port}`;

    const post = async (path: string, body: unknown) => {
      const resp = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: resp.status, json: (await resp.json()) as { code: number; data: any; message: string } };
    };

    // 1. 400: reject 缺 reason(zod refine)
    const r1 = await post("/api/canvas/v2/gate-ops", { projectId: 7, episodesId: 3, reviewId: 501, action: "reject" });
    report("400 reject 缺 reason 被拒", r1.status === 400, `status=${r1.status}`);

    // 2. 422: reviewId 不属于当前 scope(fail-closed)
    const r2 = await post("/api/canvas/v2/gate-ops", { projectId: 7, episodesId: 3, reviewId: 999, action: "approve" });
    report("422 fail-closed:异集 reviewId 拒操作", r2.status === 422, `status=${r2.status}`);

    // 3. 409 → applied:false already-resolved(幂等成功)
    const r3 = await post("/api/canvas/v2/gate-ops", { projectId: 7, episodesId: 3, reviewId: 501, action: "approve" });
    report(
      "409 → 200 applied:false cause=already-resolved",
      r3.status === 200 && r3.json.data?.applied === false && r3.json.data?.cause === "already-resolved",
      JSON.stringify(r3.json.data),
    );

    // 4. 2xx → applied:true(selected 携带 → stub 收到 result.selected)
    const r4 = await post("/api/canvas/v2/gate-ops", { projectId: 7, episodesId: 3, reviewId: 501, action: "approve", selected: [2] });
    const rec1 = await (await fetch(`${process.env.REVIEW_PLATFORM_URL}/__recorded`)).json() as { data: Record<string, unknown[]> };
    const approveBodies = rec1.data.approve as Array<{ result?: { selected?: number[] } }>;
    report(
      "2xx applied:true + approve body result.selected",
      r4.status === 200 && r4.json.data?.applied === true && approveBodies[1]?.result?.selected?.[0] === 2,
      JSON.stringify(r4.json.data),
    );

    // 5. 502: 平台 500
    const r5 = await post("/api/canvas/v2/gate-ops", { projectId: 7, episodesId: 3, reviewId: 501, action: "reject", reason: "五零二探针" });
    report("平台 500 → 502 审核平台调用失败", r5.status === 502, `status=${r5.status}`);

    // 6. waive 2xx + reason 透传
    const r6 = await post("/api/canvas/v2/gate-ops", { projectId: 7, episodesId: 3, reviewId: 501, action: "waive", reason: "s-ops waive" });
    const rec2 = await (await fetch(`${process.env.REVIEW_PLATFORM_URL}/__recorded`)).json() as { data: Record<string, unknown[]> };
    const waiveBodies = rec2.data.waive as Array<{ reason?: string }>;
    report("waive applied:true + reason 透传", r6.status === 200 && r6.json.data?.applied === true && waiveBodies[0]?.reason === "s-ops waive", "");

    // 7. GET gate-state:16 门 + episodeRefs 探针 + blocking
    const gResp = await fetch(`${base}/api/canvas/v2/gate-state?projectId=7&episodesId=3`);
    const gJson = (await gResp.json()) as { code: number; data: any };
    const snap = gJson.data ?? {};
    report(
      "GET gate-state:200 + 16 门 + episodeRefs + blocking",
      gResp.status === 200 && Array.isArray(snap.gates) && snap.gates.length === 16
        && Array.isArray(snap.episodeRefs) && snap.episodeRefs.includes("ep-ccport-test01")
        && snap.blocking?.gateId === "p13-gate",
      `gates=${snap.gates?.length} refs=${JSON.stringify(snap.episodeRefs)} blocking=${snap.blocking?.gateId}`,
    );

    // 8. approve 无 selected → body 不携带 result 键(形状契约)
    const noSelBody = approveBodies.find((b) => b && !("result" in b));
    report(
      "approve 无 selected → body 无 result 键",
      (rec1.data.approve as Array<Record<string, unknown>>).some((b) => !("result" in b)),
      JSON.stringify(rec1.data.approve),
    );

    server.close();
    const passedCount = childResults.filter((r) => r.pass).length;
    console.log(`SOPS-DONE ${passedCount}/${childResults.length}`);
    process.exit(passedCount === childResults.length ? 0 : 1);
  } catch (err) {
    console.error("s-ops child crashed:", err);
    process.exit(2);
  }
}

try {
  if (process.argv.includes("--s-ops-child")) {
    void runSopsChild();
  } else {
    void main();
  }
} catch (err) {
  console.error("verify-phase-54.ts crashed:", err);
  process.exit(2);
}
