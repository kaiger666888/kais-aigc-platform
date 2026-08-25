/**
 * g15Bridge.ts — G15 失败镜头操作桥(Phase 53-07 / VAR-04,D-15)。
 *
 * reviewBridge 同构纪律(P1/P2 逐条复刻):deps 注入 + never-throws +
 * fail-closed 匹配。两通道:
 *
 *  1. waive(豁免)= per-shot 子集语义(67-02 起服务端落地)。协议:
 *     POST /api/v1/g15/ops(review-platform g15_ops.py),服务端 fail-closed
 *     匹配 APPROVING review(type==gate + content_ref episode 段 ∈
 *     episodeRefs),waived_shot_ids union 进 review_result(幂等);404=无
 *     开着的门,409=歧义/已在别处处理(视为已送达)。review 不转终态——
 *     operator approve(web/telegram)才是终态,approve 端点 carry-forward
 *     豁免子集。kmc 侧 runner_hooks 67-03 把 waived_shot_ids 注入 outcome,
 *     p10c/p11c 消费子集(不再 approve=全量一刀切,F15 终结)。
 *  2. requeue(重渲)= 留痕语义:服务端合并 requeue_shot_ids 进
 *     review_result;kmc 重渲消费端 v3.2 Phase 69 落地(当前仅记录)。
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
  /**
   * 67-02 (v3.2 WBX-01):episode 候选集(gateStateService 画布探针解析,
   * WR-01 同源)。kmc content_ref 用真实目录名(ep-zhongkui-ep01),仅靠
   * `ep${episodesId}` 合不上——服务端按 content_ref episode 段 ∈ refs 匹配。
   */
  episodeRefs?: string[];
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
    // 67-02 (v3.2 WBX-01):/api/v1/g15/ops 已在 review-platform 落地——
    // 服务端按 APPROVING + type==gate + content_ref episode 段 ∈ refs
    // fail-closed 匹配(0 命中 404/歧义 409),waive 子集 union 进
    // review_result.waived_shot_ids(幂等),kmc poller 67-03 消费。
    // episodeRefs 由调用方(route)从 gateStateService 画布探针解析传入。
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
        ...(params.episodeRefs != null && params.episodeRefs.length > 0
          ? { episodeRefs: params.episodeRefs }
          : {}),
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
