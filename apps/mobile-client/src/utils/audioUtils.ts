/**
 * PCM16 / base64 helpers for OpenAI Realtime API.
 * Format: PCM16 LE, 24 kHz, mono (server expects SAMPLE_RATE).
 */

import { Platform } from "react-native";

const SAMPLE_RATE = 24_000;

/** Use 48k on iOS (avoids native "0 Hz" format errors); 24k elsewhere. Server expects 24k. */
export const RECORD_SAMPLE_RATE = Platform.OS === "ios" ? 48_000 : SAMPLE_RATE;

export { SAMPLE_RATE };

/**
 * Convert float32 samples (-1..1) to base64-encoded PCM16 LE.
 * Used when sending mic chunks to the server.
 */
export function float32ToBase64Pcm16(f32: Float32Array, length: number): string {
  const buf = new ArrayBuffer(length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa !== "undefined" ? btoa(binary) : encodeBase64(bytes);
}

/**
 * Decode base64 PCM16 LE to float32 array for playback.
 */
export function base64Pcm16ToFloat32(base64: string): Float32Array {
  const binary = typeof atob !== "undefined" ? atob(base64) : decodeBase64(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const samples = bytes.length / 2;
  const out = new Float32Array(samples);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < samples; i++) {
    out[i] = dv.getInt16(i * 2, true) / 32_767;
  }
  return out;
}

/** Fallback base64 encode for environments without btoa (e.g. Hermes) */
function encodeBase64(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    result += chars[a >> 2];
    result += chars[((a & 3) << 4) | (b >> 4)];
    result += i + 1 < bytes.length ? chars[((b & 15) << 2) | (c >> 6)] : "=";
    result += i + 2 < bytes.length ? chars[c & 63] : "=";
  }
  return result;
}

/** Fallback base64 decode for environments without atob */
function decodeBase64(base64: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  const len = base64.replace(/=+$/, "").length;
  const out = new Uint8Array((len * 3) >> 2);
  let j = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[base64.charCodeAt(i)];
    const b = lookup[base64.charCodeAt(i + 1)];
    const c = lookup[base64.charCodeAt(i + 2)];
    const d = lookup[base64.charCodeAt(i + 3)];
    out[j++] = (a << 2) | (b >> 4);
    if (i + 2 < len) out[j++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < len) out[j++] = ((c & 3) << 6) | d;
  }
  let s = "";
  for (let i = 0; i < j; i++) s += String.fromCharCode(out[i]);
  return s;
}
