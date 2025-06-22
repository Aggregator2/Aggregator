import axios from 'axios';
import { performance } from 'perf_hooks';
import * as os from 'os';

interface LoadTestConfig {
  baseUrl: string;
  concurrentUsers: number;
  testDuration: number; // milliseconds
  rampUpTime: number; // milliseconds
  endpoints: EndpointConfig[];
}

interface EndpointConfig {
  method: 'GET' | 'POST';
  path: string;
  body?: any;
  weight: number; // Probability weight for this endpoint
}

interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  errorRate: number;
  statusCodeDistribution: Map<number, number>;
  endpointMetrics: Map<string, EndpointMetrics>;
  systemMetrics: SystemMetrics;
}

interface EndpointMetrics {
  requests: number;
  successes: number;
  failures: number;
  avgResponseTime: number;
  errorTypes: Map<string, number>;
}

interface SystemMetrics {
  cpuUsage: number[];
  memoryUsage: number[];
  startMemory: number;
  endMemory: number;
  memoryLeak: boolean;
}

class LoadTester {
  private config: LoadTestConfig;
  private results: LoadTestResults;
  private responseTimes: number[] = [];
  private activeConnections = 0;
  private systemMetrics: SystemMetrics;
  private metricsInterval: NodeJS.Timer | null = null;

  constructor(config: LoadTestConfig) {
    this.config = config;
    this.results = this.initializeResults();
    this.systemMetrics = {
      cpuUsage: [],
      memoryUsage: [],
      startMemory: 0,
      endMemory: 0,
      memoryLeak: false
    };
  }

