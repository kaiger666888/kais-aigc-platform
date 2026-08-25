/**
 * reviewBridge.ts — kap → review-platform resolve bridge (Phase 49 SELECT-04).
 *
 * After a canvas variant-group winner selection succeeds (the 49-01
 * select-winner endpoint), this module looks for the matching OPEN review on
 * the review-platform and approves it with the chosen variant. It is
 * best-effort and fire-and-forget: called with `void`, never awaited by the
 * endpoint, and it can NEVER reject — every failure path is warn/info + skip
 * so the selection response is unaffected (D-08/D-10).
 *
 * Verified platform contract (cross-repo source audit 2026-08-19):
 *  1. Approve = `POST /api/v1/reviews/{id}/approve` with body
 *     `{ comment?: string, result?: { selected: number[] | null, scores?,
 *     feedback? } }`. The review MUST be in APPROVING state, otherwise 409 —
 *     a 409 therefore means "already resolved elsewhere": warn + skip, never
 *     an error. `result` is stored atomically into
 *     `metadata_json.review_result` and the terminal state is COMPLETE.
 *     Platform-side auth was removed (no token in transit).
 *  2. `GET /api/v1/reviews/?status=&type=&source=&limit=&cursor=` has NO
 *     content_ref filter parameter — candidates must be filtered CLIENT-SIDE
 *     from `data.items[]`. Envelope: `{ data: { items, next_cursor,
 *     has_more } }`; `limit` truncates, so the bridge paginates via
 *     next_cursor (WR-02, bounded to MAX_LIST_PAGES).
 *  3. kmc submits reviews as source_system="kais-movie-agent" with
 *     content_ref=`${episodeId}/${phase}` (e.g. "ep03/p11a0", phase = the
 *     segment after the last "/") and type=gate_id.
 *  4. Candidate scoping (CR-01/WR-01) is fail-closed on ALL dimensions:
 *     the content_ref episode segment must equal `ep${episodesId}` or the
 *     bare `${episodesId}`, and the leading `p<digits>` run of BOTH the gate
 *     type and the content_ref phase segment must EQUAL the derived phase
 *     token — a phase-matching gate of ANOTHER episode, or a prefix
 *     collision (`p1` vs `p11a0`), is a mismatch and is skipped. A missed
 *     bridge is benign; a wrong approve is not.
 *
 * DOCUMENTED PROTOCOL GAP (frozen by D-11 — kmc AND kais-review-platform are
 * both read-only this phase):
 *  - `chosen_variant_id` and `suggested_action` do NOT exist anywhere in the
 *    review-platform codebase: approving with result.selected produces
 *    NEITHER field, and the worker callback body ({review_id, old_state,
 *    new_state, timestamp, source_system, disposition, result}) lacks the
 *    gate_id/decision keys kmc's resume_from_callback needs — the callback
 *    path is a dead end for kmc.
 *  - kmc's 30s poller (runner_hooks.py Path 2) extracts
 *    {review_id, state, disposition, version} and considers the review done
 *    when state ∈ {"resolved","closed"} — but the platform state vocabulary
 *    is PENDING/POLICY_EVAL/APPROVING/COMPLETE. It ends at COMPLETE, so
 *    "resolved"/"closed" NEVER matches: kmc cannot currently read ANY
 *    platform-side resolve, not just the chosen variant.
 *  - `choose:<id>` is the only marker kmc's _chosen_from_suggested() can
 *    parse (action.startsWith("choose:") → action.slice("choose:".length)
 *    .trim()); the approve comment therefore embeds `choose:v{N}` as the
 *    forward-compatible channel (result.selected is the only machine-
 *    readable selection channel the platform persists today).
 * ⇒ This is a CONSUMER-side protocol gap, not a kap bridge gap. The bridge
 *    writes the real contract above; when kmc / the platform later align
 *    their state vocabulary and field extraction (out of scope, Phase 50+),
 *    this bridge lights up WITHOUT modification.
 *
 * Dependencies are ALL injected (baseUrl / fetchImpl / logger / timeoutMs —
 * mirroring ingestAssets.ts): the module imports NOTHING from the utils
 * barrel, so scripts and tests can drive the bridge against their own
 * endpoints without booting the app.
 */

