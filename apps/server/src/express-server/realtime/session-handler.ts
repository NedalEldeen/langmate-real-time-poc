/**
 * Session handler — orchestrates a single realtime voice conversation.
 *
 * ┌─────────────┐   Socket.IO (JSON events)   ┌────────────────┐
 * │   Browser   │ ◄──────────────────────────► │  This server   │
 * └─────────────┘                              └───────┬────────┘
 *                                                      │  WebSocket (JSON events)
 *                                               ┌──────▼────────┐
 *                                               │  OpenAI       │
 *                                               │  Realtime API │
 *                                               └───────────────┘
 *
 * Responsibilities:
 *   1. Open a dedicated WebSocket to the OpenAI Realtime API for each client.
 *   2. Configure the OpenAI session (language, voice, transcription, etc.).
 *   3. Forward all OpenAI events to the browser via Socket.IO.
 *   4. Intercept specific client messages to save audio/transcripts locally.
 *   5. Handle the custom `done_talking` event: save user audio, commit the
 *      audio buffer to OpenAI, and request a response.
 *   6. After `response.done`, save the AI audio WAV and notify the client.
 *
 * OpenAI session settings:
 *   • modalities: ["text", "audio"]  →  simultaneous streaming text + audio
 *   • turn_detection: null           →  manual mode, no voice activity detection
 *   • input_audio_transcription      →  server-side user speech transcription
 */

import WebSocket from "ws";
import { Socket } from "socket.io";
import { OPENAI_REALTIME_URL } from "./constants";
import { sessionTimestamp } from "./pcm-utils";
import { TranscriptManager } from "./transcript-manager";
import { AudioRecorder } from "./audio-recorder";

/**
 * Creates and manages all resources for one client session.
 * Called once per Socket.IO `connection` event.
 *
 * @param socket - The connected Socket.IO socket representing the browser client.
 */
