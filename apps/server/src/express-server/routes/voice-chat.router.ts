import { Router, Request, Response } from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { Readable } from "stream";

const router = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------------------------------------------------------------------------
// Multer — accept audio in memory (max 10 MB)
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = [
  "audio/aac",
  "audio/webm",
  "audio/wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`));
    }
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveExtension(mimeType: string): string {
  if (mimeType.includes("m4a") || mimeType.includes("mp4")) return ".m4a";
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return ".mp3";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("ogg")) return ".ogg";
  if (mimeType.includes("aac")) return ".aac";
  return ".wav";
}

// ---------------------------------------------------------------------------
// POST /voice-chat
//
// Flow:
//   1. Receive audio file (multipart, field name: "audio")
//   2. STT  — OpenAI gpt-4o-mini-transcribe
//   3. LLM  — OpenAI gpt-4o-mini
//   4. TTS  — OpenAI gpt-4o-mini-tts
//   5. Stream AAC audio back to client
//
// Response headers:
//   Content-Type     : audio/aac
//   X-Transcription  : URL-encoded user transcription
//   X-Response-Text  : URL-encoded LLM reply text
// ---------------------------------------------------------------------------

router.post(
  "/",
  upload.single("audio"),
  async (req: Request, res: Response) => {
    try {
      // ── 1. Validate input ───────────────────────────────────────────────
      if (!req.file) {
        res.status(400).json({ error: "No audio file provided. Send a multipart/form-data request with field name 'audio'." });
        return;
      }

      const { buffer, mimetype } = req.file;
      const extension = resolveExtension(mimetype);

      // ── 2. Speech-to-Text ───────────────────────────────────────────────
      console.log(`[STT] transcribing ${mimetype} (${buffer.byteLength} bytes)…`);

      const audioFile = await toFile(buffer, `audio${extension}`, { type: mimetype });
      const transcription = await openai.audio.transcriptions.create({
        file: audioFile,
        model: "gpt-4o-mini-transcribe",
      });

      const userText = transcription.text.trim();
      console.log(`[STT] "${userText}"`);

      // ── 3. LLM ──────────────────────────────────────────────────────────
      console.log("[LLM] generating response…");

      const chatCompletion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant. Keep your answers concise and conversational.",
          },
          { role: "user", content: userText },
        ],
      });

      const responseText = chatCompletion.choices[0]?.message?.content?.trim() ?? "";
      console.log(`[LLM] "${responseText}"`);

      // ── 4. Text-to-Speech ───────────────────────────────────────────────
      console.log("[TTS] generating audio…");

      const ttsResponse = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        input: responseText,
        voice: "nova",
        response_format: "aac",
      });

      // ── 5. Stream audio back ────────────────────────────────────────────
      res.setHeader("Content-Type", "audio/aac");
      res.setHeader("X-Transcription", encodeURIComponent(userText));
      res.setHeader("X-Response-Text", encodeURIComponent(responseText));

      const audioStream = Readable.fromWeb(ttsResponse.body as Parameters<typeof Readable.fromWeb>[0]);
      audioStream.pipe(res);

      audioStream.on("error", (err) => {
        console.error("[TTS stream error]", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream audio response" });
        }
      });
    } catch (err) {
      console.error("[voice-chat error]", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

export { router as voiceChatRouter };
