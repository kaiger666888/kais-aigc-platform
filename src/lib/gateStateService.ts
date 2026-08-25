/**
 * gateStateService.ts — gate 中心轮询单例(Phase 54-05 / GATE-01, D-03)。
 *
 * 运行时状态真值源 = review-platform REST GET /api/v1/reviews/(D-01);
 * khs gates.yaml 只是定义快照(gateCatalog)。本服务 20s 轮询平台
 * (source=kais-movie-agent,翻页 fail-closed),按 scope 三维过滤
 * (episode refs + phase token 等值,WR-01),服务端 foldDisplayState
 * 折叠(D-04:平台原始态不泄前端),diff 后 broadcastToProject('gate:state')。
 *
 * 纪律:
 *  - P2:baseUrl 默认显式走 REVIEW_PLATFORM_URL(宿主不可达的容器名不是
 *    合理默认);列表 URL 带尾斜杠(54-01 key-decision:无斜杠 307 丢端口)。
 *  - 纯副作用零:import 本模块不启动任何 timer;首个 scope 注册才 lazy 启动。
 *  - @/utils/db 不进静态 import 图(verify 脚本直读本模块,tsx 卡死纪律)——
 *    默认 nodesReader 走运行时动态 import。
 *  - GateStatePayload/GateStateGate/GateBlocking 与前端 gateStore.ts
 *    (54-04)逐字段镜像,双侧钉死;S-poller/S-ops 锁定。
 */

import {
  GATE_CATALOG,
  GATE_DISPLAY_NAMES,
  LEGACY_GATE_ID_TO_PHASE_ID,
  foldDisplayState,
  type GateEntry,
} from "./gateCatalog";

// ─── 契约类型(与 packages/infinite-canvas/src/store/gateStore.ts 镜像) ───

export interface GateStateGate {
  gateId: string;
  phaseId: string;
  label: string;
  display: "pending" | "approve" | "reject" | "waive" | "auto";
  /** 73-01:门模式镜像(gateCatalog.mode)。webhook=异步哨兵(p11b tripwire):
   *  呈现真实态但不参与 blocking 竞争,动作条永不以其为目标。 */
  mode: "blocking" | "webhook" | "polling";
  reviewId?: number;
  updatedAt?: string;
  note?: string;
}

export interface GateBlocking {
  gateId: string;
  reviewId: number;
  phaseId: string;
  label: string;
}

export interface GateStatePayload {
  projectId: number;
  episodesId: number;
  fetchedAt: number;
  degrade: boolean;
  blocking: GateBlocking | null;
  gates: GateStateGate[];
}

export interface GateScope {
  projectId: number;
  episodesId: number;
}

// ─── 依赖注入 ──────────────────────────────────────────────────────────────

export interface PlatformReviewItem {
  id?: number | string;
  type?: unknown;
  content_ref?: unknown;
  state?: unknown;
  disposition?: unknown;
  updated_at?: unknown;
  metadata?: unknown;
}

export interface GateStateServiceDeps {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  /** 默认 20000;env GATE_POLL_INTERVAL_MS 可覆盖。 */
  intervalMs?: number;
  timeoutMs?: number;
  /** 画布探针数据源(episodeRef 提取);默认运行时动态 import listNodes。 */
  nodesReader?: (scope: GateScope) => Promise<Array<Record<string, unknown>>>;
  /** 广播钩子(测试注入);默认 ws.broadcastToProject。 */
  broadcast?: (projectId: number, event: string, data: unknown) => void;
}

const LOG_PREFIX = "[gate-state]";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_LIST_PAGES = 10;
const SCOPE_EVICTION_MS = 30 * 60 * 1000;
const NOTE_MAX_CHARS = 80;

/** 完整 sub-phase token(gateCatalog.PHASE_PREFIX_RE 同源):
 *  "p11a0_iframe_qc"→"p11a0"、"p11c-gate"→"p11c"——比 leadingPhaseToken
 *  (/^p\d+/ 把 p11a0/p11a/p11b/p11c 全折叠成 "p11")更细,16 门唯一分派。 */
function fullPhaseToken(value: string): string | null {
  const m = /^p\d+[a-z0-9]*/.exec(value.trim().toLowerCase());
  return m === null ? null : m[0];
}

// 非 redline 门按 token 索引(redline 从不 submit_review,不参与 review 分派)。
const ENTRY_BY_TOKEN: ReadonlyMap<string, GateEntry> = new Map(
  GATE_CATALOG
    .filter((g) => !g.isRedline)
    .map((g) => [fullPhaseToken(g.phaseId)!, g]),
);

