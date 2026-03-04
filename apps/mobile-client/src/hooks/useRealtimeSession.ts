/**
 * Realtime voice session: Socket.IO + react-native-audio-api capture/playback.
 * Connects to the same server protocol as the web client (input_audio_buffer.append, done_talking, response.audio.delta).
 *
 * Requires react-native-audio-api ^0.11.x (AudioManager and AudioRecorder are not in 0.5.x).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { io, Socket } from "socket.io-client";
import {
  AudioContext as RNAudioContext,
  AudioRecorder,
  AudioManager,
} from "react-native-audio-api";
import {
  float32ToBase64Pcm16,
  base64Pcm16ToFloat32,
  SAMPLE_RATE,
  RECORD_SAMPLE_RATE,
} from "../utils/audioUtils";
import { SERVER_URL } from "../config";

// Debug flag - set to true to see detailed audio logging in development
const DEBUG_AUDIO = true;

export type ConnectionStatus = "disconnected" | "connecting" | "idle" | "recording" | "responding";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** When set, AI audio is available at this URL (or streamed and played) */
  audioUrl?: string | null;
  /** Streaming transcript while AI is speaking */
  isPartial?: boolean;
  /** Feedback card after assistant message */
  feedback?: {
    grammar_errors: Array<{ original: string; suggestion: string; rule: string }>;
    fluency_score: number;
    tip: string;
  } | null;
}

const LANGUAGE = "English";

// Minimum RMS threshold to detect actual voice (helps filter out silence)
const MIN_RMS_THRESHOLD = 0.01;

// Track audio statistics for debugging
interface AudioStats {
  chunksReceived: number;
  chunksSent: number;
  totalSamples: number;
  maxAmplitude: number;
  lastRms: number;
}

