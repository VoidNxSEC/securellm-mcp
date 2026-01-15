#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SecureLLM MCP Portfolio Mode Enablement Script
# ==============================================================================
# Purpose: Automate the setup of enterprise-grade CI/CD and documentation
# Usage: ./scripts/enable-portfolio-mode.sh
# ==============================================================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SecureLLM MCP - Portfolio Transformation Setup           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ==============================================================================
# Step 1: Verify Prerequisites
# ==============================================================================

echo -e "${BLUE}[1/7]${NC} Verifying prerequisites..."

# Check for required tools
REQUIRED_TOOLS=("git" "node" "npm" "jq")
for tool in "${REQUIRED_TOOLS[@]}"; do
    if ! command -v "$tool" &> /dev/null; then
        echo -e "${RED}✗${NC} Required tool not found: $tool"
        exit 1
    fi
done

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}✗${NC} Not a git repository. Please run from repository root."
    exit 1
fi

# Check if we're on the right branch
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "develop" ]]; then
    echo -e "${YELLOW}⚠${NC}  Warning: Not on main/develop branch (current: $CURRENT_BRANCH)"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${GREEN}✓${NC} Prerequisites verified"
echo ""

# ==============================================================================
# Step 2: Backup Current README
# ==============================================================================

echo -e "${BLUE}[2/7]${NC} Creating backups..."

if [ -f README.md ]; then
    cp README.md README.md.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}✓${NC} README.md backed up"
else
    echo -e "${YELLOW}⚠${NC}  README.md not found, skipping backup"
fi

echo ""

# ==============================================================================
# Step 3: Create Configuration Files
# ==============================================================================

echo -e "${BLUE}[3/7]${NC} Creating configuration files..."

# Create .codecov.yml
cat > .codecov.yml <<'EOF'
coverage:
  status:
    project:
      default:
        target: 85%
        threshold: 2%
    patch:
      default:
        target: 80%

comment:
  layout: "reach,diff,flags,tree"
  behavior: default
  require_changes: false

github_checks:
  annotations: true
EOF
echo -e "${GREEN}✓${NC} Created .codecov.yml"

# Create .github/dependabot.yml
mkdir -p .github
cat > .github/dependabot.yml <<'EOF'
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "automated"

  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "dependencies"
      - "ci/cd"
EOF
echo -e "${GREEN}✓${NC} Created .github/dependabot.yml"

# Create .github/markdown-link-check.json
cat > .github/markdown-link-check.json <<'EOF'
{
  "ignorePatterns": [
    {
      "pattern": "^http://localhost"
    },
    {
      "pattern": "^https://codecov.io"
    }
  ],
  "timeout": "10s",
  "retryOn429": true,
  "retryCount": 3,
  "fallbackRetryDelay": "5s"
}
EOF
echo -e "${GREEN}✓${NC} Created .github/markdown-link-check.json"

echo ""

# ==============================================================================
# Step 4: Add package.json scripts
# ==============================================================================

echo -e "${BLUE}[4/7]${NC} Updating package.json scripts..."

# Check if jq is available to modify JSON
if command -v jq &> /dev/null; then
    # Add additional scripts
    TEMP_FILE=$(mktemp)
    jq '.scripts += {
        "metrics": "find src -name \"*.ts\" | wc -l && find src -name \"*.ts\" -exec wc -l {} + | tail -1",
        "docs:api": "typedoc --out docs/api src/index.ts",
        "docs:serve": "npx http-server docs/api -p 8080",
        "complexity": "echo \"Complexity analysis - install ts-complexity for detailed report\"",
        "badges": "echo \"Badge generation via CI/CD pipeline\""
    }' package.json > "$TEMP_FILE" && mv "$TEMP_FILE" package.json

    echo -e "${GREEN}✓${NC} Updated package.json scripts"
else
    echo -e "${YELLOW}⚠${NC}  jq not found, skipping package.json updates"
fi

echo ""

# ==============================================================================
# Step 5: Create Documentation Directories
# ==============================================================================

echo -e "${BLUE}[5/7]${NC} Setting up documentation structure..."

mkdir -p docs/{api,diagrams,reports,guides}
mkdir -p .github/badges

# Create placeholder files
cat > docs/diagrams/.gitkeep <<'EOF'
# Architecture diagrams will be auto-generated here by CI/CD
EOF

