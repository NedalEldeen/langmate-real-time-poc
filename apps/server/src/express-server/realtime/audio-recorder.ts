/**
 * AudioRecorder — crash-safe PCM audio capture for a single session.
 *
 * ── Why temp files? ───────────────────────────────────────────────────────
 *
 * Previous design: PCM chunks were accumulated in memory (Buffer[]) and
 * written to WAV only when a turn completed.  A server crash mid-turn meant
 * all in-flight audio was lost.
 *
 * New design: each chunk is immediately appended to a `.pcm.tmp` file on disk
 * using `fs.appendFileSync`.  On turn end the temp file is read, wrapped in a
 * WAV header, and moved to the final recordings directory.  On server restart,
 * any surviving `.pcm.tmp` files represent incomplete turns that can be
 * recovered automatically (see recoverTempFiles()).
 *
 * Tracks two separate audio streams per session:
 *   • User audio  — PCM16 chunks from the browser (input_audio_buffer.append)
 *   • AI audio    — PCM16 chunks from OpenAI (response.audio.delta)
 *
 * File locations:
 *   data/recordings/.tmp/<sessionTs>_<shortId>_user<N>.pcm.tmp  (in-flight)
 *   data/recordings/.tmp/<sessionTs>_<shortId>_ai<N>.pcm.tmp    (in-flight)
 *   data/recordings/<sessionTs>_<shortId>_user<N>.wav           (completed)
 *   data/recordings/<sessionTs>_<shortId>_ai<N>.wav             (completed)
 * 
 * Set ENABLE_RECORDING_FILES to false to disable file generation.
 */

import fs   from "fs";
import path from "path";
import { DATA_DIR, TMP_DIR } from "./constants";
import { pcmToWav } from "./pcm-utils";

/** Set to false to disable recording file generation */
const ENABLE_RECORDING_FILES = false;

