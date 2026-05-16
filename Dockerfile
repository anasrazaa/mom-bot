# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Base CUDA image
# ─────────────────────────────────────────────────────────────────────────────
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# ─────────────────────────────────────────────────────────────────────────────
# System dependencies
# ─────────────────────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip \
    ffmpeg libsndfile1 libsndfile1-dev \
    portaudio19-dev libportaudio2 \
    git wget curl ca-certificates \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf python3.11 /usr/bin/python3 \
    && ln -sf python3 /usr/bin/python

# ─────────────────────────────────────────────────────────────────────────────
# Python packages
# ─────────────────────────────────────────────────────────────────────────────
WORKDIR /app

# Install PyTorch with CUDA 12.1 first (separate step for Docker cache)
RUN pip install --upgrade pip && \
    pip install torch==2.3.0 torchaudio==2.3.0 --index-url https://download.pytorch.org/whl/cu121

COPY requirements.txt .
# Install remaining deps (torch already installed, pip will skip it)
RUN pip install --no-deps faster-whisper==1.0.3 && \
    pip install $(grep -v "^torch\|^torchaudio\|^#\|^$" requirements.txt | tr '\n' ' ')

# ─────────────────────────────────────────────────────────────────────────────
# Application code
# ─────────────────────────────────────────────────────────────────────────────
COPY . .

# Pre-create data dirs inside image (volumes will overlay at runtime)
RUN mkdir -p data/meetings data/speaker_profiles data/exports models

# ─────────────────────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────────────────────
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