/** legacy 别名反查表:legacy gate_id → token(供 S-poller 别名命中断言)。 */
export const LEGACY_ALIAS_TOKENS: ReadonlyArray<[string, string]> = Object.entries(
  LEGACY_GATE_ID_TO_PHASE_ID,
).map(([alias, phaseId]) => [alias, fullPhaseToken(phaseId)!]);

/** item 的门 token(legacy 别名优先,再 fullPhaseToken;供 gate-ops 回显)。 */
export function fullPhaseTokenOfItem(item: PlatformReviewItem): string | null {
  const type = asString(item.type);
  if (type == null) return null;
  const legacyPhase = LEGACY_GATE_ID_TO_PHASE_ID[type];
  if (legacyPhase != null) return fullPhaseToken(legacyPhase);
  return fullPhaseToken(type);
}

/** 红线 legacy 别名(detector 名)→ 红线条目(73-01 红线上浮通道):
 *  khs 红线 reject 时提交 type=redline_* 的墓碑 review,按别名直接路由到
 *  对应红线门——不经 token 分派(否则别名折叠成 "p13" 会污染 p13-gate 池)。 */
const REDLINE_ALIAS_TO_PHASE: ReadonlyMap<string, string> = new Map(
  Object.entries(LEGACY_GATE_ID_TO_PHASE_ID)
    .filter(([, phaseId]) => phaseId.includes("_redline_"))
    .map(([alias, phaseId]) => [alias, phaseId]),
);

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

interface ScopeState {
  scope: GateScope;
  episodeRefs: Set<string> | null; // null = 探针未跑
  episodeRefOverride: string | null;
  lastPayload: GateStatePayload | null;
  lastItems: PlatformReviewItem[];
  lastSignature: string | null;
  lastAccessedAt: number;
}

function scopeKey(scope: GateScope): string {
  return `${scope.projectId}:${scope.episodesId}`;
}

function payloadSignature(p: GateStatePayload): string {
  return JSON.stringify({
    degrade: p.degrade,
    gates: p.gates.map((g) => [g.gateId, g.display, g.reviewId ?? null, g.updatedAt ?? null, g.note ?? null]),
  });
}

// ─── 服务 ──────────────────────────────────────────────────────────────────

