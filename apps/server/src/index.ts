import "../bootstrap";
import http from "http";
import { app } from "./express-server/app";
import { attachRealtimeRoute } from "./express-server/routes/voice-chat-realtime";

const PORT = process.env.SERVER_PORT ?? 3000;

const server = http.createServer(app);

attachRealtimeRoute(server);

server.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
});