import { LEGACY_GATE_ID_TO_PHASE_ID, fullPhaseToken } from "./gateCatalog";

export interface ReviewBridgeParams {
  projectId: number;
  episodesId: number;
  groupId: string;
  winnerNodeId: string;
  variantIndex: number;           // 1-based array position (legacy, kept for response compat)
  winnerPhaseName: string | null; // e.g. "p11_first_last_frames"; null → info skip
  /**
   * 70-01/70-02 (v3.2 F08):真 v{N} 编号(从 winner 节点解析,非数组位置)——
   * choose 载荷与 result.selected 用它;缺省回退 variantIndex。
   */
  variantNumber?: number;
  /**
   * 70-01 (F08-①):choose 作用域载荷所需——shot_id + frame_slot(从
   * cand:shot:{sid}:{slot} 组 id 解析,路由层传入)。缺省时 p11a0 域载荷
   * 退化为裸 v{N}(fail-closed,宁可不带作用域不构造错误作用域)。
   */
  shotId?: string;
  frameSlot?: "first" | "last" | null;
}

export interface ReviewBridgeDeps {
  baseUrl?: string;               // default process.env.REVIEW_PLATFORM_URL || "http://review-platform:8090"
  fetchImpl?: typeof fetch;       // test injection
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  timeoutMs?: number;             // default 5000
}

interface ReviewListItem {
  id?: number | string;
  type?: unknown;
  content_ref?: unknown;
}

const LOG_PREFIX = "[review-bridge]";
const DEFAULT_TIMEOUT_MS = 5000;

/** Phase token from a canvas phase name: first "_"-segment, lowercased
 *  ("p11_first_last_frames" → "p11"). null/empty → null (skip). */
function derivePhaseToken(winnerPhaseName: string | null | undefined): string | null {
  if (typeof winnerPhaseName !== "string") return null;
  const head = winnerPhaseName.split("_", 1)[0].trim().toLowerCase();
  return head.length > 0 ? head : null;
}

/** Leading `p<digits>` run of a gate type / content_ref phase segment,
 *  lowercased ("p11a0" → "p11", "p1_x" → "p1"). null when the string does
 *  not start with p+digits. WR-01: candidate matching compares THIS token
 *  for equality — never a prefix `startsWith`, which let a `p1_tone`
 *  selection collide with gate `p11a0` / `p10_*`. */
export function leadingPhaseToken(value: string): string | null {
  const m = /^p\d+/.exec(value.trim().toLowerCase());
  return m === null ? null : m[0];
}

export interface EpisodePhaseCandidate {
  type?: unknown
  content_ref?: unknown
}

/**
 * 三维 fail-closed 候选过滤(Phase 54-01 抽取导出,gateStateService 与
 * gate-ops 共用):
 *   a. item.type 的相位 token 与 phaseToken **等值**(WR-01:绝不前缀匹配
 *      ——p1 与 p11a0 必须互斥);
 *   b. content_ref episode segment(最后一个 "/" 之前)∈ episodeRefs;
 *   c. content_ref phase segment 的 token 与 phaseToken 等值。
 * 任何字段非 string → false(missed 是良性,wrong 不是)。
 *
 * 70-03 (v3.2 F18):token 语义从 leadingPhaseToken(/^p\d+/ 折叠)迁移到
 * fullPhaseToken(p+digits+字母尾缀)——p11a0/p11a/p11b/p11c 各自独立匹配,
 * 「资产点击静默错批同剧集 open 的 p11c 门」路径被此过滤天然锁死。
 */
export function filterEpisodePhaseCandidates<T extends EpisodePhaseCandidate>(
  items: T[],
  episodeRefs: Set<string>,
  phaseToken: string,
): T[] {
  return items.filter((item) => {
    if (typeof item.type !== "string" || typeof item.content_ref !== "string") return false;
    const typeToken = tokenOfGateType(item.type);
    if (typeToken !== phaseToken) return false;
    const ref = item.content_ref;
    const slash = ref.lastIndexOf("/");
    if (slash < 0) return false;
    const episodeSegment = ref.slice(0, slash);
    const phaseSegment = ref.slice(slash + 1);
    if (!episodeRefs.has(episodeSegment)) return false;
    return fullPhaseToken(phaseSegment) === phaseToken;
  });
}

