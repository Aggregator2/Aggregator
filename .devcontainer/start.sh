#!/bin/bash
echo "🚀 Starting Claude Code Assistant for Meta Aggregator 2.0..."

# Check if API key is set
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "❌ ANTHROPIC_API_KEY not set!"
    echo "Please set your API key in the devcontainer.json or environment"
    exit 1
fi

echo "✅ API Key configured"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

# Install Claude SDK if not present globally
if ! npm list -g @anthropic-ai/sdk > /dev/null 2>&1; then
    echo "📦 Installing Anthropic SDK..."
    npm install -g @anthropic-ai/sdk
fi

# Create output directory
mkdir -p .claude-output

echo "🎯 Meta Aggregator 2.0 - Claude Assistant Ready!"
echo "📋 Available commands:"
echo "   node .devcontainer/auto-fix.js           # Full analysis + fixes"
echo "   node .devcontainer/auto-fix.js analyze   # Analysis only"
echo "   node .devcontainer/auto-fix.js ui-fixes  # UI fixes only"
echo "   node .devcontainer/auto-fix.js fix <file> <issue>  # Specific file fix"
echo ""
echo "🔍 Running full analysis workflow..."
node .devcontainer/auto-fix.js

echo ""
echo "✅ Claude Code Assistant startup complete!"
echo "📁 Check .claude-output/ for generated fixes"
echo "📋 Check claude-session.log for detailed logs"
