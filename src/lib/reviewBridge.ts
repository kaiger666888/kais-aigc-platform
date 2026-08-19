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
 *  2. `GET /api/v1/reviews?status=&type=&source=&limit=` has NO content_ref
 *     filter parameter — candidates must be filtered CLIENT-SIDE from
 *     `data.items[]`. Envelope: `{ data: { items, next_cursor, has_more } }`.
 *  3. kmc submits reviews as source_system="kais-movie-agent" with
 *     content_ref=`${episodeId}/${phase}` (e.g. "ep03/p11a0", phase = the
 *     segment after the last "/") and type=gate_id.
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

export interface ReviewBridgeParams {
  projectId: number;
  episodesId: number;
  groupId: string;
  winnerNodeId: string;
  variantIndex: number;           // 1-based (SelectWinnerResult.variantIndex)
  winnerPhaseName: string | null; // e.g. "p11_first_last_frames"; null → info skip
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
    const phaseToken = derivePhaseToken(params.winnerPhaseName);
    if (phaseToken === null) {
      logger.info(`${LOG_PREFIX} winnerPhaseName 为空，跳过 review 桥接`);
      return;
    }

    // 1. Query open reviews (APPROVING) from the kmc source system.
    const qs = new URLSearchParams({
      source: "kais-movie-agent",
      status: "APPROVING",
      limit: "100",
    });
    const listResp = await fetchImpl(`${baseUrl}/api/v1/reviews?${qs.toString()}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!listResp.ok) {
      logger.warn(`${LOG_PREFIX} 查询 open review 失败: HTTP ${listResp.status}`);
      return;
    }
    const body = (await listResp.json()) as { data?: { items?: ReviewListItem[] } };
    const items = Array.isArray(body?.data?.items) ? body.data.items : [];

    // 2. Client-side candidate filter (the platform has no content_ref
    //    filter param): BOTH the gate type AND the content_ref phase segment
    //    (after the last "/") must start with the phase token.
    const candidates = items.filter((item) => {
      if (typeof item.type !== "string" || !item.type.startsWith(phaseToken)) return false;
      if (typeof item.content_ref !== "string") return false;
      const phaseSegment = item.content_ref.slice(item.content_ref.lastIndexOf("/") + 1);
      return phaseSegment.startsWith(phaseToken);
    });

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
    const target = candidates[0];
    const approveResp = await fetchImpl(
      `${baseUrl}/api/v1/reviews/${target.id}/approve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comment:
            `choose:v${params.variantIndex} ` +
            `(canvas group ${params.groupId} winner ${params.winnerNodeId}, ` +
            `project ${params.projectId}/${params.episodesId})`,
          result: { selected: [params.variantIndex] },
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
      `${LOG_PREFIX} review ${target.id} 已 approve（choose:v${params.variantIndex}，` +
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
