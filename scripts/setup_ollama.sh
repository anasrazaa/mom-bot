#!/usr/bin/env bash
# =============================================================================
# setup_ollama.sh
# Pulls the LLM model into the running Ollama instance.
# Run AFTER `docker compose up ollama` is healthy.
# =============================================================================
set -e

OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
MODEL="${LLM_MODEL:-qwen2.5:14b}"

GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC}  $*"; }

info "Waiting for Ollama at ${OLLAMA_HOST}..."
until curl -sf "${OLLAMA_HOST}/api/tags" > /dev/null; do
    sleep 2
done
info "Ollama is ready"

info "Pulling model: ${MODEL}"
curl -X POST "${OLLAMA_HOST}/api/pull" \
     -H "Content-Type: application/json" \
     -d "{\"name\": \"${MODEL}\"}" \
     --no-buffer | while IFS= read -r line; do
         status=$(echo "$line" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || true)
         [ -n "$status" ] && echo "  $status"
     done

info "Model '${MODEL}' is ready"
info "You can test it with:"
info "  curl ${OLLAMA_HOST}/api/generate -d '{\"model\":\"${MODEL}\",\"prompt\":\"Hello\",\"stream\":false}'"
