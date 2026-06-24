import { Server } from "socket.io";
import productionAgent from "./routes/productionAgent";
import scriptAgent from "./routes/scriptAgent";
import pipelineProgress from "./routes/pipelineProgress";
import { listEvents, getLastEventId } from "@/lib/canvasEventStore";

const REPLAYHardCap = 500;

export default (io: Server) => {
  const routes: Record<string, (nsp: ReturnType<Server["of"]>) => void> = {
    productionAgent,
    scriptAgent,
    pipelineProgress,
  };

  for (const [name, handler] of Object.entries(routes)) {
    const nsp = io.of(`/api/socket/${name}`);
    handler(nsp);
    console.log(`[Socket] 注册命名空间: /api/socket/${name}`);
  }

  // kais-core-backend: WebSocket /ws/projects/:id 实时推送
  io.of("/ws/projects").on("connection", (socket) => {
    const handshakeProjectId = socket.handshake.query.projectId as string;
    if (handshakeProjectId) {
      socket.join(`project:${handshakeProjectId}`);
      console.log(`[WS] 客户端连接 project:${handshakeProjectId}`);
    }

    // Phase 41 SYNC-07: subscribe 握手 — 客户端重连时携带 since=lastEventId
    // 服务端立即补发 since 之后的事件，超过 REPLAYHardCap 时发 canvas:reset 让客户端走全量重载
    socket.on("subscribe", async (payload: { projectId?: number; episodesId?: number; since?: number }) => {
      const projectId = payload?.projectId ?? Number(handshakeProjectId);
      const episodesId = payload?.episodesId;
      if (!projectId || episodesId === undefined) return;

      socket.join(`project:${projectId}`);

      if (payload?.since !== undefined) {
        const events = await listEvents(projectId, episodesId, payload.since, REPLAYHardCap);
        for (const ev of events) {
          socket.emit("canvas:event", {
            eventId: ev.eventId,
            type: ev.type,
            nodeId: ev.nodeId,
            payload: ev.payload,
            projectId,
            episodesId,
            createdAt: ev.createdAt,
          });
        }
        if (events.length >= REPLAYHardCap) {
          const lastEventId = await getLastEventId(projectId, episodesId);
          socket.emit("canvas:reset", { lastEventId });
        }
      }
    });

    socket.on("disconnect", () => {
      if (handshakeProjectId) {
        socket.leave(`project:${handshakeProjectId}`);
      }
    });
  });
};