/** gate type 的完整 token(legacy 别名优先——topic-gate → p01)。 */
function tokenOfGateType(gateType: string): string | null {
  const legacy = LEGACY_GATE_ID_TO_PHASE_ID[gateType];
  return fullPhaseToken(legacy ?? gateType);
}

/** winner phase_name 的完整 token("p11a0_iframe_qc" → "p11a0")。 */
function tokenOfPhaseName(phaseName: string): string | null {
  return fullPhaseToken(phaseName.split("_", 1)[0] ?? phaseName);
}

/**
 * 70-01 (v3.2 F08-①/④):按目标 phase 的 id 空间构造 choose 载荷——
 * khs chosen_from_outcome 按 per-phase finalists id 集(string)校验,
 * 裸 "v{N}" 对 p11a0("{sid}:{ft}:v{N}")与 p11a("{sid}:{vid}")恒不命中
 * → warn 回落 rank#1 却表面 approve 成功(F08 根因)。ADR-1(v3.2 变体域)
 * 定 string finalist id 为全线路标。
 */
function choosePayloadForToken(
  token: string,
  vN: number,
  shotId: string | undefined,
  frameSlot: "first" | "last" | null | undefined,
): string {
  if (token === "p11a0" && shotId != null && (frameSlot === "first" || frameSlot === "last")) {
    return `${shotId}:${frameSlot}:v${vN}`;
  }
  if (token === "p11a" && shotId != null) {
    return `${shotId}:v${vN}`;
  }
  return `v${vN}`; // p01 及其余域:variant_id 空间
}

/**
 * Best-effort resolve of the open (APPROVING) kmc review matching the canvas
 * winner's phase. NEVER throws — the whole body is wrapped, any error is
 * warn-logged and swallowed (T-49-05/06/07/08: fixed outbound path, injected
 * timeouts, double-field matching, no credentials in logs).
 */