export class GateStateService {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly nodesReader: (scope: GateScope) => Promise<Array<Record<string, unknown>>>;
  private readonly broadcast: (projectId: number, event: string, data: unknown) => void;
  private readonly scopes = new Map<string, ScopeState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: GateStateServiceDeps = {}) {
    this.baseUrl = (deps.baseUrl ?? process.env.REVIEW_PLATFORM_URL ?? "http://localhost:8090").replace(/\/+$/, "");
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.logger = deps.logger ?? console;
    this.intervalMs = deps.intervalMs ?? (Number(process.env.GATE_POLL_INTERVAL_MS) || 20000);
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nodesReader = deps.nodesReader ?? defaultNodesReader;
    this.broadcast = deps.broadcast ?? defaultBroadcast;
  }

  /** 注册/获取 scope;首个 scope 注册时 lazy 启动全局 interval。 */
  ensureScope(scope: GateScope, opts: { episodeRefOverride?: string | null } = {}): ScopeState {
    const key = scopeKey(scope);
    let state = this.scopes.get(key);
    if (state == null) {
      state = {
        scope: { projectId: scope.projectId, episodesId: scope.episodesId },
        episodeRefs: null,
        episodeRefOverride: null,
        lastPayload: null,
        lastItems: [],
        lastSignature: null,
        lastAccessedAt: Date.now(),
      };
      this.scopes.set(key, state);
    }
    if (opts.episodeRefOverride != null && opts.episodeRefOverride !== "") {
      state.episodeRefOverride = opts.episodeRefOverride;
      state.episodeRefs = null; // override 变更 → refs 重解
    }
    state.lastAccessedAt = Date.now();
    this.startTimerIfNeeded();
    return state;
  }

  getSnapshot(scope: GateScope): GateStatePayload | null {
    return this.scopes.get(scopeKey(scope))?.lastPayload ?? null;
  }

  /** 平台 baseUrl(gate-ops 桥接用;只读访问器)。 */
  getPlatformBaseUrl(): string {
    return this.baseUrl;
  }

  /** 平台调用超时(gate-ops 桥接用;只读访问器)。 */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /** 轮询间隔(gate-state stale 判定用;只读访问器)。 */
  getIntervalMs(): number {
    return this.intervalMs;
  }

  /** 已解析的 episodeRefs(诊断输出;未解析返回 null)。 */
  episodeRefsFor(scope: GateScope): Set<string> | null {
    return this.scopes.get(scopeKey(scope))?.episodeRefs ?? null;
  }

  /** 最近一次成功拉取的候选 items(gate-ops fail-closed 匹配用)。 */
  candidatesFor(scope: GateScope): PlatformReviewItem[] {
    return this.scopes.get(scopeKey(scope))?.lastItems ?? [];
  }

  /** 立即拉取并更新 + diff 广播;返回 payload(degrade 时为降级合成)。 */
  async pollNow(scope: GateScope): Promise<GateStatePayload> {
    const state = this.ensureScope(scope);
    state.lastAccessedAt = Date.now();
    try {
      const refs = await this.resolveEpisodeRefs(state);
      const { items, truncated } = await this.fetchAllPages();
      if (truncated) {
        this.logger.warn(
          `${LOG_PREFIX} reviews 列表超过 ${MAX_LIST_PAGES} 页,列表不完整 → degrade(宁可漏过不可错批)`,
        );
        return this.applyDegrade(state, "truncated");
      }
      state.lastItems = items;
      const payload = this.buildPayload(state.scope, refs, items);
      this.applyPayload(state, payload);
      return payload;
    } catch (err) {
      this.logger.warn(`${LOG_PREFIX} 平台拉取异常 → degrade,保留旧快照`, err);
      return this.applyDegrade(state, "fetch-error");
    }
  }

  /** 测试清理:停 timer、清 scope。 */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.scopes.clear();
  }

  private startTimerIfNeeded(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const [key, state] of this.scopes) {
      if (now - state.lastAccessedAt > SCOPE_EVICTION_MS) {
        this.scopes.delete(key);
        continue;
      }
      try {
        await this.pollNow(state.scope);
      } catch {
        // pollNow 自身 fail-closed;此处兜底防 timer 崩溃。
      }
    }
    if (this.scopes.size === 0 && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 三层 episodeRef 解析:override → legacy 双形态 → 画布探针(缓存)。 */
  private async resolveEpisodeRefs(state: ScopeState): Promise<Set<string>> {
    if (state.episodeRefs != null) return state.episodeRefs;
    const refs = new Set<string>([`ep${state.scope.episodesId}`, String(state.scope.episodesId)]);
    if (state.episodeRefOverride != null) refs.add(state.episodeRefOverride);
    // 画布探针:节点 data JSON 中提取最高频 ep-* token(kmc 工作目录命名)。
    try {
      const nodes = await this.nodesReader(state.scope);
      const counts = new Map<string, number>();
      for (const node of nodes) {
        const raw = safeStringify(node);
        if (raw == null) continue;
        for (const m of raw.matchAll(/episodes\/(ep-[A-Za-z0-9_-]+)/g)) {
          bump(counts, m[1]!);
        }
        for (const m of raw.matchAll(/"(ep-[A-Za-z0-9_-]+)"/g)) {
          bump(counts, m[1]!);
        }
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [tok, count] of counts) {
        if (count > bestCount) {
          best = tok;
          bestCount = count;
        }
      }
      if (best != null) refs.add(best);
    } catch (err) {
      this.logger.warn(`${LOG_PREFIX} episodeRef 画布探针失败(仅剩 legacy 形态,fail-closed)`, err);
    }
    state.episodeRefs = refs;
    return refs;
  }

  /** source 过滤 + 翻页;超页 → truncated(fail-closed)。 */
  private async fetchAllPages(): Promise<{ items: PlatformReviewItem[]; truncated: boolean }> {
    const items: PlatformReviewItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const qs = new URLSearchParams({ source: "kais-movie-agent", limit: "100" });
      if (cursor !== null) qs.set("cursor", cursor);
      // 尾斜杠(54-01):/api/v1/reviews 无斜杠 307 → location 丢端口 → 404。
      const resp = await this.fetchImpl(`${this.baseUrl}/api/v1/reviews/?${qs.toString()}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!resp.ok) throw new Error(`reviews list HTTP ${resp.status}`);
      const body = (await resp.json()) as {
        data?: { items?: PlatformReviewItem[]; next_cursor?: unknown; has_more?: unknown };
      };
      const pageItems = Array.isArray(body?.data?.items) ? body.data.items : [];
      items.push(...pageItems);
      if (body?.data?.has_more !== true) return { items, truncated: false };
      const rawCursor = body?.data?.next_cursor;
      const nextCursor =
        typeof rawCursor === "number" && Number.isFinite(rawCursor)
          ? String(rawCursor)
          : typeof rawCursor === "string" && rawCursor !== ""
            ? rawCursor
            : null;
      if (nextCursor === null || page === MAX_LIST_PAGES - 1) {
        return { items, truncated: true };
      }
      cursor = nextCursor;
    }
    return { items, truncated: true };
  }

  /** 16 门组装:分派最新 review → fold;红线无墓碑恒 auto(有 reject 墓碑上浮红态);
   *  webhook 门(p11b 哨兵)呈现真实态但不参与 blocking(73-01,review F19)。 */
  private buildPayload(scope: GateScope, refs: Set<string>, items: PlatformReviewItem[]): GateStatePayload {
    // 每门最新 review(review id 最大;WR-01 等值分派)。
    const latestByToken = new Map<string, { item: PlatformReviewItem; id: number }>();
    // 红线墓碑分派(按 legacy 别名键;73-01 F20 红线上浮)。
    const latestRedlineByAlias = new Map<string, { item: PlatformReviewItem; id: number }>();
    for (const item of items) {
      const id = Number(item.id);
      if (!Number.isInteger(id)) continue;
      const ref = asString(item.content_ref);
      if (ref == null || asString(item.type) == null) continue;
      const slash = ref.lastIndexOf("/");
      if (slash < 0) continue;
      if (!refs.has(ref.slice(0, slash))) continue;
      const type = asString(item.type)!;
      // 红线墓碑:按 detector 别名直达红线门,不进 token 池(防折叠污染 p13)。
      if (REDLINE_ALIAS_TO_PHASE.has(type)) {
        const prevR = latestRedlineByAlias.get(type);
        if (prevR == null || id > prevR.id) latestRedlineByAlias.set(type, { item, id });
        continue;
      }
      const typeToken = fullPhaseTokenOfItem(item);
      const refToken = fullPhaseToken(ref.slice(slash + 1));
      // content_ref phase segment token 与 type token 等值(桥接同源约束)。
      if (typeToken == null || refToken !== typeToken) continue;
      const prev = latestByToken.get(typeToken);
      if (prev == null || id > prev.id) latestByToken.set(typeToken, { item, id });
    }

    const gates: GateStateGate[] = GATE_CATALOG.map((entry) => {
      const gateId = entry.isRedline ? entry.phaseId : entry.derivedGateId;
      const label = GATE_DISPLAY_NAMES[gateId] ?? entry.phaseId;
      if (entry.isRedline) {
        // 红线(73-01 F20):静态自动扫描态;khs 红线 reject 墓碑上浮为 reject
        // 红态(非阻塞——红线修复在内容侧,画布动作条无意义)。从不参与 blocking。
        const alias = Object.entries(LEGACY_GATE_ID_TO_PHASE_ID).find(
          ([, phaseId]) => phaseId === entry.phaseId,
        )?.[0];
        const tombstone = alias != null ? latestRedlineByAlias.get(alias) : undefined;
        if (tombstone == null) {
          return { gateId, phaseId: entry.phaseId, label, display: "auto" as const, mode: entry.mode };
        }
        const rMeta = (tombstone.item.metadata ?? {}) as { review_result?: { decision?: unknown; reason?: unknown } };
        const fold = foldDisplayState(
          String(tombstone.item.state ?? ""),
          asString(tombstone.item.disposition) ?? null,
          rMeta.review_result == null ? null : { decision: asString(rMeta.review_result.decision) ?? "" },
        );
        const rReason = asString(rMeta.review_result?.reason);
        return {
          gateId,
          phaseId: entry.phaseId,
          label,
          display: fold,
          mode: entry.mode,
          reviewId: tombstone.id,
          updatedAt: asString(tombstone.item.updated_at),
          ...(rReason != null && rReason.length > 0 ? { note: rReason.slice(0, NOTE_MAX_CHARS) } : {}),
        };
      }
      const token = fullPhaseToken(entry.phaseId)!;
      const latest = latestByToken.get(token);
      if (latest == null) {
        return { gateId, phaseId: entry.phaseId, label, display: "pending" as const, mode: entry.mode };
      }
      const meta = (latest.item.metadata ?? {}) as { review_result?: { decision?: unknown; reason?: unknown } };
      const rawResult = meta.review_result ?? null;
      const foldResult = rawResult == null
        ? null
        : { decision: asString(rawResult.decision) ?? "" };
      const display = foldDisplayState(
        String(latest.item.state ?? ""),
        asString(latest.item.disposition) ?? null,
        foldResult,
      );
      const reason = asString(meta.review_result?.reason);
      const note =
        reason != null && reason.length > 0 ? reason.slice(0, NOTE_MAX_CHARS) : undefined;
      return {
        gateId,
        phaseId: entry.phaseId,
        label,
        display,
        mode: entry.mode,
        reviewId: latest.id,
        updatedAt: asString(latest.item.updated_at),
        ...(note != null ? { note } : {}),
      };
    });

    // blocking:pending 且有 reviewId 的最大 reviewId 者(唯一人工焦点)。
    // 73-01 F19:webhook 哨兵门(p11b)永不参与 blocking 竞争——kmc 对 p11b
    // webhook 不停车,reject 回滚承诺对它是谎言;26 条 APPROVING 残留曾凭
    // 最大 reviewId 抢占阻塞焦点。
    let blocking: GateBlocking | null = null;
    for (const g of gates) {
      if (g.mode !== "blocking") continue;
      if (g.display !== "pending" || g.reviewId == null) continue;
      if (blocking == null || g.reviewId > blocking.reviewId) {
        blocking = { gateId: g.gateId, reviewId: g.reviewId, phaseId: g.phaseId, label: g.label };
      }
    }

    return {
      projectId: scope.projectId,
      episodesId: scope.episodesId,
      fetchedAt: Date.now(),
      degrade: false,
      blocking,
      gates,
    };
  }

  private applyPayload(state: ScopeState, payload: GateStatePayload): void {
    const sig = payloadSignature(payload);
    state.lastPayload = payload;
    if (sig !== state.lastSignature) {
      state.lastSignature = sig;
      this.broadcast(payload.projectId, "gate:state", payload);
    }
  }

  /** degrade:保留旧 gates,fetchedAt 不更新;签名含 degrade → 切换时广播。 */
  private applyDegrade(state: ScopeState, cause: string): GateStatePayload {
    const prev = state.lastPayload;
    const degraded: GateStatePayload = prev == null
      ? {
          projectId: state.scope.projectId,
          episodesId: state.scope.episodesId,
          fetchedAt: 0,
          degrade: true,
          blocking: null,
          gates: GATE_CATALOG.map((entry) => ({
            gateId: entry.isRedline ? entry.phaseId : entry.derivedGateId,
            phaseId: entry.phaseId,
            label: GATE_DISPLAY_NAMES[entry.isRedline ? entry.phaseId : entry.derivedGateId] ?? entry.phaseId,
            display: "pending" as const,
            mode: entry.mode,
          })),
        }
      : { ...prev, degrade: true };
    this.logger.warn(`${LOG_PREFIX} degrade=${cause}(fail-closed,绝不折叠为全放行)`);
    this.applyPayload(state, degraded);
    return degraded;
  }
}

function bump(counts: Map<string, number>, token: string): void {
  counts.set(token, (counts.get(token) ?? 0) + 1);
}

/** 探针安全序列化:超大 data 跳过(防 base64 级 blob 拖垮扫描)。 */
function safeStringify(node: Record<string, unknown>): string | null {
  try {
    const raw = JSON.stringify(node.data ?? node);
    return typeof raw === "string" && raw.length <= 1_000_000 ? raw : null;
  } catch {
    return null;
  }
}

/** 默认广播 → ws.broadcastToProject(运行时 import,类型层面仅依赖签名)。 */
const defaultBroadcast: (projectId: number, event: string, data: unknown) => void = (
  projectId,
  event,
  data,
) => {
  void import("@/utils/ws").then((m) => m.broadcastToProject(projectId, event, data));
};

/** 默认画布探针 → listNodes(动态 import:@/utils/db 不进静态 import 图)。 */
const defaultNodesReader: (scope: GateScope) => Promise<Array<Record<string, unknown>>> = async (scope) => {
  const m = await import("@/lib/canvasRelationalStore");
  return m.listNodes(scope) as unknown as Array<Record<string, unknown>>;
};

// ─── 进程级单例(lazy:import 零副作用) ────────────────────────────────────

let _instance: GateStateService | null = null;

export function getGateStateService(): GateStateService {
  if (_instance == null) _instance = new GateStateService();
  return _instance;
}

/** 测试用:替换/清除单例。 */
export function setGateStateServiceForTest(instance: GateStateService | null): void {
  _instance = instance;
}
