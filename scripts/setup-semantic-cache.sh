#!/usr/bin/env bash
#
# Setup Script for Semantic Cache
# Configures directories, environment, and verifies llama.cpp daemon
#

set -euo pipefail

echo "🚀 SecureLLM-MCP Semantic Cache Setup"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Directories
CACHE_DIR="${HOME}/.local/share/securellm"
CACHE_DB="${CACHE_DIR}/semantic_cache.db"
ENV_FILE=".env"

# 1. Create cache directory
echo "📁 Creating cache directory..."
mkdir -p "${CACHE_DIR}"
echo "   Created: ${CACHE_DIR}"

# 2. Check llama.cpp daemon
echo ""
echo "🔍 Checking llama.cpp daemon..."
LLAMA_URL="${LLAMA_CPP_URL:-http://localhost:8080}"

if curl -s -f "${LLAMA_URL}/health" > /dev/null 2>&1; then
  echo -e "   ${GREEN}✓${NC} llama.cpp daemon is running at ${LLAMA_URL}"
else
  echo -e "   ${RED}✗${NC} llama.cpp daemon NOT running at ${LLAMA_URL}"
  echo ""
  echo "   To start llama.cpp daemon:"
  echo "   systemctl --user start llama-cpp"
  echo "   OR"
  echo "   llama-server --host 0.0.0.0 --port 8080 --model <your-model.gguf>"
  echo ""
  read -p "   Continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "   Exiting. Please start llama.cpp daemon and try again."
    exit 1
  fi
fi

# 3. Check/create .env file
echo ""
echo "⚙️  Configuring environment variables..."

if [ -f "${ENV_FILE}" ]; then
  echo "   Found existing .env file"

  # Check if semantic cache vars exist
  if grep -q "ENABLE_SEMANTIC_CACHE" "${ENV_FILE}"; then
    echo -e "   ${YELLOW}⚠${NC}  Semantic cache variables already exist in .env"
    read -p "   Overwrite? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      # Remove existing semantic cache config
      sed -i '/# Semantic Cache/,/^$/d' "${ENV_FILE}"
      echo "   Removed old configuration"
    else
      echo "   Keeping existing configuration"
      echo ""
      echo -e "${GREEN}✓${NC} Setup complete!"
      echo ""
      echo "Next steps:"
      echo "1. Apply integration changes from docs/SEMANTIC_CACHE_INTEGRATION.md"
      echo "2. Run: npm run build"
      echo "3. Start server: node dist/index.js"
      exit 0
    fi
  fi
else
  echo "   Creating new .env file"
  touch "${ENV_FILE}"
fi

# Add semantic cache configuration
cat >> "${ENV_FILE}" << EOF

# Semantic Cache Configuration
ENABLE_SEMANTIC_CACHE=true
SEMANTIC_CACHE_THRESHOLD=0.85
SEMANTIC_CACHE_TTL=3600
SEMANTIC_CACHE_MAX_ENTRIES=1000
SEMANTIC_CACHE_MIN_QUERY_LENGTH=10
SEMANTIC_CACHE_DB_PATH=${CACHE_DB}
LLAMA_CPP_URL=${LLAMA_URL}
EMBEDDING_TIMEOUT=5000
SEMANTIC_CACHE_EXCLUDE_TOOLS=

EOF

echo -e "   ${GREEN}✓${NC} Added semantic cache configuration to .env"

# 4. Test llama.cpp embedding generation
echo ""
echo "🧪 Testing llama.cpp embedding generation..."

TEST_RESPONSE=$(curl -s -X POST "${LLAMA_URL}/embedding" \
  -H "Content-Type: application/json" \
  -d '{"content":"test"}' 2>&1 || true)

if echo "${TEST_RESPONSE}" | grep -q "embedding"; then
  EMBEDDING_DIM=$(echo "${TEST_RESPONSE}" | grep -o '"embedding":\[[^]]*\]' | grep -o ',' | wc -l)
  EMBEDDING_DIM=$((EMBEDDING_DIM + 1))
  echo -e "   ${GREEN}✓${NC} Embedding generation works (dimension: ${EMBEDDING_DIM})"
else
  echo -e "   ${RED}✗${NC} Embedding generation failed"
  echo "   Response: ${TEST_RESPONSE}"
  echo ""
  echo "   This may still work with fallback embeddings, but won't be as accurate."
fi

# 5. Show summary
echo ""
echo "======================================"
echo -e "${GREEN}✓${NC} Setup Complete!"
echo "======================================"
echo ""
echo "Configuration:"
echo "  Cache Directory: ${CACHE_DIR}"
echo "  Cache Database:  ${CACHE_DB}"
echo "  llama.cpp URL:   ${LLAMA_URL}"
echo ""
echo "Next steps:"
echo "  1. Apply integration changes from docs/SEMANTIC_CACHE_INTEGRATION.md"
echo "  2. Build project: npm run build"
echo "  3. Start server:  node dist/index.js"
echo ""
echo "To verify cache is working:"
echo "  - Make tool calls and check logs for 'Semantic cache HIT/MISS'"
echo "  - Read metrics: metrics://semantic-cache"
echo ""
echo "Expected savings: 50-70% reduction in duplicate tool calls"
echo ""
