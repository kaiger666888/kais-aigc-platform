import { Server } from "socket.io";
import productionAgent from "./routes/productionAgent";
import scriptAgent from "./routes/scriptAgent";
import pipelineProgress from "./routes/pipelineProgress";

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
    const projectId = socket.handshake.query.projectId as string;
    if (projectId) {
      socket.join(`project:${projectId}`);
      console.log(`[WS] 客户端连接 project:${projectId}`);
    }
    socket.on("disconnect", () => {
      if (projectId) {
        socket.leave(`project:${projectId}`);
      }
    });
  });
};
