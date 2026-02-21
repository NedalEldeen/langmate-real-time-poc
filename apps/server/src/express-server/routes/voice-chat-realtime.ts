/**
 * Realtime voice relay — Socket.IO server attachment.
 *
 * This module is intentionally thin.  All session logic lives in
 * ../realtime/session-handler.ts.  The sole responsibility here is to
 * mount a Socket.IO server on the existing HTTP server and delegate each
 * new client connection to the session handler.
 *
 * Transport:
 *   Browser  ←──Socket.IO (/voice-chat/rt)──►  Server
 *   Server   ←──WebSocket (OpenAI Realtime)──►  OpenAI
 *
 * The Socket.IO client script is automatically served by Socket.IO at:
 *   /voice-chat/rt/socket.io.js
 */

import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { handleRealtimeSession } from "../realtime/session-handler";

/**
 * Attaches a Socket.IO server to the provided HTTP server and registers
 * the realtime session handler for every incoming client connection.
 *
 * Must be called before `server.listen()` so the upgrade handler is in place.
 *
 * @param server - The Node.js HTTP server created in src/index.ts.
 */
export function attachRealtimeRoute(server: http.Server): void {
  const io = new SocketIOServer(server, {
    // Custom path keeps this namespace separate from any REST API routes
    path: "/voice-chat/rt",
    // Allow all origins for local development; restrict in production
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    handleRealtimeSession(socket);
  });

  console.log("[realtime] Socket.IO server ready  path=/voice-chat/rt");
}
