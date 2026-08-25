/**
 * g15Bridge.ts — G15 失败镜头操作桥(Phase 53-07 / VAR-04,D-15)。
 *
 * reviewBridge 同构纪律(P1/P2 逐条复刻):deps 注入 + never-throws +
 * fail-closed 匹配。两通道:
 *
 *  1. waive(豁免)= approve-with-comment 扩展语义。协议参照(reviewBridge
 *     L12-18):approve = POST /api/v1/reviews/{id}/approve,body
 *     {comment, result?};409 = review 已在别处 resolve(视为已处理,非错误)。
 *     ⚠️ WBX-03(2026-08-25 review F09/F14/F27):本桥当前 POST 的
 *     /api/v1/g15/ops 在 review-platform 侧**尚不存在**(全网 404)——
 *     送达恒 false,操作只能入 canvas_writeback_queue 重放(≤8 次)。
 *     端点落地(67-02)前 delivered=true 不可达;UI 已按 delivered=false
 *     诚实降级(不再报成功)。G15 的 waive 对应 G15(p11c-gate)review 的
 *     approve,comment 携带 `g15:waive:{shotId}` 标记 + 豁免理由。
 *  2. requeue(重渲)= 冻结新 action。
 *
 * DOCUMENTED PROTOCOL GAP(冻结):kmc 侧 requeue 指令消费端 Wave B 才存在
 * (gated on khs2 v2.4 Phase 25 验收)。当前 delivered=true 仅代表指令送达
 * 桥通道;真实重渲执行不在 Wave A 断言范围(CONTEXT specifics 口径:requeue
 * = 指令送达语义)。Wave B 落地时消费端必须幂等(队列重放可能重复下发,
 * T-53-07-05)。
 *
 * fail-closed 三维匹配(reviewBridge L196-208 同款哲学):scope 校验不过
 * → 不发请求(fetch 计数为 0)、delivered=false。"A missed dispatch is
 * benign; a wrong waive is not."
 *
 * never-throws:全函数体 try/catch 吞一切,连 broken logger 也不 throw;
 * delivered=false 携带 reason(供端点入队 last_error 与审计)。
 */

export interface G15BridgeParams {
  projectId: number;
  episodesId: number;
  action: "waive" | "requeue";
  shotIds: string[];
  /**
   * 56-05 (D-11):目标 gate(缺省 p11c-gate = G15 现行为)。同一 bridge
   * action,不同 gate 目标——G16 配音听审传 'p10c-gate' 复用全链
   * (409 幂等/队列/重放)。白名单在 route zod 层(本层不校验形态)。
   */
  gate?: string;
}

export interface G15BridgeDeps {
  /** default process.env.REVIEW_PLATFORM_URL || "http://review-platform:8090" */
  baseUrl?: string;
  fetchImpl?: typeof fetch; // test injection
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  timeoutMs?: number; // default 5000
}

export type G15DispatchResult =
  | { delivered: true }
  | { delivered: false; reason: string };

const LOG_PREFIX = "[g15-bridge]";
const DEFAULT_TIMEOUT_MS = 5000;

/** fail-closed 前置:shotIds 形状校验(空/超长/超 200 与端点 zod 同口径)。 */
function scopeCheck(params: G15BridgeParams): string | null {
  if (!Array.isArray(params.shotIds) || params.shotIds.length === 0) {
    return "shotIds empty";
  }
  if (params.shotIds.length > 200) {
    return `shotIds ${params.shotIds.length} > 200 bound`;
  }
  for (const s of params.shotIds) {
    if (typeof s !== "string" || s.length === 0 || s.length > 128) {
      return `shotId malformed: ${String(s).slice(0, 32)}`;
    }
  }
  return null;
}

export async function dispatchG15Op(
  params: G15BridgeParams,
  deps: G15BridgeDeps = {},
): Promise<G15DispatchResult> {
  const logger = deps.logger ?? console;
  try {
    // fail-closed:形状不过 → 零请求(A missed dispatch is benign)
    const scopeError = scopeCheck(params);
    if (scopeError != null) {
      logger.warn?.(`${LOG_PREFIX} fail-closed skip: ${scopeError}`);
      return { delivered: false, reason: scopeError };
    }

    const baseUrl = (
      deps.baseUrl ?? process.env.REVIEW_PLATFORM_URL ?? "http://review-platform:8090"
    ).replace(/\/+$/, "");
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (typeof fetchImpl !== "function") {
      return { delivered: false, reason: "no fetch implementation available" };
    }
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const gateId = params.gate ?? "p11c-gate";
    const comment =
      params.action === "waive"
        ? `${gateId}:waive:${params.shotIds.join(",")}`
        : `${gateId}:requeue:${params.shotIds.join(",")}`;

    // G15 缺省 p11c-gate(G16 经 gate:'p10c-gate' 复用,56-05 D-11)。
    // review-platform 无按 content_ref 的服务端过滤
    // (reviewBridge WR-02 已核),桥侧先列表后匹配——本 Wave A 通道为
    // 指令送达语义:直接 POST approve 通道的 G15 扩展形状(批量 comment),
    // review 列表匹配闭环与 Wave B 的 kmc 消费端一并对齐。
    const res = await fetchImpl(`${baseUrl}/api/v1/g15/ops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: params.projectId,
        episodeId: `ep${params.episodesId}`,
        action: params.action,
        shotIds: params.shotIds,
        comment,
        gate: gateId,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status === 409) {
      // 409 = 已在别处处理(reviewBridge 已核语义)——视为送达成功
      logger.info?.(`${LOG_PREFIX} 409 = already resolved elsewhere (treated as delivered)`);
      return { delivered: true };
    }
    if (!res.ok) {
      const reason = `g15 ops endpoint HTTP ${res.status}`;
      logger.warn?.(`${LOG_PREFIX} ${reason}`);
      return { delivered: false, reason };
    }
    return { delivered: true };
  } catch (err) {
    // never-throws:网络/超时/解析一切异常 → delivered=false + reason
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn?.(`${LOG_PREFIX} dispatch failed (queued for replay): ${reason}`);
    return { delivered: false, reason };
  }
}
