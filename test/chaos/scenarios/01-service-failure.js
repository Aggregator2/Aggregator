/**
 * Service Failure Chaos Scenario
 * Randomly kills services during load testing
 */

const ChaosMonkey = require('../lib/chaos-monkey');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configuration
const config = {
  duration: process.env.CHAOS_DURATION || 300000, // 5 minutes
  services: [
    {
      name: 'api-server',
      type: 'docker',
      container: 'swappiq-api',
      autoRecover: true,
      recoveryDelay: 30000 // 30 seconds
    },
    {
      name: 'order-matching-engine',
      type: 'process',
      pattern: 'order-matching',
      startCommand: 'npm run matching-engine',
      autoRecover: true,
      recoveryDelay: 20000
    },
    {
      name: 'settlement-processor',
      type: 'docker',
      container: 'swappiq-settlement',
      autoRecover: true,
      recoveryDelay: 45000
    },
    {
      name: 'websocket-server',
      type: 'process',
      pattern: 'ws-server',
      startCommand: 'npm run websocket',
      autoRecover: true,
      recoveryDelay: 15000
    },
    {
      name: 'monitoring-service',
      type: 'systemd',
      service: 'swappiq-monitoring',
      autoRecover: false // Don't auto-recover monitoring
    }
  ]
};

class ServiceFailureChaos {
  constructor() {
    this.chaos = new ChaosMonkey({
      services: config.services,
      probability: 0.3, // 30% chance per interval
      minDelay: 20000, // 20 seconds
      maxDelay: 60000, // 60 seconds
      logFile: '/tmp/service-failure-chaos.log'
    });
    
    this.metrics = {
      servicesKilled: 0,
      servicesRecovered: 0,
      failuresByService: {},
      startTime: Date.now()
    };
  }

  /**
   * Run chaos scenario
   */
  async run() {
    console.log('🚀 Starting Service Failure Chaos Scenario');
    console.log(`Duration: ${config.duration / 1000}s`);
    console.log(`Services monitored: ${config.services.length}`);
    console.log('=====================================\n');
    
    // Start monitoring
    this.startMonitoring();
    
    // Start load test in parallel
    this.startLoadTest();
    
    // Start chaos monkey
    const chaosPromise = this.chaos.start();
    
    // Run for specified duration
    setTimeout(async () => {
      await this.chaos.stop();
      await this.generateReport();
    }, config.duration);
    
    await chaosPromise;
  }

  /**
   * Start load testing
   */
  async startLoadTest() {
    console.log('📊 Starting load test in parallel...');
    
    try {
      // Run K6 steady state test
      exec('k6 run ../k6/scenarios/01-steady-state.js', (error, stdout, stderr) => {
        if (error) {
          console.error('Load test error:', error);
        }
      });
    } catch (error) {
      console.error('Failed to start load test:', error);
    }
  }

  /**
   * Monitor service health
   */
  startMonitoring() {
    this.monitorInterval = setInterval(async () => {
      const health = await this.checkSystemHealth();
      
      // Log critical issues
      if (health.downServices.length > 0) {
        console.log(`⚠️ Services down: ${health.downServices.join(', ')}`);
      }
      
      if (health.apiResponseTime > 1000) {
        console.log(`⚠️ High API response time: ${health.apiResponseTime}ms`);
      }
      
      if (health.errorRate > 0.05) {
        console.log(`⚠️ High error rate: ${(health.errorRate * 100).toFixed(1)}%`);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Check system health during chaos
   */
  async checkSystemHealth() {
    const health = {
      timestamp: Date.now(),
      downServices: [],
      apiResponseTime: 0,
      errorRate: 0,
      activeConnections: 0
    };
    
    // Check each service
    for (const service of config.services) {
      const isUp = await this.isServiceUp(service);
      if (!isUp) {
        health.downServices.push(service.name);
      }
    }
    
    // Check API health
    try {
      const startTime = Date.now();
      await execAsync('curl -s http://localhost:3000/api/health');
      health.apiResponseTime = Date.now() - startTime;
    } catch (error) {
      health.apiResponseTime = -1; // API is down
    }
    
    return health;
  }

  /**
   * Check if service is up
   */
  async isServiceUp(service) {
    try {
      switch (service.type) {
        case 'docker':
          const dockerResult = await execAsync(`docker ps | grep ${service.container}`);
          return dockerResult.stdout.includes(service.container);
          
        case 'process':
          const psResult = await execAsync(`pgrep -f "${service.pattern}"`);
          return psResult.stdout.trim().length > 0;
          
        case 'systemd':
          const systemdResult = await execAsync(`systemctl is-active ${service.service}`);
          return systemdResult.stdout.trim() === 'active';
          
        default:
          return false;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate chaos report
   */
  async generateReport() {
    clearInterval(this.monitorInterval);
    
    const duration = (Date.now() - this.metrics.startTime) / 1000;
    
    console.log('\n=====================================');
    console.log('📊 Service Failure Chaos Report');
    console.log('=====================================');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Services Killed: ${this.metrics.servicesKilled}`);
    console.log(`Services Recovered: ${this.metrics.servicesRecovered}`);
    
    console.log('\nFailures by Service:');
    for (const [service, count] of Object.entries(this.metrics.failuresByService)) {
      console.log(`  ${service}: ${count} failures`);
    }
    
    // Check final system state
    const finalHealth = await this.checkSystemHealth();
    console.log('\nFinal System State:');
    console.log(`  Services Up: ${config.services.length - finalHealth.downServices.length}/${config.services.length}`);
    console.log(`  API Response Time: ${finalHealth.apiResponseTime}ms`);
    
    // Analyze resilience
    console.log('\n🎯 Resilience Analysis:');
    const resilienceScore = this.calculateResilienceScore();
    console.log(`  Overall Score: ${resilienceScore}/100`);
    
    if (resilienceScore >= 80) {
      console.log('  ✅ Excellent resilience to service failures');
    } else if (resilienceScore >= 60) {
      console.log('  ⚠️ Good resilience with room for improvement');
    } else {
      console.log('  ❌ Poor resilience - system needs hardening');
    }
    
    console.log('=====================================\n');
  }

  /**
   * Calculate resilience score
   */
  calculateResilienceScore() {
    // Factors:
    // - Recovery rate
    // - API availability
    // - Error rate during chaos
    // - Time to recover
    
    const recoveryRate = this.metrics.servicesRecovered / this.metrics.servicesKilled;
    const score = recoveryRate * 100;
    
    return Math.min(100, Math.max(0, score));
  }
}

// Run chaos scenario
if (require.main === module) {
  const chaos = new ServiceFailureChaos();
  
  chaos.run().catch(error => {
    console.error('Chaos scenario failed:', error);
    process.exit(1);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping chaos scenario...');
    await chaos.chaos.stop();
    process.exit(0);
  });
}

module.exports = ServiceFailureChaos;