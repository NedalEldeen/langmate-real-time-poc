/**
 * Shared constants for the realtime voice relay.
 *
 * Centralising these avoids magic strings scattered across modules and makes
 * it easy to swap the OpenAI model or change the data directory in one place.
 */

import path from "path";

/**
 * OpenAI Realtime API WebSocket endpoint.
 * The `model` query parameter selects the underlying LLM + voice model.
 */
export const OPENAI_REALTIME_URL =
  "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";

/**
 * Root directory for all persisted session data (recordings + transcripts).
 *
 * Resolved relative to this file's location at module load time so it is
 * correct regardless of the process working directory.
 *
 * File layout:
 *   data/
 *     recordings/   ← user WAVs (_userN.wav) + AI WAVs (_aiN.wav)
 *     transcripts/  ← per-session .txt conversation logs
 */
export const DATA_DIR = path.join(__dirname, "../../../data");
