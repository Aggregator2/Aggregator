/**
 * Database Chaos Scenario
 * Tests database failover, connection issues, and performance degradation
 */

const DatabaseChaos = require('../lib/database-chaos');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class DatabaseChaosScenario {
  constructor() {
    this.dbChaos = new DatabaseChaos({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'swappiq',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      replicaHosts: [
        {
          host: process.env.DB_REPLICA1_HOST || 'localhost',
          port: 5433,
          promotionCommand: 'pg_ctl promote -D /var/lib/postgresql/data'
        }
      ]
    });
    
    this.config = {
      duration: process.env.CHAOS_DURATION || 300000, // 5 minutes
      scenarios: [
        { name: 'connection_kill', weight: 25, minInterval: 30 },
        { name: 'table_lock', weight: 20, minInterval: 45 },
        { name: 'slow_queries', weight: 20, minInterval: 30 },
        { name: 'connection_exhaustion', weight: 15, minInterval: 60 },
        { name: 'failover', weight: 10, minInterval: 180 },
        { name: 'disk_fill', weight: 5, minInterval: 120 },
        { name: 'deadlock', weight: 5, minInterval: 60 }
      ]
    };
    
    this.lastScenarioTime = {};
    this.metrics = {
      startTime: Date.now(),
      scenariosExecuted: {},
      connectionErrors: 0,
      queryTimeouts: 0,
      deadlocks: 0,
      failovers: 0
    };
  }

  /**
   * Run database chaos scenario
   */
  async run() {
    console.log('🗄️ Starting Database Chaos Scenario');
    console.log(`Duration: ${this.config.duration / 1000}s`);
    console.log('====================================\n');
    
    // Check initial database health
    const initialHealth = await this.dbChaos.checkHealth();
    console.log('Initial database health:', initialHealth);
    console.log('');
    
    // Start load test
    this.startLoadTest();
    
    // Start monitoring
    const monitorInterval = setInterval(async () => {
      await this.monitorDatabase();
    }, 10000); // Every 10 seconds
    
    // Apply chaos scenarios
    const chaosInterval = setInterval(async () => {
      await this.applyRandomScenario();
    }, 20000); // Every 20 seconds
    
    // Run for duration
    setTimeout(async () => {
      clearInterval(chaosInterval);
      clearInterval(monitorInterval);
      await this.dbChaos.recoverAll();
      await this.generateReport();
      process.exit(0);
    }, this.config.duration);
  }

  /**
   * Apply random database chaos scenario
   */
  async applyRandomScenario() {
    // Filter scenarios based on minimum interval
    const availableScenarios = this.config.scenarios.filter(scenario => {
      const lastTime = this.lastScenarioTime[scenario.name] || 0;
      return (Date.now() - lastTime) > (scenario.minInterval * 1000);
    });
    
    if (availableScenarios.length === 0) {
      console.log('⏳ All scenarios on cooldown');
      return;
    }
    
    // Select scenario based on weights
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
   * Execute specific chaos scenario
   */
  async executeScenario(scenario) {
    try {
      switch (scenario) {
        case 'connection_kill':
          await this.killConnections();
          break;
        
        case 'table_lock':
          await this.lockTables();
          break;
        
        case 'slow_queries':
          await this.createSlowQueries();
          break;
        
        case 'connection_exhaustion':
          await this.exhaustConnections();
          break;
        
        case 'failover':
          await this.triggerFailover();
          break;
        
        case 'disk_fill':
          await this.fillDisk();
          break;
        
        case 'deadlock':
          await this.createDeadlock();
          break;
      }
    } catch (error) {
      console.error(`Failed to execute ${scenario}:`, error.message);
    }
  }

  /**
   * Kill database connections
   */
  async killConnections() {
    const patterns = ['%node%', '%pool%', '%swappiq%'];
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    
    console.log(`💀 Killing connections matching: ${pattern}`);
    const result = await this.dbChaos.killConnections(pattern);
    
    if (result.success) {
      this.metrics.connectionErrors++;
      console.log('Connections killed successfully');
    }
  }

  /**
   * Lock critical tables
   */
  async lockTables() {
    const tables = ['orders', 'trades', 'user_balances'];
    const numTables = Math.floor(Math.random() * 2) + 1;
    const selectedTables = tables.slice(0, numTables);
    
    console.log(`🔒 Locking tables: ${selectedTables.join(', ')}`);
    const result = await this.dbChaos.lockTables(selectedTables);
    
    if (result.success) {
      console.log('Tables locked for 60 seconds');
    }
  }

  /**
   * Create slow queries
   */
  async createSlowQueries() {
    const numQueries = Math.floor(Math.random() * 3) + 2;
    
    console.log(`🐌 Creating ${numQueries} slow queries`);
    const result = await this.dbChaos.createSlowQueries(numQueries);
    
    if (result.success) {
      this.metrics.queryTimeouts++;
      console.log('Slow queries initiated');
    }
  }

  /**
   * Exhaust connection pool
   */
  async exhaustConnections() {
    const numConnections = Math.floor(Math.random() * 50) + 50;
    
    console.log(`🌊 Exhausting connection pool with ${numConnections} connections`);
    const result = await this.dbChaos.exhaustConnectionPool(numConnections);
    
    if (result.success) {
      console.log('Connection pool under stress');
    }
  }

  /**
   * Trigger database failover
   */
  async triggerFailover() {
    console.log(`🔄 Triggering database failover`);
    
    const result = await this.dbChaos.triggerFailover();
    
    if (result.success) {
      this.metrics.failovers++;
      console.log(`Failover initiated to: ${result.newMaster}`);
      
      // Update connection to new master
      this.dbChaos.config.host = result.newMaster;
    }
  }

  /**
   * Fill database disk
   */
  async fillDisk() {
    const sizeMB = Math.floor(Math.random() * 500) + 500;
    
    console.log(`💾 Filling database disk with ${sizeMB}MB`);
    const result = await this.dbChaos.fillDiskSpace(`chaos_fill_${Date.now()}`, sizeMB);
    
    if (result.success) {
      console.log('Disk space consumed');
    }
  }

  /**
   * Create deadlock
   */
  async createDeadlock() {
    console.log(`🔀 Creating database deadlock`);
    const result = await this.dbChaos.createDeadlock();
    
    if (result.success) {
      this.metrics.deadlocks++;
      console.log('Deadlock scenario initiated');
    }
  }

  /**
   * Monitor database health
   */
  async monitorDatabase() {
    const health = await this.dbChaos.checkHealth();
    
    // Log issues
    if (!health.connected) {
      console.log('⚠️ Database connection lost!');
    }
    
    if (health.activeConnections > 80) {
      console.log(`⚠️ High connection count: ${health.activeConnections}`);
    }
    
    if (health.lockedQueries > 10) {
      console.log(`⚠️ Locked queries detected: ${health.lockedQueries}`);
    }
    
    if (health.replicationLag && health.replicationLag > 5) {
      console.log(`⚠️ Replication lag: ${health.replicationLag.toFixed(1)}s`);
    }
    
    if (health.cacheHitRatio < 90) {
      console.log(`⚠️ Low cache hit ratio: ${health.cacheHitRatio}%`);
    }
    
    // Check application metrics
    await this.checkApplicationHealth();
  }

  /**
   * Check application health during chaos
   */
  async checkApplicationHealth() {
    try {
      // Check API response time
      const startTime = Date.now();
      await execAsync('curl -s -w "%{http_code}" http://localhost:3000/api/health');
      const responseTime = Date.now() - startTime;
      
      if (responseTime > 1000) {
        console.log(`⚠️ API slow response: ${responseTime}ms`);
      }
      
      // Check order processing
      const ordersResult = await execAsync(
        'curl -s http://localhost:3000/api/monitoring/metrics | jq .orderProcessingRate'
      );
      const orderRate = parseFloat(ordersResult.stdout);
      
      if (orderRate < 10) {
        console.log(`⚠️ Low order processing rate: ${orderRate}/s`);
      }
    } catch (error) {
      // Application might be impacted
    }
  }

  /**
   * Start database-intensive load test
   */
  startLoadTest() {
    console.log('📊 Starting database-intensive load test...\n');
    
    try {
      // Use a test that heavily uses the database
      exec('k6 run ../k6/scenarios/03-stress-test.js', {
        env: {
          ...process.env,
          STRESS_DATABASE: 'true'
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
    const finalHealth = await this.dbChaos.checkHealth();
    
    console.log('\n=====================================');
    console.log('📊 Database Chaos Report');
    console.log('=====================================');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    
    console.log('\nScenarios Executed:');
    for (const [scenario, count] of Object.entries(this.metrics.scenariosExecuted)) {
      console.log(`  ${scenario}: ${count} times`);
    }
    
    console.log('\nDatabase Impact:');
    console.log(`  Connection Errors: ${this.metrics.connectionErrors}`);
    console.log(`  Query Timeouts: ${this.metrics.queryTimeouts}`);
    console.log(`  Deadlocks: ${this.metrics.deadlocks}`);
    console.log(`  Failovers: ${this.metrics.failovers}`);
    
    console.log('\nFinal Database State:');
    console.log(`  Connected: ${finalHealth.connected ? 'Yes' : 'No'}`);
    console.log(`  Active Connections: ${finalHealth.activeConnections}`);
    console.log(`  Cache Hit Ratio: ${finalHealth.cacheHitRatio}%`);
    
    // Calculate resilience score
    const score = this.calculateResilienceScore();
    console.log('\n🎯 Database Resilience Score:');
    console.log(`  Score: ${score}/100`);
    
    if (score >= 80) {
      console.log('  ✅ Excellent database resilience');
    } else if (score >= 60) {
      console.log('  ⚠️ Good resilience with improvements needed');
    } else {
      console.log('  ❌ Poor database resilience');
    }
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    if (this.metrics.connectionErrors > 5) {
      console.log('  - Implement connection retry logic');
    }
    if (this.metrics.queryTimeouts > 3) {
      console.log('  - Optimize slow queries and add timeouts');
    }
    if (this.metrics.failovers > 0 && finalHealth.connected) {
      console.log('  - ✅ Failover mechanism working correctly');
    }
    
    console.log('=====================================\n');
  }

  /**
   * Calculate database resilience score
   */
  calculateResilienceScore() {
    let score = 100;
    
    // Deduct for connection errors
    score -= Math.min(20, this.metrics.connectionErrors * 2);
    
    // Deduct for query timeouts
    score -= Math.min(15, this.metrics.queryTimeouts * 3);
    
    // Deduct for deadlocks
    score -= Math.min(10, this.metrics.deadlocks * 5);
    
    // Bonus for successful failover
    if (this.metrics.failovers > 0) {
      score += 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }
}

// Run chaos scenario
if (require.main === module) {
  const chaos = new DatabaseChaosScenario();
  
  chaos.run().catch(error => {
    console.error('Database chaos failed:', error);
    process.exit(1);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping database chaos...');
    await chaos.dbChaos.recoverAll();
    process.exit(0);
  });
}

module.exports = DatabaseChaosScenario;