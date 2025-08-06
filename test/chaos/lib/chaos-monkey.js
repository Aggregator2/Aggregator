/**
 * Chaos Monkey - Core chaos engineering library
 * Implements various failure injection mechanisms
 */

const { exec, spawn } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');

class ChaosMonkey {
  constructor(config = {}) {
    this.config = {
      dryRun: config.dryRun || false,
      logFile: config.logFile || '/tmp/chaos-monkey.log',
      services: config.services || [],
      probability: config.probability || 0.1,
      minDelay: config.minDelay || 10000, // 10 seconds
      maxDelay: config.maxDelay || 60000, // 60 seconds
      ...config
    };
    
    this.active = false;
    this.actions = [];
  }

  /**
   * Start chaos monkey
   */
  async start() {
    this.active = true;
    await this.log('🐵 Chaos Monkey activated!');
    
    while (this.active) {
      if (Math.random() < this.config.probability) {
        await this.executeRandomChaos();
      }
      
      const delay = this.randomDelay();
      await this.sleep(delay);
    }
  }

  /**
   * Stop chaos monkey
   */
  async stop() {
    this.active = false;
    await this.log('🛑 Chaos Monkey deactivated');
    await this.cleanup();
  }

  /**
   * Execute random chaos action
   */
  async executeRandomChaos() {
    const actions = [
      () => this.killRandomService(),
      () => this.injectNetworkLatency(),
      () => this.injectPacketLoss(),
      () => this.throttleCPU(),
      () => this.fillDisk(),
      () => this.consumeMemory(),
      () => this.killDatabaseConnection(),
      () => this.blockPort(),
      () => this.corruptDNS()
    ];
    
    const action = actions[Math.floor(Math.random() * actions.length)];
    
    try {
      await action();
    } catch (error) {
      await this.log(`Error executing chaos action: ${error.message}`, 'error');
    }
  }

  /**
   * Kill random service
   */
  async killRandomService() {
    if (this.config.services.length === 0) {
      await this.log('No services configured for chaos', 'warn');
      return;
    }
    
    const service = this.config.services[Math.floor(Math.random() * this.config.services.length)];
    await this.log(`💀 Killing service: ${service.name}`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would kill service', 'info');
      return;
    }
    
    const action = {
      type: 'kill_service',
      service: service.name,
      timestamp: Date.now()
    };
    
    try {
      if (service.type === 'docker') {
        await execAsync(`docker kill ${service.container}`);
        action.recovery = async () => {
          await execAsync(`docker start ${service.container}`);
        };
      } else if (service.type === 'process') {
        await execAsync(`pkill -f "${service.pattern}"`);
        action.recovery = async () => {
          if (service.startCommand) {
            exec(service.startCommand);
          }
        };
      } else if (service.type === 'systemd') {
        await execAsync(`sudo systemctl stop ${service.name}`);
        action.recovery = async () => {
          await execAsync(`sudo systemctl start ${service.name}`);
        };
      }
      
      this.actions.push(action);
      
      // Schedule recovery
      if (service.autoRecover) {
        setTimeout(() => this.recoverService(action), service.recoveryDelay || 30000);
      }
      
      await this.log(`Successfully killed ${service.name}`);
    } catch (error) {
      await this.log(`Failed to kill service: ${error.message}`, 'error');
    }
  }

  /**
   * Inject network latency
   */
  async injectNetworkLatency() {
    const interface = this.config.networkInterface || 'eth0';
    const latency = Math.floor(Math.random() * 300) + 50; // 50-350ms
    const jitter = Math.floor(latency * 0.2); // 20% jitter
    
    await this.log(`🌐 Injecting network latency: ${latency}ms ±${jitter}ms on ${interface}`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would inject latency', 'info');
      return;
    }
    
    const action = {
      type: 'network_latency',
      interface,
      latency,
      timestamp: Date.now()
    };
    
    try {
      // Add latency using tc (traffic control)
      await execAsync(`sudo tc qdisc add dev ${interface} root netem delay ${latency}ms ${jitter}ms`);
      
      action.recovery = async () => {
        await execAsync(`sudo tc qdisc del dev ${interface} root netem`);
      };
      
      this.actions.push(action);
      
      // Auto-recover after random time
      const duration = this.randomDelay();
      setTimeout(() => this.recoverNetworkLatency(action), duration);
      
      await this.log(`Network latency injected for ${duration/1000}s`);
    } catch (error) {
      await this.log(`Failed to inject latency: ${error.message}`, 'error');
    }
  }

