import cors from "cors";
import express from "express";
import path from "path";
import { voiceChatRouter } from "./routes/voice-chat.router";
import { sessionsApiRouter } from "./routes/sessions-api";

export const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Serve the test UI from /public (two levels up from src/express-server/)
app.use(express.static(path.join(__dirname, "../../public")));

// Serve saved recordings so the client can play them back
app.use("/recordings", express.static(path.join(__dirname, "../../data/recordings")));

app.use("/voice-chat", voiceChatRouter);
app.use("/api", sessionsApiRouter);
