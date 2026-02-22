# Langmate Real-Time POC

A real-time voice conversation server for language learning. The user speaks into a browser, the server relays audio to the OpenAI Realtime API, and the AI responds in voice — all with per-turn grammar feedback, persistent history, and a rolling long-term memory across sessions.

---

## Monorepo structure

```
langmate-real-time-poc/
├── apps/
│   ├── core/          # Domain + application layer (scaffolding, currently empty stubs)
│   └── server/        # Express + Socket.IO server — all live code lives here
├── packages/
│   ├── ui/            # Shared React component stubs
│   ├── eslint-config/ # Shared ESLint config
│   └── typescript-config/ # Shared tsconfig bases
├── pnpm-workspace.yaml
└── turbo.json
```

Built with **pnpm** workspaces and **Turborepo**. Node ≥ 18 required.

---

## How it works

### Two voice modes

**1. Realtime mode (primary)**

```
Browser ──Socket.IO(/voice-chat/rt)──► Server ──WebSocket──► OpenAI Realtime API
```

The browser streams raw PCM16 audio chunks over Socket.IO. The server relays them to the OpenAI Realtime API over a WebSocket. OpenAI sends audio and transcript deltas back; the server forwards them to the browser in real time.

**2. Classic mode (secondary)**

```
Browser ──POST /voice-chat──► Server ──► OpenAI STT → LLM → TTS ──► stream audio back
```

A single audio file is uploaded, transcribed with `gpt-4o-mini-transcribe`, answered by `gpt-4o-mini`, and a spoken reply is streamed back as AAC audio. No persistent state.

---

## Session lifecycle (realtime mode)

1. **Connect** — browser connects to Socket.IO at `/voice-chat/rt` with query params `?language=French&userId=alice`.
2. **Pre-fetch** — server immediately fetches (in parallel): user profile, rolling summary, and last 6 conversation turns from Redis.
3. **OpenAI handshake** — server opens a WebSocket to `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`.
4. **`session.created`** — server waits for pre-fetch to resolve then sends `session.update` with:
   - instructions built from base prompt + user profile fields + rolling summary
   - tools: `get_user_profile` and `submit_turn_feedback`
   - audio format: PCM16, 24 kHz, mono; transcription model: `gpt-4o-mini-transcribe`
5. **`session.updated`** — server injects the last N verbatim turns via `conversation.item.create`, then emits `history_injected` to the client so the UI can enable recording.
6. **User speaks** — browser sends `input_audio_buffer.append` events (base64 PCM chunks). Each chunk is immediately appended to a crash-safe `.pcm.tmp` file on disk.
7. **Done talking** — browser sends `done_talking`. Server finalises the user WAV file, uploads it to MinIO, sends `input_audio_buffer.commit` + `response.create` to OpenAI.
8. **AI responds** — OpenAI streams `response.audio.delta` (PCM chunks) back. Each chunk is appended to an AI `.pcm.tmp` file.
9. **`response.done`** — server finalises the AI WAV, saves it, sends `ai_audio_ready` URL to client, uploads to MinIO. Immediately fires a silent feedback request.
10. **Feedback** — server sends a forced `response.create` (text-only, tool_choice: `submit_turn_feedback`). The AI evaluates the user's last utterance and returns structured JSON. Server emits a `turn_feedback` event to the client (no audio).
11. **Disconnect** — server marks session ended in Redis. If ≥ 2 turns occurred, generates an updated rolling summary with `gpt-4o-mini` and stores it in Redis (TTL 30 days).

---

## Persistence layers

### Redis (ioredis)

| Key | Type | TTL | Contents |
|-----|------|-----|----------|
| `langmate:session:{sessionId}` | Hash | 24 h | sessionId, userId, language, startedAt, status, turnsCompleted |
| `langmate:history:{userId}:turns` | List | none | Last 100 `ConversationTurn` JSON objects (oldest dropped) |
| `langmate:history:{userId}:summary` | String | 30 d | Rolling 2–3 sentence summary of all past sessions |
| `langmate:user:{userId}:profile` | Hash | none | name, nativeLanguage, level, interests, goals |

### MinIO (S3-compatible)

Bucket configured via `MINIO_BUCKET` (default `langmate-media`).

```
recordings/
  <sessionTs>_<shortId>_user<N>.wav   ← user speech per turn
  <sessionTs>_<shortId>_ai<N>.wav     ← AI response per turn
```

Files are written to local disk first (`data/recordings/`) and uploaded asynchronously. Local disk playback via `/recordings/<filename>` stays intact even if MinIO is unreachable.

### Local disk

