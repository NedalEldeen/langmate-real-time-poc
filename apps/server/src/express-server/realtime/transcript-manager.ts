/**
 * TranscriptManager — per-session conversation transcript file.
 *
 * Creates a plain-text file when the session starts and appends each turn
 * (user or assistant) as it completes.  Using append-as-you-go means the
 * file always contains what was said so far, even if the server crashes.
 *
 * File format:
 *   Session : 2026:02:21 14:30:00
 *   Language: English
 *   ────────────────────────────────────────────────
 *
 *   You: Hello, how are you?
 *
 *   Assistant: I'm doing great, thanks for asking!
 *
 *   ...
 * 
 * Set ENABLE_TRANSCRIPT_FILES to false to disable file generation.
 */

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./constants";

/** Set to false to disable transcript file generation */
const ENABLE_TRANSCRIPT_FILES = false;

export class TranscriptManager {
  /** Absolute path to the session's .txt file once initialised. */
  private filePath: string | null = null;

  /**
   * Creates the transcript file with a human-readable header.
   *
   * Called once per session when OpenAI sends `session.created`, so every
   * session gets a file even if the user never speaks.
   *
   * @param sessionTs - Timestamp string used in the file name (from sessionTimestamp()).
   * @param shortId   - First 8 chars of the Socket.IO socket ID.
   * @param language  - Conversation language chosen by the user.
   */
  init(sessionTs: string, shortId: string, language: string): void {
    if (!ENABLE_TRANSCRIPT_FILES) return;
    
    try {
      const dir = path.join(DATA_DIR, "transcripts");
      fs.mkdirSync(dir, { recursive: true });

      this.filePath = path.join(dir, `${sessionTs}_${shortId}.txt`);

      const header =
        `Session : ${sessionTs.replace("T", " ").replace(/-/g, ":")}\n` +
        `Language: ${language}\n` +
        `${"─".repeat(48)}\n\n`;

      fs.writeFileSync(this.filePath, header, "utf8");
      console.log(`[transcript] file created → ${this.filePath}`);
    } catch (err) {
      console.error("[transcript] init failed:", err);
    }
  }

  /**
   * Appends a completed user speech turn.
   * Called when `conversation.item.input_audio_transcription.completed` fires.
   *
   * @param text - The transcribed user speech (already trimmed).
   */
  appendUser(text: string): void {
    this.append(`You: ${text}`);
  }

  /**
   * Appends a completed AI response turn.
   * Called when `response.audio_transcript.done` fires (full text at once).
   *
   * @param text - The AI response transcript (already trimmed).
   */
  appendAssistant(text: string): void {
    this.append(`Assistant: ${text}`);
  }

  /**
   * Writes a single line to the transcript file followed by a blank line.
   * Silent no-op if the file has not been initialised yet.
   */
  private append(line: string): void {
    if (!this.filePath) return;
    try {
      fs.appendFileSync(this.filePath, line + "\n\n", "utf8");
      console.log(`[transcript] ← ${line.slice(0, 72)}`);
    } catch (err) {
      console.error("[transcript] append failed:", err);
    }
  }
}
