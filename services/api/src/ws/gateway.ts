import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { CompanyEvent } from "@ai-opc/shared";

let wss: WebSocketServer | null = null;

export function initWebSocketGateway(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
    if (pathname === "/ws") {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "AGENT_STATUS", payload: { hello: "connected" } }));
  });
}

/** Phát 1 CompanyEvent tới toàn bộ client đang kết nối (Web/Desktop/Mobile). */
export function broadcastCompanyEvent<T>(event: CompanyEvent<T>): void {
  if (!wss) return;
  const data = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}