/** Ensures a directory exists, creating it (and parents) if necessary. */
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export class AudioRecorder {
  /** Absolute path of the active user-turn temp file, or null between turns. */
  private userTmpPath: string | null = null;

  /** Absolute path of the active AI-turn temp file, or null between turns. */
  private aiTmpPath: string | null = null;

  /** How many user chunks have been written to the current temp file. */
  private userChunkCount_ = 0;

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
    private readonly shortId:   string,
  ) {}

  // ── User audio ────────────────────────────────────────────────────────────

  /**
   * Appends one user PCM chunk to the current temp file.
   *
   * Opens the temp file on the very first chunk of each turn.
   * Using appendFileSync keeps the implementation simple and guarantees that
   * each chunk is on disk before the next one arrives.
   *
   * @param base64 - Base64-encoded PCM16 audio chunk from the browser.
   */
  appendUserChunk(base64: string): void {
    if (!ENABLE_RECORDING_FILES) return;
    
    const chunk = Buffer.from(base64, "base64");

    if (!this.userTmpPath) {
      ensureDir(TMP_DIR);
      this.userTmpPath = path.join(
        TMP_DIR,
        `${this.sessionTs}_${this.shortId}_user${this.userTurnIndex + 1}.pcm.tmp`,
      );
      this.userChunkCount_ = 0;
            console.log(`[audio] user tmp opened → ${path.basename(this.userTmpPath)}`);
    }

    fs.appendFileSync(this.userTmpPath, chunk);
    this.userChunkCount_++;

    if (this.userChunkCount_ === 1) {
      console.log(`[audio] first user chunk written (${chunk.length} bytes)`);
    }
  }

  /**
   * Appends one AI PCM chunk to the current temp file.
   *
   * @param base64 - Base64-encoded PCM16 audio chunk from OpenAI.
   */
  appendAiChunk(base64: string): void {
    if (!ENABLE_RECORDING_FILES) return;
    
    const chunk = Buffer.from(base64, "base64");

    if (!this.aiTmpPath) {
      ensureDir(TMP_DIR);
      this.aiTmpPath = path.join(
        TMP_DIR,
        `${this.sessionTs}_${this.shortId}_ai${this.aiTurnIndex + 1}.pcm.tmp`,
      );
      console.log(`[audio] ai tmp opened → ${path.basename(this.aiTmpPath)}`);
    }

    fs.appendFileSync(this.aiTmpPath, chunk);
  }

  /**
   * Finalises the current user turn: reads the temp file, wraps it in a WAV
   * header, writes the final WAV, and deletes the temp file.
   *
   * Called when the user clicks "Done Talking" (done_talking event).
   *
   * @returns The saved filename (basename only), or null if no audio was recorded.
   */
  saveUserAudio(): string | null {
    if (!ENABLE_RECORDING_FILES) return null;
    
    const tmp = this.userTmpPath;
    this.userTmpPath    = null;
    this.userChunkCount_ = 0;
    return this.finaliseTmp(tmp, "user", ++this.userTurnIndex);
  }

  /**
   * Finalises the current AI turn: reads the temp file, wraps it in a WAV
   * header, writes the final WAV, and deletes the temp file.
   *
   * Called when `response.done` fires from OpenAI.
   *
   * @returns The saved filename (basename only), or null if no audio was recorded.
   */
  saveAiAudio(): string | null {
    if (!ENABLE_RECORDING_FILES) return null;
    
    const tmp = this.aiTmpPath;
    this.aiTmpPath = null;
    return this.finaliseTmp(tmp, "ai", ++this.aiTurnIndex);
  }

  /** How many user PCM chunks are in the current temp file (useful for diagnostics). */
  get userChunkCount(): number {
    return this.userChunkCount_;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Reads `tmpPath`, prepends a WAV header, writes the final file, and removes
   * the temp file.  Returns the final filename or null on any error / empty file.
   */
  private finaliseTmp(
    tmpPath:  string | null,
    label:    "user" | "ai",
    turnIndex: number,
  ): string | null {
    if (!tmpPath) {
      console.log(`[audio] save${label === "user" ? "User" : "Ai"}Audio: no tmp file — skipping`);
      return null;
    }

    try {
      const pcmData = fs.readFileSync(tmpPath);

      if (pcmData.length === 0) {
        fs.unlinkSync(tmpPath);
        console.log(`[audio] ${label} tmp file was empty — deleted`);
        return null;
      }

      const dir      = path.join(DATA_DIR, "recordings");
      ensureDir(dir);

      const filename = `${this.sessionTs}_${this.shortId}_${label}${turnIndex}.wav`;
      fs.writeFileSync(path.join(dir, filename), pcmToWav([pcmData]));
      fs.unlinkSync(tmpPath);

      console.log(
        `[audio] saved ${label} WAV → ${filename} (${pcmData.length} PCM bytes)`,
      );
      return filename;
    } catch (err) {
      console.error(`[audio] finalise ${label} WAV failed:`, err);
      return null;
    }
  }
}

// ── Startup recovery ────────────────────────────────────────────────────────

/**
 * Scans TMP_DIR for leftover `.pcm.tmp` files from a previous server run
 * (i.e. turns that were in-flight when the server crashed or was restarted)
 * and converts each one to a valid WAV file in the recordings directory.
 *
 * Call this once at server startup, before `server.listen()`.
 */
export function recoverTempFiles(): void {
  if (!ENABLE_RECORDING_FILES) return;
  
  ensureDir(TMP_DIR);

  const files = fs.readdirSync(TMP_DIR).filter((f) => f.endsWith(".pcm.tmp"));

  if (files.length === 0) {
    console.log("[recovery] no incomplete turns found in tmp dir");
    return;
  }

  console.log(`[recovery] found ${files.length} incomplete turn(s) — recovering…`);

  const recDir = path.join(DATA_DIR, "recordings");
  ensureDir(recDir);

  for (const file of files) {
    const tmpPath = path.join(TMP_DIR, file);
    try {
      const pcmData = fs.readFileSync(tmpPath);

      if (pcmData.length === 0) {
        fs.unlinkSync(tmpPath);
        console.log(`[recovery] ${file} — empty, deleted`);
        continue;
      }

      // Replace .pcm.tmp → .wav for the recovered file name
      const wavName = file.replace(/\.pcm\.tmp$/, ".recovered.wav");
      fs.writeFileSync(path.join(recDir, wavName), pcmToWav([pcmData]));
      fs.unlinkSync(tmpPath);

      console.log(`[recovery] ${file} → ${wavName} (${pcmData.length} bytes recovered)`);
    } catch (err) {
      console.error(`[recovery] failed to recover ${file}:`, err);
    }
  }
}
