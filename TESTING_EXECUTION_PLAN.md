# SwappiQ Testing Execution Plan

## Prerequisites - Terminal 1 (Setup & Services)

First, let's check what services need to be running:

```bash
# Check if Redis is running
redis-cli ping

# If Redis is not running, start it:
redis-server

# Check if the Next.js server is running
curl http://localhost:3000/api/health

# If not running, start the server:
npm run dev
```

---

## 1. API Testing Suite - Terminal 2

### A. Quick Health Check (Run First)
```bash
cd /workspace
node scripts/api-endpoint-checker.js
```
**Expected Output**: JSON report showing which core endpoints exist and their security status

### B. Static Security Analysis
```bash
cd /workspace
node scripts/api-static-analysis.js
```
**Expected Output**: 
- `api-static-analysis-report.json` - Detailed security analysis
- `API_SECURITY_SUMMARY.md` - Human-readable summary
- Console output showing vulnerabilities found

### C. Comprehensive API Testing (Requires Running Server)
```bash
cd /workspace
# Make sure server is running on port 3000
node scripts/comprehensive-api-test.js
```
**Expected Output**: 
- `api-test-report.json` - Full test results
- `API_TEST_REPORT.md` - Detailed report
- Console progress showing each endpoint being tested

---

## 2. WebSocket/Redis Tests - Terminal 3

### A. Check WebSocket/Redis Setup
```bash
cd /workspace/tests
npm install  # Install test dependencies first
npx ts-node check-websocket-setup.ts
```
**Expected Output**: Environment validation results

### B. Run WebSocket Tests
```bash
cd /workspace/tests
npm run test:websocket
# or
npx jest websocket/websocket.test.ts --verbose
```
**Expected Output**: WebSocket connection, authentication, and subscription test results

### C. Run Redis Tests
```bash
cd /workspace/tests
npm run test:redis
# or
npx jest redis/redis.test.ts --verbose
```
**Expected Output**: Redis connection, operations, and failover test results

### D. Run Integration Tests
```bash
cd /workspace/tests
npm run test:integration
# or
npx jest integration/websocket-redis.test.ts --verbose
```
**Expected Output**: End-to-end flow test results

### E. Generate Full Report
```bash
cd /workspace/tests
npm run test:report
# or
npx ts-node run-websocket-tests.ts
```
**Expected Output**: 
- `websocket-redis-test-report.json`
- `websocket-redis-test-report.html`

---

## 3. State Channel Tests - Terminal 4

### A. Install Hardhat Dependencies
```bash
cd /workspace
npm install --save-dev hardhat @nomiclabs/hardhat-ethers ethers
```

### B. Run Channel Lifecycle Tests
```bash
npx hardhat test test/comprehensive/stateChannels/channelLifecycle.test.ts
```
**Expected Output**: State channel creation, trading, and settlement test results

### C. Run EIP-712 Signature Tests
```bash
npx hardhat test test/comprehensive/eip712/signatureHandling.test.ts
```
**Expected Output**: Signature generation and verification test results

### D. Run Security/Fraud Proof Tests
```bash
npx hardhat test test/comprehensive/security/fraudProofTests.test.ts
```
**Expected Output**: Fraud detection and proof generation test results

### E. Run Full State Channel Suite
```bash
cd /workspace
./test/comprehensive/runTests.ts
```
**Expected Output**: Complete test report with performance metrics

---

## 4. Matching/Settlement Tests - Terminal 5

### A. Run Matching Engine Tests
```bash
cd /workspace
npm run test:matching
# or
npx jest tests/matching-engine/comprehensive-matching.test.ts --verbose
```
**Expected Output**: Order matching, routing, and performance test results

### B. Run Settlement Tests
```bash
cd /workspace
npm run test:settlement
# or
npx jest tests/settlement/comprehensive-settlement.test.ts --verbose
```
**Expected Output**: Settlement batch creation and proof generation results

### C. Run End-to-End Trading Tests
```bash
cd /workspace
npm run test:e2e
# or
npx jest tests/integration/end-to-end-trading.test.ts --verbose
```
**Expected Output**: Complete trade lifecycle test results

### D. Run Performance/Stress Tests
```bash
cd /workspace
npm run test:performance
# or
npx ts-node tests/performance/stress-test.ts
```
**Expected Output**: Performance metrics (TPS, latency, memory usage)

---

## 5. Frontend Component Tests - Terminal 6

### A. Run Our Created API Tests
```bash
cd /workspace
npx jest __tests__/ --testPathIgnorePatterns="submitOrder.test.js|orderFlow.integration.test.js" --no-coverage
```
**Expected Output**: requireAuth middleware and integration test results

### B. Check Frontend Security
```bash
cd /workspace
# Analyze frontend components for security issues
grep -r "dangerouslySetInnerHTML" components/
grep -r "eval(" components/
grep -r "innerHTML" components/
```
**Expected Output**: Any unsafe patterns in frontend code

---

## Monitoring & Logs - Terminal 7

### A. Watch Application Logs
```bash
cd /workspace
tail -f logs/combined.log logs/error.log
```

### B. Monitor Redis
```bash
redis-cli monitor
```

### C. Check System Health
```bash
# In a loop to monitor continuously
while true; do
  curl -s http://localhost:3000/api/health/detailed | jq .
  sleep 5
done
```

---

## Quick Test Sequence (If Short on Time)

Run these in order for a basic health check:

```bash
# Terminal 1 - Start services
redis-server
npm run dev

# Terminal 2 - Quick API check
node scripts/api-endpoint-checker.js
node scripts/api-static-analysis.js

# Terminal 3 - Basic integration test
cd tests && npm test

# Terminal 4 - Health monitoring
curl http://localhost:3000/api/health/detailed
```

---

## Interpreting Results

### 🟢 Good Results:
- "All tests passed"
- "0 vulnerabilities found"
- Response times < 100ms
- Memory usage stable

### 🟡 Warning Signs:
- "Some tests failed"
- "Authentication missing"
- Response times 100-500ms
- Memory usage increasing

### 🔴 Critical Issues:
- "Connection refused"
- "Private keys exposed"
- Response times > 500ms
- Out of memory errors

---

## Troubleshooting Common Issues

### Redis Connection Refused
```bash
# Start Redis
redis-server --daemonize yes
# or
brew services start redis  # macOS
sudo systemctl start redis  # Linux
```

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000
# Kill the process
kill -9 <PID>
```

### Module Not Found Errors
```bash
# Install missing dependencies
npm install
cd tests && npm install
```

### Permission Denied
```bash
# Make scripts executable
chmod +x scripts/*.js
chmod +x test/comprehensive/runTests.ts
```

---

## Results Collection

After running all tests, collect the results:

```bash
# Create results directory
mkdir -p /workspace/test-results

# Copy all reports
cp api-test-report.json /workspace/test-results/
cp api-static-analysis-report.json /workspace/test-results/
cp websocket-redis-test-report.json /workspace/test-results/
cp test-report.json /workspace/test-results/

# Create summary
ls -la /workspace/test-results/
```

Share the console outputs and generated report files for analysis.