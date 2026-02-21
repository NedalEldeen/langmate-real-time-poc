/**
 * AudioRecorder — accumulates and persists PCM audio for a single session.
 *
 * Tracks two separate audio streams per session:
 *   • User audio  — PCM16 chunks received from the browser via Socket.IO,
 *                   flushed and saved when the user clicks "Done Talking".
 *   • AI audio    — PCM16 chunks received from OpenAI via `response.audio.delta`,
 *                   flushed and saved when `response.done` fires.
 *
 * Both are saved as standard WAV files under data/recordings/.
 * File naming: <sessionTs>_<shortId>_user<N>.wav  /  _ai<N>.wav
 */

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./constants";
import { pcmToWav } from "./pcm-utils";

/** Ensures a directory exists, creating it (and parents) if necessary. */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export class AudioRecorder {
  /** Accumulated raw PCM chunks for the current user speech turn. */
  private userChunks: Buffer[] = [];

  /** Accumulated raw PCM chunks for the current AI response turn. */
  private aiChunks: Buffer[] = [];

  /** Counter incremented each time user audio is saved (turn 1, 2, …). */
  private userTurnIndex = 0;

  /** Counter incremented each time AI audio is saved (response 1, 2, …). */
  private aiTurnIndex = 0;

  /**
   * @param sessionTs - Filesystem-safe timestamp string (from sessionTimestamp()).
   * @param shortId   - First 8 chars of the Socket.IO socket ID.
   */
  constructor(
    private readonly sessionTs: string,
    private readonly shortId: string,
  ) {}

  // ── User audio ────────────────────────────────────────────────────────────

  /**
   * Buffers one chunk of user PCM audio sent from the browser.
   *
   * The browser sends base64-encoded PCM16 LE 24 kHz mono chunks via
   * `input_audio_buffer.append` events.  We decode and buffer them here so
   * we can reconstruct the full audio when the turn ends.
   *
   * @param base64 - Base64-encoded PCM16 audio chunk.
   */
  appendUserChunk(base64: string): void {
    const chunk = Buffer.from(base64, "base64");
    this.userChunks.push(chunk);

    // Log only on the first chunk so we know audio is flowing without noise
    if (this.userChunks.length === 1) {
      console.log(`[audio] first user chunk received (${chunk.length} bytes)`);
    }
  }

  /**
   * Buffers one chunk of AI audio received from OpenAI.
   *
   * OpenAI streams audio via `response.audio.delta` events, each containing
   * a base64-encoded PCM16 chunk.  These are accumulated here and flushed
   * to disk when the response is complete.
   *
   * @param base64 - Base64-encoded PCM16 audio chunk.
   */
  appendAiChunk(base64: string): void {
    this.aiChunks.push(Buffer.from(base64, "base64"));
  }

  /**
   * Flushes all accumulated user audio chunks to a WAV file.
   *
   * Called when the user clicks "Done Talking" (done_talking event).
   * The chunks are cleared so the next turn starts fresh.
   *
   * @returns The saved filename (without directory), or null if no audio.
   */
  saveUserAudio(): string | null {
    return this.flush(this.userChunks, "user", () => ++this.userTurnIndex);
  }

  /**
   * Flushes all accumulated AI audio chunks to a WAV file.
   *
   * Called when `response.done` fires from OpenAI.
   * The chunks are cleared so the next response starts fresh.
   *
   * @returns The saved filename (without directory), or null if no audio.
   */
  saveAiAudio(): string | null {
    return this.flush(this.aiChunks, "ai", () => ++this.aiTurnIndex);
  }

  /** How many user PCM chunks are currently buffered (useful for diagnostics). */
  get userChunkCount(): number {
    return this.userChunks.length;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Generic flush helper.  Drains `chunks` in-place, converts to WAV, and
   * writes to disk.  Returns the filename on success, null otherwise.
   */
  private flush(
    chunks: Buffer[],
    label: "user" | "ai",
    nextIndex: () => number,
  ): string | null {
    // Drain the array atomically so concurrent flushes don't double-save
    const drained = chunks.splice(0);

    if (drained.length === 0) {
      console.log(`[audio] save${label === "user" ? "User" : "Ai"}Audio: no chunks — skipping`);
      return null;
    }

    try {
      const dir = path.join(DATA_DIR, "recordings");
      ensureDir(dir);

      const idx      = nextIndex();
      const filename = `${this.sessionTs}_${this.shortId}_${label}${idx}.wav`;
      fs.writeFileSync(path.join(dir, filename), pcmToWav(drained));
      console.log(`[audio] saved ${label} WAV → ${filename} (${drained.length} chunks)`);
      return filename;
    } catch (err) {
      console.error(`[audio] save ${label} WAV failed:`, err);
      return null;
    }
  }
}
