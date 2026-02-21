/**
 * Redis client singleton.
 *
 * A single ioredis instance is reused for the lifetime of the process.
 * All modules import `getRedisClient()` rather than constructing their own
 * connections, which keeps the total connection count to one.
 *
 * Configuration is read from the REDIS_URL environment variable, defaulting
 * to the Docker Compose address used in local development.
 */

import Redis from "ioredis";

let _client: Redis | null = null;

/**
 * Returns the shared Redis client, creating it on first call.
 *
 * The client reconnects automatically on failure (ioredis default behaviour).
 */
export function getRedisClient(): Redis {
  if (_client) return _client;

  _client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    // No keyPrefix here — each store adds its own "langmate:" namespace manually.
    // Using a prefix via this option breaks SCAN/KEYS pattern matching because
    // ioredis prepends the prefix to the pattern but the returned keys already
    // include it, causing double-prefix when those keys are passed back to HGETALL.
    maxRetriesPerRequest: null,
  });

  _client.on("connect", () => console.log("[redis] connected"));
  _client.on("ready",   () => console.log("[redis] ready"));
  _client.on("error",   (err: Error) =>
    console.error("[redis] error:", err.message),
  );
  _client.on("close",   () => console.log("[redis] connection closed"));

  return _client;
}

/**
 * Gracefully closes the Redis connection.
 * Called during process shutdown to allow in-flight commands to complete.
 */
export async function closeRedisClient(): Promise<void> {
  if (_client) {
    await _client.quit();
    _client = null;
    console.log("[redis] connection closed gracefully");
  }
}
