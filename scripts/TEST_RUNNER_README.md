# SwappiQ Test Runner Documentation

## Overview

The test runner script (`test-runner.sh`) is a comprehensive testing solution that:
- Checks all prerequisites (Redis, Hardhat, etc.)
- Sets up the test environment automatically
- Runs test suites in parallel where possible
- Generates detailed HTML and JSON reports
- Handles failures gracefully with proper exit codes

## Usage

### Run all tests
```bash
./scripts/test-runner.sh
```

### Run specific test suites
```bash
# Run only unit tests
./scripts/test-runner.sh unit

# Run multiple specific suites
./scripts/test-runner.sh unit matching

# Run all available suites
./scripts/test-runner.sh unit integration matching settlement
```

## Features

### 1. **Prerequisite Checking**
- Verifies Node.js, npm, Redis, and other required tools
- Automatically starts Redis if not running
- Starts Hardhat network for integration tests

### 2. **Parallel Execution**
- Unit and matching tests run in parallel
- Integration and settlement tests run sequentially (due to dependencies)

### 3. **Comprehensive Reporting**
- **Console Output**: Real-time colored status updates
- **HTML Report**: Beautiful visual report with test results
- **JSON Report**: Machine-readable results for CI/CD
- **Log Files**: Complete test output for each suite

### 4. **Smart Environment Setup**
- Automatically creates `.env.test` from `.env.example` if missing
- Sets appropriate Node environment variables
- Creates timestamped result directories

## Test Results

All test results are stored in `test-results/YYYYMMDD_HHMMSS/`:
```
test-results/
└── 20240115_143022/
    ├── unit.log           # Unit test output
    ├── unit.json          # Unit test results
    ├── integration.log    # Integration test output
    ├── integration.json   # Integration test results
    ├── matching.log       # Matching engine test output
    ├── matching.json      # Matching engine test results
    ├── settlement.log     # Settlement test output
    ├── settlement.json    # Settlement test results
    ├── summary.txt        # Text summary
    ├── summary.json       # JSON summary
    └── test-report.html   # Visual HTML report
```

## Exit Codes

- `0`: All tests passed
- `1`: One or more test suites failed

## Prerequisites

### Required Software
- Node.js (v16+)
- npm
- Redis
- netcat (nc)
- jq (for JSON parsing)

### Required npm packages
The script will use the test commands defined in `package.json`:
- `test:unit` - Unit tests with Jest
- `test:integration` - Integration tests with Jest
- `test:matching` - Matching engine tests
- `test:settlement` - Settlement tests

## CI/CD Integration

The script is designed for easy CI/CD integration:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: ./scripts/test-runner.sh
  
- name: Upload Test Results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: test-results
    path: test-results/
```

## Troubleshooting

### Redis not starting
```bash
# Check if Redis is installed
redis-cli --version

# Start Redis manually
redis-server --daemonize yes
```

### Hardhat network issues
```bash
# Kill any existing Hardhat processes
pkill -f hardhat

# Start Hardhat manually
npx hardhat node --fork https://eth.llamarpc.com
```

### Permission denied
```bash
# Make script executable
chmod +x scripts/test-runner.sh
```

## Advanced Usage

### Custom test timeout
```bash
# Set custom timeout (in seconds)
TEST_TIMEOUT=300 ./scripts/test-runner.sh
```

### Skip service checks
```bash
# Skip Redis/Hardhat checks (if already running)
SKIP_SERVICE_CHECK=1 ./scripts/test-runner.sh
```

### Verbose output
```bash
# Enable debug logging
DEBUG=1 ./scripts/test-runner.sh
```