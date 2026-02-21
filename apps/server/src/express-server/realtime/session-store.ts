/**
 * SessionStore — persists session metadata in Redis.
 *
 * Each active session is stored as a Redis Hash under the key
 * `langmate:session:{sessionId}` with a 24-hour TTL.
 *
 * Fields stored:
 *   sessionId      - e.g. "2026-02-21T14-30-00_a1b2c3d4"
 *   userId         - caller-supplied user identifier
 *   language       - conversation language chosen at session start
 *   startedAt      - ISO-8601 UTC timestamp
 *   status         - "active" | "ended"
 *   turnsCompleted - integer count of completed exchange turns
 *
 * This data survives server restarts (Redis is persistent) and enables:
 *   • Cross-session history lookup (see history-store.ts)
 *   • Session provenance / analytics
 *   • Detection of incomplete sessions after a crash
 */

import { getRedisClient } from "./redis-client";

/** How long a session record lives in Redis after creation (24 hours). */
const SESSION_TTL_SECONDS = 60 * 60 * 24;

export class SessionStore {
  private readonly key: string;

  /**
   * @param sessionId - Unique session identifier (`${sessionTs}_${shortId}`).
   */
  constructor(private readonly sessionId: string) {
    this.key = `langmate:session:${sessionId}`;
  }

  /**
   * Writes the initial session record and sets the TTL.
   * Called once when `session.created` fires from OpenAI.
   */
  async create(userId: string, language: string): Promise<void> {
    const redis = getRedisClient();
    await redis.hset(this.key, {
      sessionId:      this.sessionId,
      userId,
      language,
      startedAt:      new Date().toISOString(),
      status:         "active",
      turnsCompleted: "0",
    });
    await redis.expire(this.key, SESSION_TTL_SECONDS);
    console.log(`[session-store] created  key=${this.key}`);
  }

  /**
   * Atomically increments the completed-turns counter.
   * Called after each full user→AI exchange (response.done).
   */
  async incrementTurns(): Promise<void> {
    await getRedisClient().hincrby(this.key, "turnsCompleted", 1);
  }

  /**
   * Marks the session as ended.
   * Called when the Socket.IO client disconnects.
   */
  async end(): Promise<void> {
    await getRedisClient().hset(this.key, "status", "ended");
    console.log(`[session-store] ended    key=${this.key}`);
  }
}
