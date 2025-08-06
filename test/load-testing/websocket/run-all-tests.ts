#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';

interface TestConfig {
  name: string;
  script: string;
  duration: number; // seconds
  env?: Record<string, string>;
  expectedMetrics?: {
    minConnections?: number;
    minMessagesPerSecond?: number;
    maxLatency?: number;
    maxErrorRate?: number;
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  metrics: any;
  errors: string[];
  summary: string;
}

class WebSocketLoadTestRunner {
  private tests: TestConfig[] = [
    {
      name: '50K Concurrent Connections',
      script: 'scenarios/50k-connections-test.ts',
      duration: 300,
      env: {
        NUM_WORKERS: '8',
        WS_URL: process.env.WS_URL || 'ws://localhost:8080'
      },
      expectedMetrics: {
        minConnections: 45000, // 90% of target
        maxErrorRate: 5,
      }
    },
    {
      name: 'Order Book Stress Test',
      script: 'scenarios/orderbook-stress-test.ts',
      duration: 180,
      env: {
        WS_URL: process.env.WS_URL || 'ws://localhost:8080'
      },
      expectedMetrics: {
        minMessagesPerSecond: 10000,
        maxLatency: 100,
      }
    },
    {
      name: '100K Messages/Second Throughput',
      script: 'scenarios/throughput-test.ts',
      duration: 180,
      env: {
        NUM_WORKERS: '8',
        CONNECTIONS: '2000',
        WS_URL: process.env.WS_URL || 'ws://localhost:8080'
      },
      expectedMetrics: {
        minMessagesPerSecond: 90000, // 90% of target
      }
    },
    {
      name: 'Connection Recovery Test',
      script: 'scenarios/connection-recovery-test.ts',
      duration: 300,
      env: {
        CONNECTIONS: '200',
        WS_URL: process.env.WS_URL || 'ws://localhost:8080'
      },
      expectedMetrics: {
        maxErrorRate: 10,
      }
    },
    {
      name: 'Memory Leak Detection',
      script: 'scenarios/memory-leak-test.ts',
      duration: 600,
      env: {
        DURATION: '600',
        WS_URL: process.env.WS_URL || 'ws://localhost:8080'
      },
    }
  ];

  private results: TestResult[] = [];
  private dashboardServer?: http.Server;
  private dashboardWss?: WebSocket.Server;
  private dashboardClients: Set<WebSocket> = new Set();
  private currentTest?: { name: string; process?: any };

  async runAllTests(): Promise<void> {
    console.log('🚀 WebSocket Load Testing Suite');
    console.log('================================\n');

    // Start dashboard server
    await this.startDashboardServer();

    // Run tests sequentially
    for (const test of this.tests) {
      if (process.env.SKIP_TESTS && process.env.SKIP_TESTS.includes(test.name)) {
        console.log(`⏭️  Skipping ${test.name}`);
        continue;
      }

      await this.runTest(test);
      
      // Wait between tests
      console.log('\n⏳ Waiting 30 seconds before next test...\n');
      await this.wait(30000);
    }

    // Generate report
    this.generateReport();

    // Stop dashboard
    this.stopDashboardServer();
  }

  private async runTest(config: TestConfig): Promise<void> {
    console.log(`📋 Starting: ${config.name}`);
    console.log(`   Script: ${config.script}`);
    console.log(`   Duration: ${config.duration}s`);

    this.currentTest = { name: config.name };
    
    this.broadcastToDashboard({
      type: 'test-started',
      testType: config.name,
      config,
    });

    const startTime = Date.now();
    const scriptPath = path.join(__dirname, config.script);
    
    const result: TestResult = {
      name: config.name,
      passed: false,
      duration: 0,
      metrics: {},
      errors: [],
      summary: '',
    };

    try {
      const testMetrics = await this.executeTest(scriptPath, config);
      result.metrics = testMetrics;
      result.duration = (Date.now() - startTime) / 1000;
      
      // Validate against expected metrics
      if (config.expectedMetrics) {
        result.passed = this.validateMetrics(testMetrics, config.expectedMetrics, result.errors);
      } else {
        result.passed = true;
      }

      result.summary = this.generateTestSummary(config, testMetrics);
      
    } catch (error: any) {
      result.errors.push(error.message);
      result.summary = `Test failed: ${error.message}`;
    }

    this.results.push(result);
    
    this.broadcastToDashboard({
      type: 'test-completed',
      testType: config.name,
      result,
    });

    // Display result
    console.log(`\n${result.passed ? '✅' : '❌'} ${config.name}: ${result.passed ? 'PASSED' : 'FAILED'}`);
    console.log(`   ${result.summary}`);
    if (result.errors.length > 0) {
      console.log('   Errors:');
      result.errors.forEach(err => console.log(`     - ${err}`));
    }
  }

