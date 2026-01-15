#!/bin/bash
# Script to create Pull Request for MCP refactoring

echo "🚀 Creating Pull Request for Enterprise MCP Refactoring..."
echo ""

# PR Details
TITLE="feat: Enterprise-grade MCP server refactoring - [MCP-1] + [MCP-2]"
HEAD="claude/refactor-mcp-server-rv8Ek"
BASE="main"

# Try using gh CLI if available
if command -v gh &> /dev/null; then
    echo "Using GitHub CLI (gh)..."
    gh pr create \
        --title "$TITLE" \
        --body-file PR_DESCRIPTION.md \
        --base "$BASE" \
        --head "$HEAD"

    if [ $? -eq 0 ]; then
        echo "✅ PR created successfully!"
        exit 0
    fi
fi

# Fallback: Generate URL
echo "GitHub CLI not available. Opening browser to create PR manually..."
echo ""
echo "📋 PR Information:"
echo "  Title: $TITLE"
echo "  Branch: $HEAD → $BASE"
echo "  Body: See PR_DESCRIPTION.md"
echo ""
echo "🔗 Open this URL to create the PR:"
PR_URL="https://github.com/marcosfpina/securellm-mcp/compare/${BASE}...${HEAD}?expand=1"
echo "$PR_URL"
echo ""

# Try to open browser
if command -v xdg-open &> /dev/null; then
    echo "Opening browser..."
    xdg-open "$PR_URL" 2>/dev/null &
elif command -v open &> /dev/null; then
    echo "Opening browser..."
    open "$PR_URL" 2>/dev/null &
else
    echo "❌ Could not open browser automatically."
    echo "Please copy the URL above and paste it in your browser."
fi

echo ""
echo "📄 Copy this for the PR description:"
echo "---"
cat PR_DESCRIPTION.md
