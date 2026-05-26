import { Server } from "socket.io";

let _io: Server | null = null;

export function setIo(io: Server) {
  _io = io;
}

export function getIo(): Server | null {
  return _io;
}

export function broadcastToProject(
  projectId: string | number,
  event: string,
  data: any,
) {
  if (!_io) return;
  _io
    .of("/ws/projects")
    .to(`project:${projectId}`)
    .emit(event, data);
}