cat > docs/reports/.gitkeep <<'EOF'
# Code metrics and analysis reports will be auto-generated here by CI/CD
EOF

echo -e "${GREEN}✓${NC} Documentation structure created"
echo ""

# ==============================================================================
# Step 6: Generate Initial Metrics
# ==============================================================================

echo -e "${BLUE}[6/7]${NC} Generating initial metrics..."

# Count TypeScript files
TS_FILES=$(find src -name "*.ts" 2>/dev/null | wc -l || echo "0")
echo "  • TypeScript files: $TS_FILES"

# Count lines of code
TOTAL_LOC=$(find src -name "*.ts" -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
echo "  • Total lines of code: $TOTAL_LOC"

# Calculate average file size
if [ "$TS_FILES" -gt 0 ]; then
    AVG_LOC=$((TOTAL_LOC / TS_FILES))
    echo "  • Average file size: $AVG_LOC lines"
fi

# Create metrics summary
cat > docs/reports/initial-metrics.md <<EOF
# Initial Codebase Metrics

Generated: $(date)

## Statistics

- **Total TypeScript Files:** $TS_FILES
- **Total Lines of Code:** $TOTAL_LOC
- **Average File Size:** $AVG_LOC lines
- **Repository Size:** $(du -sh . 2>/dev/null | cut -f1 || echo "Unknown")

## Next Steps

These metrics will be automatically updated by CI/CD pipelines:
- \`.github/workflows/ci-advanced.yml\` - Main CI/CD pipeline
- \`.github/workflows/documentation.yml\` - Documentation generation
- \`.github/workflows/nix-build.yml\` - Nix build validation

EOF

echo -e "${GREEN}✓${NC} Initial metrics generated"
echo ""

# ==============================================================================
# Step 7: Git Setup
# ==============================================================================

echo -e "${BLUE}[7/7]${NC} Finalizing setup..."

# Add all new files
git add .github/workflows/ docs/ scripts/ .codecov.yml .github/dependabot.yml .github/markdown-link-check.json 2>/dev/null || true

echo -e "${GREEN}✓${NC} Files staged for commit"
echo ""

# ==============================================================================
# Summary & Next Steps
# ==============================================================================

echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✓ Portfolio Transformation Setup Complete!               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${BLUE}📊 Summary:${NC}"
echo "  • CI/CD workflows configured (8 stages)"
echo "  • Documentation structure created"
echo "  • Configuration files generated"
echo "  • Initial metrics calculated"
echo ""

echo -e "${BLUE}🔑 Required GitHub Secrets:${NC}"
echo "  Configure these in: Settings → Secrets and variables → Actions"
echo ""
echo "  1. CODECOV_TOKEN       - Get from https://codecov.io"
echo "  2. SNYK_TOKEN          - Get from https://snyk.io"
echo "  3. CACHIX_AUTH_TOKEN   - Optional: https://cachix.org"
echo "  4. NPM_TOKEN           - For release automation"
echo ""

echo -e "${BLUE}📝 Next Steps:${NC}"
echo ""
echo "  1. Review changes:"
echo -e "     ${YELLOW}git status${NC}"
echo ""
echo "  2. Commit changes:"
echo -e "     ${YELLOW}git commit -m \"feat(ci/cd): add enterprise-grade CI/CD pipelines\"${NC}"
echo ""
echo "  3. Push to GitHub:"
echo -e "     ${YELLOW}git push${NC}"
echo ""
echo "  4. Configure GitHub Secrets (see list above)"
echo ""
echo "  5. Enable GitHub Pages:"
echo "     Settings → Pages → Source: GitHub Actions"
echo ""
echo "  6. Update README.md with enhancements:"
echo "     See: ${YELLOW}docs/README-ENHANCEMENT.md${NC}"
echo ""
echo "  7. Verify first CI/CD run:"
echo "     Actions tab in GitHub repository"
echo ""

echo -e "${BLUE}📚 Documentation:${NC}"
echo "  • Full guide: ${YELLOW}PORTFOLIO-TRANSFORMATION-SUMMARY.md${NC}"
echo "  • README updates: ${YELLOW}docs/README-ENHANCEMENT.md${NC}"
echo ""

echo -e "${GREEN}🚀 Ready for deployment!${NC}"
echo ""

# Offer to show git diff
read -p "Show git diff of changes? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git diff --cached
fi