  /**
   * Inject packet loss
   */
  async injectPacketLoss() {
    const interface = this.config.networkInterface || 'eth0';
    const lossRate = Math.floor(Math.random() * 10) + 1; // 1-10% loss
    
    await this.log(`📦 Injecting packet loss: ${lossRate}% on ${interface}`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would inject packet loss', 'info');
      return;
    }
    
    const action = {
      type: 'packet_loss',
      interface,
      lossRate,
      timestamp: Date.now()
    };
    
    try {
      await execAsync(`sudo tc qdisc add dev ${interface} root netem loss ${lossRate}%`);
      
      action.recovery = async () => {
        await execAsync(`sudo tc qdisc del dev ${interface} root netem`);
      };
      
      this.actions.push(action);
      
      const duration = this.randomDelay();
      setTimeout(() => this.recoverPacketLoss(action), duration);
      
      await this.log(`Packet loss injected for ${duration/1000}s`);
    } catch (error) {
      await this.log(`Failed to inject packet loss: ${error.message}`, 'error');
    }
  }

  /**
   * Throttle CPU usage
   */
  async throttleCPU() {
    const cores = this.config.cpuCores || 2;
    const percentage = Math.floor(Math.random() * 50) + 50; // 50-100%
    
    await this.log(`🔥 Throttling CPU: ${percentage}% on ${cores} cores`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would throttle CPU', 'info');
      return;
    }
    
    const action = {
      type: 'cpu_throttle',
      cores,
      percentage,
      timestamp: Date.now(),
      processes: []
    };
    
    try {
      // Use stress-ng to consume CPU
      for (let i = 0; i < cores; i++) {
        const proc = spawn('stress-ng', [
          '--cpu', '1',
          '--cpu-load', percentage.toString(),
          '--timeout', '60s'
        ]);
        action.processes.push(proc);
      }
      
      action.recovery = async () => {
        action.processes.forEach(proc => proc.kill());
      };
      
      this.actions.push(action);
      await this.log(`CPU throttled with ${cores} stress processes`);
    } catch (error) {
      await this.log(`Failed to throttle CPU: ${error.message}`, 'error');
    }
  }

  /**
   * Fill disk space
   */
  async fillDisk() {
    const path = this.config.diskPath || '/tmp';
    const sizeMB = Math.floor(Math.random() * 1000) + 500; // 500-1500MB
    
    await this.log(`💾 Filling disk: ${sizeMB}MB in ${path}`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would fill disk', 'info');
      return;
    }
    
    const filename = `chaos_disk_${Date.now()}.tmp`;
    const filepath = `${path}/${filename}`;
    
    const action = {
      type: 'disk_fill',
      filepath,
      sizeMB,
      timestamp: Date.now()
    };
    
    try {
      await execAsync(`dd if=/dev/zero of=${filepath} bs=1M count=${sizeMB}`);
      
      action.recovery = async () => {
        await execAsync(`rm -f ${filepath}`);
      };
      
      this.actions.push(action);
      
      const duration = this.randomDelay();
      setTimeout(() => this.recoverDiskSpace(action), duration);
      
      await this.log(`Disk filled for ${duration/1000}s`);
    } catch (error) {
      await this.log(`Failed to fill disk: ${error.message}`, 'error');
    }
  }

  /**
   * Consume memory
   */
  async consumeMemory() {
    const memoryMB = Math.floor(Math.random() * 2000) + 1000; // 1-3GB
    
    await this.log(`🧠 Consuming memory: ${memoryMB}MB`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would consume memory', 'info');
      return;
    }
    
    const action = {
      type: 'memory_consume',
      memoryMB,
      timestamp: Date.now()
    };
    
    try {
      const proc = spawn('stress-ng', [
        '--vm', '1',
        '--vm-bytes', `${memoryMB}M`,
        '--timeout', '60s'
      ]);
      
      action.process = proc;
      action.recovery = async () => {
        proc.kill();
      };
      
      this.actions.push(action);
      await this.log(`Memory consumption started`);
    } catch (error) {
      await this.log(`Failed to consume memory: ${error.message}`, 'error');
    }
  }

