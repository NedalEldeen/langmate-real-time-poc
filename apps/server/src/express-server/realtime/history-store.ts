/**
 * HistoryStore — persists per-user conversation history in Redis.
 *
 * Turns are stored as a Redis List under `langmate:history:{userId}:turns`.
 * Each element is a JSON-serialised ConversationTurn object.
 *
 * The list is capped at MAX_HISTORY_TURNS via LTRIM so it never grows
 * unboundedly.  Oldest turns are dropped first.
 *
 * This data is used in §2 of the architecture roadmap: on the next session
 * start, the last N turns are loaded and injected into the OpenAI Realtime
 * conversation via `conversation.item.create` so the AI has context.
 */

import { getRedisClient } from "./redis-client";

/** Maximum number of turns retained per user. Older turns are dropped. */
const MAX_HISTORY_TURNS = 100;

export interface ConversationTurn {
  role:      "user" | "assistant";
  text:      string;
  ts:        string;   // ISO-8601 UTC
  sessionId: string;
}

export class HistoryStore {
  private readonly key: string;

  /**
   * @param userId    - Stable user identifier (same across sessions).
   * @param sessionId - Current session ID, stamped on each turn for provenance.
   */
  constructor(
    private readonly userId:    string,
    private readonly sessionId: string,
  ) {
    this.key = `langmate:history:${userId}:turns`;
  }

  /**
   * Appends one completed turn to the user's history and trims the list.
   *
   * @param role - "user" | "assistant"
   * @param text - Full transcript text for this turn (already trimmed).
   */
  async appendTurn(role: "user" | "assistant", text: string): Promise<void> {
    const redis = getRedisClient();

    const turn: ConversationTurn = {
      role,
      text,
      ts:        new Date().toISOString(),
      sessionId: this.sessionId,
    };

    // RPUSH appends to the right; LTRIM keeps only the last N elements
    await redis.rpush(this.key, JSON.stringify(turn));
    await redis.ltrim(this.key, -MAX_HISTORY_TURNS, -1);

    console.log(`[history] ${role} turn saved (${text.length} chars)  key=${this.key}`);
  }

  /**
   * Returns the most recent `n` turns for this user, oldest-first.
   *
   * @param n - How many turns to retrieve (e.g. 10 for last 10 exchanges).
   */
  async getRecentTurns(n: number): Promise<ConversationTurn[]> {
    const raw = await getRedisClient().lrange(this.key, -n, -1);
    return raw.map((s) => JSON.parse(s) as ConversationTurn);
  }
}
