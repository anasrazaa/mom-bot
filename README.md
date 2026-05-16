# GIK Faculty Meeting MoM Assistant

Production-grade, fully offline AI system for automatic Faculty Meeting Minutes of Meeting (MoM) generation. Built for GIK Institute's NVIDIA V100 GPU server.

## Architecture

```
Audio Input (WebSocket / File Upload)
         │
         ▼
  Voice Activity Detection  (Silero VAD)
         │
         ▼
  Speaker Diarization       (pyannote.audio 3.x)
         │
         ▼
  Speech-to-Text            (faster-whisper large-v3 – Urdu + English)
         │
         ▼
  Speaker Identification    (SpeechBrain ECAPA-TDNN)
         │
         ▼
  Transcript Store          (JSON, per-meeting)
         │
         ▼
  LLM Processing            (Qwen2.5-14B via Ollama)
         │
         ▼
  MoM Generator             (structured JSON → formal document)
         │
         ▼
  Export                    (DOCX + PDF)
```

## Project Structure

```
mom_bot/
├── app/
│   ├── main.py                     # FastAPI entry point
│   ├── config.py                   # All settings (env-driven)
│   ├── models/schemas.py           # Pydantic models
│   ├── modules/
│   │   ├── vad.py                  # Silero VAD
│   │   ├── transcription.py        # faster-whisper STT
│   │   ├── diarization.py          # pyannote diarization
│   │   ├── speaker_id.py           # ECAPA-TDNN enrollment + ID
│   │   ├── transcript_manager.py   # Transcript persistence
│   │   ├── llm_processor.py        # Ollama LLM interface
│   │   ├── mom_generator.py        # MoM document assembly
│   │   ├── export_module.py        # DOCX + PDF generation
│   │   └── pipeline.py             # End-to-end orchestrator
│   ├── api/routes/
│   │   ├── meeting.py              # Meeting lifecycle + audio WS
│   │   ├── transcript.py           # Transcript REST + WS
│   │   ├── speaker.py              # Speaker enrollment
│   │   └── export.py               # File download
│   └── utils/helpers.py
├── data/                           # Runtime data (mounted volume)
│   ├── meetings/                   # Per-meeting JSON transcripts + MoM
│   ├── speaker_profiles/           # Enrolled speaker embeddings
│   └── exports/                    # Generated DOCX + PDF files
├── models/                         # Downloaded AI models (mounted volume)
├── scripts/
│   ├── download_models.sh          # One-time model download
│   └── setup_ollama.sh             # Pull LLM into Ollama
├── docker/init_ollama.sh
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## Quick Start (Docker – recommended)

### Prerequisites
- NVIDIA Docker runtime (`nvidia-container-toolkit`)
- Docker Compose v2
- GPU server with ≥ 40 GB VRAM (V100 64 GB recommended)

### Step 1 – Configure

```bash
cp .env.example .env
# Edit .env:
#   PYANNOTE_HF_TOKEN=hf_xxxx   ← required for first model download
#   LLM_MODEL=qwen2.5:14b
```

### Step 2 – Start services

```bash
docker compose up -d ollama         # start LLM backend first
docker compose run --rm ollama-init # pull LLM model (≈8 GB, one-time)
docker compose up -d mom-api        # start API server
```

### Step 3 – Download AI models (one-time)

```bash
# Inside the running container:
docker exec -it mom_api bash
source .env && bash scripts/download_models.sh
exit
```

### Step 4 – Verify

```bash
curl http://localhost:8000/health
# → {"status":"ok","models_loaded":true,"ollama_ready":true,...}

# Open interactive API docs:
open http://localhost:8000/docs
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/meeting/start` | Start a new meeting session |
| `POST` | `/meeting/{id}/stop` | Stop recording |
| `POST` | `/meeting/{id}/upload_audio` | Upload pre-recorded audio file |
| `POST` | `/meeting/generate_mom` | Run LLM → generate MoM |
| `GET`  | `/meeting/{id}` | Get meeting info |
| `GET`  | `/meeting/history` | List all meetings |
| `GET`  | `/transcript/{id}` | Get full transcript |
| `WS`   | `/meeting/ws/audio/{id}` | Stream audio → server (client mic) |
| `WS`   | `/transcript/ws/{id}` | Receive live transcript |
| `POST` | `/speaker/enroll` | Enroll a faculty member's voice |
| `GET`  | `/speaker/` | List enrolled speakers |
| `DELETE` | `/speaker/{name}` | Remove speaker profile |
| `GET`  | `/export/{id}/docx` | Download DOCX |
| `GET`  | `/export/{id}/pdf` | Download PDF |
| `GET`  | `/health` | System health check |

---

## Example Workflow

### 1. Start meeting

```bash
curl -X POST http://localhost:8000/meeting/start \
  -H "Content-Type: application/json" \
  -d '{"title":"Faculty Senate – May 2025","venue":"Boardroom, Admin Block"}'
