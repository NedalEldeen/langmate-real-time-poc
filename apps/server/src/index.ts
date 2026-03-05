import "../bootstrap";
import http from "http";
import { app } from "./express-server/app";
import { attachRealtimeRoute } from "./express-server/routes/voice-chat-realtime";
import { recoverTempFiles } from "./express-server/realtime/audio-recorder";
import { ensureBucket } from "./express-server/realtime/storage-service";

const PORT = process.env.SERVER_PORT ?? 3000;

// Recover any in-flight PCM temp files left over from a previous server run.
recoverTempFiles();

// Ensure the MinIO bucket exists before any sessions start uploading.
// MinIO is off by default; set MINIO_ENABLED=true and run MinIO (e.g. docker-compose up minio) to enable.
ensureBucket().catch((err: unknown) => {
  console.error("[minio] ensureBucket failed (recordings will not be uploaded):", err);
  console.info("[minio] Recordings are still saved locally. Set MINIO_ENABLED=true only when MinIO is running.");
});

const server = http.createServer(app);

attachRealtimeRoute(server);

server.listen(Number(PORT), () => {
  console.log(`Server listening on port ${PORT}`);
});
