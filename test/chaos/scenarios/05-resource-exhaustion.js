/**
 * Resource Exhaustion Chaos Scenario
 * Tests system behavior under CPU, memory, disk, and I/O pressure
 */

const ChaosMonkey = require('../lib/chaos-monkey');
const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const os = require('os');

class ResourceExhaustionChaos {
  constructor() {
    this.config = {
      duration: process.env.CHAOS_DURATION || 300000, // 5 minutes
      scenarios: [
        { name: 'cpu_spike', weight: 25 },
        { name: 'memory_leak', weight: 25 },
        { name: 'disk_io_stress', weight: 20 },
        { name: 'network_bandwidth', weight: 15 },
        { name: 'file_descriptor_exhaustion', weight: 10 },
        { name: 'thread_exhaustion', weight: 5 }
      ]
    };
    
    this.activeStressors = [];
    this.metrics = {
      startTime: Date.now(),
      baseline: {},
      peak: {
        cpu: 0,
        memory: 0,
        diskIO: 0,
        networkIO: 0
      },
      scenariosExecuted: {},
      systemFailures: 0
    };
  }

  /**
   * Run resource exhaustion chaos
   */
  async run() {
    console.log('💥 Starting Resource Exhaustion Chaos');
    console.log(`Duration: ${this.config.duration / 1000}s`);
    console.log('=====================================\n');
    
    // Establish baseline
    await this.measureBaseline();
    
    // Start load test
    this.startLoadTest();
    
    // Monitor resources
    const monitorInterval = setInterval(async () => {
      await this.monitorResources();
    }, 5000); // Every 5 seconds
    
    // Apply chaos scenarios
    const chaosInterval = setInterval(async () => {
      await this.applyRandomScenario();
    }, 20000); // Every 20 seconds
    
    // Check system stability
    const stabilityInterval = setInterval(async () => {
      await this.checkSystemStability();
    }, 15000);
    
    // Run for duration
    setTimeout(async () => {
      clearInterval(chaosInterval);
      clearInterval(monitorInterval);
      clearInterval(stabilityInterval);
      await this.cleanup();
      await this.generateReport();
      process.exit(0);
    }, this.config.duration);
  }

  /**
   * Measure baseline resource usage
   */
  async measureBaseline() {
    console.log('📊 Measuring baseline resource usage...');
    
    const resources = await this.getResourceUsage();
    this.metrics.baseline = resources;
    
    console.log('Baseline established:');
    console.log(`  CPU: ${resources.cpu.toFixed(1)}%`);
    console.log(`  Memory: ${resources.memory.toFixed(1)}%`);
    console.log(`  Disk I/O: ${resources.diskIO.read}/${resources.diskIO.write} MB/s`);
    console.log('');
  }

  /**
   * Apply random resource exhaustion scenario
   */
  async applyRandomScenario() {
    const totalWeight = this.config.scenarios.reduce((sum, s) => sum + s.weight, 0);
    const random = Math.random() * totalWeight;
    
    let accumulator = 0;
    for (const scenario of this.config.scenarios) {
      accumulator += scenario.weight;
      if (random <= accumulator) {
        console.log(`\n🎲 Applying: ${scenario.name}`);
        await this.executeScenario(scenario.name);
        
        this.metrics.scenariosExecuted[scenario.name] = 
          (this.metrics.scenariosExecuted[scenario.name] || 0) + 1;
        
        break;
      }
    }
  }

  /**
   * Execute specific resource exhaustion scenario
   */
  async executeScenario(scenario) {
    try {
      switch (scenario) {
        case 'cpu_spike':
          await this.createCPUSpike();
          break;
        
        case 'memory_leak':
          await this.simulateMemoryLeak();
          break;
        
        case 'disk_io_stress':
          await this.stressDiskIO();
          break;
        
        case 'network_bandwidth':
          await this.consumeNetworkBandwidth();
          break;
        
        case 'file_descriptor_exhaustion':
          await this.exhaustFileDescriptors();
          break;
        
        case 'thread_exhaustion':
          await this.exhaustThreads();
          break;
      }
    } catch (error) {
      console.error(`Failed to execute ${scenario}:`, error.message);
      this.metrics.systemFailures++;
    }
  }

