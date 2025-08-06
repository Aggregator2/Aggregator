# K6 Load Testing Suite for SwappiQ Protocol

This directory contains comprehensive K6 load testing scripts designed to test the SwappiQ Protocol under various load conditions.

## Test Scenarios

### 1. Steady State Test (`01-steady-state.js`)
- **Load**: 1,000 concurrent users
- **Duration**: 30 minutes
- **Purpose**: Tests system stability under normal operating conditions
- **User Behaviors**:
  - Market makers placing multiple limit orders
  - Day traders executing frequent trades
  - Arbitrageurs monitoring multiple pairs
  - Casual traders with infrequent activity

### 2. Spike Test (`02-spike-test.js`)
- **Load**: 0 → 10,000 users in 2 minutes
- **Duration**: ~10 minutes total
- **Purpose**: Tests system's ability to handle sudden traffic spikes
- **Behaviors**:
  - Panic trading during high load
  - Aggressive market orders
  - Rapid orderbook queries

### 3. Stress Test (`03-stress-test.js`)
- **Load**: Gradually increases up to 30,000 RPS
- **Duration**: ~18 minutes
- **Purpose**: Find system breaking point
- **Focus Areas**:
  - Order placement capacity
  - Query performance
  - Resource-intensive operations
  - System degradation patterns

### 4. Soak Test (`04-soak-test.js`)
- **Load**: 5,000 concurrent users
- **Duration**: 4 hours
- **Purpose**: Detect memory leaks and performance degradation
- **Monitoring**:
  - Memory usage trends
  - CPU utilization
  - Connection pool health
  - Response time degradation

### 5. Breakpoint Test (`05-breakpoint-test.js`)
- **Load**: Increases until P95 > 500ms
- **Duration**: Variable (auto-stops at threshold)
- **Purpose**: Find exact load where performance degrades
- **Metrics**:
  - P95 response time tracking
  - RPS at breakpoint
  - System capacity assessment

## Installation

1. Install K6:
```bash
# macOS
brew install k6

# Linux
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6
```

2. Install dependencies (optional):
```bash
# For HTML report generation
npm install -g k6-reporter
```

## Usage

### Interactive Mode
Run the test runner script for an interactive menu:
```bash
./run-tests.sh
```

### Command Line Mode
Run specific tests directly:
```bash
# Run steady state test
./run-tests.sh steady-state

# Run spike test
./run-tests.sh spike

# Run stress test
./run-tests.sh stress

# Run soak test
./run-tests.sh soak

# Run breakpoint test
./run-tests.sh breakpoint

# Run all tests sequentially
./run-tests.sh all
```

### Manual Execution
Run individual test files:
```bash
# Set environment variables
export BASE_URL=http://localhost:3000
export WS_URL=ws://localhost:8080

# Run a specific test
k6 run scenarios/01-steady-state.js

# Run with custom options
k6 run --vus 100 --duration 5m scenarios/01-steady-state.js

# Export results
k6 run --out json=results/test-results.json scenarios/02-spike-test.js
```

## Configuration

### Environment Variables
- `BASE_URL`: API base URL (default: `http://localhost:3000`)
- `WS_URL`: WebSocket URL (default: `ws://localhost:8080`)

### Thresholds
Defined in `config/thresholds.js`:
- HTTP request duration percentiles
- Error rate limits
- WebSocket connection times
- Custom metric thresholds

## Metrics

### Standard Metrics
- `http_req_duration`: HTTP request duration
- `http_req_failed`: Failed request rate
- `http_reqs`: Request rate
- `vus`: Active virtual users

### Custom Metrics
- `order_placement_duration`: Time to place orders
- `order_matching_duration`: Order matching latency
- `orderbook_fetch_duration`: Orderbook query time
- `trade_execution_duration`: Trade execution time
- `successful_orders`: Count of successful orders
- `failed_orders`: Count of failed orders

## Results

Results are saved in the following directories:
- `./results/`: JSON output files and summaries
- `./reports/`: HTML reports (if k6-reporter is installed)

### Result Files
- `{test-name}_{timestamp}.json`: Raw test data
- `{test-name}_{timestamp}_summary.json`: Test summary
- `{test-name}_{timestamp}.html`: Visual HTML report

## Performance Targets

### Steady State
- P95 response time < 500ms
- Error rate < 1%
- Stable performance over 30 minutes

### Spike Test
- System recovers from 10k user spike
- P95 < 1000ms during spike
- Error rate < 5%

### Stress Test
- Identify breaking point RPS
- Document degradation pattern
- Find resource bottlenecks

### Soak Test
- Memory usage remains stable
- No significant performance degradation
- Resource utilization < 85%

### Breakpoint
- Accurately identify P95 > 500ms threshold
- Determine maximum sustainable load
- Provide optimization recommendations

## Troubleshooting

### Common Issues

1. **Connection refused errors**
   - Ensure API is running at BASE_URL
   - Check firewall settings
   - Verify port availability

2. **High error rates**
   - Check API logs for errors
   - Monitor system resources
   - Verify database connections

3. **Memory issues during tests**
   - Reduce VU count
   - Decrease test duration
   - Monitor K6 memory usage

### Debug Mode
Enable debug output:
```bash
k6 run --http-debug="full" scenarios/01-steady-state.js
```

## Best Practices

1. **Warm up the system** before running tests
2. **Monitor system resources** during tests
3. **Run tests in isolation** to avoid interference
4. **Analyze results** immediately after tests
5. **Document findings** and bottlenecks
6. **Iterate and optimize** based on results

## Integration

### CI/CD Pipeline
```yaml
# Example GitHub Actions workflow
load-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v2
    - name: Run K6 tests
      uses: k6io/action@v0.2.0
      with:
        filename: test/k6/scenarios/01-steady-state.js
        flags: --out json=results.json
```

### Monitoring Integration
- Export metrics to InfluxDB
- Visualize in Grafana
- Alert on threshold breaches

## Contributing

When adding new test scenarios:
1. Follow the existing file naming convention
2. Include comprehensive documentation
3. Define appropriate thresholds
4. Add the scenario to `run-tests.sh`
5. Update this README

## Resources

- [K6 Documentation](https://k6.io/docs/)
- [K6 Examples](https://github.com/k6io/k6-examples)
- [Performance Testing Best Practices](https://k6.io/docs/testing-guides/)