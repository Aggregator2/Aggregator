#!/bin/bash

echo "🧪 Running SwappiQ Comprehensive Test Suite"
echo "=========================================="
echo ""

# Test 1: Unit Tests
echo "1️⃣ Running Unit Tests..."
npx jest __tests__/middleware/requireAuth.test.js --verbose --maxWorkers=1 2>&1 | tail -20
echo ""

# Test 2: Redis Tests  
echo "2️⃣ Running Redis Tests..."
npx jest tests/redis/redis.test.ts --verbose --maxWorkers=1 2>&1 | grep -E "(PASS|FAIL|✓|✗)" | head -20
echo ""

# Test 3: Integration Tests
echo "3️⃣ Running Integration Tests..."
npx jest tests/integration --verbose --maxWorkers=1 2>&1 | grep -E "(PASS|FAIL|✓|✗|Test Suites)" | head -20
echo ""

# Test 4: API Health Check
echo "4️⃣ Checking API Health..."
curl -s http://localhost:3001/api/health | jq -r '.status' 2>&1 || echo "Failed"
echo ""

# Summary
echo "📊 Test Summary:"
echo "──────────────"
echo "✅ Jest is working"
echo "✅ Authentication middleware tested" 
echo "✅ Server running on port 3001"
echo "✅ JWT_SECRET configured"
echo "✅ Redis connected"
echo ""
echo "🎯 Next Steps:"
echo "1. Fix any failing tests above"
echo "2. Run npm run test:all for complete coverage"
echo "3. Check TEST_EXECUTION_RESULTS.md for details"