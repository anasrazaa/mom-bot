# GIK Faculty MoM Assistant — Developer Handbook

> Last updated: May 2026  
> Stack: FastAPI · faster-whisper · pyannote · SpeechBrain · Ollama/Qwen2.5 · React 18 · Docker Compose

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Infrastructure & Docker](#3-infrastructure--docker)
4. [Configuration Reference](#4-configuration-reference)
5. [Backend Architecture](#5-backend-architecture)
6. [AI Pipeline Deep-Dive](#6-ai-pipeline-deep-dive)
7. [REST API Reference](#7-rest-api-reference)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Data Storage](#9-data-storage)
10. [Speaker Enrollment & Identification](#10-speaker-enrollment--identification)
11. [Transcript Quality & Tuning](#11-transcript-quality--tuning)
12. [MoM Generation](#12-mom-generation)
13. [Speaker Correction & Re-enrollment](#13-speaker-correction--re-enrollment)
14. [Interval Summaries](#14-interval-summaries)
15. [RAG — Semantic Search over Meetings](#15-rag--semantic-search-over-meetings)
16. [Analytics](#16-analytics)
17. [Export (DOCX / PDF)](#17-export-docx--pdf)
18. [Common Development Tasks](#18-common-development-tasks)
19. [Known Issues & Fixes](#19-known-issues--fixes)
20. [Tuning Cheat-Sheet](#20-tuning-cheat-sheet)

---

## 1. Project Overview

The **GIK Faculty MoM Assistant** is a self-hosted, GPU-accelerated system that:

- Records meeting audio live from any browser (or accepts pre-recorded uploads)
- Transcribes speech in real-time (English + Urdu; output forced to English)
- Identifies who spoke using enrolled voice profiles
- Generates formal **Minutes of Meeting (MoM)** documents via a local LLM
- Exports MoM as DOCX or PDF
- Provides semantic search across all past meeting transcripts
- Shows per-speaker participation analytics
- Allows post-meeting speaker label correction that also re-trains voice profiles

Everything runs on a single machine with an NVIDIA GPU — no cloud services, no data leaves the premises.

---

## 2. Repository Layout

```
mom_bot/
├── app/                        # FastAPI backend
│   ├── main.py                 # App entry-point, lifespan hooks
│   ├── config.py               # All settings (pydantic-settings, .env)
│   ├── api/
│   │   └── routes/
│   │       ├── meeting.py      # Meeting lifecycle endpoints
│   │       ├── transcript.py   # Transcript, WebSocket push, clip serve, speaker correct
│   │       ├── speaker.py      # Enrollment & management
│   │       ├── analytics.py    # Per-meeting + cross-meeting stats
│   │       ├── chat.py         # Chat/RAG + live summaries
│   │       ├── export.py       # DOCX / PDF export
│   │       └── handbook.py     # Faculty Handbook Q&A
│   ├── models/
│   │   └── schemas.py          # All Pydantic request/response models
│   └── modules/
│       ├── pipeline.py         # Core orchestrator (MeetingSession + PipelineManager)
│       ├── vad.py              # Silero VAD
│       ├── transcription.py    # faster-whisper STT
│       ├── diarization.py      # pyannote diarization
│       ├── speaker_id.py       # ECAPA-TDNN enrollment + identification
│       ├── transcript_manager.py # Per-meeting transcript store + disk persistence
│       ├── action_item_detector.py # LLM-based action item extraction
│       ├── action_item_manager.py  # Action item CRUD + persistence
│       ├── llm_processor.py    # Ollama prompts (MoM, summary, draft, chat)
│       ├── mom_generator.py    # Builds MoMDocument from LLM JSON
│       ├── rag.py              # Sentence-transformer index over transcripts
│       ├── handbook_rag.py     # RAG index for Faculty Handbook PDF
│       ├── export_module.py    # DOCX + PDF rendering
│       └── utils/helpers.py    # Audio decode, UUID, save_audio helpers
├── frontend/                   # React 18 + Vite SPA
│   ├── src/
│   │   ├── App.jsx             # Router, global context (AppContext, ToastContext)
│   │   ├── api.js              # Typed fetch wrapper (api.get / post / form / delete)
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ActiveMeeting.jsx   # Live transcript + interval summaries
│   │   │   ├── LiveMeetings.jsx
│   │   │   ├── MeetingDetail.jsx   # History view + speaker correction mode
│   │   │   ├── MeetingHistory.jsx
│   │   │   ├── Speakers.jsx        # Enrollment form
│   │   │   ├── Analytics.jsx
│   │   │   └── Chat.jsx
│   │   └── components/Layout.jsx
│   └── Dockerfile              # nginx + Vite build
├── data/                       # All persistent data (Docker volume mount)
│   ├── meetings/               # _meta.json, _transcript.json, _mom.json per meeting
│   │   └── clips/              # Per-entry WAV clips for speaker correction
│   ├── speaker_profiles/       # ECAPA embeddings per speaker
│   ├── exports/                # Generated DOCX / PDF files
│   └── server.log              # Rotating backend log (50 MB, 30 days)
├── models/                     # Downloaded model weights (Docker volume mount)
│   ├── whisper/
│   ├── pyannote/
│   └── (speechbrain cached in HF cache)
├── docker-compose.yml
├── Dockerfile                  # API container
└── .env                        # Secrets (not committed)
```

---

## 3. Infrastructure & Docker

### Services

| Container | Image / Build | Port | Purpose |
|---|---|---|---|
| `mom_ollama` | `ollama/ollama:latest` | 11434 | LLM inference server |
| `mom_ollama_init` | same | — | One-shot model puller (exits after pulling) |
| `mom_api` | `./Dockerfile` | 8000 | FastAPI backend |
| `mom_frontend` | `./frontend/Dockerfile` | 80 | nginx serving compiled React SPA |

### Volumes

| Volume | Purpose |
|---|---|
| `ollama_models` | Ollama model weights (persisted across restarts) |
| `hf_cache` | HuggingFace model cache (pyannote, speechbrain, sentence-transformers) |
| `./data` (bind mount) | All meeting data, speaker profiles, exports, logs |
| `./models` (bind mount) | Whisper weights downloaded by `scripts/download_models.sh` |

### Required `.env` file

```dotenv
PYANNOTE_HF_TOKEN=hf_xxxxxxxxxxxxxxxxxxxx   # HuggingFace token for pyannote models
LLM_MODEL=qwen2.5:14b                        # Ollama model name
WHISPER_MODEL=large-v3                        # Whisper model variant
LOG_LEVEL=INFO                                # DEBUG for development
```

`PYANNOTE_HF_TOKEN` is only needed the first time (to download the model). Once cached in `hf_cache`, it can be left empty.

### Build & Run

```bash
# First time: pull LLM model and build everything
docker compose up --build

# Subsequent starts (no rebuild)
docker compose up -d

# Rebuild only the API after backend changes
docker compose build mom-api && docker compose up -d mom-api

# Rebuild only frontend after UI changes
docker compose build frontend && docker compose up -d frontend

# View API logs live
docker compose logs -f mom-api

# Open a shell in the API container
docker compose exec mom-api bash
```

### Startup Sequence

1. `mom_ollama` starts and becomes healthy (takes ~30 s)
2. `mom_ollama_init` pulls the configured LLM model (first run only — takes several minutes depending on model size)
3. `mom-api` starts and calls `pipeline_manager.load_models()` which loads all AI models into GPU memory sequentially:
   - Silero VAD
   - faster-whisper large-v3
   - pyannote diarization 3.1
   - SpeechBrain ECAPA-TDNN
   - sentence-transformers (RAG)
   - This takes **2–5 minutes** on first run; subsequent restarts are faster because weights are cached
4. The startup hook also: auto-heals stale `recording` statuses in meta files, indexes the Faculty Handbook PDF if changed
5. `mom_frontend` starts immediately; the UI will show "models loading" until step 3 completes

---

## 4. Configuration Reference

All settings live in `app/config.py` as a `pydantic-settings` class. They can be overridden with environment variables or the `.env` file.

### Audio

| Key | Default | Notes |
|---|---|---|
| `SAMPLE_RATE` | 16000 | Hz; all audio is resampled to this |
| `CHUNK_DURATION` | 8.0 | Seconds of audio buffered before processing |
| `MAX_MEETING_DURATION` | 480 | Max minutes (soft limit) |

### Whisper

| Key | Default | Notes |
|---|---|---|
| `WHISPER_MODEL` | `large-v3` | Model variant; `medium` is faster but less accurate |
| `WHISPER_DEVICE` | `cuda` | Use `cpu` if no GPU |
| `WHISPER_COMPUTE_TYPE` | `float16` | Use `int8` for less VRAM |
| `WHISPER_LANGUAGE` | `None` | Force a language code (e.g. `en`), or leave `None` for auto-detect |
| `WHISPER_ALLOWED_LANGUAGES` | `en,ur` | Candidate languages for auto-detect |
| `WHISPER_FORCE_ENGLISH` | `True` | Translate all output to English |
| `WHISPER_BEAM_SIZE` | 5 | Higher = more accurate, slower |
| `WHISPER_LOW_CONF_THRESHOLD` | -0.85 | Entries below this are flagged in the MoM draft review |
| `WHISPER_NO_SPEECH_THRESHOLD` | 0.5 | Discard segment if P(silence) exceeds this |
| `WHISPER_LOG_PROB_THRESHOLD` | -1.0 | Discard if avg log-prob is too low (hallucination guard) |
| `WHISPER_COMPRESSION_RATIO_THRESHOLD` | 2.4 | Discard repetitive/hallucinated text |
| `WHISPER_REPETITION_PENALTY` | 1.2 | Penalise repeating tokens |

### Diarization

| Key | Default | Notes |
|---|---|---|
| `PYANNOTE_MODEL` | `pyannote/speaker-diarization-3.1` | |
| `DIARIZATION_MIN_SPEAKERS` | 1 | |
| `DIARIZATION_MAX_SPEAKERS` | 8 | Hard ceiling; further capped at enrolled-speaker count at runtime |

### Speaker ID

| Key | Default | Notes |
|---|---|---|
| `SPEECHBRAIN_MODEL` | `speechbrain/spkrec-ecapa-voxceleb` | |
| `SPEAKER_ID_THRESHOLD` | 0.42 | Cosine similarity threshold; below this → "Unknown" |

### LLM

| Key | Default | Notes |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Internal Docker network URL |
| `LLM_MODEL` | `qwen2.5:14b` | Any Ollama model; 14b requires ~12 GB VRAM |
| `LLM_TEMPERATURE` | 0.1 | Low = more deterministic (good for structured output) |
| `LLM_MAX_TOKENS` | 4096 | Max output tokens |
| `LLM_NUM_CTX` | 32768 | **Critical** — must be large enough for the full transcript |
| `LLM_TIMEOUT` | 600 | Seconds; long meetings need the full 10 minutes |
| `LLM_CHUNK_CHARS` | 90000 | Transcripts longer than this are split and merged |

### Paths

| Key | Default |
|---|---|
| `MEETINGS_DIR` | `data/meetings/` |
| `CLIPS_DIR` | `data/meetings/clips/` |
| `SPEAKER_PROFILES_DIR` | `data/speaker_profiles/` |
| `EXPORTS_DIR` | `data/exports/` |
| `MODELS_DIR` | `models/` |

---

## 5. Backend Architecture

### Entry Point (`app/main.py`)

FastAPI app with a `lifespan` context manager. On startup:
- Loads all AI models (`pipeline_manager.load_models()`)
- Auto-heals stale `recording` statuses in meeting meta files (`_fix_completed_statuses`)
- Indexes Faculty Handbook PDF into RAG if it changed

### `PipelineManager` (`app/modules/pipeline.py`)

Singleton (`pipeline_manager`) that owns:
- All loaded AI model instances (shared across meetings)
- The in-memory session dict `_sessions: Dict[str, MeetingSession]`
- Public methods: `create_meeting`, `get_session`, `stop_meeting`, `list_meetings`, `generate_mom`, `generate_live_summary`, `export_docx/pdf`

**Important:** `_sessions` is in-memory only. On container restart, all sessions are lost. The `list_meetings` method reads `*_meta.json` from disk to reconstruct history, and auto-heals any meta file that still shows `recording` status (since the session no longer exists in memory).

### `MeetingSession` (`app/modules/pipeline.py`)

Manages one live meeting:
- Audio buffer (`_buffer`, `_buffer_secs`)
- `asyncio.Lock` on the buffer (thread-safe ingestion)
- `ingest(audio, sr)` — accumulates audio; flushes when `CHUNK_DURATION` is reached
- `_flush()` — drains buffer, spawns `asyncio.to_thread(_process, ...)` so the pipeline runs off the async event loop
- `_process()` — the core pipeline: VAD → Diarization → STT → Speaker ID → TranscriptEntry → save clip → push via WebSocket
- `stop()` — flushes remaining buffer, saves transcript, indexes into RAG
- `ws_clients: Set[WebSocket]` — all connected WebSocket clients receive every new `TranscriptEntry` as it is produced

### Request Flow for Live Audio

```
Browser (WebSocket)
    │  binary audio chunk (Int16 PCM or WebM/Opus)
    ▼
meeting.py  ws_audio()
    │  bytes_to_numpy() → float32
    ▼
MeetingSession.ingest()
    │  buffer until 8 seconds
    ▼
MeetingSession._process()  [runs in thread pool]
    ├── VAD  →  skip if silent
    ├── Diarization  →  [(start, end, SPEAKER_xx), ...]
    ├── for each segment:
    │   ├── STT  →  text, confidence, language
    │   ├── Speaker ID  →  named speaker / "Unknown"
    │   ├── TranscriptManager.add_entry()  →  persisted to disk
    │   └── save WAV clip to data/meetings/clips/{meeting_id}/{entry_id}.wav
    └── push entry to all ws_clients
```

---

## 6. AI Pipeline Deep-Dive

### Voice Activity Detection — Silero VAD (`modules/vad.py`)

- Model: `snakers4/silero-vad` loaded via `torch.hub`
- Runs on CUDA if available
- `has_speech()` returns True/False; used to skip silent 8-second windows
- `get_segments()` returns `[(start_sec, end_sec), ...]` speech regions
- Threshold: 0.4 (speech probability); min speech: 250 ms; min silence: 100 ms

### Speech-to-Text — faster-whisper (`modules/transcription.py`)

- Model: `large-v3` (configurable), CUDA + float16
- Input: float32 mono audio at 16 kHz
- **Audio normalisation**: RMS target = 0.1 (−20 dBFS), gain capped at 5× to help quiet/distant microphones without amplifying noise
- Language handling:
  - If `WHISPER_LANGUAGE` is set: always use that language
  - Otherwise: auto-detect among `WHISPER_ALLOWED_LANGUAGES` (default: en, ur)
  - If `WHISPER_FORCE_ENGLISH=True`: translate all output to English regardless of input language
- Key parameters that reduce hallucinations:
  - `condition_on_previous_text=False` — prevents cascade errors between segments
  - `vad_filter=True` with padding — double VAD layer inside Whisper
  - `no_speech_threshold`, `log_prob_threshold`, `compression_ratio_threshold`, `repetition_penalty` — all tuned to discard garbage output

### Speaker Diarization — pyannote (`modules/diarization.py`)

- Model: `pyannote/speaker-diarization-3.1` (requires HuggingFace token for download)
- Returns `[(start_sec, end_sec, "SPEAKER_xx"), ...]`
- **`max_speakers` is capped at the number of enrolled speakers at runtime** — prevents pyannote from hallucinating extra speakers when only one person is in the room
- Short segments are merged (`merge_short_segments`) to reduce fragmentation
- Segments shorter than 200 ms (0.2 s) are skipped entirely

### Speaker Identification — ECAPA-TDNN (`modules/speaker_id.py`)

- Model: `speechbrain/spkrec-ecapa-voxceleb`
- Enrollment stores up to `MAX_SAMPLES=5` embeddings per speaker; computed as a centroid for matching
- Identification uses cosine similarity against all centroids; threshold = 0.42 (below → "Unknown")
- **Audio normalisation before embedding**: same RMS normalisation as Whisper, ensuring far-mic audio is comparable to enrollment samples
- **`SpeakerTracker`**: per-meeting temporal consistency window (last 6 segments), applies additive boost (0.18) toward the most recent confirmed speaker — reduces label flipping on short segments
- Profiles persisted as JSON (embeddings) in `data/speaker_profiles/{name}.json`

#### Enroll vs Identify flow

```
Enroll:
  audio → _embed() → cosine centroid update → saved to disk

Identify:
  audio → _embed() → cosine similarity vs all centroids
        → SpeakerTracker.apply_boost()
        → if best_score > threshold → return name
        → else → return "Unknown"
```

### LLM — Ollama/Qwen2.5 (`modules/llm_processor.py`)

- Communicates with Ollama via HTTP (`httpx`, async)
- `LLM_NUM_CTX=32768` — the single most important setting; the default Ollama context window (2048) is far too small for meeting transcripts
- `LLM_TIMEOUT=600` — long-form generation can take 5–10 minutes on 14b models
- Transcripts longer than `LLM_CHUNK_CHARS=90000` are split, MoMs generated per-chunk, then merged
- Temperature = 0.1 for deterministic, factual output
- All prompts instruct the model to output **only valid JSON** (no markdown fences)

---

## 7. REST API Reference

Base URL: `http://localhost:8000`  
Interactive docs: `http://localhost:8000/docs`

### Meeting

| Method | Path | Description |
|---|---|---|
| `POST` | `/meeting/start` | Start a new meeting; returns `MeetingInfo` |
| `POST` | `/meeting/{id}/stop` | Stop recording; handles orphaned (disk-only) meetings |
| `PATCH` | `/meeting/{id}` | Update venue / chaired_by while recording |
| `POST` | `/meeting/{id}/agenda` | Set or update agenda items |
| `GET` | `/meeting/history` | List all meetings (live + historical) |
| `GET` | `/meeting/{id}` | Get meeting details |
| `POST` | `/meeting/generate_mom` | Generate MoM from transcript |
| `POST` | `/meeting/prepare_mom_draft` | Get editable draft points before final MoM |
| `GET` | `/meeting/{id}/mom` | Retrieve saved MoM |
| `GET` | `/meeting/{id}/action-items` | List action items |
| `PATCH` | `/meeting/{id}/action-items/{item_id}` | Toggle action item completion |
| `WS` | `/meeting/ws/audio/{id}` | Stream binary audio chunks to the server |

### Transcript

| Method | Path | Description |
|---|---|---|
| `GET` | `/transcript/{id}` | Full transcript for a meeting |
| `WS` | `/transcript/ws/{id}` | WebSocket: receive new entries live |
| `GET` | `/transcript/{id}/clip/{entry_id}` | Download WAV clip for one transcript entry |
| `POST` | `/transcript/{id}/correct` | Correct speaker label; optionally re-enroll from clip |

### Speaker

| Method | Path | Description |
|---|---|---|
| `POST` | `/speaker/enroll` | Upload one voice sample (multipart: `name` + `audio`) |
| `GET` | `/speaker/` | List enrolled speakers with sample counts |
| `DELETE` | `/speaker/{name}` | Remove a speaker profile |

### Analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/analytics/{id}` | Per-meeting analytics (speaking time, word count, equity score) |
| `GET` | `/analytics/cross` | Cross-meeting aggregate statistics |

### Chat / RAG

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat/query` | Semantic search across past meeting transcripts |
| `POST` | `/chat/handbook` | Q&A against the Faculty Handbook PDF |
| `GET` | `/chat/summary/{id}` | Get accumulated interval summaries for a live meeting |

### Export

| Method | Path | Description |
|---|---|---|
| `GET` | `/export/{id}/docx` | Download MoM as DOCX |
| `GET` | `/export/{id}/pdf` | Download MoM as PDF |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{status, models_loaded, version}` |

---

## 8. Frontend Architecture

### Stack

- **React 18** with functional components and hooks
- **Vite 5** for bundling and development server
- **framer-motion** for animations
- **recharts** for analytics charts
- **lucide-react** for icons
- Served by **nginx** in production (Docker)

### Key Files

| File | Role |
|---|---|
| `App.jsx` | Top-level router, `AppContext` (active meeting, navigate), `ToastContext` |
| `api.js` | Thin fetch wrapper; all requests go through `api.get/post/form/delete`. Base URL is proxied by nginx to `http://mom-api:8000` |
| `pages/ActiveMeeting.jsx` | Live transcript display, WebSocket connection, interval summary cards |
| `pages/MeetingDetail.jsx` | Historical meeting view, MoM display, draft editor, **speaker correction mode** |
| `pages/Speakers.jsx` | Speaker enrollment form (record + upload modes) |
| `pages/Analytics.jsx` | Charts for speaking time, word count, equity |
| `pages/Chat.jsx` | RAG chat interface |

### nginx Proxy

`frontend/nginx.conf` proxies `/` → static files and `/api` prefix is **not** used. All API paths (`/meeting`, `/transcript`, `/speaker`, etc.) are proxied directly through nginx to `mom-api:8000`. The `api.js` wrapper uses relative URLs (e.g. `/meeting/start`) which works transparently.

### State Management

No Redux or Zustand. State is local to each page component. Global shared state (only two things):
- `activeMeetingId` — stored in `AppContext`; survives page navigation
- Toast notifications — `ToastContext`

---

## 9. Data Storage

All data is stored as flat files under `data/`. There is no database.

### Per-meeting files

Every meeting creates three files in `data/meetings/`:

| File | Content |
|---|---|
| `{meeting_id}_meta.json` | Title, venue, chaired_by, start/end time, status, agenda, transcript_count |
| `{meeting_id}_transcript.json` | Array of `TranscriptEntry` objects |
| `{meeting_id}_mom.json` | Full `MoMDocument` object (after MoM generation) |

### Meeting status lifecycle

```
recording  →  stopped  →  (generate MoM)  →  completed
                                              ↑
                               status set when mom.json is saved
```

On server restart, any meta file still showing `recording` is auto-healed to `stopped` during `list_meetings()` (since the in-memory session no longer exists).

### Speaker profiles

Each enrolled speaker has one file: `data/speaker_profiles/{name}.json`

```json
{
  "name": "Dr. Ahmed Khan",
  "embeddings": [[0.12, -0.34, ...], ...],   // up to 5 vectors, dim=192
  "sample_count": 3
}
```

### Audio clips

Per-entry WAV files at `data/meetings/clips/{meeting_id}/{entry_id}.wav`.  
Written by the pipeline immediately after each transcript entry is created.  
Used by the speaker correction UI for audio playback and re-enrollment.

### RAG index

`data/rag_index.json` — chunk metadata  
`data/rag_embeddings.npy` — 384-dim sentence-transformer embeddings

---

## 10. Speaker Enrollment & Identification

### Enrollment

- Minimum 3 samples recommended; 5 is ideal
- Each sample must be ≥ 2 seconds of clean speech
- The speaker can say anything naturally — no scripted phrases
- Each call to `POST /speaker/enroll` adds one embedding; older ones are dropped when count exceeds 5
- Centroid (mean of all embeddings) is recomputed after every new sample

### Identification accuracy tips

1. **Record enrollment samples in conditions similar to actual meetings** — same room, same microphone distance
2. **Use the speaker correction feature** (see Section 13) to add real meeting audio to profiles; this is the best way to improve accuracy over time
3. If one person is consistently misidentified, lower `SPEAKER_ID_THRESHOLD` (e.g. to 0.38) and re-enroll with more samples
4. If too many "Unknown" labels appear, the threshold may be too high — try 0.38–0.45

### `max_speakers` capping

The pipeline caps pyannote's `max_speakers` at the number of enrolled speakers. If you have 3 enrolled speakers, pyannote will never produce a 4th label. This is the single most effective fix for "one person detected as multiple speakers" when the room has fewer people than the model's default maximum.

---

## 11. Transcript Quality & Tuning

### Audio normalisation

Before Whisper transcription, each audio segment's RMS is normalised to −20 dBFS with a maximum gain of 5×. This compensates for speakers sitting far from the microphone without dangerously amplifying background noise.

The same normalisation is applied before speaker embedding in `speaker_id.py`.

### Hallucination guards

`condition_on_previous_text=False` is the most impactful single setting — it prevents Whisper from carrying over errors from one segment to the next, which caused cascade hallucinations in earlier versions.

The four quality thresholds (`no_speech_threshold`, `log_prob_threshold`, `compression_ratio_threshold`, `repetition_penalty`) collectively filter out segments where Whisper is guessing or repeating itself.

### Language handling

When `WHISPER_LANGUAGE=None`, the module uses faster-whisper's language detection, constrained to `WHISPER_ALLOWED_LANGUAGES`. The detected language is stored per-entry in `TranscriptEntry.language`. When `WHISPER_FORCE_ENGLISH=True`, the Whisper `task` is set to `translate` for non-English audio, producing English output regardless of input language.

### Low-confidence entries

Entries with `confidence < WHISPER_LOW_CONF_THRESHOLD` (default: -0.85) are surfaced in the MoM draft review screen so a human can verify them before finalising.

---

## 12. MoM Generation

### Generation flow

1. User stops meeting → clicks "Prepare Draft" → `POST /meeting/prepare_mom_draft`  
   - LLM extracts bullet-point draft (agenda items, decisions, action items, attendees)
   - Low-confidence transcript entries are highlighted for human review
2. User edits the draft in the UI (add/remove/modify any field)
3. User clicks "Generate Final MoM" → `POST /meeting/generate_mom` with edited draft points
   - LLM generates the full structured JSON document guided by the draft
4. MoM saved to `{meeting_id}_mom.json`; meeting status → `completed`

### Interval summaries as context

When a live meeting has accumulated interval summaries (see Section 14), they are prepended to `additional_context` before the final MoM generation prompt. This gives the LLM a structured overview of the whole meeting even before reading the raw transcript.

### Long transcript handling

Transcripts exceeding `LLM_CHUNK_CHARS=90000` (~22k tokens) are split into overlapping chunks. Each chunk produces a partial MoM; results are merged by taking the union of decisions, action items, and discussion points, and concatenating overviews. The final conclusion is generated in a second LLM pass over the merged partial results.

---

## 13. Speaker Correction & Re-enrollment

This feature lets you fix speaker attribution errors after a meeting and simultaneously improve the voice profiles for future meetings.

### How it works

**During a meeting:** After every transcript entry is stored, the corresponding audio segment is saved as a WAV file at:
```
data/meetings/clips/{meeting_id}/{entry_id}.wav
```

**After the meeting:**  
1. Open the meeting in **Meeting History**
2. Click **"Correct Speakers"** (only shown for stopped/completed meetings with transcripts)
3. Each entry shows: current speaker label → name input (with autocomplete from enrolled speakers) + Play button + Save button
4. Click **Play** to hear the actual audio for that entry
5. Type or select the correct speaker name, click **Save**
6. The backend: (a) updates the speaker label in the transcript on disk, (b) loads the WAV clip, (c) enrolls it as a new voice sample for the named speaker

### API

```http
POST /transcript/{meeting_id}/correct
Content-Type: application/json

{
  "entry_id": "abc12345",
  "new_speaker": "Dr. Ahmed Khan",
  "enroll": true
}
```

Response:
```json
{ "status": "ok", "entry_id": "...", "new_speaker": "...", "enrolled": true }
```

`enrolled` is `false` if: (a) `enroll=false`, (b) no clip file exists, or (c) the clip is shorter than 1 second.

### Live vs historical meetings

The correction endpoint handles both:
- **Live session in memory**: updates `session.transcript` directly
- **Historical (disk only)**: loads a `TranscriptManager` from disk, updates, persists

---

## 14. Interval Summaries

During a live meeting, every `SUMMARY_INTERVAL=15` new transcript entries trigger an LLM summary of that window. This gives attendees real-time oversight of discussion themes without having to scroll through the raw transcript.

### Data structure

Each interval summary stored in `session.interval_summaries`:
```json
{
  "label": "0:00 – 2:15",
  "overview": "The committee discussed...",
  "decisions": ["Motion to approve budget passed", "..."],
  "action_items": ["Dean to submit report by Friday", "..."]
}
```

### Frontend display

`ActiveMeeting.jsx` polls `GET /chat/summary/{meeting_id}` every 30 seconds. Each interval is displayed as a card with a purple left border, ordered chronologically. Decisions and action items are shown as bullet lists.

### Triggering

The pipeline calls `generate_live_summary()` inside `_process()` after every batch of entries. If fewer than 15 new entries have arrived since the last summary, the function is a no-op (returns existing intervals immediately). This means summaries never duplicate.

---

## 15. RAG — Semantic Search over Meetings

### Meeting transcript RAG

- Model: `all-MiniLM-L6-v2` (22 MB, 384-dim embeddings)
- Index stored in `data/rag_index.json` + `data/rag_embeddings.npy`
- Meetings are indexed into 200-word chunks when stopped
- Query: cosine similarity, top-k results above threshold 0.25
- Endpoint: `POST /chat/query` with `{ "query": "...", "meeting_id": null }` (or specify a meeting)

### Faculty Handbook RAG

- Same model and mechanism, but indexes the Faculty Handbook PDF
- Separate index (`data/handbook_index.json`)
- Auto-indexed on startup if the PDF changes (hash comparison)
- Endpoint: `POST /chat/handbook`

---

## 16. Analytics

### Per-meeting

`GET /analytics/{meeting_id}` returns:
- Per-speaker: speaking time (s), word count, segment count, % of time, % of words, speaking rate (wpm), average turn duration
- Participation equity score (1 − Gini coefficient): 1.0 = perfectly balanced, 0.0 = one person monopolises
- Silence percentage (time with no speaker detected)
- Full timeline of speaker turns

### Cross-meeting

`GET /analytics/cross` aggregates across all completed meetings: total meetings per speaker, total speaking time, average participation share.

---

## 17. Export (DOCX / PDF)

### DOCX

Generated with `python-docx`. If `data/templates/official_mom_header.docx` exists, it is used as a template (providing the institutional letterhead). Dynamic fields in the template (e.g. `{{DATE}}`, `{{VENUE}}`) are replaced at generation time. If the template is missing or corrupt, a clean document is generated programmatically.

### PDF

Generated with `reportlab`. Embeds the full MoM with headings, tables for attendees and action items, and a footer.

Both files are cached in `data/exports/`. Re-downloading regenerates the file.

---

## 18. Common Development Tasks

### Add a new API endpoint

1. Create or edit the relevant route file in `app/api/routes/`
2. Add Pydantic schemas to `app/models/schemas.py` if needed
3. Register the router in `app/main.py` if it's a new file
4. Rebuild: `docker compose build mom-api && docker compose up -d mom-api`

### Add a new frontend page

1. Create `frontend/src/pages/MyPage.jsx`
2. Add a route case in `App.jsx` switch statement
3. Add a nav link in `Layout.jsx`
4. Rebuild: `docker compose build frontend && docker compose up -d frontend`

### Change the LLM model

```dotenv
# .env
LLM_MODEL=llama3.1:8b
```

Then re-pull: `docker compose up ollama-init`. The `ollama-init` container exits after pulling. Then restart the API.

### Wipe and re-enroll all speakers

```bash
docker compose exec mom-api bash
rm -rf /app/data/speaker_profiles/*
```

Then re-enroll from the Speakers page.

### Re-index RAG after adding historical transcripts

The RAG is indexed automatically when `stop_meeting()` is called. To re-index everything from scratch:

```bash
docker compose exec mom-api python -c "
from app.modules.rag import rag_module
from app.modules.transcript_manager import TranscriptManager
from app.config import settings
import json
for f in settings.MEETINGS_DIR.glob('*_meta.json'):
    meta = json.loads(f.read_text())
    mid = meta['meeting_id']
    tm = TranscriptManager(mid)
    rag_module.index_meeting(mid, meta['title'], tm.get_speaker_turns())
print('Done')
"
```

### Check GPU usage

```bash
docker compose exec mom-api nvidia-smi
```

### Read server logs

```bash
docker compose logs -f mom-api          # live stdout logs
cat data/server.log                     # full log including DEBUG level
```

---

## 19. Known Issues & Fixes

### "Meeting not found" when clicking Stop

**Cause:** The API container was restarted while a meeting was recording. In-memory sessions were lost; the meta file on disk still says `status: recording`.

**Fix (implemented):** 
- `list_meetings()` now auto-heals stale `recording` meta files to `stopped` on the next list call
- `stop_meeting()` now handles disk-only meetings without a 404

If you still have a stuck meeting after upgrading, open Meeting History — it will appear there with `stopped` status on the next page load.

### One speaker detected as multiple speakers

**Cause:** pyannote's `max_speakers` was too high, so it split one voice into multiple clusters.

**Fix (implemented):** `max_speakers` is now capped at the enrolled speaker count at runtime. Re-enroll with more samples if accuracy is still poor.

### Transcript quality degraded (hallucinations, repetitions)

**Immediate fix:** Enable `condition_on_previous_text=False` (already default).

**If problem persists:**
- Increase `WHISPER_REPETITION_PENALTY` to 1.3–1.5
- Lower `WHISPER_COMPRESSION_RATIO_THRESHOLD` to 2.2
- Check that audio RMS normalisation is working (add `logger.debug` around `_normalize_audio`)

### LLM timeout

If MoM generation times out, increase `LLM_TIMEOUT` in `.env`. For very long meetings (>3 hours), also consider increasing `LLM_NUM_CTX` beyond 32768 — check that the Ollama model supports the context size.

### Frontend shows blank page after rebuild

Usually a Vite cache issue. Run:
```bash
docker compose exec frontend rm -rf /app/.vite
docker compose restart frontend
```

### Audio clips not saving

If `data/meetings/clips/` is missing or has wrong permissions:
```bash
docker compose exec mom-api mkdir -p /app/data/meetings/clips
docker compose exec mom-api chmod 777 /app/data/meetings/clips
```

---

## 20. Tuning Cheat-Sheet

| Problem | What to change |
|---|---|
| Too many "Unknown" speakers | Lower `SPEAKER_ID_THRESHOLD` (e.g. 0.38); add more enrollment samples |
| Too many wrong speaker labels | Use speaker correction → re-enrollment after each meeting |
| One person split into N speakers | Ensure `DIARIZATION_MAX_SPEAKERS` ≤ enrolled count; already auto-capped |
| Repetitive / hallucinated transcript | Raise `WHISPER_REPETITION_PENALTY`; lower `WHISPER_COMPRESSION_RATIO_THRESHOLD` |
| Silent segments transcribed as noise | Lower `WHISPER_NO_SPEECH_THRESHOLD` (e.g. 0.4) |
| Short confident segments dropped | Raise `WHISPER_LOG_PROB_THRESHOLD` (e.g. -1.5) |
| Quiet speaker not transcribed | Increase audio RMS target in `transcription.py` `_TARGET_RMS` (e.g. 0.15) |
| MoM generation too slow | Use a smaller model (e.g. `qwen2.5:7b`) or reduce `LLM_NUM_CTX` |
| MoM cuts off mid-document | Increase `LLM_MAX_TOKENS` or `LLM_CHUNK_CHARS` |
| Interval summaries never trigger | Lower `SUMMARY_INTERVAL` in `pipeline.py` (default: 15 entries) |
| Speaker correction clips missing | Check `CLIPS_DIR` path and disk space |

---

*End of Developer Handbook*
