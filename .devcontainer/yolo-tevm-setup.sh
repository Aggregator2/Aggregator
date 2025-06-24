#!/bin/bash
# Enhanced YOLO Mode Setup with Tevm Integration

echo "🚀 Setting up Claude Code + Tevm in YOLO Mode"

# Run existing YOLO setup
source /workspace/.devcontainer/yolo-setup.sh

# Install Tevm dependencies
echo "📦 Installing Tevm and testing dependencies..."
cd /workspace

# Install core Tevm packages
npm install --save-dev @tevm/node @tevm/contract @tevm/utils @tevm/memory-client

# Install testing frameworks
npm install --save-dev jest @types/jest ts-jest
npm install --save-dev mocha chai @types/mocha @types/chai
npm install --save-dev @types/node typescript

# Install Claude Code CLI if not available
if ! command -v claude-code &> /dev/null; then
    echo "Installing Claude Code CLI..."
    npm install -g @anthropic-ai/claude-code
fi

# Create Tevm configuration
mkdir -p /workspace/tevm-config

cat > /workspace/tevm-config/tevm.config.js << 'EOF'
export default {
  chainId: 1,
  forkUrl: process.env.RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY',
  enableTracing: true,
  logLevel: 'debug',
  contracts: [
    './src/contracts/FixedEscrow.sol',
    './contracts/**/*.sol'
  ],
  deployCreate2: true,
  miningConfig: {
    type: 'manual'
  }
}
EOF

# Create Jest configuration for Tevm
cat > /workspace/jest.config.js << 'EOF'
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  testTimeout: 30000
};
EOF

# Create test setup file
mkdir -p /workspace/test
cat > /workspace/test/setup.ts << 'EOF'
import { TevmNode } from '@tevm/node';

// Global test setup
global.beforeAll(async () => {
  console.log('🔧 Setting up test environment...');
});

global.afterAll(async () => {
  console.log('🧹 Cleaning up test environment...');
});
EOF

# Update package.json with new scripts
echo "📝 Adding scripts to package.json..."
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('/workspace/package.json', 'utf8'));
pkg.scripts = {
  ...pkg.scripts,
  'claude-yolo': 'bash /workspace/.devcontainer/yolo-tevm-setup.sh',
  'claude-test': 'bash /workspace/scripts/claude-tevm-runner.sh',
  'claude-generate': 'claude-code generate-tests --file src/index.ts --contract FixedEscrow',
  'claude-execute': 'claude-code execute --function getBestPrice --context tevm',
  'claude-validate': 'claude-code validate --memory escrow-memory.json --tool web-search',
  'tevm-test': 'jest --config jest.config.js',
  'claude-optimize': 'claude-code optimize --file src/index.ts --goal \"minimize gas costs\"',
  'claude-security': 'claude-code security-scan --file src/contracts/ --comprehensive'
};
fs.writeFileSync('/workspace/package.json', JSON.stringify(pkg, null, 2));
"

echo "✅ Tevm + Claude Code integration complete!"
echo ""
echo "🎯 Quick commands:"
echo "   npm run claude-generate    # Generate tests"
echo "   npm run claude-execute     # Execute with Tevm"
echo "   npm run claude-validate    # Validate with live data"
echo "   npm run tevm-test          # Run Jest tests"
echo ""
echo "🔥 Start Claude in YOLO mode:"
echo "   claude --dangerously-skip-permissions"
