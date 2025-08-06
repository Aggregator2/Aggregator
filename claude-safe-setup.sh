#!/bin/bash
# Claude safe execution script
# This script runs Claude with proper environment settings to avoid parsing issues

echo "🔧 Setting up Claude safe environment..."

# Set environment variables to prevent shell parsing issues
export CLAUDE_DISABLE_SHELL_PARSING=true
export CLAUDE_STRICT_MODE=false
export CLAUDE_IGNORE_JS_PATTERNS=true

# Create temporary ignore file if not exists
if [ ! -f .claudeignore ]; then
    echo "Creating .claudeignore file..."
    cat > .claudeignore << 'EOF'
# Exclude JS/TS files to prevent parsing issues
*.js
*.ts
*.tsx
*.jsx
components/
hooks/
utils/
src/
pages/
test/
tests/
scripts/
node_modules/
.git/
*.log
logs/
EOF
fi

echo "✅ Safe environment configured"
echo "🚀 You can now run Claude commands safely"
echo ""
echo "Recommended Claude commands:"
echo "  claude --help"
echo "  claude analyze --file src/contracts/FixedEscrow.sol"
echo "  claude generate --contract FixedEscrow"
