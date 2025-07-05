#!/usr/bin/env node

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

interface TestResult {
  suite: string;
  passed: number;
  failed: number;
  duration: number;
  errors: string[];
}

interface HealthCheck {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: any;
  timestamp: number;
}

class WebSocketTestRunner {
  private results: TestResult[] = [];
  private healthChecks: HealthCheck[] = [];
  private reportDir: string;

  constructor() {
    this.reportDir = join(process.cwd(), 'test-reports');
    if (!existsSync(this.reportDir)) {
      mkdirSync(this.reportDir, { recursive: true });
    }
  }

  async runTests(): Promise<void> {
    console.log('🚀 Starting WebSocket and Redis Integration Tests...\n');

    // Run health checks first
    await this.runHealthChecks();

    // Run test suites
    const testSuites = [
      {
        name: 'WebSocket Tests',
        path: 'tests/websocket/websocket.test.ts'
      },
      {
        name: 'Redis Tests',
        path: 'tests/redis/redis.test.ts'
      },
      {
        name: 'Integration Tests',
        path: 'tests/integration/websocket-redis.test.ts'
      }
    ];

    for (const suite of testSuites) {
      await this.runTestSuite(suite);
    }

    // Generate report
    await this.generateReport();
  }

  private async runHealthChecks(): Promise<void> {
    console.log('🏥 Running health checks...\n');

    // Check Redis
    await this.checkRedis();

    // Check WebSocket Server
    await this.checkWebSocket();

    // Check Node.js memory
    this.checkMemory();
  }

  private async checkRedis(): Promise<void> {
    try {
      const { stdout } = await execAsync('redis-cli ping');
      const isHealthy = stdout.trim() === 'PONG';
      
      this.healthChecks.push({
        service: 'Redis',
        status: isHealthy ? 'healthy' : 'unhealthy',
        details: {
          ping: stdout.trim(),
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || '6379'
        },
        timestamp: Date.now()
      });

      console.log(`✅ Redis: ${isHealthy ? 'Healthy' : 'Unhealthy'}`);
    } catch (error) {
      this.healthChecks.push({
        service: 'Redis',
        status: 'unhealthy',
        details: { error: error.message },
        timestamp: Date.now()
      });
      console.log('❌ Redis: Unhealthy');
    }
  }

  private async checkWebSocket(): Promise<void> {
    try {
      const response = await fetch('http://localhost:3000/api/websocket');
      const data = await response.json();
      
      this.healthChecks.push({
        service: 'WebSocket',
        status: response.ok ? 'healthy' : 'degraded',
        details: data,
        timestamp: Date.now()
      });

      console.log(`✅ WebSocket: ${response.ok ? 'Healthy' : 'Degraded'}`);
    } catch (error) {
      this.healthChecks.push({
        service: 'WebSocket',
        status: 'unhealthy',
        details: { error: error.message },
        timestamp: Date.now()
      });
      console.log('❌ WebSocket: Unhealthy');
    }
  }

  private checkMemory(): void {
    const usage = process.memoryUsage();
    const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(usage.rss / 1024 / 1024);

    this.healthChecks.push({
      service: 'Node.js Memory',
      status: heapUsedMB < 500 ? 'healthy' : 'degraded',
      details: {
        heapUsed: `${heapUsedMB} MB`,
        heapTotal: `${heapTotalMB} MB`,
        rss: `${rssMB} MB`,
        external: Math.round(usage.external / 1024 / 1024) + ' MB'
      },
      timestamp: Date.now()
    });

    console.log(`✅ Memory: ${heapUsedMB}/${heapTotalMB} MB\n`);
  }