  private async executeTest(scriptPath: string, config: TestConfig): Promise<any> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...config.env };
      const child = spawn('ts-node', ['--transpile-only', scriptPath], { env });
      
      this.currentTest!.process = child;
      
      let output = '';
      let metrics: any = {};
      let lastMetricsUpdate = Date.now();

      child.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        // Parse metrics from output
        const metricsMatch = text.match(/Current Rate:\s*([\d,]+)\s*msg\/sec/);
        if (metricsMatch) {
          metrics.messagesPerSecond = parseInt(metricsMatch[1].replace(/,/g, ''));
        }
        
        const connectionsMatch = text.match(/Active Connections:\s*([\d,]+)/);
        if (connectionsMatch) {
          metrics.activeConnections = parseInt(connectionsMatch[1].replace(/,/g, ''));
        }
        
        const latencyMatch = text.match(/Average Latency:\s*([\d.]+)ms/);
        if (latencyMatch) {
          metrics.averageLatency = parseFloat(latencyMatch[1]);
        }
        
        // Broadcast metrics to dashboard
        if (Date.now() - lastMetricsUpdate > 1000) {
          this.broadcastToDashboard({
            type: 'metrics',
            metrics,
          });
          lastMetricsUpdate = Date.now();
        }
      });

      child.stderr.on('data', (data) => {
        console.error(data.toString());
      });

      // Set timeout for test duration
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
      }, config.duration * 1000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code !== 0 && code !== null) {
          reject(new Error(`Test exited with code ${code}`));
        } else {
          // Parse final metrics from output
          const finalMetrics = this.parseFinalMetrics(output);
          resolve({ ...metrics, ...finalMetrics });
        }
      });
    });
  }

  private parseFinalMetrics(output: string): any {
    const metrics: any = {};
    
    // Parse various metric patterns
    const patterns = {
      totalConnections: /Total Connections:\s*([\d,]+)/,
      peakConnections: /Peak Achieved:\s*([\d,]+)/,
      messagesPerSecond: /Peak Achieved:\s*([\d,]+)\s*msg\/sec/,
      averageLatency: /Avg Latency:\s*([\d.]+)ms/,
      p99Latency: /P99 Latency:\s*([\d.]+)ms/,
      errorRate: /Error Rate:\s*([\d.]+)%/,
      memoryLeak: /Memory Leak:\s*(DETECTED|NOT DETECTED)/,
      recoveryRate: /Recovery Success:\s*([\d.]+)%/,
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = output.match(pattern);
      if (match) {
        if (key === 'memoryLeak') {
          metrics[key] = match[1] === 'DETECTED';
        } else {
          metrics[key] = parseFloat(match[1].replace(/,/g, ''));
        }
      }
    }
    
    return metrics;
  }

  private validateMetrics(
    actual: any,
    expected: any,
    errors: string[]
  ): boolean {
    let passed = true;
    
    if (expected.minConnections && actual.totalConnections < expected.minConnections) {
      errors.push(`Connections ${actual.totalConnections} < ${expected.minConnections}`);
      passed = false;
    }
    
    if (expected.minMessagesPerSecond && actual.messagesPerSecond < expected.minMessagesPerSecond) {
      errors.push(`Messages/sec ${actual.messagesPerSecond} < ${expected.minMessagesPerSecond}`);
      passed = false;
    }
    
    if (expected.maxLatency && actual.averageLatency > expected.maxLatency) {
      errors.push(`Latency ${actual.averageLatency}ms > ${expected.maxLatency}ms`);
      passed = false;
    }
    
    if (expected.maxErrorRate && actual.errorRate > expected.maxErrorRate) {
      errors.push(`Error rate ${actual.errorRate}% > ${expected.maxErrorRate}%`);
      passed = false;
    }
    
    if (actual.memoryLeak === true) {
      errors.push('Memory leak detected');
      passed = false;
    }
    
    return passed;
  }

  private generateTestSummary(config: TestConfig, metrics: any): string {
    const parts: string[] = [];
    
    if (metrics.totalConnections) {
      parts.push(`${metrics.totalConnections.toLocaleString()} connections`);
    }
    
    if (metrics.messagesPerSecond) {
      parts.push(`${metrics.messagesPerSecond.toLocaleString()} msg/s`);
    }
    
    if (metrics.averageLatency) {
      parts.push(`${metrics.averageLatency.toFixed(2)}ms latency`);
    }
    
    if (metrics.errorRate !== undefined) {
      parts.push(`${metrics.errorRate.toFixed(2)}% errors`);
    }
    
    if (metrics.recoveryRate !== undefined) {
      parts.push(`${metrics.recoveryRate.toFixed(1)}% recovery`);
    }
    
    return parts.join(', ');
  }

  private generateReport(): void {
    const reportPath = path.join(process.cwd(), 'websocket-load-test-report.md');
    
    let report = '# WebSocket Load Testing Report\n\n';
    report += `Generated: ${new Date().toISOString()}\n\n`;
    
    // Summary
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    report += '## Summary\n\n';
    report += `- Total Tests: ${this.results.length}\n`;
    report += `- Passed: ${passed} ✅\n`;
    report += `- Failed: ${failed} ❌\n`;
    report += `- Success Rate: ${((passed / this.results.length) * 100).toFixed(1)}%\n\n`;
    
    // Detailed Results
    report += '## Detailed Results\n\n';
    
    for (const result of this.results) {
      report += `### ${result.name} ${result.passed ? '✅' : '❌'}\n\n`;
      report += `- Duration: ${result.duration.toFixed(1)}s\n`;
      report += `- Summary: ${result.summary}\n`;
      
      if (Object.keys(result.metrics).length > 0) {
        report += '\n**Metrics:**\n';
        for (const [key, value] of Object.entries(result.metrics)) {
          report += `- ${key}: ${value}\n`;
        }
      }
      
      if (result.errors.length > 0) {
        report += '\n**Errors:**\n';
        for (const error of result.errors) {
          report += `- ${error}\n`;
        }
      }
      
      report += '\n---\n\n';
    }
    
    // Recommendations
    report += '## Recommendations\n\n';
    
    if (failed > 0) {
      report += '### Failed Tests\n\n';
      for (const result of this.results.filter(r => !r.passed)) {
        report += `- **${result.name}**: `;
        if (result.errors.includes('Memory leak detected')) {
          report += 'Review memory management and cleanup procedures\n';
        } else if (result.errors.some(e => e.includes('Connections'))) {
          report += 'Increase server capacity or optimize connection handling\n';
        } else if (result.errors.some(e => e.includes('Messages/sec'))) {
          report += 'Optimize message processing or increase worker threads\n';
        } else if (result.errors.some(e => e.includes('Latency'))) {
          report += 'Review message processing pipeline for bottlenecks\n';
        }
      }
    }
    
    fs.writeFileSync(reportPath, report);
    console.log(`\n📄 Report saved to: ${reportPath}`);
  }

  private async startDashboardServer(): Promise<void> {
    const app = express();
    const server = http.createServer(app);
    
    // Serve dashboard HTML
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'dashboard', 'performance-dashboard.html'));
    });
    
    // WebSocket server for real-time updates
    this.dashboardWss = new WebSocket.Server({ server, path: '/dashboard' });
    
    this.dashboardWss.on('connection', (ws) => {
      this.dashboardClients.add(ws);
      
      ws.on('close', () => {
        this.dashboardClients.delete(ws);
      });
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleDashboardMessage(message, ws);
        } catch (error) {
          console.error('Dashboard message error:', error);
        }
      });
    });
    
    return new Promise((resolve) => {
      const port = 8081;
      this.dashboardServer = server.listen(port, () => {
        console.log(`📊 Dashboard available at: http://localhost:${port}`);
        resolve();
      });
    });
  }

  private handleDashboardMessage(message: any, ws: WebSocket): void {
    switch (message.type) {
      case 'stop-test':
        if (this.currentTest?.process) {
          this.currentTest.process.kill('SIGTERM');
        }
        break;
    }
  }

  private broadcastToDashboard(data: any): void {
    const message = JSON.stringify(data);
    this.dashboardClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private stopDashboardServer(): void {
    if (this.dashboardWss) {
      this.dashboardWss.close();
    }
    if (this.dashboardServer) {
      this.dashboardServer.close();
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run tests
if (require.main === module) {
  const runner = new WebSocketLoadTestRunner();
  
  runner.runAllTests()
    .then(() => {
      console.log('\n✅ All tests completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test runner failed:', error);
      process.exit(1);
    });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping test runner...');
    process.exit(0);
  });
}