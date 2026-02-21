/**
 * UserProfileStore — persists learner profile data in Redis.
 *
 * Stored as a Redis Hash under `langmate:user:{userId}:profile`.
 * Fields are optional; only non-empty values are written.
 *
 * The profile is used in two places:
 *   1. §3a — Dynamic prompt injection: name + level embedded in session.update
 *      instructions so the AI always has basic context without a tool call.
 *   2. §3b — Tool calling: the `get_user_profile` function returns the full
 *      profile as JSON so the AI can access detailed preferences on demand.
 */

import { getRedisClient } from "./redis-client";

export interface UserProfile {
  /** Learner's display name, e.g. "Nader". */
  name?: string;

  /** Mother tongue, e.g. "Arabic". Helps the AI understand likely error patterns. */
  nativeLanguage?: string;

  /** Current level in the target language: A1, A2, B1, B2, C1, C2, or descriptive. */
  level?: string;

  /** Topics the learner enjoys, e.g. "travel, technology, cooking". */
  interests?: string;

  /** Specific learning goal, e.g. "prepare for a job interview in English". */
  goals?: string;
}

const profileKey = (userId: string) => `langmate:user:${userId}:profile`;

export class UserProfileStore {
  private readonly key: string;

  constructor(userId: string) {
    this.key = profileKey(userId);
  }

  /**
   * Returns the stored profile fields.  Returns an empty object `{}` if the
   * user has not set up a profile yet (not an error).
   */
  async get(): Promise<UserProfile> {
    try {
      const data = await getRedisClient().hgetall(this.key);
      return data as UserProfile;
    } catch (err) {
      console.error("[profile] get failed:", err);
      return {};
    }
  }

  /**
   * Writes the given fields, skipping undefined/empty values.
   * Existing fields not included in the update are left unchanged.
   */
  async set(profile: Partial<UserProfile>): Promise<void> {
    const filtered = Object.fromEntries(
      Object.entries(profile).filter(([, v]) => v !== undefined && v !== ""),
    );
    if (Object.keys(filtered).length === 0) return;

    try {
      await getRedisClient().hset(this.key, filtered);
    } catch (err) {
      console.error("[profile] set failed:", err);
    }
  }
}
