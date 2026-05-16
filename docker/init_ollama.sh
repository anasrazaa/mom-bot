#!/usr/bin/env sh
# =============================================================================
# docker/init_ollama.sh
# Entrypoint helper for the ollama-init container.
# Waits for Ollama health then pulls the configured model.
# =============================================================================
set -e

MODEL="${LLM_MODEL:-qwen2.5:14b}"
OLLAMA_HOST="${OLLAMA_HOST:-http://ollama:11434}"

echo "[init] Waiting for Ollama at ${OLLAMA_HOST} ..."
until curl -sf "${OLLAMA_HOST}/api/tags" > /dev/null 2>&1; do
    sleep 3
done
echo "[init] Ollama is up"

echo "[init] Pulling model: ${MODEL}"
ollama pull "${MODEL}"
echo "[init] Done – model '${MODEL}' is ready"
