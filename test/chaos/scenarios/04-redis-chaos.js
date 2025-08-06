/**
 * Redis Chaos Scenario
 * Tests Redis cluster failures, memory issues, and data consistency
 */

const RedisChaos = require('../lib/redis-chaos');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class RedisChaosScenario {
  constructor() {
    this.redisChaos = new RedisChaos({
      clusterNodes: [
        { host: 'localhost', port: 7000, dockerContainer: 'redis-node-1' },
        { host: 'localhost', port: 7001, dockerContainer: 'redis-node-2' },
        { host: 'localhost', port: 7002, dockerContainer: 'redis-node-3' },
        { host: 'localhost', port: 7003, dockerContainer: 'redis-node-4' },
        { host: 'localhost', port: 7004, dockerContainer: 'redis-node-5' },
        { host: 'localhost', port: 7005, dockerContainer: 'redis-node-6' }
      ],
      sentinelNodes: [
        { host: 'localhost', port: 26379 },
        { host: 'localhost', port: 26380 },
        { host: 'localhost', port: 26381 }
      ],
      masterName: 'mymaster',
      redisPassword: process.env.REDIS_PASSWORD
    });
    
    this.config = {
      duration: process.env.CHAOS_DURATION || 300000, // 5 minutes
      scenarios: [
        { name: 'node_kill', weight: 25, cooldown: 60 },
        { name: 'cluster_partition', weight: 20, cooldown: 120 },
        { name: 'memory_pressure', weight: 20, cooldown: 90 },
        { name: 'slow_node', weight: 15, cooldown: 60 },
        { name: 'sentinel_failover', weight: 10, cooldown: 180 },
        { name: 'oom_simulation', weight: 10, cooldown: 120 }
      ]
    };
    
    this.lastScenarioTime = {};
    this.metrics = {
      startTime: Date.now(),
      scenariosExecuted: {},
      nodeFailures: 0,
      failovers: 0,
      dataLoss: false,
      consistencyErrors: 0
    };
  }

  /**
   * Run Redis chaos scenario
   */
  async run() {
    console.log('🔴 Starting Redis Chaos Scenario');
    console.log(`Duration: ${this.config.duration / 1000}s`);
    console.log('=================================\n');
    
    // Check initial cluster health
    const initialHealth = await this.redisChaos.checkClusterHealth();
    console.log('Initial cluster health:');
    initialHealth.forEach(node => {
      console.log(`  ${node.node}: ${node.healthy ? '✅' : '❌'}`);
    });
    console.log('');
    
    // Start monitoring
    const monitorInterval = setInterval(async () => {
      await this.monitorRedis();
    }, 10000);
    
    // Start load test
    this.startLoadTest();
    
    // Apply chaos scenarios
    const chaosInterval = setInterval(async () => {
      await this.applyRandomScenario();
    }, 30000); // Every 30 seconds
    
    // Data consistency checks
    const consistencyInterval = setInterval(async () => {
      await this.checkDataConsistency();
    }, 20000);
    
    // Run for duration
    setTimeout(async () => {
      clearInterval(chaosInterval);
      clearInterval(monitorInterval);
      clearInterval(consistencyInterval);
      await this.redisChaos.recoverAll();
      await this.generateReport();
      process.exit(0);
    }, this.config.duration);
  }

  /**
   * Apply random Redis chaos scenario
   */
  async applyRandomScenario() {
    // Filter scenarios based on cooldown
    const availableScenarios = this.config.scenarios.filter(scenario => {
      const lastTime = this.lastScenarioTime[scenario.name] || 0;
      return (Date.now() - lastTime) > (scenario.cooldown * 1000);
    });
    
    if (availableScenarios.length === 0) {
      console.log('⏳ All scenarios on cooldown');
      return;
    }
    
    // Select scenario
    const totalWeight = availableScenarios.reduce((sum, s) => sum + s.weight, 0);
    const random = Math.random() * totalWeight;
    
    let accumulator = 0;
    for (const scenario of availableScenarios) {
      accumulator += scenario.weight;
      if (random <= accumulator) {
        console.log(`\n🎲 Executing: ${scenario.name}`);
        await this.executeScenario(scenario.name);
        
        this.lastScenarioTime[scenario.name] = Date.now();
        this.metrics.scenariosExecuted[scenario.name] = 
          (this.metrics.scenariosExecuted[scenario.name] || 0) + 1;
        
        break;
      }
    }
  }

  /**
   * Execute specific Redis chaos scenario
   */
  async executeScenario(scenario) {
    try {
      switch (scenario) {
        case 'node_kill':
          await this.killRedisNode();
          break;
        
        case 'cluster_partition':
          await this.partitionCluster();
          break;
        
        case 'memory_pressure':
          await this.applyMemoryPressure();
          break;
        
        case 'slow_node':
          await this.slowDownNode();
          break;
        
        case 'sentinel_failover':
          await this.triggerSentinelFailover();
          break;
        
        case 'oom_simulation':
          await this.simulateOOM();
          break;
      }
    } catch (error) {
      console.error(`Failed to execute ${scenario}:`, error.message);
    }
  }

  /**
   * Kill a Redis node
   */
  async killRedisNode() {
    const result = await this.redisChaos.killClusterNode();
    
    if (result.success) {
      this.metrics.nodeFailures++;
      console.log(`Node ${result.node.host}:${result.node.port} killed`);
      
      // Schedule recovery
      setTimeout(async () => {
        console.log(`🔧 Recovering node ${result.node.host}:${result.node.port}`);
        if (result.node.dockerContainer) {
          await execAsync(`docker start ${result.node.dockerContainer}`);
        }
      }, 60000); // Recover after 1 minute
    }
  }

  /**
   * Create network partition
   */
  async partitionCluster() {
    const result = await this.redisChaos.partitionCluster();
    
    if (result.success) {
      console.log('Cluster partitioned into two groups');
      console.log(`Group 1: ${result.groups[0].length} nodes`);
      console.log(`Group 2: ${result.groups[1].length} nodes`);
    }
  }

  /**
   * Apply memory pressure
   */
  async applyMemoryPressure() {
    const nodes = this.redisChaos.config.clusterNodes;
    const targetNode = nodes[Math.floor(Math.random() * nodes.length)];
    const fillPercent = Math.floor(Math.random() * 30) + 60; // 60-90%
    
    console.log(`💾 Filling memory to ${fillPercent}% on ${targetNode.host}:${targetNode.port}`);
    const result = await this.redisChaos.fillMemory(targetNode, fillPercent);
    
    if (result.success) {
      console.log(`Memory filled: ${(result.filled / 1024 / 1024).toFixed(1)}MB`);
    }
  }

  /**
   * Slow down a node
   */
  async slowDownNode() {
    const nodes = this.redisChaos.config.clusterNodes;
    const targetNode = nodes[Math.floor(Math.random() * nodes.length)];
    
    const result = await this.redisChaos.slowDownNode(targetNode);
    
    if (result.success) {
      console.log(`Node ${targetNode.host}:${targetNode.port} slowed down`);
    }
  }

  /**
   * Trigger Sentinel failover
   */
  async triggerSentinelFailover() {
    const result = await this.redisChaos.triggerSentinelFailover();
    
    if (result.success) {
      this.metrics.failovers++;
      console.log('Sentinel failover triggered');
    }
  }

  /**
   * Simulate OOM condition
   */
  async simulateOOM() {
    const nodes = this.redisChaos.config.clusterNodes;
    const targetNode = nodes[Math.floor(Math.random() * nodes.length)];
    
    const result = await this.redisChaos.simulateOOM(targetNode);
    
    if (result.success) {
      console.log(`OOM simulated on ${targetNode.host}:${targetNode.port}`);
    }
  }

  /**
   * Monitor Redis health
   */
  async monitorRedis() {
    const clusterHealth = await this.redisChaos.checkClusterHealth();
    const unhealthyNodes = clusterHealth.filter(n => !n.healthy);
    
    if (unhealthyNodes.length > 0) {
      console.log(`⚠️ Unhealthy nodes: ${unhealthyNodes.length}`);
      unhealthyNodes.forEach(node => {
        console.log(`  - ${node.node}: ${node.error || 'Not responding'}`);
      });
    }
    
    // Check cluster state
    const healthyNodes = clusterHealth.filter(n => n.healthy);
    if (healthyNodes.length > 0) {
      const clusterOk = healthyNodes.some(n => n.output?.includes('cluster_state:ok'));
      if (!clusterOk) {
        console.log('⚠️ Cluster state: FAIL');
      }
    }
    
    // Monitor application impact
    await this.checkApplicationImpact();
  }

  /**
   * Check data consistency
   */
  async checkDataConsistency() {
    try {
      // Write test data
      const testKey = `chaos:test:${Date.now()}`;
      const testValue = `value_${Date.now()}`;
      
      await execAsync(`redis-cli -c SET ${testKey} ${testValue}`);
      
      // Read back from different node
      const result = await execAsync(`redis-cli -c -p 7001 GET ${testKey}`);
      
      if (result.stdout.trim() !== testValue) {
        this.metrics.consistencyErrors++;
        console.log('⚠️ Data consistency error detected!');
      }
      
      // Cleanup
      await execAsync(`redis-cli -c DEL ${testKey}`);
      
    } catch (error) {
      // Might fail during partition
    }
  }

  /**
   * Check application impact
   */
  async checkApplicationImpact() {
    try {
      // Test order placement through API
      const orderData = {
        userId: 'chaos_test_user',
        pair: 'ETH-USDC',
        side: 'buy',
        type: 'limit',
        price: 1850,
        amount: 0.1
      };
      
      const startTime = Date.now();
      const result = await execAsync(
        `curl -s -X POST http://localhost:3000/api/orders \
         -H "Content-Type: application/json" \
         -d '${JSON.stringify(orderData)}'`
      );
      const responseTime = Date.now() - startTime;
      
      if (responseTime > 500) {
        console.log(`⚠️ Slow order placement: ${responseTime}ms`);
      }
      
      // Check orderbook availability
      const orderbookResult = await execAsync(
        'curl -s http://localhost:3000/api/orderbook/ETH-USDC'
      );
      
      if (!orderbookResult.stdout.includes('bids')) {
        console.log('⚠️ Orderbook unavailable');
      }
      
    } catch (error) {
      console.log('⚠️ Application impact detected:', error.message);
    }
  }

  /**
   * Start Redis-intensive load test
   */
  startLoadTest() {
    console.log('📊 Starting Redis-intensive load test...\n');
    
    try {
      // Custom K6 test that heavily uses Redis
      exec('k6 run ../k6/scenarios/01-steady-state.js', {
        env: {
          ...process.env,
          STRESS_REDIS: 'true',
          REDIS_OPS_PER_VU: '100'
        }
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('Load test error:', error);
        }
      });
    } catch (error) {
      console.error('Failed to start load test:', error);
    }
  }

  /**
   * Generate chaos report
   */
  async generateReport() {
    const duration = (Date.now() - this.metrics.startTime) / 1000;
    const finalHealth = await this.redisChaos.checkClusterHealth();
    
    console.log('\n=================================');
    console.log('📊 Redis Chaos Report');
    console.log('=================================');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    
    console.log('\nScenarios Executed:');
    for (const [scenario, count] of Object.entries(this.metrics.scenariosExecuted)) {
      console.log(`  ${scenario}: ${count} times`);
    }
    
    console.log('\nCluster Impact:');
    console.log(`  Node Failures: ${this.metrics.nodeFailures}`);
    console.log(`  Failovers: ${this.metrics.failovers}`);
    console.log(`  Consistency Errors: ${this.metrics.consistencyErrors}`);
    console.log(`  Data Loss: ${this.metrics.dataLoss ? 'Yes' : 'No'}`);
    
    console.log('\nFinal Cluster State:');
    const healthyCount = finalHealth.filter(n => n.healthy).length;
    console.log(`  Healthy Nodes: ${healthyCount}/${finalHealth.length}`);
    
    finalHealth.forEach(node => {
      console.log(`  ${node.node}: ${node.healthy ? '✅' : '❌'}`);
    });
    
    // Calculate resilience score
    const score = this.calculateResilienceScore();
    console.log('\n🎯 Redis Resilience Score:');
    console.log(`  Score: ${score}/100`);
    
    if (score >= 80) {
      console.log('  ✅ Excellent Redis resilience');
    } else if (score >= 60) {
      console.log('  ⚠️ Good resilience with concerns');
    } else {
      console.log('  ❌ Poor Redis resilience');
    }
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    if (this.metrics.nodeFailures > 2) {
      console.log('  - Improve node recovery time');
    }
    if (this.metrics.consistencyErrors > 0) {
      console.log('  - Review data consistency guarantees');
    }
    if (healthyCount < finalHealth.length) {
      console.log('  - Some nodes still unhealthy - check recovery');
    }
    
    console.log('=================================\n');
  }

  /**
   * Calculate Redis resilience score
   */
  calculateResilienceScore() {
    let score = 100;
    
    // Deduct for node failures
    score -= Math.min(20, this.metrics.nodeFailures * 5);
    
    // Deduct for consistency errors
    score -= Math.min(30, this.metrics.consistencyErrors * 10);
    
    // Deduct for data loss
    if (this.metrics.dataLoss) {
      score -= 40;
    }
    
    // Bonus for successful failovers
    if (this.metrics.failovers > 0) {
      score += 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }
}

// Run chaos scenario
if (require.main === module) {
  const chaos = new RedisChaosScenario();
  
  chaos.run().catch(error => {
    console.error('Redis chaos failed:', error);
    process.exit(1);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping Redis chaos...');
    await chaos.redisChaos.recoverAll();
    process.exit(0);
  });
}

module.exports = RedisChaosScenario;