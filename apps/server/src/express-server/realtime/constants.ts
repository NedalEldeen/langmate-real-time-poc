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
 *     recordings/        ← user WAVs (_userN.wav) + AI WAVs (_aiN.wav)
 *     recordings/.tmp/   ← in-flight PCM chunks (.pcm.tmp) — crash-safe buffer
 *     transcripts/       ← per-session .txt conversation logs
 */
export const DATA_DIR = path.join(__dirname, "../../../data");

/**
 * Staging area for in-flight PCM audio.
 *
 * Each active turn writes chunks here as `<sessionTs>_<shortId>_<type><N>.pcm.tmp`.
 * On turn end the file is converted to WAV and moved to recordings/.
 * On server restart any surviving .pcm.tmp files are recovered automatically.
 */
export const TMP_DIR = path.join(DATA_DIR, "recordings", ".tmp");

/**
 * How many recent turns to inject verbatim into each new session.
 *
 * Older turns are represented by a rolling summary (see session-summarizer.ts).
 * 6 turns = 3 full exchanges (user + AI), which covers the immediate prior context
 * without excessive token cost.
 */
export const HISTORY_INJECTION_TURNS = 6;