# → {"meeting_id": "abc-123", "status": "recording", ...}
```

### 2. Upload recorded audio

```bash
curl -X POST "http://localhost:8000/meeting/abc-123/upload_audio" \
  -F "file=@meeting_recording.wav"
```

### 3. Stop meeting

```bash
curl -X POST http://localhost:8000/meeting/abc-123/stop
```

### 4. Generate MoM

```bash
curl -X POST http://localhost:8000/meeting/generate_mom \
  -H "Content-Type: application/json" \
  -d '{"meeting_id": "abc-123"}'
```

### 5. Download documents

```bash
curl -O http://localhost:8000/export/abc-123/docx
curl -O http://localhost:8000/export/abc-123/pdf
```

---

## Speaker Enrollment

```bash
curl -X POST http://localhost:8000/speaker/enroll \
  -F "name=Prof. Dr. Ahmed Khan" \
  -F "audio=@prof_ahmed_voice.wav"
```

Once enrolled, the speaker's name replaces generic "SPEAKER_00" labels in transcripts.

---

## Sample MoM Output (DOCX section)

```
GHULAM ISHAQ KHAN INSTITUTE
OF ENGINEERING SCIENCES AND TECHNOLOGY
         MINUTES OF MEETING
─────────────────────────────────────

Meeting Title │ Faculty Senate – May 2025
Date          │ 16 May 2025
Time          │ 10:00 AM
Venue         │ Boardroom, Admin Block
Chaired By    │ Prof. Dr. Rector

1. ATTENDEES
   • Prof. Dr. Ahmed Khan
   • Dr. Sarah Malik
   • Dr. Usman Tariq

2. AGENDA
   1. Review of semester calendar
   2. Faculty promotion cases
   3. Research grant applications

3. DISCUSSION SUMMARY
   Semester Calendar: The committee reviewed the proposed academic calendar...

4. DECISIONS TAKEN
   1. Semester to begin on 5 September 2025  (Approved by: Rector)
   2. Three promotion cases approved          (Approved by: Faculty Committee)

5. ACTION ITEMS
   ┌────────────────────────────┬─────────────────┬───────────────┐
   │ Action Item                │ Responsible     │ Deadline      │
   ├────────────────────────────┼─────────────────┼───────────────┤
   │ Update official calendar   │ Registrar Office│ 25 May 2025   │
   │ Notify promoted faculty    │ HR Department   │ 20 May 2025   │
   └────────────────────────────┴─────────────────┴───────────────┘

6. NEXT MEETING
   15 June 2025, 10:00 AM – Boardroom

7. CLOSING REMARKS
   The meeting was concluded with a vote of thanks to the chair.
```

---

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Transcription latency | < 10 sec | Per 8-sec audio chunk |
| Speaker diarization accuracy | > 85% | With 2–8 speakers |
| STT word error rate | < 10% | For clear audio; higher for code-switching |
| MoM generation time | < 2 min | After meeting stop |
| End-to-end pipeline | Fully offline | No external API calls |

---

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| GPU | V100 32 GB | V100 64 GB |
| RAM | 32 GB | 64 GB |
| Storage | 50 GB | 100 GB |
| OS | Ubuntu 20.04+ | Ubuntu 22.04 |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_MODEL` | `qwen2.5:14b` | Ollama model tag |
| `OLLAMA_BASE_URL` | `http://ollama:11434` | Ollama service URL |
| `PYANNOTE_HF_TOKEN` | *(empty)* | HuggingFace token (first download only) |
| `WHISPER_MODEL` | `large-v3` | Whisper model size |
| `WHISPER_COMPUTE_TYPE` | `float16` | `float16` for GPU, `int8` for CPU |
| `SPEAKER_ID_THRESHOLD` | `0.75` | Cosine similarity threshold |
| `CHUNK_DURATION` | `8.0` | Audio chunk size (seconds) |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` |

---

## Troubleshooting

**Models not loading:**
```bash
docker logs mom_api | grep -E "ERROR|WARN"
# Re-run: bash scripts/download_models.sh
```

**Pyannote download fails:**
```bash
# Ensure PYANNOTE_HF_TOKEN is set and you accepted model terms at:
# https://huggingface.co/pyannote/speaker-diarization-3.1
```

**Ollama out of memory:**
```bash
# Use a smaller model:
LLM_MODEL=qwen2.5:7b docker compose up -d
```

**Audio quality issues:**
- Use a directional microphone or USB conference mic
- Ensure sample rate is 16 kHz or higher
- Minimize background noise for better diarization
