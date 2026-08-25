import express from "express";
import { z } from "zod";
import { success, error } from "@/lib/responseFormat";
import { broadcastToProject } from "@/utils/ws";
import { db } from "@/utils/db";
import { dispatchG15Op } from "@/lib/g15Bridge";
import { enqueueWriteback, ensureDrainStarted, drainOnce } from "@/lib/writebackQueue";
import { getManifestTransport, replayManifestWriteback } from "@/lib/manifestWriteback";
import { getGateStateService } from "@/lib/gateStateService";

const router = express.Router();

/**
 * POST /api/canvas/v2/g15-ops — G15 失败镜头批量操作(Phase 53-07 / VAR-04,D-15)。
 *
 * waive(豁免)= reviewBridge approve-with-comment 扩展语义;requeue(重渲)=
 * 指令送达语义(kmc 消费端 Wave B,见 g15Bridge DOCUMENTED PROTOCOL GAP)。
 * 独立端点不并入 select-winner(豁免不是选定,语义不污染)。
 *
 * 桥投递失败 → canvas_writeback_queue 入队重放(action g15_waive/g15_requeue,
 * 53-04 队列复用);入队自身失败降级 warn(最坏丢一次指令,操作侧 UI 已乐观
 * 呈现,Pitfall 4 同款)。
 *
 * body: { projectId, episodesId, action: "waive"|"requeue", shotIds: string[] }
 *   shotIds 每项 1..128,数组 ≤200(V5 bound,与桥 fail-closed 同口径)。
 * → 200 { action, shotIds, applied, queued }
 */
const g15OpsSchema = z.object({
  projectId: z.number(),
  episodesId: z.number(),
  action: z.enum(["waive", "requeue"]),
  shotIds: z.array(z.string().min(1).max(128)).max(200),
  // 56-05 (D-11/T-56-05-01):目标 gate 白名单(gateCatalog deriveGateId 同源
  // 词汇)——任意 gate 字符串不接受,防越权豁免他门;缺省 = G15 p11c-gate。
  gate: z.string().regex(/^p\d+[a-z0-9]*-gate$/).optional(),
});

// 队列 drain 消费者(53-04 bootWritebackDrain 同款;g15 行重放走 g15Bridge)
let drainBooted = false;
function bootG15Drain(): void {
  if (drainBooted) return;
  drainBooted = true;
  void (async () => {
    ensureDrainStarted(db, async (d) => {
      const manifestTransport = getManifestTransport();
      await drainOnce(d, async (row) => {
        if (row.action === "manifest_writeback") {
          if (manifestTransport == null) return true; // 通道未开通——跳过不误标
          return replayManifestWriteback(row, manifestTransport);
        }
        // g15_waive / g15_requeue 重放:按行 payload 重发桥指令。
        // 56-05/WBX-03:gate 必须从 payload 透传——此前解构丢 gate,排队的
        // p10c-gate 豁免重放时被 dispatchG15Op 缺省成 p11c-gate(错门豁免)。
        // 67-02:episodeRefs 同随 payload 透传(入队时快照的重放同源)。
        const payload = JSON.parse(row.payload) as {
          projectId: number;
          episodesId: number;
          action: "waive" | "requeue";
          shotIds: string[];
          gate?: string;
          episodeRefs?: string[];
        };
        const r = await dispatchG15Op(payload);
        return r.delivered;
      });
    });
  })().catch(() => {
    drainBooted = false;
  });
}

router.post("/", async (req, res) => {
  const parse = g15OpsSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).send(error("参数校验失败", parse.error.issues));
  }
  const { projectId, episodesId, action, shotIds, gate } = parse.data;

  // 67-02 (WBX-01):episodeRefs 从 gateStateService 画布探针取(WR-01 同源
  // ——kmc content_ref 用 ep-zhongkui-ep01 目录名,裸 ep{id} 合不上)。
  // 未解析过(服务未轮询该 scope)先兜底 legacy 双形态,并异步触发一次
  // pollNow 供后续操作用;refs 随入队 payload 持久化,drain 重放同源。
  const scope = { projectId, episodesId };
  const svc = getGateStateService();
  svc.ensureScope(scope);
  const refs = svc.episodeRefsFor(scope) ?? new Set([`ep${episodesId}`, String(episodesId)]);
  if (svc.episodeRefsFor(scope) == null) void svc.pollNow(scope).catch(() => {});
  const episodeRefs = [...refs];

  try {
    bootG15Drain();
    const result = await dispatchG15Op({ projectId, episodesId, action, shotIds, gate, episodeRefs });
    let queued = 0;
    if (!result.delivered) {
      // D-10/Pitfall 4:入队失败降级 warn——响应仍是 200(操作已受理)
      try {
        await enqueueWriteback(db, {
          projectId,
          episodesId,
          action: action === "waive" ? "g15_waive" : "g15_requeue",
          // 56-05:gate 入队透传;67-02:episodeRefs 一并入队(重放同源)
          payload: { projectId, episodesId, action, shotIds, gate, episodeRefs, lastReason: result.reason },
        });
        queued = 1;
      } catch (queueErr) {
        console.warn("[canvas:v2/g15-ops] 回写入队失败(降级丢弃):", queueErr);
      }
    }

    broadcastToProject(projectId, "g15:ops", {
      projectId,
      episodesId,
      action,
      shotIds,
      delivered: result.delivered,
      queued,
      timestamp: Date.now(),
    });

    return res
      .status(200)
      .send(success({ action, shotIds, applied: result.delivered ? shotIds.length : 0, queued, delivered: result.delivered }));
  } catch (err) {
    console.error("[canvas:v2/g15-ops] 操作失败:", err);
    return res.status(500).send(error("G15 操作失败"));
  }
});

export default router;