  /**
   * Create CPU spike
   */
  async createCPUSpike() {
    const cores = os.cpus().length;
    const targetCores = Math.floor(cores * 0.8); // Use 80% of cores
    const duration = Math.floor(Math.random() * 30) + 30; // 30-60 seconds
    
    console.log(`🔥 CPU spike: ${targetCores} cores for ${duration}s`);
    
    const stressors = [];
    for (let i = 0; i < targetCores; i++) {
      const proc = spawn('stress-ng', [
        '--cpu', '1',
        '--cpu-load', '95',
        '--timeout', `${duration}s`
      ]);
      
      stressors.push(proc);
    }
    
    this.activeStressors.push({
      type: 'cpu',
      processes: stressors,
      startTime: Date.now(),
      duration: duration * 1000
    });
  }

  /**
   * Simulate memory leak
   */
  async simulateMemoryLeak() {
    const totalMemory = os.totalmem();
    const targetMemory = Math.floor(totalMemory * 0.7); // Use 70% of memory
    const chunkSize = 100 * 1024 * 1024; // 100MB chunks
    const duration = 60; // 60 seconds
    
    console.log(`🧠 Memory leak: ${(targetMemory / 1024 / 1024 / 1024).toFixed(1)}GB over ${duration}s`);
    
    const memoryEater = spawn('node', ['-e', `
      const arrays = [];
      const chunkSize = ${chunkSize};
      const targetMemory = ${targetMemory};
      let allocated = 0;
      
      const interval = setInterval(() => {
        if (allocated < targetMemory) {
          arrays.push(new Array(chunkSize / 8).fill(Math.random()));
          allocated += chunkSize;
          
          if (global.gc) {
            global.gc(); // Force GC to make memory pressure more realistic
          }
        }
      }, 1000);
      
      setTimeout(() => {
        clearInterval(interval);
        process.exit(0);
      }, ${duration * 1000});
    `]);
    
    this.activeStressors.push({
      type: 'memory',
      process: memoryEater,
      startTime: Date.now(),
      duration: duration * 1000
    });
  }

