#!/bin/bash
# Automated Claude Code + Tevm Test Runner

echo "🔥 Running Claude Code with Tevm integration..."

# Set up environment
export NODE_ENV=test
export LOG_LEVEL=info

# 1. Generate comprehensive tests
echo "📝 Generating tests for escrow system..."
claude-code generate-tests \
  --file src/contracts/FixedEscrow.sol \
  --contract FixedEscrow \
  --framework jest \
  --coverage \
  --output test/generated

# 2. Execute key functions with simulation
echo "🎮 Simulating escrow transactions..."
claude-code execute \
  --function initializeEscrow \
  --args "USDC" "WETH" 1000 \
  --context tevm \
  --chain ethereum \
  --memory escrow-memory.json

# 3. Test quote system
echo "💰 Testing quote system..."
claude-code execute \
  --function getBestPrice \
  --args "USDC" "WETH" 1000 \
  --context tevm \
  --memory aggregator-memory.json

# 4. Cross-chain validation
echo "🌉 Testing cross-chain routes..."
for chain in ethereum polygon arbitrum bsc; do
  echo "Testing on $chain..."
  claude-code execute \
    --function findBestRoute \
    --args "USDC" "WETH" 1000 \
    --chain $chain \
    --context tevm \
    --parallel &
done
wait

# 5. Performance benchmarking
echo "⚡ Running performance tests..."
claude-code benchmark \
  --function getBestPrice \
  --iterations 100 \
  --memory performance-metrics.json \
  --target-time 20ms

# 6. Security validation
echo "🔒 Security validation..."
claude-code security-scan \
  --file src/contracts/FixedEscrow.sol \
  --checks reentrancy,overflow,access-control,front-running \
  --tool web-search

# 7. API endpoint testing
echo "🌐 Testing API endpoints..."
claude-code test-endpoints \
  --config claude.config.json \
  --endpoints "/api/quote,/api/unified-quote,/api/health" \
  --load-test

# 8. Live data validation
echo "📊 Validating against live DEX data..."
claude-code validate \
  --function getBestPrice \
  --args "USDC" "WETH" 1000 \
  --tool web-search \
  --sources "0x,1inch,paraswap,lifi" \
  --tolerance 0.5%

# 9. Run Jest tests
echo "🧪 Running Jest test suite..."
npm run tevm-test

# 10. Generate comprehensive report
echo "📋 Generating test report..."
claude-code report \
  --memory escrow-memory.json,aggregator-memory.json,performance-metrics.json \
  --output test-results/claude-tevm-report.json \
  --format json,html

echo "✅ Claude Code + Tevm testing complete!"
echo "📊 Results saved to test-results/"
echo "🔍 View detailed report: test-results/claude-tevm-report.html"