export async function resolveOpenReviewForSelection(
  params: ReviewBridgeParams,
  deps: ReviewBridgeDeps = {},
): Promise<void> {
  const logger = deps.logger ?? console;
  try {
    const baseUrl = (deps.baseUrl ?? process.env.REVIEW_PLATFORM_URL ?? "http://review-platform:8090")
      .replace(/\/+$/, "");
    const fetchImpl = deps.fetchImpl ?? fetch;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Phase token derivation — no usable phase name means the selection
    // cannot be correlated to any kmc gate (common case → info skip).
    // 70-03 (F18):fullPhaseToken——p11a0/p11a/p11b/p11c 独立分派。
    const phaseToken = tokenOfPhaseName(params.winnerPhaseName ?? "");
    if (phaseToken === null) {
      logger.info(`${LOG_PREFIX} winnerPhaseName 为空，跳过 review 桥接`);
      return;
    }

    // 1. Query open reviews (APPROVING) from the kmc source system. WR-02:
    //    `limit` truncates the list — follow next_cursor/has_more so a busy
    //    queue cannot push the real gate off page 1. The loop is BOUNDED
    //    (MAX_LIST_PAGES): exhausting it with has_more still true means the
    //    candidate list is unusable → warn + skip (fail closed) instead of
    //    approving from a partial list.
    const MAX_LIST_PAGES = 10;
    const items: ReviewListItem[] = [];
    let cursor: string | null = null;
    let truncated = false;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const qs = new URLSearchParams({
        source: "kais-movie-agent",
        status: "APPROVING",
        limit: "100",
      });
      if (cursor !== null) qs.set("cursor", cursor);
      // 尾斜杠(61-02/54-01 同陷阱):/api/v1/reviews 无斜杠 307 → Location 丢端口 → 404;带斜杠直连 200。
      const listResp = await fetchImpl(`${baseUrl}/api/v1/reviews/?${qs.toString()}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!listResp.ok) {
        logger.warn(`${LOG_PREFIX} 查询 open review 失败: HTTP ${listResp.status}`);
        return;
      }
      const body = (await listResp.json()) as {
        data?: { items?: ReviewListItem[]; next_cursor?: unknown; has_more?: unknown };
      };
      const pageItems = Array.isArray(body?.data?.items) ? body.data.items : [];
      items.push(...pageItems);
      if (body?.data?.has_more !== true) break;
      const rawCursor = body?.data?.next_cursor;
      const nextCursor =
        typeof rawCursor === "number" && Number.isFinite(rawCursor)
          ? String(rawCursor)
          : typeof rawCursor === "string" && rawCursor !== ""
            ? rawCursor
            : null;
      if (nextCursor === null || page === MAX_LIST_PAGES - 1) {
        // has_more but no cursor to follow, or page bound reached — the list
        // is truncated and cannot be trusted for a single-candidate approve.
        truncated = true;
        break;
      }
      cursor = nextCursor;
    }
    if (truncated) {
      logger.warn(
        `${LOG_PREFIX} open review 列表超过 ${MAX_LIST_PAGES} 页（或平台未回 next_cursor）` +
          `，列表不完整，放弃桥接（宁可漏过不可错批）`,
      );
      return;
    }

    // 2. Client-side candidate filter (the platform has no content_ref
    //    filter param). ALL THREE dimensions must match, fail closed:
    //    a. gate type — leading `p<digits>` EQUAL to the phase token (WR-01:
    //       no prefix matching, `p1` must never collide with `p11a0`);
    //    b. content_ref episode segment — EQUAL to `ep${episodesId}` or the
    //       bare `${episodesId}` (CR-01: a phase-matching gate belonging to
    //       ANOTHER episode/project is exactly the wrong-approve hazard;
    //       both id forms accepted until the kmc content_ref format is
    //       frozen). A gate whose episode cannot be verified is a mismatch;
    //    c. content_ref phase segment (after the last "/") — same exact
    //       token equality as (a).
    const episodeIds = new Set<string>([`ep${params.episodesId}`, String(params.episodesId)]);
    const candidates = filterEpisodePhaseCandidates(items, episodeIds, phaseToken ?? "");

    if (candidates.length === 0) {
      logger.info(`${LOG_PREFIX} 无挂起 gate，跳过桥接（常态）`);
      return;
    }
    if (candidates.length >= 2) {
      // Better to not resolve at all than to resolve someone else's gate.
      logger.warn(`${LOG_PREFIX} 歧义：${candidates.length} 个 open review 匹配，跳过`);
      return;
    }

    // 3. Exactly one hit → approve with the chosen variant.
    //    70-01 (F08-①):choose 载荷按 phase id 空间构造(scoped);70-02
    //    (F08-②):v{N} 用 winner 节点的真编号 variantNumber(非数组位置)。
    const target = candidates[0];
    const vN = params.variantNumber ?? params.variantIndex;
    const chooseId = choosePayloadForToken(phaseToken, vN, params.shotId, params.frameSlot);
    const approveResp = await fetchImpl(
      `${baseUrl}/api/v1/reviews/${target.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment:
            `choose:${chooseId} ` +
            `(canvas group ${params.groupId} winner ${params.winnerNodeId}, ` +
            `project ${params.projectId}/${params.episodesId})`,
          result: { selected: [vN] },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (approveResp.status === 409) {
      logger.warn(`${LOG_PREFIX} review ${target.id} 已被别处 resolve（409），跳过`);
      return;
    }
    if (!approveResp.ok) {
      logger.warn(`${LOG_PREFIX} approve 失败: HTTP ${approveResp.status} (review ${target.id})`);
      return;
    }
    logger.info(
      `${LOG_PREFIX} review ${target.id} 已 approve（choose:${chooseId}，` +
      `gate ${target.type}）`,
    );
  } catch (err) {
    // Swallow EVERYTHING (fetch errors, timeouts, JSON parse errors…) — the
    // bridge is best-effort and must never leak into the caller's response.
    try {
      logger.warn(`${LOG_PREFIX} 桥接失败（尽力而为，不影响选定）:`, err);
    } catch {
      // even a broken injected logger must not turn this into a throw
    }
  }
}
