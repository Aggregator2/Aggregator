/**
 * Custom Jest reporter for performance metrics
 */

const fs = require('fs');
const path = require('path');

class PerformanceReporter {
  constructor(globalConfig, options) {
    this._globalConfig = globalConfig;
    this._options = options;
    this.performanceData = {
      timestamp: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpus: require('os').cpus().length,
        memory: Math.round(require('os').totalmem() / 1024 / 1024 / 1024) + 'GB'
      },
      tests: []
    };
  }

  onTestResult(test, testResult) {
    // Extract performance metrics from console logs
    const performanceMetrics = this.extractPerformanceMetrics(testResult);
    
    if (performanceMetrics.length > 0) {
      this.performanceData.tests.push({
        testFile: path.relative(process.cwd(), test.path),
        duration: testResult.perfStats.runtime,
        metrics: performanceMetrics
      });
    }
  }

  onRunComplete(contexts, results) {
    // Calculate aggregate metrics
    const aggregateMetrics = this.calculateAggregateMetrics();
    this.performanceData.summary = {
      totalTests: results.numTotalTests,
      totalDuration: results.testResults.reduce((sum, r) => sum + r.perfStats.runtime, 0),
      passed: results.numPassedTests,
      failed: results.numFailedTests,
      aggregateMetrics
    };

    // Write results
    if (this._options.outputFile) {
      const outputPath = path.resolve(this._options.outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(this.performanceData, null, 2));
      console.log(`\nPerformance results written to: ${outputPath}`);
    }

    // Print summary to console
    this.printSummary();
  }

  extractPerformanceMetrics(testResult) {
    const metrics = [];
    
    // Look for specific metric patterns in console output
    testResult.testResults.forEach(test => {
      const consoleOutput = test.console || [];
      
      consoleOutput.forEach(log => {
        // Extract throughput metrics
        const throughputMatch = log.message.match(/throughput[:\s]+(\d+\.?\d*)\s*TPS/i);
        if (throughputMatch) {
          metrics.push({
            name: test.title,
            type: 'throughput',
            value: parseFloat(throughputMatch[1]),
            unit: 'TPS'
          });
        }

        // Extract latency metrics
        const latencyMatch = log.message.match(/(?:avg|average|p99|p95|p50)[\s]*latency[:\s]+(\d+\.?\d*)\s*ms/i);
        if (latencyMatch) {
          const latencyType = log.message.match(/(avg|average|p99|p95|p50)/i)?.[1] || 'avg';
          metrics.push({
            name: test.title,
            type: `latency_${latencyType.toLowerCase()}`,
            value: parseFloat(latencyMatch[1]),
            unit: 'ms'
          });
        }

        // Extract memory usage
        const memoryMatch = log.message.match(/memory[:\s]+(\d+\.?\d*)\s*MB/i);
        if (memoryMatch) {
          metrics.push({
            name: test.title,
            type: 'memory',
            value: parseFloat(memoryMatch[1]),
            unit: 'MB'
          });
        }
      });
    });

    return metrics;
  }

  calculateAggregateMetrics() {
    const allMetrics = this.performanceData.tests.flatMap(t => t.metrics);
    const metricsByType = {};

    allMetrics.forEach(metric => {
      if (!metricsByType[metric.type]) {
        metricsByType[metric.type] = [];
      }
      metricsByType[metric.type].push(metric.value);
    });

    const aggregates = {};
    Object.entries(metricsByType).forEach(([type, values]) => {
      const sorted = values.sort((a, b) => a - b);
      aggregates[type] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
        p99: sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1]
      };
    });

    return aggregates;
  }

  printSummary() {
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║          HFT Performance Test Summary          ║');
    console.log('╚════════════════════════════════════════════════╝\n');

    const summary = this.performanceData.summary;
    
    console.log(`Total Tests: ${summary.totalTests} (${summary.passed} passed, ${summary.failed} failed)`);
    console.log(`Total Duration: ${(summary.totalDuration / 1000).toFixed(2)}s\n`);

    if (summary.aggregateMetrics.throughput) {
      const tps = summary.aggregateMetrics.throughput;
      console.log('📊 Throughput (TPS):');
      console.log(`   Average: ${tps.avg.toFixed(0)} TPS`);
      console.log(`   P95: ${tps.p95.toFixed(0)} TPS`);
      console.log(`   Max: ${tps.max.toFixed(0)} TPS\n`);
    }

    if (summary.aggregateMetrics.latency_avg) {
      const latency = summary.aggregateMetrics.latency_avg;
      console.log('⏱️  Latency (ms):');
      console.log(`   Average: ${latency.avg.toFixed(2)}ms`);
      console.log(`   P95: ${latency.p95.toFixed(2)}ms`);
      console.log(`   P99: ${latency.p99.toFixed(2)}ms\n`);
    }

    if (summary.aggregateMetrics.memory) {
      const memory = summary.aggregateMetrics.memory;
      console.log('💾 Memory Usage:');
      console.log(`   Average: ${memory.avg.toFixed(2)} MB`);
      console.log(`   Peak: ${memory.max.toFixed(2)} MB\n`);
    }

    // Performance grade
    const grade = this.calculatePerformanceGrade();
    console.log(`Overall Performance Grade: ${grade}`);
    console.log('═══════════════════════════════════════════════\n');
  }

  calculatePerformanceGrade() {
    const metrics = this.performanceData.summary.aggregateMetrics;
    let score = 100;

    // Deduct points based on performance
    if (metrics.throughput && metrics.throughput.avg < 1000) score -= 20;
    if (metrics.latency_avg && metrics.latency_avg.avg > 10) score -= 20;
    if (metrics.latency_p99 && metrics.latency_p99.avg > 50) score -= 20;
    if (metrics.memory && metrics.memory.max > 500) score -= 10;

    if (score >= 90) return '🏆 A+ (Excellent)';
    if (score >= 80) return '✅ A (Very Good)';
    if (score >= 70) return '👍 B (Good)';
    if (score >= 60) return '⚠️  C (Needs Improvement)';
    return '❌ D (Poor)';
  }
}

module.exports = PerformanceReporter;