  private async runTestSuite(suite: { name: string; path: string }): Promise<void> {
    console.log(`\n📋 Running ${suite.name}...`);
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(
        `npx jest ${suite.path} --json --outputFile=${this.reportDir}/temp.json`,
        { env: { ...process.env, NODE_ENV: 'test' } }
      );

      // Parse Jest output
      const report = require(join(this.reportDir, 'temp.json'));
      
      const result: TestResult = {
        suite: suite.name,
        passed: report.numPassedTests || 0,
        failed: report.numFailedTests || 0,
        duration: Date.now() - startTime,
        errors: []
      };

      if (report.testResults) {
        report.testResults.forEach((testFile: any) => {
          testFile.assertionResults?.forEach((assertion: any) => {
            if (assertion.status === 'failed') {
              result.errors.push(`${assertion.title}: ${assertion.failureMessages?.join(', ')}`);
            }
          });
        });
      }

      this.results.push(result);

      console.log(`✅ ${suite.name}: ${result.passed} passed, ${result.failed} failed (${result.duration}ms)`);
    } catch (error) {
      const result: TestResult = {
        suite: suite.name,
        passed: 0,
        failed: 1,
        duration: Date.now() - startTime,
        errors: [error.message]
      };
      
      this.results.push(result);
      console.log(`❌ ${suite.name}: Failed to run tests`);
    }
  }

  private async generateReport(): Promise<void> {
    console.log('\n📊 Generating test report...\n');

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalSuites: this.results.length,
        totalPassed: this.results.reduce((sum, r) => sum + r.passed, 0),
        totalFailed: this.results.reduce((sum, r) => sum + r.failed, 0),
        totalDuration: this.results.reduce((sum, r) => sum + r.duration, 0)
      },
      healthChecks: this.healthChecks,
      testResults: this.results,
      recommendations: this.generateRecommendations()
    };

    // Write JSON report
    writeFileSync(
      join(this.reportDir, `websocket-redis-report-${Date.now()}.json`),
      JSON.stringify(report, null, 2)
    );

    // Write HTML report
    const htmlReport = this.generateHTMLReport(report);
    writeFileSync(
      join(this.reportDir, `websocket-redis-report-${Date.now()}.html`),
      htmlReport
    );

    // Print summary
    this.printSummary(report);
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // Check health status
    const unhealthyServices = this.healthChecks.filter(h => h.status !== 'healthy');
    if (unhealthyServices.length > 0) {
      recommendations.push('⚠️ Some services are not healthy. Check service configurations.');
    }

    // Check test failures
    const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
    if (totalFailed > 0) {
      recommendations.push(`⚠️ ${totalFailed} tests failed. Review error logs for details.`);
    }

    // Check performance
    const slowTests = this.results.filter(r => r.duration > 30000);
    if (slowTests.length > 0) {
      recommendations.push('⚠️ Some test suites are running slowly. Consider optimization.');
    }

    // Memory check
    const memoryCheck = this.healthChecks.find(h => h.service === 'Node.js Memory');
    if (memoryCheck && memoryCheck.status === 'degraded') {
      recommendations.push('⚠️ High memory usage detected. Check for memory leaks.');
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ All systems operational. No issues detected.');
    }

    return recommendations;
  }

  private generateHTMLReport(report: any): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>WebSocket & Redis Test Report</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1, h2 {
            color: #333;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .summary-card {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            text-align: center;
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            color: #666;
        }
        .summary-card .value {
            font-size: 24px;
            font-weight: bold;
        }
        .passed { color: #28a745; }
        .failed { color: #dc3545; }
        .health-status {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            margin-right: 10px;
        }
        .healthy { background-color: #d4edda; color: #155724; }
        .degraded { background-color: #fff3cd; color: #856404; }
        .unhealthy { background-color: #f8d7da; color: #721c24; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: bold;
        }
        .error {
            background-color: #f8d7da;
            padding: 10px;
            border-radius: 4px;
            margin: 5px 0;
            font-family: monospace;
            font-size: 12px;
        }
        .recommendation {
            background-color: #e7f3ff;
            padding: 10px;
            border-left: 4px solid #0066cc;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>WebSocket & Redis Test Report</h1>
        <p>Generated: ${report.timestamp}</p>
        
        <h2>Summary</h2>
        <div class="summary">
            <div class="summary-card">
                <h3>Total Tests</h3>
                <div class="value">${report.summary.totalPassed + report.summary.totalFailed}</div>
            </div>
            <div class="summary-card">
                <h3>Passed</h3>
                <div class="value passed">${report.summary.totalPassed}</div>
            </div>
            <div class="summary-card">
                <h3>Failed</h3>
                <div class="value failed">${report.summary.totalFailed}</div>
            </div>
            <div class="summary-card">
                <h3>Duration</h3>
                <div class="value">${(report.summary.totalDuration / 1000).toFixed(2)}s</div>
            </div>
        </div>

        <h2>Health Checks</h2>
        <table>
            <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Details</th>
            </tr>
            ${report.healthChecks.map(h => `
                <tr>
                    <td>${h.service}</td>
                    <td><span class="health-status ${h.status}">${h.status.toUpperCase()}</span></td>
                    <td>${JSON.stringify(h.details, null, 2)}</td>
                </tr>
            `).join('')}
        </table>

        <h2>Test Results</h2>
        <table>
            <tr>
                <th>Test Suite</th>
                <th>Passed</th>
                <th>Failed</th>
                <th>Duration</th>
            </tr>
            ${report.testResults.map(r => `
                <tr>
                    <td>${r.suite}</td>
                    <td class="passed">${r.passed}</td>
                    <td class="failed">${r.failed}</td>
                    <td>${(r.duration / 1000).toFixed(2)}s</td>
                </tr>
            `).join('')}
        </table>

        ${report.testResults.some(r => r.errors.length > 0) ? `
            <h2>Errors</h2>
            ${report.testResults.filter(r => r.errors.length > 0).map(r => `
                <h3>${r.suite}</h3>
                ${r.errors.map(e => `<div class="error">${e}</div>`).join('')}
            `).join('')}
        ` : ''}

        <h2>Recommendations</h2>
        ${report.recommendations.map(r => `
            <div class="recommendation">${r}</div>
        `).join('')}
    </div>
</body>
</html>
    `;
  }

  private printSummary(report: any): void {
    console.log('\n' + '='.repeat(50));
    console.log('TEST EXECUTION SUMMARY');
    console.log('='.repeat(50));
    console.log(`Total Tests: ${report.summary.totalPassed + report.summary.totalFailed}`);
    console.log(`Passed: ${report.summary.totalPassed}`);
    console.log(`Failed: ${report.summary.totalFailed}`);
    console.log(`Duration: ${(report.summary.totalDuration / 1000).toFixed(2)}s`);
    console.log('\nRecommendations:');
    report.recommendations.forEach(r => console.log(r));
    console.log('\n✅ Report generated in:', this.reportDir);
  }
}

// Run tests
const runner = new WebSocketTestRunner();
runner.runTests().catch(console.error);