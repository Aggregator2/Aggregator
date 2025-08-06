/**
 * Network Chaos Scenario
 * Injects network latency, packet loss, and partitions
 */

const ChaosMonkey = require('../lib/chaos-monkey');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class NetworkChaos {
  constructor() {
    this.config = {
      duration: process.env.CHAOS_DURATION || 300000, // 5 minutes
      interfaces: ['eth0', 'docker0'],
      scenarios: [
        {
          name: 'latency_spike',
          weight: 30,
          apply: () => this.applyLatencySpike()
        },
        {
          name: 'packet_loss',
          weight: 25,
          apply: () => this.applyPacketLoss()
        },
        {
          name: 'bandwidth_throttle',
          weight: 20,
          apply: () => this.applyBandwidthThrottle()
        },
        {
          name: 'network_partition',
          weight: 15,
          apply: () => this.applyNetworkPartition()
        },
        {
          name: 'dns_failure',
          weight: 10,
          apply: () => this.applyDNSFailure()
        }
      ]
    };
    
    this.activeEffects = [];
    this.metrics = {
      scenariosApplied: {},
      networkEvents: [],
      startTime: Date.now()
    };
  }

  /**
   * Run network chaos scenario
   */
  async run() {
    console.log('🌐 Starting Network Chaos Scenario');
    console.log(`Duration: ${this.config.duration / 1000}s`);
    console.log('==================================\n');
    
    // Start baseline measurement
    await this.measureBaseline();
    
    // Start load test
    this.startLoadTest();
    
    // Apply chaos scenarios
    const chaosInterval = setInterval(async () => {
      await this.applyRandomScenario();
    }, 30000); // Every 30 seconds
    
    // Monitor network health
    const monitorInterval = setInterval(async () => {
      await this.monitorNetwork();
    }, 10000); // Every 10 seconds
    
    // Run for duration
    setTimeout(async () => {
      clearInterval(chaosInterval);
      clearInterval(monitorInterval);
      await this.cleanup();
      await this.generateReport();
    }, this.config.duration);
  }

  /**
   * Measure baseline network performance
   */
  async measureBaseline() {
    console.log('📊 Measuring baseline network performance...');
    
    const baseline = {
      latency: {},
      bandwidth: {},
      packetLoss: {}
    };
    
    // Ping test for latency
    try {
      const pingResult = await execAsync('ping -c 10 -i 0.2 8.8.8.8');
      const avgLatency = pingResult.stdout.match(/avg = [\d.]+\/([\d.]+)/);
      baseline.latency.external = avgLatency ? parseFloat(avgLatency[1]) : 0;
    } catch (error) {
      console.error('Baseline ping failed:', error.message);
    }
    
    // Internal service latency
    try {
      const internalPing = await execAsync('ping -c 10 -i 0.2 localhost');
      const avgLatency = internalPing.stdout.match(/avg = [\d.]+\/([\d.]+)/);
      baseline.latency.internal = avgLatency ? parseFloat(avgLatency[1]) : 0;
    } catch (error) {
      console.error('Internal ping failed:', error.message);
    }
    
    this.baseline = baseline;
    console.log('Baseline established:', baseline);
    console.log('');
  }

  /**
   * Apply random network chaos scenario
   */
  async applyRandomScenario() {
    // Calculate total weight
    const totalWeight = this.config.scenarios.reduce((sum, s) => sum + s.weight, 0);
    const random = Math.random() * totalWeight;
    
    let accumulator = 0;
    for (const scenario of this.config.scenarios) {
      accumulator += scenario.weight;
      if (random <= accumulator) {
        console.log(`\n🎲 Applying scenario: ${scenario.name}`);
        await scenario.apply();
        
        // Track metrics
        this.metrics.scenariosApplied[scenario.name] = 
          (this.metrics.scenariosApplied[scenario.name] || 0) + 1;
        
        break;
      }
    }
  }

  /**
   * Apply latency spike
   */
  async applyLatencySpike() {
    const interface = this.config.interfaces[0];
    const baseLatency = Math.floor(Math.random() * 200) + 100; // 100-300ms
    const jitter = Math.floor(baseLatency * 0.3); // 30% jitter
    const duration = Math.floor(Math.random() * 60) + 30; // 30-90 seconds
    
    console.log(`💉 Injecting latency: ${baseLatency}ms ±${jitter}ms for ${duration}s`);
    
    try {
      // Apply latency
      await execAsync(
        `sudo tc qdisc add dev ${interface} root netem delay ${baseLatency}ms ${jitter}ms distribution normal`
      );
      
      const effect = {
        type: 'latency',
        interface,
        baseLatency,
        jitter,
        startTime: Date.now(),
        duration: duration * 1000
      };
      
      this.activeEffects.push(effect);
      
      // Schedule removal
      setTimeout(async () => {
        await this.removeEffect(effect);
      }, duration * 1000);
      
      this.metrics.networkEvents.push({
        type: 'latency_spike',
        timestamp: Date.now(),
        details: effect
      });
      
    } catch (error) {
      console.error('Failed to apply latency:', error.message);
    }
  }

  /**
   * Apply packet loss
   */
  async applyPacketLoss() {
    const interface = this.config.interfaces[0];
    const lossRate = Math.floor(Math.random() * 15) + 5; // 5-20% loss
    const duration = Math.floor(Math.random() * 45) + 30; // 30-75 seconds
    
    console.log(`📦 Applying packet loss: ${lossRate}% for ${duration}s`);
    
    try {
      await execAsync(
        `sudo tc qdisc add dev ${interface} root netem loss ${lossRate}%`
      );
      
      const effect = {
        type: 'packet_loss',
        interface,
        lossRate,
        startTime: Date.now(),
        duration: duration * 1000
      };
      
      this.activeEffects.push(effect);
      
      setTimeout(async () => {
        await this.removeEffect(effect);
      }, duration * 1000);
      
      this.metrics.networkEvents.push({
        type: 'packet_loss',
        timestamp: Date.now(),
        details: effect
      });
      
    } catch (error) {
      console.error('Failed to apply packet loss:', error.message);
    }
  }

  /**
   * Apply bandwidth throttling
   */
  async applyBandwidthThrottle() {
    const interface = this.config.interfaces[0];
    const bandwidth = Math.floor(Math.random() * 5) + 1; // 1-5 Mbps
    const duration = Math.floor(Math.random() * 60) + 60; // 60-120 seconds
    
    console.log(`🚦 Throttling bandwidth: ${bandwidth}Mbps for ${duration}s`);
    
    try {
      // Use tc with htb qdisc for bandwidth limiting
      await execAsync(`sudo tc qdisc add dev ${interface} root handle 1: htb default 30`);
      await execAsync(
        `sudo tc class add dev ${interface} parent 1: classid 1:1 htb rate ${bandwidth}mbit`
      );
      await execAsync(
        `sudo tc filter add dev ${interface} protocol ip parent 1:0 prio 1 u32 match ip dst 0.0.0.0/0 flowid 1:1`
      );
      
      const effect = {
        type: 'bandwidth_throttle',
        interface,
        bandwidth,
        startTime: Date.now(),
        duration: duration * 1000
      };
      
      this.activeEffects.push(effect);
      
      setTimeout(async () => {
        await this.removeEffect(effect);
      }, duration * 1000);
      
      this.metrics.networkEvents.push({
        type: 'bandwidth_throttle',
        timestamp: Date.now(),
        details: effect
      });
      
    } catch (error) {
      console.error('Failed to throttle bandwidth:', error.message);
    }
  }

  /**
   * Apply network partition
   */
  async applyNetworkPartition() {
    const duration = Math.floor(Math.random() * 30) + 30; // 30-60 seconds
    
    console.log(`🔪 Creating network partition for ${duration}s`);
    
    try {
      // Block communication between services
      const rules = [
        // Block API to Database
        'sudo iptables -A INPUT -s 172.17.0.2 -d 172.17.0.3 -j DROP',
        'sudo iptables -A OUTPUT -s 172.17.0.2 -d 172.17.0.3 -j DROP',
        
        // Block API to Redis
        'sudo iptables -A INPUT -s 172.17.0.2 -d 172.17.0.4 -j DROP',
        'sudo iptables -A OUTPUT -s 172.17.0.2 -d 172.17.0.4 -j DROP'
      ];
      
      for (const rule of rules) {
        await execAsync(rule);
      }
      
      const effect = {
        type: 'network_partition',
        rules,
        startTime: Date.now(),
        duration: duration * 1000
      };
      
      this.activeEffects.push(effect);
      
      setTimeout(async () => {
        await this.removeEffect(effect);
      }, duration * 1000);
      
      this.metrics.networkEvents.push({
        type: 'network_partition',
        timestamp: Date.now(),
        details: effect
      });
      
    } catch (error) {
      console.error('Failed to create partition:', error.message);
    }
  }

  /**
   * Apply DNS failure
   */
  async applyDNSFailure() {
    const duration = Math.floor(Math.random() * 20) + 20; // 20-40 seconds
    
    console.log(`🌐 Simulating DNS failure for ${duration}s`);
    
    try {
      // Redirect DNS to invalid server
      const originalResolv = await execAsync('cat /etc/resolv.conf');
      await execAsync('sudo cp /etc/resolv.conf /etc/resolv.conf.backup');
      await execAsync('echo "nameserver 169.254.169.254" | sudo tee /etc/resolv.conf');
      
      const effect = {
        type: 'dns_failure',
        originalContent: originalResolv.stdout,
        startTime: Date.now(),
        duration: duration * 1000
      };
      
      this.activeEffects.push(effect);
      
      setTimeout(async () => {
        await this.removeEffect(effect);
      }, duration * 1000);
      
      this.metrics.networkEvents.push({
        type: 'dns_failure',
        timestamp: Date.now(),
        details: effect
      });
      
    } catch (error) {
      console.error('Failed to simulate DNS failure:', error.message);
    }
  }

  /**
   * Remove network effect
   */
  async removeEffect(effect) {
    console.log(`🔧 Removing ${effect.type} effect`);
    
    try {
      switch (effect.type) {
        case 'latency':
        case 'packet_loss':
        case 'bandwidth_throttle':
          await execAsync(`sudo tc qdisc del dev ${effect.interface} root`);
          break;
          
        case 'network_partition':
          for (const rule of effect.rules) {
            const deleteRule = rule.replace('-A', '-D');
            await execAsync(deleteRule);
          }
          break;
          
        case 'dns_failure':
          await execAsync('sudo mv /etc/resolv.conf.backup /etc/resolv.conf');
          break;
      }
      
      // Remove from active effects
      this.activeEffects = this.activeEffects.filter(e => e !== effect);
      
    } catch (error) {
      console.error(`Failed to remove ${effect.type}:`, error.message);
    }
  }

  /**
   * Monitor network conditions
   */
  async monitorNetwork() {
    const metrics = {
      timestamp: Date.now(),
      latency: {},
      packetLoss: {},
      connections: {}
    };
    
    // Measure current latency
    try {
      const pingResult = await execAsync('ping -c 5 -i 0.2 localhost');
      const avgLatency = pingResult.stdout.match(/avg = [\d.]+\/([\d.]+)/);
      metrics.latency.localhost = avgLatency ? parseFloat(avgLatency[1]) : -1;
    } catch (error) {
      metrics.latency.localhost = -1;
    }
    
    // Check connection count
    try {
      const netstatResult = await execAsync('netstat -an | grep ESTABLISHED | wc -l');
      metrics.connections.established = parseInt(netstatResult.stdout.trim());
    } catch (error) {
      metrics.connections.established = 0;
    }
    
    // Log anomalies
    if (metrics.latency.localhost > 50) {
      console.log(`⚠️ High latency detected: ${metrics.latency.localhost}ms`);
    }
    
    if (this.activeEffects.length > 2) {
      console.log(`⚠️ Multiple network effects active: ${this.activeEffects.length}`);
    }
  }

  /**
   * Start load test
   */
  async startLoadTest() {
    console.log('📊 Starting network-sensitive load test...\n');
    
    try {
      exec('k6 run ../k6/scenarios/02-spike-test.js', (error, stdout, stderr) => {
        if (error) {
          console.error('Load test error:', error);
        }
      });
    } catch (error) {
      console.error('Failed to start load test:', error);
    }
  }

  /**
   * Cleanup all effects
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up network effects...');
    
    for (const effect of [...this.activeEffects]) {
      await this.removeEffect(effect);
    }
    
    // Reset any remaining tc rules
    for (const interface of this.config.interfaces) {
      try {
        await execAsync(`sudo tc qdisc del dev ${interface} root`);
      } catch (error) {
        // Ignore if no rules exist
      }
    }
  }

  /**
   * Generate report
   */
  async generateReport() {
    const duration = (Date.now() - this.metrics.startTime) / 1000;
    
    console.log('\n=====================================');
    console.log('📊 Network Chaos Report');
    console.log('=====================================');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Total Network Events: ${this.metrics.networkEvents.length}`);
    
    console.log('\nScenarios Applied:');
    for (const [scenario, count] of Object.entries(this.metrics.scenariosApplied)) {
      console.log(`  ${scenario}: ${count} times`);
    }
    
    console.log('\nNetwork Impact Summary:');
    const impacts = this.analyzeImpact();
    console.log(`  Max Latency Spike: ${impacts.maxLatency}ms`);
    console.log(`  Max Packet Loss: ${impacts.maxPacketLoss}%`);
    console.log(`  Total Downtime: ${impacts.totalDowntime}s`);
    
    console.log('\n🎯 Network Resilience Score:');
    const score = this.calculateResilienceScore(impacts);
    console.log(`  Score: ${score}/100`);
    
    if (score >= 80) {
      console.log('  ✅ Excellent network resilience');
    } else if (score >= 60) {
      console.log('  ⚠️ Good resilience with some vulnerabilities');
    } else {
      console.log('  ❌ Poor network resilience');
    }
    
    console.log('=====================================\n');
  }

  /**
   * Analyze network impact
   */
  analyzeImpact() {
    const impacts = {
      maxLatency: 0,
      maxPacketLoss: 0,
      totalDowntime: 0
    };
    
    for (const event of this.metrics.networkEvents) {
      if (event.type === 'latency_spike') {
        impacts.maxLatency = Math.max(impacts.maxLatency, event.details.baseLatency);
      } else if (event.type === 'packet_loss') {
        impacts.maxPacketLoss = Math.max(impacts.maxPacketLoss, event.details.lossRate);
      } else if (event.type === 'network_partition') {
        impacts.totalDowntime += event.details.duration / 1000;
      }
    }
    
    return impacts;
  }

  /**
   * Calculate resilience score
   */
  calculateResilienceScore(impacts) {
    let score = 100;
    
    // Deduct for high latency
    if (impacts.maxLatency > 200) score -= 20;
    else if (impacts.maxLatency > 100) score -= 10;
    
    // Deduct for packet loss
    if (impacts.maxPacketLoss > 15) score -= 25;
    else if (impacts.maxPacketLoss > 10) score -= 15;
    
    // Deduct for downtime
    if (impacts.totalDowntime > 60) score -= 30;
    else if (impacts.totalDowntime > 30) score -= 15;
    
    return Math.max(0, score);
  }
}

// Run chaos scenario
if (require.main === module) {
  const chaos = new NetworkChaos();
  
  chaos.run().catch(error => {
    console.error('Network chaos failed:', error);
    process.exit(1);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping network chaos...');
    await chaos.cleanup();
    process.exit(0);
  });
}

module.exports = NetworkChaos;