export function handleRealtimeSession(socket: Socket): void {
  // ── Session metadata ────────────────────────────────────────────────────
  const language  = (socket.handshake.query["language"] as string) || "English";
  const sessionTs = sessionTimestamp();
  const shortId   = socket.id.slice(0, 8);

  console.log(`\n[session] ── NEW SESSION ──────────────────────────`);
  console.log(`[session]   socket  : ${socket.id}`);
  console.log(`[session]   language: ${language}`);
  console.log(`[session]   ts      : ${sessionTs}`);

  // ── Per-session services ────────────────────────────────────────────────
  const transcript = new TranscriptManager();
  const recorder   = new AudioRecorder(sessionTs, shortId);

  // ── Connect to OpenAI Realtime API ──────────────────────────────────────
  const openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      // Required beta header for the Realtime API
      "OpenAI-Beta": "realtime=v1",
    },
  });

  // ════════════════════════════════════════════════════════════════════════
  // OpenAI → Client  (receive events from OpenAI, forward to browser)
  // ════════════════════════════════════════════════════════════════════════

  openaiWs.on("open", () => {
    console.log("[session] OpenAI WebSocket opened");
  });

  openaiWs.on("message", (raw: WebSocket.RawData) => {
    // Parse the JSON event frame from OpenAI
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      console.warn("[session] received non-JSON frame from OpenAI — ignoring");
      return;
    }

    const t = event.type as string;

    // Log all events; suppress high-frequency audio delta frames to keep
    // the console readable (those are logged as a summary in audio.done).
    if (t !== "response.audio.delta" && t !== "response.audio_transcript.delta") {
      console.log(`[openai →] ${t}`);
    }

    // ── Session created ──────────────────────────────────────────────────
    if (t === "session.created") {
      // Create the transcript file immediately — captures even empty sessions
      transcript.init(sessionTs, shortId, language);

      // Configure the OpenAI session with our desired parameters
      console.log("[session] sending session.update");
      openaiWs.send(
        JSON.stringify({
          type: "session.update",
          session: {
            // Generate both a text transcript and audio simultaneously
            modalities: ["text", "audio"],

            // System prompt: sets language and conversational style
            instructions: `You are a helpful conversation partner. Conduct the entire conversation in ${language}. Keep answers short and natural — like a real conversation.`,

            // TTS voice used for AI responses
            voice: "alloy",

            // Raw PCM16 LE 24 kHz mono in both directions
            input_audio_format:  "pcm16",
            output_audio_format: "pcm16",

            // Enable server-side transcription of the user's speech.
            // Fires `conversation.item.input_audio_transcription.completed`.
            input_audio_transcription: { model: "gpt-4o-mini-transcribe" },

            // null = manual turn detection.
            // The client drives the turn lifecycle via done_talking events.
            // OpenAI will NOT auto-commit or auto-respond.
            turn_detection: null,
          },
        }),
      );
    }

    // ── User transcription complete ──────────────────────────────────────
    if (
      t === "conversation.item.input_audio_transcription.completed" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      // The user's speech has been transcribed — save it to the transcript file
      transcript.appendUser(event.transcript.trim());
    }

    // ── AI audio delta ───────────────────────────────────────────────────
    if (t === "response.audio.delta" && typeof event.delta === "string") {
      // Buffer each base64-encoded PCM16 chunk for later WAV saving
      recorder.appendAiChunk(event.delta);
    }

    // ── AI audio done ────────────────────────────────────────────────────
    if (t === "response.audio.done") {
      // All audio chunks for this response have arrived — log the summary
      console.log(`[openai →] response.audio.done`);
    }

    // ── AI transcript done ───────────────────────────────────────────────
    if (
      t === "response.audio_transcript.done" &&
      typeof event.transcript === "string" &&
      event.transcript.trim()
    ) {
      // `response.audio_transcript.done` fires once with the complete AI text,
      // making it more reliable than accumulating individual delta events.
      transcript.appendAssistant(event.transcript.trim());
    }

    // ── Forward event to client FIRST ────────────────────────────────────
    // The client must receive response.done before ai_audio_ready so it can
    // attach the audio player to the correct DOM element (lastAiEl).
    socket.emit("message", event);

    // ── Post-response: save AI audio and notify client ───────────────────
    if (t === "response.done") {
      const filename = recorder.saveAiAudio();
      if (filename) {
        // Send the playback URL so the client can render an <audio> element
        socket.emit("message", {
          type: "ai_audio_ready",
          url: `/recordings/${filename}`,
        });
        console.log(`[session] ai_audio_ready → ${filename}`);
      }
    }
  });

  openaiWs.on("error", (err: Error) => {
    console.error(`[session] OpenAI WebSocket error:`, err.message);
    // Surface the error to the client so it can show a user-facing message
    socket.emit("message", {
      type: "error",
      error: { message: "OpenAI connection error", detail: err.message },
    });
  });

  openaiWs.on("close", () => {
    console.log(`[session] OpenAI WebSocket closed — disconnecting client`);
    // Mirror the OpenAI disconnect to the browser so it resets its UI
    socket.disconnect(true);
  });

  // ════════════════════════════════════════════════════════════════════════
  // Client → OpenAI  (receive events from browser, forward to OpenAI)
  // ════════════════════════════════════════════════════════════════════════

  socket.on("message", (data: unknown) => {
    const msg = data as Record<string, unknown>;

    // ── Audio buffer append ──────────────────────────────────────────────
    if (msg.type === "input_audio_buffer.append" && typeof msg.audio === "string") {
      // Intercept to buffer the raw PCM for WAV saving.
      // The event is still forwarded to OpenAI below so its buffer stays in sync.
      recorder.appendUserChunk(msg.audio);
    }

    // ── Done talking (custom client event) ──────────────────────────────
    if (msg.type === "done_talking") {
      console.log(
        `[session] done_talking received  userChunks=${recorder.userChunkCount}  openaiState=${openaiWs.readyState}`,
      );

      // Save user audio before any conditional returns so audio is never lost,
      // even if the OpenAI connection has dropped.
      recorder.saveUserAudio();

      if (openaiWs.readyState !== WebSocket.OPEN) {
        console.error("[session] done_talking: OpenAI WS not open — audio saved but no response possible");
        return;
      }

      // Commit the audio buffer: tells OpenAI the user's turn is complete
      openaiWs.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

      // Request a response from the model (text + audio)
      openaiWs.send(JSON.stringify({ type: "response.create" }));

      console.log("[session] response.create sent to OpenAI");
      return; // do not forward done_talking to OpenAI — it's a client-only event
    }

    // ── Forward all other events to OpenAI ──────────────────────────────
    if (openaiWs.readyState !== WebSocket.OPEN) return;
    openaiWs.send(JSON.stringify(data));
  });

  // ── Session teardown ────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[session] client disconnected: ${socket.id}`);
    // Clean up the OpenAI WebSocket so we don't leak connections
    if (openaiWs.readyState !== WebSocket.CLOSED) openaiWs.close();
  });
}
