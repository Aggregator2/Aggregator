#!/usr/bin/env node

/**
 * Performance Regression Detection Script
 * Compares current performance test results against baseline
 * and determines if there are any performance regressions
 */

const fs = require('fs');
const path = require('path');
const { program } = require('commander');

// Performance regression thresholds (percentages)
const DEFAULT_THRESHOLDS = {
  responseTime: {
    p95: 10,     // 10% increase in P95 response time
    median: 15,  // 15% increase in median response time
    mean: 20     // 20% increase in mean response time
  },
  throughput: {
    degradation: 10,  // 10% decrease in throughput
    minimum: 35.0     // Minimum acceptable RPS
  },
  errorRate: {
    increase: 50,     // 50% increase in error rate
    maximum: 2.0      // Maximum acceptable error rate (%)
  },
  resourceUsage: {
    cpu: 25,          // 25% increase in CPU usage
    memory: 30        // 30% increase in memory usage
  }
};

class PerformanceRegressionAnalyzer {
  constructor(options = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
    this.verbose = options.verbose || false;
    this.results = {
      passed: true,
      regressions: [],
      improvements: [],
      summary: {},
      recommendations: []
    };
  }

  /**
   * Load and parse JSON file
   */
  loadJsonFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load ${filePath}: ${error.message}`);
    }
  }

  /**
   * Main analysis function
   */
  async analyze(currentFile, baselineFile) {
    console.log('🔍 Starting performance regression analysis...');
    
    const current = this.loadJsonFile(currentFile);
    const baseline = this.loadJsonFile(baselineFile);
    
    // Analyze different performance aspects
    this.analyzeResponseTimes(current, baseline);
    this.analyzeThroughput(current, baseline);
    this.analyzeErrorRates(current, baseline);
    this.analyzeResourceUsage(current, baseline);
    this.analyzeEndpointPerformance(current, baseline);
    
    // Generate summary and recommendations
    this.generateSummary(current, baseline);
    this.generateRecommendations();
    
    return this.results;
  }

  /**
   * Analyze response time metrics
   */
  analyzeResponseTimes(current, baseline) {
    const currentMetrics = current.performance_metrics?.response_times || current.aggregate?.response_time;
    const baselineMetrics = baseline.performance_metrics?.response_times || baseline.aggregate?.response_time;
    
    if (!currentMetrics || !baselineMetrics) {
      console.warn('⚠️  Response time metrics not found in one or both files');
      return;
    }

    const metrics = ['mean', 'median', 'p95', 'p99'];
    
    metrics.forEach(metric => {
      const currentValue = currentMetrics[metric];
      const baselineValue = baselineMetrics[metric];
      
      if (currentValue && baselineValue) {
        const change = ((currentValue - baselineValue) / baselineValue) * 100;
        const threshold = this.thresholds.responseTime[metric] || this.thresholds.responseTime.mean;
        
        if (change > threshold) {
          this.results.regressions.push({
            category: 'response_time',
            metric: metric,
            current: currentValue,
            baseline: baselineValue,
            change: change,
            threshold: threshold,
            severity: change > threshold * 2 ? 'critical' : 'high'
          });
          this.results.passed = false;
        } else if (change < -5) { // Improvement > 5%
          this.results.improvements.push({
            category: 'response_time',
            metric: metric,
            current: currentValue,
            baseline: baselineValue,
            change: change
          });
        }
        
        if (this.verbose) {
          console.log(`📊 Response time ${metric}: ${currentValue}ms (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
        }
      }
    });
  }

  /**
   * Analyze throughput metrics
   */
  analyzeThroughput(current, baseline) {
    const currentThroughput = current.performance_metrics?.throughput?.requests_per_second || 
                             current.aggregate?.rps?.mean;
    const baselineThroughput = baseline.performance_metrics?.throughput?.requests_per_second || 
                              baseline.aggregate?.rps?.mean;
    
    if (currentThroughput && baselineThroughput) {
      const change = ((currentThroughput - baselineThroughput) / baselineThroughput) * 100;
      
      if (change < -this.thresholds.throughput.degradation) {
        this.results.regressions.push({
          category: 'throughput',
          metric: 'requests_per_second',
          current: currentThroughput,
          baseline: baselineThroughput,
          change: change,
          threshold: -this.thresholds.throughput.degradation,
          severity: change < -this.thresholds.throughput.degradation * 2 ? 'critical' : 'high'
        });
        this.results.passed = false;
      }
      
      if (currentThroughput < this.thresholds.throughput.minimum) {
        this.results.regressions.push({
          category: 'throughput',
          metric: 'minimum_threshold',
          current: currentThroughput,
          baseline: baselineThroughput,
          change: change,
          threshold: this.thresholds.throughput.minimum,
          severity: 'critical'
        });
        this.results.passed = false;
      }
      
      if (change > 5) { // Improvement > 5%
        this.results.improvements.push({
          category: 'throughput',
          metric: 'requests_per_second',
          current: currentThroughput,
          baseline: baselineThroughput,
          change: change
        });
      }
      
      if (this.verbose) {
        console.log(`📊 Throughput: ${currentThroughput} RPS (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
      }
    }
  }

  /**
   * Analyze error rate metrics
   */
  analyzeErrorRates(current, baseline) {
    const currentErrorRate = current.performance_metrics?.error_rates?.error_rate_percent || 
                            (current.aggregate?.codes?.['4xx'] + current.aggregate?.codes?.['5xx']) / current.aggregate?.codes?.total * 100;
    const baselineErrorRate = baseline.performance_metrics?.error_rates?.error_rate_percent ||
                             (baseline.aggregate?.codes?.['4xx'] + baseline.aggregate?.codes?.['5xx']) / baseline.aggregate?.codes?.total * 100;
    
    if (currentErrorRate !== undefined && baselineErrorRate !== undefined) {
      const change = baselineErrorRate > 0 ? ((currentErrorRate - baselineErrorRate) / baselineErrorRate) * 100 : 
                     currentErrorRate > 0 ? 100 : 0;
      
      if (change > this.thresholds.errorRate.increase) {
        this.results.regressions.push({
          category: 'error_rate',
          metric: 'error_rate_percent',
          current: currentErrorRate,
          baseline: baselineErrorRate,
          change: change,
          threshold: this.thresholds.errorRate.increase,
          severity: change > this.thresholds.errorRate.increase * 2 ? 'critical' : 'high'
        });
        this.results.passed = false;
      }
      
      if (currentErrorRate > this.thresholds.errorRate.maximum) {
        this.results.regressions.push({
          category: 'error_rate',
          metric: 'maximum_threshold',
          current: currentErrorRate,
          baseline: baselineErrorRate,
          change: change,
          threshold: this.thresholds.errorRate.maximum,
          severity: 'critical'
        });
        this.results.passed = false;
      }
      
      if (this.verbose) {
        console.log(`📊 Error rate: ${currentErrorRate.toFixed(2)}% (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
      }
    }
  }

  /**
   * Analyze resource usage metrics
   */
  analyzeResourceUsage(current, baseline) {
    const currentCpu = current.performance_metrics?.resource_utilization?.cpu_average_percent;
    const baselineCpu = baseline.performance_metrics?.resource_utilization?.cpu_average_percent;
    
    const currentMemory = current.performance_metrics?.resource_utilization?.memory_average_mb;
    const baselineMemory = baseline.performance_metrics?.resource_utilization?.memory_average_mb;
    
    // Analyze CPU usage
    if (currentCpu && baselineCpu) {
      const change = ((currentCpu - baselineCpu) / baselineCpu) * 100;
      
      if (change > this.thresholds.resourceUsage.cpu) {
        this.results.regressions.push({
          category: 'resource_usage',
          metric: 'cpu_usage',
          current: currentCpu,
          baseline: baselineCpu,
          change: change,
          threshold: this.thresholds.resourceUsage.cpu,
          severity: change > this.thresholds.resourceUsage.cpu * 2 ? 'critical' : 'medium'
        });
      }
      
      if (this.verbose) {
        console.log(`📊 CPU usage: ${currentCpu}% (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
      }
    }
    
    // Analyze memory usage
    if (currentMemory && baselineMemory) {
      const change = ((currentMemory - baselineMemory) / baselineMemory) * 100;
      
      if (change > this.thresholds.resourceUsage.memory) {
        this.results.regressions.push({
          category: 'resource_usage',
          metric: 'memory_usage',
          current: currentMemory,
          baseline: baselineMemory,
          change: change,
          threshold: this.thresholds.resourceUsage.memory,
          severity: change > this.thresholds.resourceUsage.memory * 2 ? 'critical' : 'medium'
        });
      }
      
      if (this.verbose) {
        console.log(`📊 Memory usage: ${currentMemory}MB (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
      }
    }
  }

  /**
   * Analyze endpoint-specific performance
   */
  analyzeEndpointPerformance(current, baseline) {
    const currentEndpoints = current.endpoint_performance || {};
    const baselineEndpoints = baseline.endpoint_performance || {};
    
    Object.keys(currentEndpoints).forEach(endpoint => {
      if (baselineEndpoints[endpoint]) {
        const currentP95 = currentEndpoints[endpoint].p95_response_time;
        const baselineP95 = baselineEndpoints[endpoint].p95_response_time;
        
        if (currentP95 && baselineP95) {
          const change = ((currentP95 - baselineP95) / baselineP95) * 100;
          
          if (change > this.thresholds.responseTime.p95) {
            this.results.regressions.push({
              category: 'endpoint_performance',
              metric: 'p95_response_time',
              endpoint: endpoint,
              current: currentP95,
              baseline: baselineP95,
              change: change,
              threshold: this.thresholds.responseTime.p95,
              severity: change > this.thresholds.responseTime.p95 * 2 ? 'critical' : 'medium'
            });
          }
        }
      }
    });
  }

  /**
   * Generate analysis summary
   */
  generateSummary(current, baseline) {
    this.results.summary = {
      total_regressions: this.results.regressions.length,
      critical_regressions: this.results.regressions.filter(r => r.severity === 'critical').length,
      high_regressions: this.results.regressions.filter(r => r.severity === 'high').length,
      medium_regressions: this.results.regressions.filter(r => r.severity === 'medium').length,
      improvements: this.results.improvements.length,
      overall_status: this.results.passed ? 'PASS' : 'FAIL'
    };
  }

  /**
   * Generate recommendations based on findings
   */
  generateRecommendations() {
    const criticalRegressions = this.results.regressions.filter(r => r.severity === 'critical');
    const responseTimeRegressions = this.results.regressions.filter(r => r.category === 'response_time');
    const throughputRegressions = this.results.regressions.filter(r => r.category === 'throughput');
    
    if (criticalRegressions.length > 0) {
      this.results.recommendations.push({
        priority: 'critical',
        description: 'Critical performance regressions detected. Immediate investigation required.',
        action: 'Review recent code changes, database queries, and external service integrations'
      });
    }
    
    if (responseTimeRegressions.length > 0) {
      this.results.recommendations.push({
        priority: 'high',
        description: 'Response time degradation detected.',
        action: 'Profile application performance, check database query performance, and review caching strategies'
      });
    }
    
    if (throughputRegressions.length > 0) {
      this.results.recommendations.push({
        priority: 'high',
        description: 'Throughput degradation detected.',
        action: 'Check for resource constraints, connection pool limits, and concurrency bottlenecks'
      });
    }
  }

  /**
   * Print analysis results
   */
  printResults() {
    console.log('\n📈 Performance Regression Analysis Results');
    console.log('==========================================');
    
    console.log(`\n📊 Summary:`);
    console.log(`   Overall Status: ${this.results.summary.overall_status}`);
    console.log(`   Total Regressions: ${this.results.summary.total_regressions}`);
    console.log(`   Critical: ${this.results.summary.critical_regressions}`);
    console.log(`   High: ${this.results.summary.high_regressions}`);
    console.log(`   Medium: ${this.results.summary.medium_regressions}`);
    console.log(`   Improvements: ${this.results.summary.improvements}`);
    
    if (this.results.regressions.length > 0) {
      console.log(`\n❌ Performance Regressions Detected:`);
      this.results.regressions.forEach((regression, index) => {
        console.log(`   ${index + 1}. [${regression.severity.toUpperCase()}] ${regression.category}/${regression.metric}`);
        console.log(`      Current: ${regression.current} | Baseline: ${regression.baseline}`);
        console.log(`      Change: ${regression.change > 0 ? '+' : ''}${regression.change.toFixed(1)}% (threshold: ${regression.threshold}%)`);
        if (regression.endpoint) {
          console.log(`      Endpoint: ${regression.endpoint}`);
        }
      });
    }
    
    if (this.results.improvements.length > 0) {
      console.log(`\n✅ Performance Improvements:`);
      this.results.improvements.forEach((improvement, index) => {
        console.log(`   ${index + 1}. ${improvement.category}/${improvement.metric}`);
        console.log(`      Current: ${improvement.current} | Baseline: ${improvement.baseline}`);
        console.log(`      Improvement: ${Math.abs(improvement.change).toFixed(1)}%`);
      });
    }
    
    if (this.results.recommendations.length > 0) {
      console.log(`\n💡 Recommendations:`);
      this.results.recommendations.forEach((rec, index) => {
        console.log(`   ${index + 1}. [${rec.priority.toUpperCase()}] ${rec.description}`);
        console.log(`      Action: ${rec.action}`);
      });
    }
    
    console.log('\n==========================================');
  }
}

// CLI setup
program
  .version('1.0.0')
  .description('Performance regression detection tool')
  .requiredOption('-c, --current <file>', 'Current performance test results file')
  .requiredOption('-b, --baseline <file>', 'Baseline performance results file')
  .option('-t, --threshold <percent>', 'Performance degradation threshold percentage', '10')
  .option('-v, --verbose', 'Verbose output')
  .option('-o, --output <file>', 'Output results to JSON file')
  .option('--fail-on-regression', 'Exit with non-zero code if regressions detected');

program.parse();

const options = program.opts();

async function main() {
  try {
    const analyzer = new PerformanceRegressionAnalyzer({
      verbose: options.verbose,
      thresholds: {
        responseTime: {
          p95: parseInt(options.threshold),
          median: parseInt(options.threshold) + 5,
          mean: parseInt(options.threshold) + 10
        },
        throughput: {
          degradation: parseInt(options.threshold)
        }
      }
    });
    
    const results = await analyzer.analyze(options.current, options.baseline);
    
    analyzer.printResults();
    
    if (options.output) {
      fs.writeFileSync(options.output, JSON.stringify(results, null, 2));
      console.log(`\n📄 Results saved to: ${options.output}`);
    }
    
    if (options.failOnRegression && !results.passed) {
      console.log('\n❌ Performance regressions detected. Exiting with error code.');
      process.exit(1);
    }
    
    if (results.passed) {
      console.log('\n✅ No performance regressions detected!');
    }
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = PerformanceRegressionAnalyzer;