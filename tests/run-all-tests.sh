#!/bin/bash

# Comprehensive test runner for matching engine and settlement system

echo "====================================="
echo "Trading System Comprehensive Tests"
echo "====================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

# Function to run test suite
run_test_suite() {
    local suite_name=$1
    local test_command=$2
    
    echo -e "${YELLOW}Running $suite_name...${NC}"
    
    if $test_command; then
        echo -e "${GREEN}✓ $suite_name passed${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ $suite_name failed${NC}"
        ((FAILED++))
    fi
    echo ""
}

# 1. Unit Tests
echo "1. Unit Tests"
echo "============="

run_test_suite "Matching Engine Unit Tests" \
    "npx jest src/services/matchingEngine/__tests__/MatchingEngine.test.ts --verbose"

run_test_suite "Settlement Engine Unit Tests" \
    "npx jest src/services/settlement/__tests__/FinalSettlementEngine.test.ts --verbose"

run_test_suite "Order Book Unit Tests" \
    "npx jest src/services/matchingEngine/__tests__/OrderBook.test.ts --verbose"

# 2. Integration Tests
echo ""
echo "2. Integration Tests"
echo "==================="

run_test_suite "Comprehensive Matching Engine Tests" \
    "npx jest tests/matching-engine/comprehensive-matching.test.ts --verbose"

run_test_suite "Comprehensive Settlement Tests" \
    "npx jest tests/settlement/comprehensive-settlement.test.ts --verbose"

run_test_suite "End-to-End Trading Tests" \
    "npx jest tests/integration/end-to-end-trading.test.ts --verbose"

# 3. Performance Tests
echo ""
echo "3. Performance Tests"
echo "==================="

echo -e "${YELLOW}Running performance benchmarks...${NC}"

# Run basic performance test
node -r ts-node/register tests/performance/stress-test.ts

# 4. External Integration Tests
echo ""
echo "4. External Integration Tests"
echo "============================"

run_test_suite "LiFi Integration Tests" \
    "npx jest src/tests/externalLiquidityExecution.test.ts --verbose"

run_test_suite "Smart Order Router Tests" \
    "npx jest src/liquidity-aggregator/tests/SmartOrderRouter.test.ts --verbose"

# 5. Settlement Verification Tests
echo ""
echo "5. Settlement Verification Tests"
echo "==============================="

run_test_suite "Merkle Proof Generation Tests" \
    "npx jest --testPathPattern=merkle --verbose"

run_test_suite "Cross-chain Settlement Tests" \
    "npx jest --testPathPattern=cross-chain --verbose"

# Summary
echo ""
echo "====================================="
echo "Test Summary"
echo "====================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed. Please check the output above.${NC}"
    exit 1
fi