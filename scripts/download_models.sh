#!/usr/bin/env bash
# =============================================================================
# download_models.sh
# Downloads all AI models that require a one-time network fetch.
# After this script runs, the system operates fully offline.
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODELS_DIR="${SCRIPT_DIR}/../models"
mkdir -p "${MODELS_DIR}"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 1. faster-whisper (large-v3) ──────────────────────────────────────────────
info "Downloading Whisper large-v3 model..."
python3 - <<'PYEOF'
from huggingface_hub import snapshot_download
import os
snapshot_download(
    repo_id="Systran/faster-whisper-large-v3",
    local_dir=os.path.join(os.environ.get("MODELS_DIR", "models"), "whisper", "large-v3"),
    ignore_patterns=["*.msgpack", "*.h5", "flax_model*", "tf_model*"],
)
print("✓ Whisper large-v3 downloaded")
PYEOF

# ── 2. pyannote speaker-diarization-3.1 ──────────────────────────────────────
if [ -z "${PYANNOTE_HF_TOKEN}" ]; then
    warn "PYANNOTE_HF_TOKEN is not set. Skipping pyannote download."
    warn "Set it in .env and re-run this script to download pyannote models."
else
    info "Downloading pyannote speaker-diarization-3.1..."
    python3 - <<PYEOF
from pyannote.audio import Pipeline
import torch, os
pipe = Pipeline.from_pretrained(
    "pyannote/speaker-diarization-3.1",
    use_auth_token="${PYANNOTE_HF_TOKEN}",
    cache_dir=os.path.join("${MODELS_DIR}", "pyannote"),
)
print("✓ Pyannote diarization downloaded")
PYEOF
fi

# ── 3. SpeechBrain ECAPA-TDNN ─────────────────────────────────────────────────
info "Downloading SpeechBrain ECAPA-TDNN speaker model..."
python3 - <<PYEOF
from speechbrain.pretrained import SpeakerRecognition
import os
SpeakerRecognition.from_hparams(
    source="speechbrain/spkrec-ecapa-voxceleb",
    savedir=os.path.join("${MODELS_DIR}", "speechbrain"),
)
print("✓ SpeechBrain ECAPA-TDNN downloaded")
PYEOF

# ── 4. Silero VAD (auto-downloaded by torch.hub at first run) ─────────────────
info "Pre-fetching Silero VAD..."
python3 - <<'PYEOF'
import torch
model, _ = torch.hub.load("snakers4/silero-vad", "silero_vad", trust_repo=True)
print("✓ Silero VAD ready")
PYEOF

info "======================================"
info " All models downloaded successfully! "
info "======================================"