  private initializeResults(): LoadTestResults {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      minResponseTime: Infinity,
      maxResponseTime: 0,
      p50ResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      requestsPerSecond: 0,
      errorRate: 0,
      statusCodeDistribution: new Map(),
      endpointMetrics: new Map(),
      systemMetrics: this.systemMetrics
    };
  }

  async runTest(): Promise<LoadTestResults> {
    console.log(`Starting load test with ${this.config.concurrentUsers} concurrent users...`);
    console.log(`Test duration: ${this.config.testDuration / 1000} seconds`);
    console.log(`Ramp-up time: ${this.config.rampUpTime / 1000} seconds\n`);

    // Start system metrics collection
    this.startMetricsCollection();
    this.systemMetrics.startMemory = process.memoryUsage().heapUsed;

    const startTime = Date.now();
    const endTime = startTime + this.config.testDuration;
    const userPromises: Promise<void>[] = [];

    // Ramp up users gradually
    const usersPerInterval = Math.ceil(this.config.concurrentUsers / 10);
    const intervalTime = this.config.rampUpTime / 10;

    for (let i = 0; i < this.config.concurrentUsers; i++) {
      const delay = Math.floor(i / usersPerInterval) * intervalTime;
      
      const userPromise = this.simulateUser(i, startTime + delay, endTime);
      userPromises.push(userPromise);
      
      // Progress indicator
      if ((i + 1) % 10 === 0 || i === this.config.concurrentUsers - 1) {
        console.log(`Started ${i + 1} / ${this.config.concurrentUsers} users`);
      }
    }

    // Wait for all users to complete
    await Promise.all(userPromises);

    // Stop metrics collection
    this.stopMetricsCollection();
    this.systemMetrics.endMemory = process.memoryUsage().heapUsed;
    
    // Check for memory leak (more than 100MB increase)
    const memoryIncrease = this.systemMetrics.endMemory - this.systemMetrics.startMemory;
    this.systemMetrics.memoryLeak = memoryIncrease > 100 * 1024 * 1024;

    // Calculate final metrics
    this.calculateFinalMetrics();

    return this.results;
  }

  private async simulateUser(userId: number, startTime: number, endTime: number): Promise<void> {
    // Wait until start time
    const waitTime = startTime - Date.now();
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    while (Date.now() < endTime) {
      // Select random endpoint based on weights
      const endpoint = this.selectEndpoint();
      
      try {
        this.activeConnections++;
        const responseTime = await this.makeRequest(endpoint);
        this.recordSuccess(endpoint, responseTime);
      } catch (error: any) {
        this.recordFailure(endpoint, error);
      } finally {
        this.activeConnections--;
      }

      // Random think time between requests (100-500ms)
      const thinkTime = 100 + Math.random() * 400;
      await new Promise(resolve => setTimeout(resolve, thinkTime));
    }
  }

  private selectEndpoint(): EndpointConfig {
    const totalWeight = this.config.endpoints.reduce((sum, ep) => sum + ep.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const endpoint of this.config.endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        return endpoint;
      }
    }
    
    return this.config.endpoints[0];
  }

  private async makeRequest(endpoint: EndpointConfig): Promise<number> {
    const startTime = performance.now();
    const url = `${this.config.baseUrl}${endpoint.path}`;
    
    try {
      const response = await axios({
        method: endpoint.method,
        url,
        data: endpoint.body,
        timeout: 30000,
        validateStatus: () => true // Don't throw on any status code
      });
      
      const responseTime = performance.now() - startTime;
      
      // Record status code
      const statusCount = this.results.statusCodeDistribution.get(response.status) || 0;
      this.results.statusCodeDistribution.set(response.status, statusCount + 1);
      
      // Consider 4xx and 5xx as failures
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return responseTime;
    } catch (error: any) {
      const responseTime = performance.now() - startTime;
      throw { ...error, responseTime };
    }
  }

  private recordSuccess(endpoint: EndpointConfig, responseTime: number) {
    this.results.totalRequests++;
    this.results.successfulRequests++;
    this.responseTimes.push(responseTime);
    
    // Update min/max
    this.results.minResponseTime = Math.min(this.results.minResponseTime, responseTime);
    this.results.maxResponseTime = Math.max(this.results.maxResponseTime, responseTime);
    
    // Update endpoint metrics
    const key = `${endpoint.method} ${endpoint.path}`;
    const metrics = this.results.endpointMetrics.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
      avgResponseTime: 0,
      errorTypes: new Map()
    };
    
    metrics.requests++;
    metrics.successes++;
    metrics.avgResponseTime = (metrics.avgResponseTime * (metrics.successes - 1) + responseTime) / metrics.successes;
    
    this.results.endpointMetrics.set(key, metrics);
  }

  private recordFailure(endpoint: EndpointConfig, error: any) {
    this.results.totalRequests++;
    this.results.failedRequests++;
    
    // Still record response time if available
    if (error.responseTime) {
      this.responseTimes.push(error.responseTime);
    }
    
    // Update endpoint metrics
    const key = `${endpoint.method} ${endpoint.path}`;
    const metrics = this.results.endpointMetrics.get(key) || {
      requests: 0,
      successes: 0,
      failures: 0,
      avgResponseTime: 0,
      errorTypes: new Map()
    };
    
    metrics.requests++;
    metrics.failures++;
    
    // Track error types
    const errorType = error.code || error.message || 'Unknown';
    metrics.errorTypes.set(errorType, (metrics.errorTypes.get(errorType) || 0) + 1);
    
    this.results.endpointMetrics.set(key, metrics);
  }

  private calculateFinalMetrics() {
    // Response time percentiles
    if (this.responseTimes.length > 0) {
      this.responseTimes.sort((a, b) => a - b);
      const len = this.responseTimes.length;
      
      this.results.avgResponseTime = this.responseTimes.reduce((a, b) => a + b, 0) / len;
      this.results.p50ResponseTime = this.responseTimes[Math.floor(len * 0.5)];
      this.results.p95ResponseTime = this.responseTimes[Math.floor(len * 0.95)];
      this.results.p99ResponseTime = this.responseTimes[Math.floor(len * 0.99)];
    }
    
    // Requests per second
    const durationSeconds = this.config.testDuration / 1000;
    this.results.requestsPerSecond = this.results.totalRequests / durationSeconds;
    
    // Error rate
    this.results.errorRate = (this.results.failedRequests / this.results.totalRequests) * 100;
  }

  private startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      // CPU usage
      const cpus = os.cpus();
      const totalIdle = cpus.reduce((acc, cpu) => acc + cpu.times.idle, 0);
      const totalTick = cpus.reduce((acc, cpu) => 
        acc + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq, 0
      );
      const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);
      this.systemMetrics.cpuUsage.push(cpuUsage);
      
      // Memory usage
      const memUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
      this.systemMetrics.memoryUsage.push(memUsage);
    }, 1000);
  }

  private stopMetricsCollection() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  generateReport(): string {
    let report = '# Load Test Report\n\n';
    
    report += `## Test Configuration\n`;
    report += `- Base URL: ${this.config.baseUrl}\n`;
    report += `- Concurrent Users: ${this.config.concurrentUsers}\n`;
    report += `- Test Duration: ${this.config.testDuration / 1000} seconds\n`;
    report += `- Ramp-up Time: ${this.config.rampUpTime / 1000} seconds\n\n`;
    
    report += `## Overall Results\n`;
    report += `- Total Requests: ${this.results.totalRequests}\n`;
    report += `- Successful Requests: ${this.results.successfulRequests}\n`;
    report += `- Failed Requests: ${this.results.failedRequests}\n`;
    report += `- Error Rate: ${this.results.errorRate.toFixed(2)}%\n`;
    report += `- Requests/Second: ${this.results.requestsPerSecond.toFixed(2)}\n\n`;
    
    report += `## Response Time Statistics\n`;
    report += `- Average: ${this.results.avgResponseTime.toFixed(2)}ms\n`;
    report += `- Min: ${this.results.minResponseTime.toFixed(2)}ms\n`;
    report += `- Max: ${this.results.maxResponseTime.toFixed(2)}ms\n`;
    report += `- P50 (Median): ${this.results.p50ResponseTime.toFixed(2)}ms\n`;
    report += `- P95: ${this.results.p95ResponseTime.toFixed(2)}ms\n`;
    report += `- P99: ${this.results.p99ResponseTime.toFixed(2)}ms\n\n`;
    
    report += `## Status Code Distribution\n`;
    this.results.statusCodeDistribution.forEach((count, status) => {
      report += `- ${status}: ${count} (${((count / this.results.totalRequests) * 100).toFixed(2)}%)\n`;
    });
    report += '\n';
    
    report += `## Endpoint Performance\n`;
    this.results.endpointMetrics.forEach((metrics, endpoint) => {
      report += `### ${endpoint}\n`;
      report += `- Requests: ${metrics.requests}\n`;
      report += `- Success Rate: ${((metrics.successes / metrics.requests) * 100).toFixed(2)}%\n`;
      report += `- Avg Response Time: ${metrics.avgResponseTime.toFixed(2)}ms\n`;
      
      if (metrics.errorTypes.size > 0) {
        report += `- Error Types:\n`;
        metrics.errorTypes.forEach((count, type) => {
          report += `  - ${type}: ${count}\n`;
        });
      }
      report += '\n';
    });
    
    report += `## System Metrics\n`;
    report += `- Avg CPU Usage: ${(this.systemMetrics.cpuUsage.reduce((a, b) => a + b, 0) / this.systemMetrics.cpuUsage.length).toFixed(2)}%\n`;
    report += `- Peak CPU Usage: ${Math.max(...this.systemMetrics.cpuUsage)}%\n`;
    report += `- Start Memory: ${(this.systemMetrics.startMemory / 1024 / 1024).toFixed(2)}MB\n`;
    report += `- End Memory: ${(this.systemMetrics.endMemory / 1024 / 1024).toFixed(2)}MB\n`;
    report += `- Memory Increase: ${((this.systemMetrics.endMemory - this.systemMetrics.startMemory) / 1024 / 1024).toFixed(2)}MB\n`;
    report += `- Memory Leak Detected: ${this.systemMetrics.memoryLeak ? 'Yes ⚠️' : 'No ✅'}\n\n`;
    
    // Analysis for 1000 users
    const scaleFactor = 1000 / this.config.concurrentUsers;
    report += `## Extrapolation for 1000 Concurrent Users\n`;
    report += `- Estimated Requests/Second: ${(this.results.requestsPerSecond * scaleFactor).toFixed(2)}\n`;
    report += `- Estimated Error Rate: ${this.results.errorRate.toFixed(2)}% (assuming same infrastructure)\n`;
    report += `- **Recommendation**: ${this.results.errorRate < 1 && this.results.p95ResponseTime < 500 ? '✅ System can likely handle 1000 users' : '⚠️ Infrastructure scaling needed'}\n`;
    
    return report;
  }
}

