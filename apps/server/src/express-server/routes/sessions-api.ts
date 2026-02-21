/**
 * Sessions REST API
 *
 * Provides read/write access to session metadata, conversation history, and
 * user profile data stored in Redis.  Used by the UI.
 *
 * Endpoints:
 *   GET  /api/sessions?userId=<id>       — list sessions for a user
 *   GET  /api/history?userId=<id>&limit  — recent conversation turns
 *   GET  /api/profile?userId=<id>        — get learner profile
 *   PUT  /api/profile?userId=<id>        — create / update learner profile
 */

import { Router, Request, Response } from "express";
import { getRedisClient } from "../realtime/redis-client";
import type { ConversationTurn } from "../realtime/history-store";
import { UserProfileStore, type UserProfile } from "../realtime/user-profile-store";

export const sessionsApiRouter = Router();

/**
 * Scans all Redis keys matching a pattern using SCAN (cursor-based, non-blocking).
 * Safer than KEYS for large keyspaces.
 */
async function scanKeys(pattern: string): Promise<string[]> {
  const redis  = getRedisClient();
  const result: string[] = [];
  let cursor   = "0";

  do {
    const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "200");
    cursor = next;
    result.push(...batch);
  } while (cursor !== "0");

  return result;
}

// ── GET /api/sessions ─────────────────────────────────────────────────────────

sessionsApiRouter.get("/sessions", async (req: Request, res: Response) => {
  const userId = req.query["userId"] as string | undefined;
  const redis  = getRedisClient();

  try {
    const keys = await scanKeys("langmate:session:*");

    if (keys.length === 0) {
      res.json([]);
      return;
    }

    // Fetch all session hashes in one pipeline round-trip
    const pipeline = redis.pipeline();
    for (const key of keys) pipeline.hgetall(key);

    const results = await pipeline.exec();

    // pipeline.exec() returns [Error | null, result][] — filter out errors and nulls
    let sessions = (results ?? [])
      .filter(([err]) => !err)
      .map(([, data]) => data as Record<string, string>)
      .filter(Boolean);

    // Filter by userId if provided
    if (userId) {
      sessions = sessions.filter((s) => s["userId"] === userId);
    }

    // Sort newest-first
    sessions.sort((a, b) =>
      (b["startedAt"] ?? "").localeCompare(a["startedAt"] ?? ""),
    );

    res.json(sessions);
  } catch (err) {
    console.error("[api] sessions list failed:", err);
    res.status(500).json({ error: "Failed to list sessions" });
  }
});

// ── GET /api/history ──────────────────────────────────────────────────────────

sessionsApiRouter.get("/history", async (req: Request, res: Response) => {
  const userId = req.query["userId"] as string | undefined;
  const limit  = Math.min(Number(req.query["limit"] ?? 10), 50);

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const redis = getRedisClient();
  const key   = `langmate:history:${userId}:turns`;

  try {
    const raw   = await redis.lrange(key, -limit, -1);
    const turns = raw.map((s) => JSON.parse(s) as ConversationTurn);
    res.json(turns);
  } catch (err) {
    console.error("[api] history fetch failed:", err);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// ── GET /api/profile ──────────────────────────────────────────────────────────

sessionsApiRouter.get("/profile", async (req: Request, res: Response) => {
  const userId = req.query["userId"] as string | undefined;

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const profile = await new UserProfileStore(userId).get();
    res.json(profile);
  } catch (err) {
    console.error("[api] profile get failed:", err);
    res.status(500).json({ error: "Failed to get profile" });
  }
});

// ── PUT /api/profile ──────────────────────────────────────────────────────────

sessionsApiRouter.put("/profile", async (req: Request, res: Response) => {
  const userId = req.query["userId"] as string | undefined;

  if (!userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const { name, nativeLanguage, level, interests, goals } = req.body as UserProfile;

  try {
    await new UserProfileStore(userId).set({ name, nativeLanguage, level, interests, goals });
    res.json({ ok: true });
  } catch (err) {
    console.error("[api] profile set failed:", err);
    res.status(500).json({ error: "Failed to save profile" });
  }
});
