#!/usr/bin/env bash
# Start Cerebro RAG daemon (and optional companions) for the MCP server.
# Usage: ./scripts/start-daemons.sh [--build] [--profile pgvector|qdrant]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD=""
PROFILE_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --build) BUILD="--build" ;;
    --profile=*) PROFILE_ARGS+=(--profile "${arg#--profile=}") ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

cd "$ROOT"

echo "Starting Cerebro RAG daemon..."
docker compose "${PROFILE_ARGS[@]}" up -d $BUILD cerebro

echo ""
echo "Waiting for Cerebro health check..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:"${CEREBRO_PORT:-8009}"/health >/dev/null 2>&1; then
    echo "Cerebro is healthy at http://localhost:${CEREBRO_PORT:-8009}"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Cerebro did not become healthy in 90s — check: docker compose logs cerebro"
    exit 1
  fi
  sleep 3
done

echo ""
echo "MCP tools available: cerebro_rag_query, cerebro_rag_ingest, cerebro_rag_status, cerebro_rag_benchmark"