  /**
   * Kill database connections
   */
  async killDatabaseConnection() {
    await this.log(`🔌 Killing database connections`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would kill DB connections', 'info');
      return;
    }
    
    const action = {
      type: 'db_connection_kill',
      timestamp: Date.now()
    };
    
    try {
      // PostgreSQL example
      if (this.config.database?.type === 'postgresql') {
        const query = `
          SELECT pg_terminate_backend(pid) 
          FROM pg_stat_activity 
          WHERE datname = '${this.config.database.name}' 
          AND pid <> pg_backend_pid()
          AND application_name LIKE '%${this.config.database.appName || 'node'}%';
        `;
        
        await execAsync(`psql -U ${this.config.database.user} -d ${this.config.database.name} -c "${query}"`);
      }
      
      // Redis example
      if (this.config.redis) {
        await execAsync(`redis-cli CLIENT KILL TYPE normal`);
      }
      
      this.actions.push(action);
      await this.log(`Database connections killed`);
    } catch (error) {
      await this.log(`Failed to kill DB connections: ${error.message}`, 'error');
    }
  }

  /**
   * Block network port
   */
  async blockPort() {
    const ports = this.config.ports || [3000, 5432, 6379];
    const port = ports[Math.floor(Math.random() * ports.length)];
    
    await this.log(`🚫 Blocking port: ${port}`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would block port', 'info');
      return;
    }
    
    const action = {
      type: 'port_block',
      port,
      timestamp: Date.now()
    };
    
    try {
      await execAsync(`sudo iptables -A INPUT -p tcp --dport ${port} -j DROP`);
      
      action.recovery = async () => {
        await execAsync(`sudo iptables -D INPUT -p tcp --dport ${port} -j DROP`);
      };
      
      this.actions.push(action);
      
      const duration = this.randomDelay();
      setTimeout(() => this.recoverPort(action), duration);
      
      await this.log(`Port ${port} blocked for ${duration/1000}s`);
    } catch (error) {
      await this.log(`Failed to block port: ${error.message}`, 'error');
    }
  }

  /**
   * Corrupt DNS resolution
   */
  async corruptDNS() {
    await this.log(`🌐 Corrupting DNS resolution`);
    
    if (this.config.dryRun) {
      await this.log('DRY RUN: Would corrupt DNS', 'info');
      return;
    }
    
    const action = {
      type: 'dns_corruption',
      timestamp: Date.now()
    };
    
    try {
      // Add fake DNS entry
      const fakeEntry = `127.0.0.1 ${this.config.database?.host || 'database.local'}`;
      await execAsync(`echo "${fakeEntry}" | sudo tee -a /etc/hosts`);
      
      action.recovery = async () => {
        await execAsync(`sudo sed -i '/${fakeEntry}/d' /etc/hosts`);
      };
      
      this.actions.push(action);
      
      const duration = this.randomDelay();
      setTimeout(() => this.recoverDNS(action), duration);
      
      await this.log(`DNS corrupted for ${duration/1000}s`);
    } catch (error) {
      await this.log(`Failed to corrupt DNS: ${error.message}`, 'error');
    }
  }

  /**
   * Recovery methods
   */
  async recoverService(action) {
    await this.log(`🔧 Recovering service: ${action.service}`);
    if (action.recovery) {
      await action.recovery();
    }
  }

  async recoverNetworkLatency(action) {
    await this.log(`🔧 Removing network latency from ${action.interface}`);
    if (action.recovery) {
      await action.recovery();
    }
  }

  async recoverPacketLoss(action) {
    await this.log(`🔧 Removing packet loss from ${action.interface}`);
    if (action.recovery) {
      await action.recovery();
    }
  }

  async recoverDiskSpace(action) {
    await this.log(`🔧 Cleaning disk space: ${action.filepath}`);
    if (action.recovery) {
      await action.recovery();
    }
  }

  async recoverPort(action) {
    await this.log(`🔧 Unblocking port: ${action.port}`);
    if (action.recovery) {
      await action.recovery();
    }
  }

  async recoverDNS(action) {
    await this.log(`🔧 Restoring DNS resolution`);
    if (action.recovery) {
      await action.recovery();
    }
  }

  /**
   * Cleanup all active chaos
   */
  async cleanup() {
    await this.log('🧹 Cleaning up all chaos actions...');
    
    for (const action of this.actions) {
      if (action.recovery) {
        try {
          await action.recovery();
          await this.log(`Cleaned up: ${action.type}`);
        } catch (error) {
          await this.log(`Failed to cleanup ${action.type}: ${error.message}`, 'error');
        }
      }
    }
    
    this.actions = [];
  }

  /**
   * Utility methods
   */
  randomDelay() {
    return Math.floor(Math.random() * (this.config.maxDelay - this.config.minDelay)) + this.config.minDelay;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    
    console.log(logEntry.trim());
    
    try {
      await fs.appendFile(this.config.logFile, logEntry);
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }
}

module.exports = ChaosMonkey;