export function useRealtimeSession() {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const recorderRef = useRef<InstanceType<typeof AudioRecorder> | null>(null);
  const audioContextRef = useRef<InstanceType<typeof RNAudioContext> | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<Array<{ stop: () => void }>>([]);
  // Use timestamp-based session ID to ensure unique message keys across reconnections
  const sessionIdRef = useRef(Date.now());
  const partialUserKeyRef = useRef(1);
  const partialAiKeyRef = useRef(1);
  const isStreamingRef = useRef(false);
  const audioStatsRef = useRef<AudioStats>({
    chunksReceived: 0,
    chunksSent: 0,
    totalSamples: 0,
    maxAmplitude: 0,
    lastRms: 0,
  });

  // Helper to generate unique message keys
  const getUserKey = useCallback(() => `user-${sessionIdRef.current}-${partialUserKeyRef.current}`, []);
  const getAiKey = useCallback(() => `ai-${sessionIdRef.current}-${partialAiKeyRef.current}`, []);

  const addOrUpdateMessage = useCallback(
    (id: string, update: Partial<ChatMessage> | ((prev: ChatMessage) => ChatMessage)) => {
      setMessages((prev: ChatMessage[]) => {
        const i = prev.findIndex((m: ChatMessage) => m.id === id);
        if (i >= 0) {
          const next = [...prev];
          next[i] =
            typeof update === "function"
              ? update(next[i])
              : { ...next[i], ...update };
          return next;
        }
        const newMsg: ChatMessage =
          typeof update === "object" && "role" in update
            ? { id, role: "user", text: "", isPartial: false, ...update }
            : (update as ChatMessage);
        return [...prev, newMsg];
      });
    },
    []
  );

  const playPcmDelta = useCallback((base64: string) => {
    const ctx = audioContextRef.current;
    if (!ctx || !base64) return;

    const floats = base64Pcm16ToFloat32(base64);
    const samples = floats.length;
    if (samples === 0) return;

    const buffer = ctx.createBuffer(1, samples, SAMPLE_RATE);
    buffer.getChannelData(0).set(floats);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.04;
    src.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
    activeSourcesRef.current.push(src as unknown as { stop: () => void });
  }, []);

  const playFromUrl = useCallback(async (relativeUrl: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const fullUrl = relativeUrl.startsWith("http") ? relativeUrl : `${SERVER_URL}${relativeUrl}`;
    try {
      const res = await fetch(fullUrl);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      const now = ctx.currentTime;
      if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.05;
      src.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuffer.duration;
      activeSourcesRef.current.push(src as unknown as { stop: () => void });
    } catch (e) {
      console.warn("Play from URL failed:", e);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((s: { stop: () => void }) => {
      try {
        if ("stop" in s && typeof s.stop === "function") s.stop();
      } catch (_) {}
    });
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const connect = useCallback(async () => {
    if (socketRef.current?.connected) return;
    setError(null);
    setStatus("connecting");

    if (!AudioManager) {
      setError(
        "AudioManager not available. Upgrade react-native-audio-api to 0.11+: pnpm add react-native-audio-api@^0.11.5 then rebuild (expo run:ios)."
      );
      setStatus("disconnected");
      return;
    }

    const perm = await AudioManager.requestRecordingPermissions();
    if (perm !== "Granted") {
      setError("Microphone permission denied");
      setStatus("disconnected");
      return;
    }

    // Configure session and create recorder BEFORE activating the session so iOS
    // gets a valid format (avoids "0 Hz" / IsFormatSampleRateAndChannelCountValid).
    AudioManager.setAudioSessionOptions({
      iosCategory: "playAndRecord",
      iosMode: "voiceChat",
      iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
    });
    
    // Create audio context first
    if (!audioContextRef.current) {
      audioContextRef.current = new RNAudioContext({ sampleRate: SAMPLE_RATE });
    }
    
    if (!recorderRef.current) {
      const recorder = new AudioRecorder();
      const recordRate = RECORD_SAMPLE_RATE;
      const factor = recordRate / SAMPLE_RATE; // e.g. 2 for 48k->24k
      
      // Buffer length: ~100ms of audio at the recording sample rate
      const bufferLength = Math.floor(0.1 * recordRate);
      
      if (DEBUG_AUDIO) {
        console.log(`[audio] Setting up recorder: rate=${recordRate}Hz, buffer=${bufferLength} samples, factor=${factor}`);
      }
      
      const result = recorder.onAudioReady(
        {
          sampleRate: recordRate,
          bufferLength: bufferLength,
          channelCount: 1,
        },
        ({ buffer, numFrames }: { buffer: { getChannelData: (ch: number) => Float32Array }; numFrames: number }) => {
          if (!isStreamingRef.current || !socketRef.current?.connected) {
            return;
          }
          
          const ch = buffer.getChannelData(0);
          audioStatsRef.current.chunksReceived++;
          
          // Calculate RMS to check if there's actual audio
          let sumSquares = 0;
          let maxAmp = 0;
          for (let i = 0; i < numFrames; i++) {
            const sample = ch[i];
            sumSquares += sample * sample;
            const absVal = Math.abs(sample);
            if (absVal > maxAmp) maxAmp = absVal;
          }
          const rms = Math.sqrt(sumSquares / numFrames);
          
          audioStatsRef.current.lastRms = rms;
          if (maxAmp > audioStatsRef.current.maxAmplitude) {
            audioStatsRef.current.maxAmplitude = maxAmp;
          }
          
          if (DEBUG_AUDIO && audioStatsRef.current.chunksReceived % 10 === 1) {
            console.log(`[audio] Chunk #${audioStatsRef.current.chunksReceived}: frames=${numFrames}, RMS=${rms.toFixed(4)}, maxAmp=${maxAmp.toFixed(4)}`);
          }
          
          // Downsample if needed (iOS records at 48kHz, server expects 24kHz)
          let samples = ch;
          let len = numFrames;
          if (factor > 1) {
            len = Math.floor(numFrames / factor);
            const down = new Float32Array(len);
            for (let i = 0; i < len; i++) {
              // Average neighboring samples for better quality downsampling
              const idx = i * factor;
              let sum = 0;
              for (let j = 0; j < factor && (idx + j) < numFrames; j++) {
                sum += ch[idx + j];
              }
              down[i] = sum / factor;
            }
            samples = down;
          }
          
          // Send audio chunk to server
          const base64 = float32ToBase64Pcm16(samples, len);
          audioStatsRef.current.chunksSent++;
          audioStatsRef.current.totalSamples += len;
          
          socketRef.current?.emit("message", {
            type: "input_audio_buffer.append",
            audio: base64,
          });
        }
      );
      
      if (DEBUG_AUDIO) {
        console.log(`[audio] onAudioReady setup result:`, result);
      }
      
      recorderRef.current = recorder;
    }

    const success = await AudioManager.setAudioSessionActivity(true);
    if (!success) {
      setError("Could not activate audio session");
      setStatus("disconnected");
      return;
    }

    try {
      const ping = await fetch(SERVER_URL, { method: "GET" }).catch(() => null);
      if (ping === null) {
        setError(
          "Cannot reach server at " +
            SERVER_URL +
            ". Is it running? (pnpm --filter server dev)"
        );
        setStatus("disconnected");
        return;
      }
    } catch (_e) {
      setError(
        "Cannot reach server at " +
          SERVER_URL +
          ". Is it running? (pnpm --filter server dev)"
      );
      setStatus("disconnected");
      return;
    }

    const socket = io(SERVER_URL, {
      path: "/voice-chat/rt",
      query: { language: LANGUAGE, userId: `mobile-${Date.now()}` },
      transports: ["polling", "websocket"],
      timeout: 10000,
      forceNew: true,
    });
    socketRef.current = socket;

    const timeoutId = setTimeout(() => {
      if (socketRef.current?.connected) return;
      setError(
        "Connection timed out. Is the server running? (pnpm --filter server dev). " +
          "On physical device, set SERVER_URL in src/config.ts to your computer's IP."
      );
      setStatus("disconnected");
      socket.close();
    }, 10000);

    socket.on("connect", () => {
      clearTimeout(timeoutId);
      setStatus("idle");
      setError(null);
    });

    socket.on("connect_error", (err: Error) => {
      clearTimeout(timeoutId);
      setError(err.message || "Connection failed. Is the server running on port 3000?");
      setStatus("disconnected");
    });

    socket.on("disconnect", () => {
      setStatus("disconnected");
      isStreamingRef.current = false;
    });

    socket.on("message", (ev: Record<string, unknown>) => {
      const t = ev.type as string;

      // Debug: log all non-audio events
      if (DEBUG_AUDIO && !t.includes("audio.delta") && !t.includes("audio_transcript.delta")) {
        console.log(`[socket] received event: ${t}`);
      }

      if (t === "session.created") return;

      if (t === "session.updated") {
        // Ready to record after history injection
        return;
      }

      if (t === "history_injected") {
        setStatus((s: ConnectionStatus) => (s === "idle" ? s : s));
        return;
      }

      if (t === "conversation.item.input_audio_transcription.delta") {
        const delta = (ev.delta as string) ?? "";
        if (DEBUG_AUDIO) {
          console.log(`[transcription] delta received: "${delta.slice(0, 30)}${delta.length > 30 ? '...' : ''}"`);
        }
        const key = getUserKey();
        addOrUpdateMessage(key, (prev: ChatMessage) => ({
          ...prev,
          text: (prev.text || "") + delta,
          isPartial: true,
        }));
        return;
      }

      if (t === "conversation.item.input_audio_transcription.completed") {
        const transcript = (ev.transcript as string) ?? "";
        if (DEBUG_AUDIO) {
          console.log(`[transcription] completed: "${transcript.slice(0, 50)}${transcript.length > 50 ? '...' : ''}"`);
        }
        const key = getUserKey();
        addOrUpdateMessage(key, {
          text: transcript,
          isPartial: false,
        });
        return;
      }

      // ── Ignore ALL AI response events while user is recording ──────────
      // This prevents any AI activity (empty bubbles, audio, etc.) while the user speaks
      if (isStreamingRef.current && t.startsWith("response.")) {
        // Silently ignore response events while recording
        return;
      }

      if (t === "response.created") {
        console.log(`[client] response.created received, setting status to responding`);
        setStatus("responding");
        partialAiKeyRef.current += 1;
        addOrUpdateMessage(getAiKey(), {
          role: "assistant",
          text: "",
          isPartial: true,
        });
        return;
      }

      if (t === "response.audio.delta") {
        playPcmDelta((ev.delta as string) ?? "");
        return;
      }

      if (t === "response.audio_transcript.delta") {
        const key = getAiKey();
        const delta = (ev.delta as string) ?? "";
        addOrUpdateMessage(key, (prev: ChatMessage) => ({
          ...prev,
          text: (prev.text || "") + delta,
          isPartial: true,
        }));
        return;
      }

      if (t === "response.audio_transcript.done") {
        const key = getAiKey();
        addOrUpdateMessage(key, {
          text: (ev.transcript as string) ?? "",
          isPartial: false,
        });
        return;
      }

      if (t === "response.done") {
        console.log(`[client] response.done received, setting status to idle`);
        setStatus("idle");
        return;
      }

      if (t === "ai_audio_ready") {
        const url = ev.url as string | undefined;
        const key = getAiKey();
        if (url) addOrUpdateMessage(key, { audioUrl: url });
        return;
      }

      if (t === "turn_feedback") {
        const key = getAiKey();
        const feedback = ev.feedback as ChatMessage["feedback"];
        if (feedback) addOrUpdateMessage(key, { feedback });
        return;
      }

      if (t === "tool_call_complete") {
        return;
      }

      if (t === "error") {
        const err = ev.error as { message?: string };
        setError(err?.message ?? "Unknown error");
        return;
      }
    });

    // Recorder and audio context are created above (before setAudioSessionActivity).
  }, [addOrUpdateMessage, playPcmDelta]);

  const disconnect = useCallback(() => {
    isStreamingRef.current = false;
    recorderRef.current?.clearOnAudioReady?.();
    stopPlayback();
    socketRef.current?.disconnect();
    socketRef.current = null;
    setStatus("disconnected");
    if (AudioManager) AudioManager.setAudioSessionActivity(false);
  }, [stopPlayback]);

  const startRecording = useCallback(() => {
    if (status !== "idle" || !socketRef.current?.connected) return;
    
    // Reset audio stats for this recording session
    audioStatsRef.current = {
      chunksReceived: 0,
      chunksSent: 0,
      totalSamples: 0,
      maxAmplitude: 0,
      lastRms: 0,
    };
    
    partialUserKeyRef.current += 1;
    const key = getUserKey();
    addOrUpdateMessage(key, {
      role: "user",
      text: "",
      isPartial: true,
    });
    isStreamingRef.current = true;
    setStatus("recording");

    if (DEBUG_AUDIO) {
      console.log("[audio] Starting recording...");
    }

    try {
      const result = recorderRef.current?.start();
      
      if (DEBUG_AUDIO) {
        console.log("[audio] recorder.start() result:", result);
      }
      
      if (result?.status === "error") {
        setError(result.message ?? "Failed to start recording");
        isStreamingRef.current = false;
        setStatus("idle");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Recording failed";
      setError(message + ". Try closing other apps using the microphone.");
      isStreamingRef.current = false;
      setStatus("idle");
    }
  }, [status, addOrUpdateMessage]);

  const stopRecording = useCallback(() => {
    if (status !== "recording") return;
    
    const stats = audioStatsRef.current;
    if (DEBUG_AUDIO) {
      console.log(`[audio] Stopping recording. Stats:`, {
        chunksReceived: stats.chunksReceived,
        chunksSent: stats.chunksSent,
        totalSamples: stats.totalSamples,
        maxAmplitude: stats.maxAmplitude.toFixed(4),
        lastRms: stats.lastRms.toFixed(4),
        durationSec: (stats.totalSamples / SAMPLE_RATE).toFixed(2),
      });
    }
    
    // Warn if no audio was detected (iOS Simulator issue)
    if (stats.chunksReceived === 0) {
      console.warn("[audio] No audio chunks were received! This may happen on iOS Simulator which has no microphone.");
      setError("No audio detected. If using iOS Simulator, test on a real device.");
    } else if (stats.maxAmplitude < 0.01) {
      console.warn("[audio] Audio levels very low - might be silence. maxAmplitude:", stats.maxAmplitude);
    }
    
    isStreamingRef.current = false;
    setStatus("responding");
    recorderRef.current?.stop();
    socketRef.current?.emit("message", { type: "done_talking" });
  }, [status]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
    // connect/disconnect are stable callbacks — run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    messages,
    error,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    playFromUrl,
  };
}
