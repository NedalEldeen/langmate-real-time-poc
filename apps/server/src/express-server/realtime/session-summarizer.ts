/**
 * Session summarizer — long-term memory via rolling summary.
 *
 * ── Problem ──────────────────────────────────────────────────────────────
 *
 * Injecting N verbatim turns from history covers only the most recent
 * exchanges.  A user who has had many sessions loses older context when
 * those turns scroll out of the injection window.
 *
 * ── Solution ─────────────────────────────────────────────────────────────
 *
 * After each session ends, generate a 2–3 sentence summary of that session
 * using gpt-4o-mini and store it in Redis.  On the next session start, this
 * summary is embedded in the system prompt alongside the last N verbatim turns:
 *
 *   session.update.instructions = BASE_INSTRUCTIONS
 *                                + "\n\nPrevious session context: {summary}"
 *
 * The summary is updated after EVERY session (rolling: each summary also
 * incorporates the previous summary so older context is never fully lost).
 *
 * Redis key:
 *   langmate:history:{userId}:summary  →  plain text, TTL 30 days
 */

import OpenAI from "openai";
import { getRedisClient } from "./redis-client";

/** How long to retain a user's summary (30 days). */
const SUMMARY_TTL_SECONDS = 60 * 60 * 24 * 30;

const summaryKey = (userId: string) => `langmate:history:${userId}:summary`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the cached summary for a user, or null if none exists yet.
 */
export async function getCachedSummary(userId: string): Promise<string | null> {
  try {
    return await getRedisClient().get(summaryKey(userId));
  } catch (err) {
    console.error("[summarizer] getCachedSummary failed:", err);
    return null;
  }
}

/**
 * Generates an updated rolling summary for a user based on a completed session
 * and stores it in Redis.
 *
 * Called asynchronously on session disconnect — never blocks the user.
 *
 * @param userId   - The user whose summary should be updated.
 * @param turns    - The completed turns from the session that just ended.
 *                   Minimum 2 turns (one exchange) to be worth summarising.
 */
export async function generateAndCacheSummary(
  userId:  string,
  turns:   Array<{ role: "user" | "assistant"; text: string }>,
): Promise<void> {
  if (turns.length < 2) return; // nothing meaningful to summarise

  const redis      = getRedisClient();
  const prevSummary = await redis.get(summaryKey(userId)).catch(() => null);

  const conversation = turns
    .map((t) => `${t.role === "user" ? "User" : "AI"}: ${t.text}`)
    .join("\n");

  // If a previous summary exists, ask the model to incorporate it (rolling summary).
  // Otherwise, just summarise the current session.
  const prompt = prevSummary
    ? `You are maintaining a concise memory for a language learning assistant.

Previous context about the user:
${prevSummary}

New conversation session:
${conversation}

Write an updated 2–3 sentence summary that incorporates both the old context and new session. Note the language(s) being practiced, topics covered, recurring mistakes, and the user's approximate level. Be specific but concise.`
    : `You are creating a memory entry for a language learning assistant.

Conversation:
${conversation}

Write a 2–3 sentence summary. Note the language being practiced, topics covered, and the user's apparent level. Be specific but concise.`;

  const client = new OpenAI();
  const result  = await client.chat.completions.create({
    model:      "gpt-4o-mini",
    messages:   [{ role: "user", content: prompt }],
    max_tokens: 200,
  });

  const summary = result.choices[0]?.message?.content?.trim();
  if (!summary) return;

  await redis.set(summaryKey(userId), summary, "EX", SUMMARY_TTL_SECONDS);

  console.log(
    `[summarizer] summary updated for ${userId.slice(0, 8)}… — "${summary.slice(0, 70)}…"`,
  );
}
