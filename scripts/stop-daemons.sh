#!/usr/bin/env bash
# Stop Cerebro RAG daemon gracefully.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"

echo "Stopping Cerebro RAG daemon..."
docker compose down

echo "Stopped."
