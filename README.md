# GIK Faculty Meeting MoM Assistant

AI system for faculty meeting recording, transcription, live meeting intelligence, and Minutes of Meeting (MoM) generation. Stack: React frontend, FastAPI backend, Ollama LLM, and optional Cloudflare Tunnel exposure.

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
  Draft Review Layer        (editable MoM points + low-confidence highlights)
         │
         ▼
  LLM Processing            (Qwen2.5-14B via Ollama)
         │
         ▼
  MoM Generator             (structured JSON → formal document)
         │
         ├── Live Summary + Action Item Extraction
         │
         └── RAG Chat over meeting history (optional meeting-scoped retrieval)
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
│   │   ├── meeting.py              # Meeting lifecycle + audio WS + MoM draft/finalization
│   │   ├── transcript.py           # Transcript REST + WS
│   │   ├── chat.py                 # RAG chat, live summary, prep brief
│   │   ├── analytics.py            # Meeting analytics
│   │   ├── speaker.py              # Speaker enrollment
│   │   └── export.py               # File download
│   └── utils/helpers.py
├── data/                           # Runtime data (mounted volume)
│   ├── meetings/                   # Per-meeting JSON transcripts + MoM
│   ├── speaker_profiles/           # Enrolled speaker embeddings
│   ├── exports/                    # Generated DOCX + PDF files
│   └── templates/                  # DOCX templates (e.g., official MoM header)
├── models/                         # Downloaded AI models (mounted volume)
├── frontend/                       # React + Vite + nginx SPA
├── scripts/
│   ├── download_models.sh          # One-time model download
│   └── setup_ollama.sh             # Pull LLM into Ollama
├── docker/init_ollama.sh
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

## Quick Start (Docker)

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
docker compose up -d frontend       # start web UI (nginx on :80)
```

### Step 3 – Download AI models (one-time)

```bash
# Inside the running container:
docker exec -it mom_api bash
source .env && bash scripts/download_models.sh
exit
```

### Step 3.5 – Add official DOCX header template (optional, recommended)

Place your institutional MoM header template at:

```bash
data/templates/official_mom_header.docx
```

If present, DOCX exports use this template as the base (header/footer/body/styles) and append generated MoM content after the template content.

If the template includes text fields, use placeholders to keep values dynamic per meeting:

```text
{{MEETING_TITLE}} {{DATE}} {{TIME}} {{VENUE}} {{CHAIRED_BY}}
```

### Step 4 – Verify

```bash
curl http://localhost:8000/health
# → {"status":"ok","models_loaded":true,"ollama_ready":true,...}

# API docs: http://localhost:8000/docs
# Web app:  http://localhost
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/meeting/start` | Start a new meeting session |
| `POST` | `/meeting/{id}/stop` | Stop recording |
| `POST` | `/meeting/{id}/upload_audio` | Upload pre-recorded audio file |
| `POST` | `/meeting/prepare_mom_draft` | Generate editable MoM draft points |
| `POST` | `/meeting/generate_mom` | Run LLM → generate MoM |
| `GET`  | `/meeting/{id}` | Get meeting info |
| `GET`  | `/meeting/history` | List all meetings |
| `GET`  | `/meeting/{id}/action-items` | Get action items |
| `PATCH`| `/meeting/{id}/action-items/{item_id}` | Toggle action item completion |
| `GET`  | `/transcript/{id}` | Get full transcript |
| `WS`   | `/meeting/ws/audio/{id}` | Stream audio → server (client mic) |
| `WS`   | `/transcript/ws/{id}` | Receive live transcript |
| `POST` | `/chat/message` | RAG Q&A over meeting history |
| `POST` | `/chat/prepare` | Pre-meeting prep brief from prior records |
| `GET`  | `/chat/summary/{meeting_id}` | Live/cached summary for a meeting |
| `GET`  | `/chat/indexed` | List meeting IDs indexed for RAG |
| `GET`  | `/analytics/overview` | Analytics summary |
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
| `WHISPER_LANGUAGE` | *(empty)* | Force one input language (`en` or `ur`) |
| `WHISPER_ALLOWED_LANGUAGES` | `en,ur` | Candidate languages if auto mode is used |
| `WHISPER_FORCE_ENGLISH` | `true` | Force transcript text output in English |
| `WHISPER_COMPUTE_TYPE` | `float16` | `float16` for GPU, `int8` for CPU |
| `SPEAKER_ID_THRESHOLD` | `0.50` | Cosine similarity threshold |
| `CHUNK_DURATION` | `8.0` | Audio chunk size (seconds) |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARNING` |
| `MOM_DOCX_TEMPLATE_PATH` | `data/templates/official_mom_header.docx` | DOCX template path for official MoM header/footer |

---

## Public Access via Cloudflare Tunnel (Custom Domain)

Use this if inbound ports are blocked by campus/network firewall.

1. Install and login:

```bash
cloudflared tunnel login
cloudflared tunnel create mom-bot
```

2. Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /etc/cloudflared/<TUNNEL_ID>.json

ingress:
       - hostname: mom.your-domain.com
              service: http://127.0.0.1:80
       - service: http_status:404
```

3. Route DNS and run service:

```bash
cloudflared tunnel route dns mom-bot mom.your-domain.com
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
```

4. Verify:

```bash
cloudflared tunnel info mom-bot
curl -I https://mom.your-domain.com
```

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