// Default test configuration
const defaultConfig: LoadTestConfig = {
  baseUrl: process.env.API_URL || 'http://localhost:3000',
  concurrentUsers: 100,
  testDuration: 60000, // 1 minute
  rampUpTime: 10000, // 10 seconds
  endpoints: [
    {
      method: 'POST',
      path: '/api/unified-quote-simple',
      body: {
        sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        sellAmount: '1000000000000000000',
        chainId: 1
      },
      weight: 70 // 70% of requests
    },
    {
      method: 'GET',
      path: '/api/tokens/comprehensive-v2?chainId=1',
      weight: 20 // 20% of requests
    },
    {
      method: 'POST',
      path: '/api/crosschain/quote',
      body: {
        fromChain: 1,
        toChain: 137,
        fromToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        toToken: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        amount: '1000000000000000000'
      },
      weight: 10 // 10% of requests
    }
  ]
};

// Export for use in other tests
export { LoadTester, LoadTestConfig, LoadTestResults };

// Run test if executed directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const config = { ...defaultConfig };
  
  // Parse command line arguments
  if (args.includes('--users')) {
    config.concurrentUsers = parseInt(args[args.indexOf('--users') + 1]);
  }
  if (args.includes('--duration')) {
    config.testDuration = parseInt(args[args.indexOf('--duration') + 1]) * 1000;
  }
  if (args.includes('--url')) {
    config.baseUrl = args[args.indexOf('--url') + 1];
  }

  const tester = new LoadTester(config);
  
  console.log('Starting load test...\n');
  
  tester.runTest().then(results => {
    const report = tester.generateReport();
    console.log('\n' + report);
    
    // Save report
    require('fs').writeFileSync('load-test-report.md', report);
    console.log('Report saved to load-test-report.md');
    
    // Exit with error if failure rate is too high
    if (results.errorRate > 5) {
      console.error('\n❌ Load test failed: Error rate too high');
      process.exit(1);
    } else {
      console.log('\n✅ Load test passed');
      process.exit(0);
    }
  }).catch(error => {
    console.error('Load test failed:', error);
    process.exit(1);
  });
}