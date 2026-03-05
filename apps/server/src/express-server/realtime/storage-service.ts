/**
 * Storage service — MinIO (S3-compatible) object storage client.
 *
 * Audio WAV files are written to local disk first (by AudioRecorder) and then
 * uploaded here asynchronously.  Local disk serving via Express stays intact,
 * so the playback URL never changes.  MinIO is an additional durable store.
 *
 * MinIO is OFF by default. Set MINIO_ENABLED=true (and run MinIO, e.g. via
 * docker-compose up minio) to upload recordings to MinIO.
 *
 * Environment variables (see .env.example):
 *   MINIO_ENABLED     — "true" to enable MinIO (default: off)
 *   MINIO_ENDPOINT    — hostname, e.g. "localhost"
 *   MINIO_PORT        — port, e.g. 9000
 *   MINIO_ACCESS_KEY  — MinIO root user or IAM access key
 *   MINIO_SECRET_KEY  — MinIO root password or IAM secret key
 *   MINIO_BUCKET      — bucket name, e.g. "langmate-media"
 *   MINIO_USE_SSL     — "true" | "false"  (default: false)
 */

import { Client } from "minio";

function isMinioEnabled(): boolean {
  return process.env.MINIO_ENABLED === "true";
}

// ── Singleton client ──────────────────────────────────────────────────────────

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client({
      endPoint:  process.env.MINIO_ENDPOINT  ?? "localhost",
      port:      Number(process.env.MINIO_PORT ?? 9000),
      useSSL:    process.env.MINIO_USE_SSL === "true",
      accessKey: process.env.MINIO_ACCESS_KEY ?? "minioadmin",
      secretKey: process.env.MINIO_SECRET_KEY ?? "minioadmin",
    });
  }
  return _client;
}

const bucket = (): string => process.env.MINIO_BUCKET ?? "langmate-media";

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates the configured bucket if it doesn't already exist.
 * Call once at server startup — safe to call multiple times.
 * No-op when MinIO is not enabled (default).
 */
export async function ensureBucket(): Promise<void> {
  if (!isMinioEnabled()) {
    return;
  }
  const client = getClient();
  const b      = bucket();

  const exists = await client.bucketExists(b);
  if (!exists) {
    await client.makeBucket(b);
  }
}

/**
 * Uploads a local WAV file to MinIO under `recordings/<filename>`.
 *
 * Uses `fPutObject` so the SDK streams directly from disk — no extra memory
 * buffer needed.  The caller should fire-and-forget with `.catch()` so a
 * failed upload never blocks the session.
 * No-op when MinIO is not enabled (default).
 *
 * @param localPath - Absolute path to the WAV file on disk.
 * @param filename  - Basename (e.g. "20260221_abc12345_ai1.wav").
 */
export async function uploadRecording(localPath: string, filename: string): Promise<void> {
  if (!isMinioEnabled()) return;
  const client    = getClient();
  const b         = bucket();
  const objectKey = `recordings/${filename}`;

  await client.fPutObject(b, objectKey, localPath, {
    "Content-Type": "audio/wav",
  });
}

/**
 * Returns a presigned GET URL for a recording already in MinIO.
 *
 * The URL is valid for 7 days — long enough for in-session playback and
 * short-term review, while still expiring automatically.
 * Throws when MinIO is not enabled.
 *
 * @param filename - Basename (e.g. "20260221_abc12345_ai1.wav").
 */
export async function getPresignedUrl(filename: string): Promise<string> {
  if (!isMinioEnabled()) throw new Error("MinIO is disabled");
  const SEVEN_DAYS = 7 * 24 * 60 * 60;
  return getClient().presignedGetObject(bucket(), `recordings/${filename}`, SEVEN_DAYS);
}
