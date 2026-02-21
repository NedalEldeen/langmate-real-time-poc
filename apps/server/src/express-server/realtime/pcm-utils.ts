/**
 * PCM / WAV utility functions.
 *
 * OpenAI Realtime API exchanges raw PCM16 LE (little-endian, signed 16-bit)
 * audio at 24 000 Hz mono.  These helpers convert that raw format into a
 * standard WAV file that any media player can open, and provide a timestamp
 * formatter used in session file names.
 */

/**
 * Wraps an array of raw PCM16 LE mono 24 kHz byte buffers into a valid
 * WAV file buffer.
 *
 * WAV structure:
 *   [44-byte RIFF/fmt/data header] + [concatenated PCM samples]
 *
 * @param chunks - Raw PCM byte chunks to combine and wrap.
 * @returns A Buffer containing a complete, playable WAV file.
 */
export function pcmToWav(chunks: Buffer[]): Buffer {
  const pcm = Buffer.concat(chunks);

  const sampleRate    = 24_000;
  const numChannels   = 1;
  const bitsPerSample = 16;
  const byteRate      = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign    = (numChannels * bitsPerSample) / 8;
  const dataSize      = pcm.length;

  // Standard 44-byte WAV header (RIFF / WAVE / fmt  / data chunks)
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);   // total file size - 8 bytes
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);             // PCM format chunk size
  header.writeUInt16LE(1, 20);             // audio format: 1 = PCM (uncompressed)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Returns a filesystem-safe ISO-8601 timestamp string for the current moment.
 *
 * Colons and dots are replaced with dashes so the result can be used safely
 * in file names on all operating systems.
 *
 * Example output: "2026-02-21T14-30-00"
 */
export function sessionTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
