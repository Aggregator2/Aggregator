#!/bin/bash
# YOLO Mode Setup Script for Claude Code CLI

echo "🚀 Setting up Claude Code in YOLO Mode (no firewall restrictions)"

# Set ANTHROPIC_API_KEY if not already set
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "⚠️  WARNING: ANTHROPIC_API_KEY not set!"
    echo "Please set your API key in devcontainer.json or as an environment variable"
    echo "Get your API key from: https://console.anthropic.com/"
    exit 1
else
    echo "✅ API key found: ${ANTHROPIC_API_KEY:0:20}..."
fi


# Skip firewall setup for YOLO mode
echo "⚠️  YOLO MODE: Skipping firewall configuration for unrestricted access"

# Check if Claude CLI is available
if ! command -v claude &> /dev/null; then
    echo "Installing Claude CLI..."
    npm install -g @anthropic-ai/claude-code
fi

# Verify Claude CLI installation
if command -v claude &> /dev/null; then
    echo "✅ Claude CLI is installed"
    claude --version
else
    echo "❌ Failed to install Claude CLI"
    exit 1
fi

# Set up Claude config directory
mkdir -p /home/node/.claude

# Create a basic Claude config for YOLO mode
cat > /home/node/.claude/config.json << EOF
{
  "apiKey": "$ANTHROPIC_API_KEY",
  "model": "claude-3-5-sonnet-20241022",
  "dangerouslySkipPermissions": true
}
EOF

echo "🎯 YOLO Mode setup complete!"
echo ""
echo "🚨 WARNING: YOLO Mode is active - no firewall restrictions!"
echo "📋 To start Claude in YOLO mode, run:"
echo "   claude --dangerously-skip-permissions"
echo ""
echo "🔧 Or start it automatically:"
echo "   nohup claude --dangerously-skip-permissions > /dev/null 2>&1 &"
echo ""
echo "💡 Project is ready for unattended Claude Code operation!"