```
data/
  recordings/          ← final WAV files served at /recordings/*
  recordings/.tmp/     ← in-flight .pcm.tmp files (crash-safe buffer)
  transcripts/         ← per-session plain-text conversation logs
```

On server startup, any leftover `.pcm.tmp` files are automatically recovered and converted to `.recovered.wav`.

---

## Memory / context system

Three layers of context are injected into every session:

| Layer | Mechanism | Coverage |
|-------|-----------|----------|
| User profile | Embedded in `session.update.instructions` | Permanent (name, level, goals…) |
| Rolling summary | Embedded in `session.update.instructions` | All past sessions compressed |
| Verbatim turns | `conversation.item.create` after `session.updated` | Last 6 turns (3 full exchanges) |

After every session the summary is regenerated by `gpt-4o-mini` to incorporate the new session, so older context is never fully lost.

---

## Tool calling

Two tools are registered in every session:

**`get_user_profile`** (interactive)
- The AI may call this spontaneously to read the learner's detailed profile from Redis.
- Server executes it locally, submits the result, and continues the conversation.

**`submit_turn_feedback`** (forced, post-turn)
- Called silently after each AI response via a forced `response.create`.
- Returns structured JSON: `grammar_errors[]`, `fluency_score` (1–10), `tip`.
- Server emits `turn_feedback` to the client; no audio response follows.

---

## REST API

All routes served by the `server` app at the configured port (default 3000).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/voice-chat` | Classic STT→LLM→TTS pipeline (multipart audio upload) |
| `GET` | `/api/sessions?userId=` | List sessions for a user (from Redis) |
| `GET` | `/api/history?userId=&limit=` | Recent conversation turns (from Redis) |
| `GET` | `/api/profile?userId=` | Read learner profile |
| `PUT` | `/api/profile?userId=` | Create / update learner profile |
| `GET` | `/recordings/*` | Serve saved WAV recordings |

---

## Socket.IO events

### Client → Server
| Event | Payload | Meaning |
|-------|---------|---------|
| `message` | `{ type: "input_audio_buffer.append", audio: "<base64>" }` | Send PCM chunk |
| `message` | `{ type: "done_talking" }` | User finished speaking, trigger AI response |
| `message` | any other OpenAI event | Forwarded directly to OpenAI |

### Server → Client
| Event | Payload | Meaning |
|-------|---------|---------|
| `message` | OpenAI event object | Forwarded from OpenAI (audio deltas, transcripts, etc.) |
| `message` | `{ type: "history_injected", count }` | History injection complete; safe to start recording |
| `message` | `{ type: "ai_audio_ready", url }` | AI WAV file available for playback |
| `message` | `{ type: "turn_feedback", feedback }` | Structured grammar/fluency feedback |
| `message` | `{ type: "tool_call_complete", toolName }` | Interactive tool call finished |
| `message` | `{ type: "error", error }` | OpenAI connection error |

---

## Environment variables

Create `apps/server/.env`:

```env
OPENAI_API_KEY=sk-...

# Server
SERVER_PORT=3000

# Redis
REDIS_URL=redis://localhost:6379

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=langmate-media
MINIO_USE_SSL=false
```

---

## Development

```sh
# Install dependencies
pnpm install

# Run the server in watch mode
pnpm --filter server dev

# Or run all apps
pnpm dev

# Build everything
pnpm build

# Type-check
pnpm check-types

# Lint
pnpm lint
```

---

## Server module map

```
apps/server/src/express-server/
├── app.ts                        # Express app, middleware, route mounts
├── routes/
│   ├── voice-chat.router.ts      # POST /voice-chat (classic STT→LLM→TTS)
│   ├── voice-chat-realtime.ts    # Socket.IO server attachment
│   └── sessions-api.ts           # REST API for sessions, history, profile
└── realtime/
    ├── constants.ts              # OPENAI_REALTIME_URL, DATA_DIR, HISTORY_INJECTION_TURNS
    ├── session-handler.ts        # Core session orchestrator (one per socket connection)
    ├── session-store.ts          # Redis: session metadata
    ├── history-store.ts          # Redis: per-user conversation turns
    ├── session-summarizer.ts     # Redis: rolling summary via gpt-4o-mini
    ├── user-profile-store.ts     # Redis: learner profile
    ├── tool-handler.ts           # Tool definitions + execution (get_user_profile, submit_turn_feedback)
    ├── audio-recorder.ts         # Crash-safe PCM capture → WAV files
    ├── storage-service.ts        # MinIO upload
    ├── transcript-manager.ts     # Per-session plain-text transcript file
    ├── pcm-utils.ts              # pcmToWav(), sessionTimestamp()
    └── redis-client.ts           # Singleton ioredis client
```
