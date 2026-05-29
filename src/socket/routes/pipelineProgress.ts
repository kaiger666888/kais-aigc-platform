import u from "@/utils";
import { Namespace, Socket } from "socket.io";

/**
 * Pipeline progress WebSocket route — namespace: /api/socket/pipelineProgress
 *
 * Events emitted to subscribed clients:
 *   pipeline:started        — pipeline run started
 *   pipeline:phase-start    — a phase has begun
 *   pipeline:phase-progress — phase progress update (percent)
 *   pipeline:phase-complete — phase finished (completed / failed)
 *   pipeline:review-required— phase waiting for human review
 *   pipeline:review-result  — review decision made
 *   pipeline:completed      — entire pipeline finished
 *   pipeline:failed         — pipeline run failed
 *
 * Client events:
 *   pipeline:subscribe   — subscribe to a pipeline (body: { pipelineId })
 *   pipeline:unsubscribe — unsubscribe
 *   pipeline:history     — request historical progress (body: { pipelineId })
 */

interface HistoryPayload {
  pipelineId: string;
}

export default (nsp: Namespace) => {
  nsp.on("connection", (socket: Socket) => {
    const subscribedPipelineIds = new Set<string>();

    console.log(`[pipelineProgress] 客户端已连接: ${socket.id}`);

    // --- Subscribe to a specific pipeline run ---
    socket.on("pipeline:subscribe", (data: { pipelineId: string }) => {
      const { pipelineId } = data;
      if (!pipelineId) return;
      subscribedPipelineIds.add(pipelineId);
      socket.join(`pipeline:${pipelineId}`);
      console.log(`[pipelineProgress] ${socket.id} 订阅 pipeline:${pipelineId}`);
    });

    // --- Unsubscribe ---
    socket.on("pipeline:unsubscribe", (data: { pipelineId: string }) => {
      const { pipelineId } = data;
      if (!pipelineId) return;
      subscribedPipelineIds.delete(pipelineId);
      socket.leave(`pipeline:${pipelineId}`);
    });

    // --- Request historical progress for a pipeline run ---
    socket.on("pipeline:history", async (data: HistoryPayload, callback?: (result: any) => void) => {
      const { pipelineId } = data;
      if (!pipelineId) {
        callback?.({ error: "pipelineId is required" });
        return;
      }

      try {
        const run = await u.db("kv_pipelineRun").where({ id: pipelineId }).first();
        if (!run) {
          callback?.({ error: "pipeline run not found" });
          return;
        }

        // Fetch audit trail for this pipeline
        const audits = await u.db("kv_audit")
          .where("detail", "like", `%${pipelineId}%`)
          .orderBy("createTime", "asc")
          .select("*");

        callback?.({
          pipelineId: run.id,
          projectId: run.projectId,
          state: run.state,
          currentPhase: run.currentPhase,
          currentPhaseOrder: run.currentPhaseOrder,
          createTime: run.createTime,
          updateTime: run.updateTime,
          config: run.config,
          auditTrail: audits.map((a: any) => ({
            id: a.id,
            action: a.action,
            result: a.result,
            detail: a.detail,
            createTime: a.createTime,
          })),
        });
      } catch (err: any) {
        console.error("[pipelineProgress] history error:", err.message);
        callback?.({ error: "failed to fetch history" });
      }
    });

    // --- Disconnect ---
    socket.on("disconnect", () => {
      for (const pid of subscribedPipelineIds) {
        socket.leave(`pipeline:${pid}`);
      }
      subscribedPipelineIds.clear();
      console.log(`[pipelineProgress] 客户端断开: ${socket.id}`);
    });
  });
};
