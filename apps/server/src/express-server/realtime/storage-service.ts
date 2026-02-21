/**
 * Storage service — MinIO (S3-compatible) object storage client.
 *
 * Audio WAV files are written to local disk first (by AudioRecorder) and then
 * uploaded here asynchronously.  Local disk serving via Express stays intact,
 * so the playback URL never changes.  MinIO is an additional durable store.
 *
 * Object key layout:
 *   <bucket>/
 *     recordings/
 *       <sessionTs>_<shortId>_user<N>.wav
 *       <sessionTs>_<shortId>_ai<N>.wav
 *
 * Environment variables (see .env.example):
 *   MINIO_ENDPOINT    — hostname, e.g. "localhost"
 *   MINIO_PORT        — port, e.g. 9000
 *   MINIO_ACCESS_KEY  — MinIO root user or IAM access key
 *   MINIO_SECRET_KEY  — MinIO root password or IAM secret key
 *   MINIO_BUCKET      — bucket name, e.g. "langmate-media"
 *   MINIO_USE_SSL     — "true" | "false"  (default: false)
 */

import { Client } from "minio";

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
 */
export async function ensureBucket(): Promise<void> {
  const client = getClient();
  const b      = bucket();

  const exists = await client.bucketExists(b);
  if (!exists) {
    await client.makeBucket(b);
    console.log(`[minio] bucket "${b}" created`);
  } else {
    console.log(`[minio] bucket "${b}" ready`);
  }
}

/**
 * Uploads a local WAV file to MinIO under `recordings/<filename>`.
 *
 * Uses `fPutObject` so the SDK streams directly from disk — no extra memory
 * buffer needed.  The caller should fire-and-forget with `.catch()` so a
 * failed upload never blocks the session.
 *
 * @param localPath - Absolute path to the WAV file on disk.
 * @param filename  - Basename (e.g. "20260221_abc12345_ai1.wav").
 */
export async function uploadRecording(localPath: string, filename: string): Promise<void> {
  const client    = getClient();
  const b         = bucket();
  const objectKey = `recordings/${filename}`;

  await client.fPutObject(b, objectKey, localPath, {
    "Content-Type": "audio/wav",
  });

  console.log(`[minio] uploaded ${filename} → ${b}/${objectKey}`);
}