  /**
   * Stress disk I/O
   */
  async stressDiskIO() {
    const fileSize = Math.floor(Math.random() * 500) + 500; // 500-1000MB
    const duration = 45; // 45 seconds
    const tempDir = '/tmp/chaos_disk_io';
    
    console.log(`💾 Disk I/O stress: ${fileSize}MB for ${duration}s`);
    
    // Create temp directory
    await fs.mkdir(tempDir, { recursive: true });
    
    // Random read/write stress
    const ioStressor = spawn('stress-ng', [
      '--hdd', '2',
      '--hdd-bytes', `${fileSize}M`,
      '--timeout', `${duration}s`,
      '--temp-path', tempDir
    ]);
    
    this.activeStressors.push({
      type: 'disk_io',
      process: ioStressor,
      tempDir,
      startTime: Date.now(),
      duration: duration * 1000,
      cleanup: async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  }

  /**
   * Consume network bandwidth
   */
  async consumeNetworkBandwidth() {
    const duration = 30; // 30 seconds
    const bandwidth = Math.floor(Math.random() * 50) + 50; // 50-100 Mbps
    
    console.log(`🌐 Network bandwidth consumption: ${bandwidth}Mbps for ${duration}s`);
    
    // Use iperf3 to generate network traffic
    const server = spawn('iperf3', ['-s', '-1', '-p', '5201']);
    
    setTimeout(() => {
      const client = spawn('iperf3', [
        '-c', 'localhost',
        '-p', '5201',
        '-t', duration.toString(),
        '-b', `${bandwidth}M`
      ]);
      
      this.activeStressors.push({
        type: 'network',
        processes: [server, client],
        startTime: Date.now(),
        duration: duration * 1000
      });
    }, 1000);
  }

  /**
   * Exhaust file descriptors
   */
  async exhaustFileDescriptors() {
    const targetFDs = 4000; // Try to open 4000 file descriptors
    const duration = 30; // 30 seconds
    
    console.log(`📁 File descriptor exhaustion: ${targetFDs} FDs for ${duration}s`);
    
    const fdExhaustor = spawn('node', ['-e', `
      const fs = require('fs');
      const files = [];
      
      // Open many files
      for (let i = 0; i < ${targetFDs}; i++) {
        try {
          const fd = fs.openSync('/dev/null', 'r');
          files.push(fd);
        } catch (e) {
          console.log('Max FDs reached at:', i);
          break;
        }
      }
      
      console.log('Opened file descriptors:', files.length);
      
      // Hold them open
      setTimeout(() => {
        files.forEach(fd => fs.closeSync(fd));
        process.exit(0);
      }, ${duration * 1000});
    `]);
    
    this.activeStressors.push({
      type: 'file_descriptors',
      process: fdExhaustor,
      startTime: Date.now(),
      duration: duration * 1000
    });
  }

  /**
   * Exhaust threads
   */
  async exhaustThreads() {
    const targetThreads = 500; // Try to create 500 threads
    const duration = 30; // 30 seconds
    
    console.log(`🧵 Thread exhaustion: ${targetThreads} threads for ${duration}s`);
    
    const threadExhaustor = spawn('node', ['-e', `
      const { Worker, isMainThread } = require('worker_threads');
      const workers = [];
      
      if (isMainThread) {
        // Create many worker threads
        for (let i = 0; i < ${targetThreads}; i++) {
          try {
            const worker = new Worker('setInterval(() => {}, 1000)', { eval: true });
            workers.push(worker);
          } catch (e) {
            console.log('Max threads reached at:', i);
            break;
          }
        }
        
        console.log('Created threads:', workers.length);
        
        // Keep them alive
        setTimeout(() => {
          workers.forEach(w => w.terminate());
          process.exit(0);
        }, ${duration * 1000});
      }
    `]);
    
    this.activeStressors.push({
      type: 'threads',
      process: threadExhaustor,
      startTime: Date.now(),
      duration: duration * 1000
    });
  }

  /**
   * Monitor resource usage
   */
  async monitorResources() {
    const resources = await this.getResourceUsage();
    
    // Update peak metrics
    this.metrics.peak.cpu = Math.max(this.metrics.peak.cpu, resources.cpu);
    this.metrics.peak.memory = Math.max(this.metrics.peak.memory, resources.memory);
    this.metrics.peak.diskIO = Math.max(
      this.metrics.peak.diskIO,
      resources.diskIO.read + resources.diskIO.write
    );
    
    // Log high usage
    if (resources.cpu > 90) {
      console.log(`⚠️ High CPU usage: ${resources.cpu.toFixed(1)}%`);
    }
    
    if (resources.memory > 85) {
      console.log(`⚠️ High memory usage: ${resources.memory.toFixed(1)}%`);
    }
    
    if (resources.loadAvg > os.cpus().length * 2) {
      console.log(`⚠️ High load average: ${resources.loadAvg.toFixed(2)}`);
    }
  }

  /**
   * Get current resource usage
   */
  async getResourceUsage() {
    const usage = {
      cpu: 0,
      memory: 0,
      diskIO: { read: 0, write: 0 },
      loadAvg: 0
    };
    
    try {
      // CPU usage
      const cpuResult = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'");
      usage.cpu = parseFloat(cpuResult.stdout) || 0;
      
      // Memory usage
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      usage.memory = ((totalMem - freeMem) / totalMem) * 100;
      
      // Load average
      const loadAvg = os.loadavg();
      usage.loadAvg = loadAvg[0]; // 1-minute average
      
      // Disk I/O (simplified)
      const ioResult = await execAsync("iostat -d 1 2 | tail -n 2");
      const ioMatch = ioResult.stdout.match(/[\d.]+/g);
      if (ioMatch && ioMatch.length >= 2) {
        usage.diskIO.read = parseFloat(ioMatch[0]) || 0;
        usage.diskIO.write = parseFloat(ioMatch[1]) || 0;
      }
    } catch (error) {
      // Fallback to basic metrics
    }
    
    return usage;
  }

  /**
   * Check system stability
   */
  async checkSystemStability() {
    try {
      // Check API responsiveness
      const startTime = Date.now();
      const result = await execAsync('curl -s -m 5 http://localhost:3000/api/health');
      const responseTime = Date.now() - startTime;
      
      if (responseTime > 2000) {
        console.log(`⚠️ API slow response: ${responseTime}ms`);
        this.metrics.systemFailures++;
      }
      
      // Check critical services
      const services = ['postgresql', 'redis-server', 'node'];
      for (const service of services) {
        const psResult = await execAsync(`pgrep -x ${service}`);
        if (!psResult.stdout.trim()) {
          console.log(`⚠️ Service ${service} not running!`);
          this.metrics.systemFailures++;
        }
      }
    } catch (error) {
      console.log('⚠️ System stability check failed:', error.message);
      this.metrics.systemFailures++;
    }
  }

  /**
   * Start resource-intensive load test
   */
  startLoadTest() {
    console.log('📊 Starting resource-intensive load test...\n');
    
    try {
      exec('k6 run ../k6/scenarios/03-stress-test.js', (error, stdout, stderr) => {
        if (error) {
          console.error('Load test error:', error);
        }
      });
    } catch (error) {
      console.error('Failed to start load test:', error);
    }
  }

  /**
   * Cleanup all stressors
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up resource stressors...');
    
    for (const stressor of this.activeStressors) {
      try {
        if (stressor.process) {
          stressor.process.kill();
        }
        if (stressor.processes) {
          stressor.processes.forEach(p => p.kill());
        }
        if (stressor.cleanup) {
          await stressor.cleanup();
        }
      } catch (error) {
        // Process might already be dead
      }
    }
    
    this.activeStressors = [];
  }

  /**
   * Generate chaos report
   */
  async generateReport() {
    const duration = (Date.now() - this.metrics.startTime) / 1000;
    const finalResources = await this.getResourceUsage();
    
    console.log('\n=====================================');
    console.log('📊 Resource Exhaustion Chaos Report');
    console.log('=====================================');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    
    console.log('\nScenarios Executed:');
    for (const [scenario, count] of Object.entries(this.metrics.scenariosExecuted)) {
      console.log(`  ${scenario}: ${count} times`);
    }
    
    console.log('\nResource Usage Peaks:');
    console.log(`  CPU: ${this.metrics.peak.cpu.toFixed(1)}% (baseline: ${this.metrics.baseline.cpu.toFixed(1)}%)`);
    console.log(`  Memory: ${this.metrics.peak.memory.toFixed(1)}% (baseline: ${this.metrics.baseline.memory.toFixed(1)}%)`);
    console.log(`  Disk I/O: ${this.metrics.peak.diskIO.toFixed(1)} MB/s`);
    
    console.log('\nSystem Impact:');
    console.log(`  System Failures: ${this.metrics.systemFailures}`);
    console.log(`  Final CPU: ${finalResources.cpu.toFixed(1)}%`);
    console.log(`  Final Memory: ${finalResources.memory.toFixed(1)}%`);
    console.log(`  Final Load: ${finalResources.loadAvg.toFixed(2)}`);
    
    // Calculate resilience score
    const score = this.calculateResilienceScore();
    console.log('\n🎯 Resource Resilience Score:');
    console.log(`  Score: ${score}/100`);
    
    if (score >= 80) {
      console.log('  ✅ Excellent resource handling');
    } else if (score >= 60) {
      console.log('  ⚠️ Adequate with room for improvement');
    } else {
      console.log('  ❌ Poor resource resilience');
    }
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    if (this.metrics.peak.cpu > 95) {
      console.log('  - Implement CPU throttling and load shedding');
    }
    if (this.metrics.peak.memory > 90) {
      console.log('  - Add memory limits and improve GC tuning');
    }
    if (this.metrics.systemFailures > 5) {
      console.log('  - Improve service health checks and auto-recovery');
    }
    
    console.log('=====================================\n');
  }

  /**
   * Calculate resource resilience score
   */
  calculateResilienceScore() {
    let score = 100;
    
    // Deduct for high resource usage
    if (this.metrics.peak.cpu > 95) score -= 15;
    else if (this.metrics.peak.cpu > 90) score -= 10;
    
    if (this.metrics.peak.memory > 90) score -= 20;
    else if (this.metrics.peak.memory > 85) score -= 10;
    
    // Deduct for system failures
    score -= Math.min(30, this.metrics.systemFailures * 5);
    
    // Bonus if system remained responsive
    if (this.metrics.systemFailures === 0) {
      score += 10;
    }
    
    return Math.max(0, Math.min(100, score));
  }
}

// Run chaos scenario
if (require.main === module) {
  const chaos = new ResourceExhaustionChaos();
  
  chaos.run().catch(error => {
    console.error('Resource chaos failed:', error);
    process.exit(1);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Stopping resource chaos...');
    await chaos.cleanup();
    process.exit(0);
  });
}

module.exports = ResourceExhaustionChaos;