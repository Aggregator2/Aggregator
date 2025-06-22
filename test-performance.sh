#!/bin/bash

echo "🚀 DeFi Aggregator Performance Test Suite"
echo "======================================="
echo ""

# Compile TypeScript files
echo "📦 Compiling TypeScript files..."
npx tsc test/performance/quote-performance.test.ts --module commonjs --target es2020 --lib es2020
npx tsc test/performance/load-test.ts --module commonjs --target es2020 --lib es2020
npx tsc test/performance/run-all-tests.ts --module commonjs --target es2020 --lib es2020

# Run quote performance test
echo ""
echo "1️⃣ Testing Quote Response Times..."
echo "Running 30 iterations for common token pairs..."
node test/performance/quote-performance.test.js

# Run load test with 50 concurrent users
echo ""
echo "2️⃣ Testing Concurrent Load..."
echo "Simulating 50 concurrent users for 30 seconds..."
node test/performance/load-test.js --users 50 --duration 30

# Generate comprehensive report
echo ""
echo "3️⃣ Generating Comprehensive Performance Report..."
node test/performance/run-all-tests.js

echo ""
echo "✅ Performance testing complete!"
echo "📄 Check PERFORMANCE_TEST_REPORT.md for detailed results"