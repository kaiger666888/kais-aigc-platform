/**
 * manifestWriteback.ts — 选定 → kmc manifest 回写通道(Phase 53-04 / VAR-03
 * kap 半部,D-09/D-10/D-11)。
 *
 * 通道收口(D-09):select-winner 端点 status==='updated' 段 reviewBridge 同位
 * 挂本模块,一处扩展不另开端点。best-effort 隔离(D-10):hook 失败绝不影响
 * 200 响应;失败入 canvas_writeback_queue 重放;入队自身失败降级 warn(最坏
 * 丢一次回写,canvas 真值已在——Pitfall 4)。
 *
 * 字段名权威对齐(D-11):frameSlot='first' → selected_first_variant;
 * 'last' → selected_last_variant(p11a0 已写 iframe-manifest.json 的既有名);
 * 无 frameSlot(G14 预览等)→ chosen_variant_id(variantIndex 通用化,Wave B
 * 定最终字段形状)。
 *
 * Wave B 决策点冻结(Open Question 1):传输实现 = FS 直写 episode workdir
 * vs HTTP——本模块把传输抽象为 ManifestTransport deps 注入,Wave A 零实现
 * (KMC_MANIFEST_TRANSPORT 未配置 → warn-once + no-op,不入队——避免 Wave A
 * 把每笔选定都灌成 8 次重试的 failed 行;通道未开通 ≠ 通道故障)。
 * Wave B 挂接点:getManifestTransport() 返回实现 + replayManifestWriteback
 * 作为 drain handler。
 *
 * never-throws 纪律(reviewBridge P1 逐条复刻):全函数体 try/catch 吞一切,
 * 连 broken logger 也不 throw;幂等语义 = "目标值已相等 → no-op"(队列重放
 * 依赖 transport 自身幂等)。
 */

import { enqueueWriteback, type WritebackQueueRow } from "./writebackQueue";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ManifestWritebackParams {
  projectId: number
  episodesId: number
  groupId: string
  winnerNodeId: string
  variantIndex: number
  frameSlot?: "first" | "last"
  source?: string
}

export interface ManifestWriteTarget {
  field: "selected_first_variant" | "selected_last_variant" | "chosen_variant_id"
  value: number // 1-based variantIndex
}

/**
 * 出站传输接口(Wave B 实现:FS 直写 / HTTP)。
 * 实现自身必须幂等:目标值已相等 → no-op(成功返回)——队列重放依赖。
 * FS 实现的路径约束(冻结,V12):必须限定在 episode workdir 内。
 */
export interface ManifestTransport {
  writeSelection(params: ManifestWritebackParams, target: ManifestWriteTarget): Promise<void>
}

// ─── Transport resolution(Wave B 挂接点)──────────────────────────────────

export function getManifestTransport(): ManifestTransport | null {
  // Wave A:无实现。Wave B:按 KMC_MANIFEST_TRANSPORT(env)分派 FS/HTTP 实现。
  const configured = process.env.KMC_MANIFEST_TRANSPORT;
  if (!configured) return null;
  // 已配置但无实现注册——视为未开通(warn-once 路径),不猜通道。
  return null;
}

// ─── Target mapping(D-11 权威字段名)──────────────────────────────────────

export function targetForParams(params: ManifestWritebackParams): ManifestWriteTarget {
  const field: ManifestWriteTarget["field"] =
    params.frameSlot === "first"
      ? "selected_first_variant"
      : params.frameSlot === "last"
        ? "selected_last_variant"
        : "chosen_variant_id";
  return { field, value: params.variantIndex };
}

// ─── enqueueManifestWriteback(never-throws 挂点)──────────────────────────

let warnedNoTransport = false;

export async function enqueueManifestWriteback(params: ManifestWritebackParams): Promise<void> {
  try {
    const transport = getManifestTransport();
    if (transport == null) {
      if (!warnedNoTransport) {
        warnedNoTransport = true;
        console.warn(
          "[manifestWriteback] 传输未配置,跳过 manifest 回写(队列未启用)",
        );
      }
      return;
    }
    try {
      await transport.writeSelection(params, targetForParams(params));
      return; // 直投成功——不入队
    } catch {
      // 直投失败 → 入队重放(D-10)
    }
    try {
      const { db } = await import("@/utils/db");
      await enqueueWriteback(db, {
        projectId: params.projectId,
        episodesId: params.episodesId,
        action: "manifest_writeback",
        payload: params as unknown as Record<string, unknown>,
      });
    } catch (queueErr) {
      // Pitfall 4:入队失败降级日志——最坏丢一次回写,canvas 真值已在
      console.warn("[manifestWriteback] 回写入队失败(降级丢弃):", queueErr);
    }
  } catch (outer) {
    // never-throws 双保险(连 getManifestTransport 抛错也不影响选定响应)
    console.warn("[manifestWriteback] 回写通道异常(吞错):", outer);
  }
}

// ─── replayManifestWriteback(drain handler)────────────────────────────────

/** 队列重放 handler:按行 payload 重放 writeSelection,成功 true。 */
export async function replayManifestWriteback(
  row: WritebackQueueRow,
  transport: ManifestTransport,
): Promise<boolean> {
  const params = JSON.parse(row.payload) as ManifestWritebackParams;
  await transport.writeSelection(params, targetForParams(params));
  return true;
}
