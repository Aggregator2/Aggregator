/**
 * Redis Chaos Engineering
 * Specific chaos scenarios for Redis cluster and sentinel
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class RedisChaos {
  constructor(config = {}) {
    this.config = {
      clusterNodes: config.clusterNodes || [],
      sentinelNodes: config.sentinelNodes || [],
      masterName: config.masterName || 'mymaster',
      redisPassword: config.redisPassword,
      ...config
    };
    
    this.activeFailures = [];
  }

  /**
   * Kill random Redis cluster node
   */
  async killClusterNode() {
    if (this.config.clusterNodes.length === 0) {
      throw new Error('No cluster nodes configured');
    }
    
    const node = this.config.clusterNodes[Math.floor(Math.random() * this.config.clusterNodes.length)];
    console.log(`💀 Killing Redis cluster node: ${node.host}:${node.port}`);
    
    try {
      if (node.dockerContainer) {
        await execAsync(`docker kill ${node.dockerContainer}`);
        
        this.activeFailures.push({
          type: 'cluster_node_kill',
          node,
          timestamp: Date.now(),
          recovery: async () => {
            await execAsync(`docker start ${node.dockerContainer}`);
          }
        });
      } else {
        // Kill by port
        await execAsync(`sudo kill $(sudo lsof -t -i:${node.port})`);
      }
      
      return { success: true, node };
    } catch (error) {
      console.error(`Failed to kill cluster node: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Partition Redis cluster
   */
  async partitionCluster() {
    console.log(`🔪 Creating network partition in Redis cluster`);
    
    // Split nodes into two groups
    const half = Math.floor(this.config.clusterNodes.length / 2);
    const group1 = this.config.clusterNodes.slice(0, half);
    const group2 = this.config.clusterNodes.slice(half);
    
    try {
      // Block communication between groups
      for (const node1 of group1) {
        for (const node2 of group2) {
          await this.blockCommunication(node1, node2);
        }
      }
      
      this.activeFailures.push({
        type: 'cluster_partition',
        group1,
        group2,
        timestamp: Date.now(),
        recovery: async () => {
          for (const node1 of group1) {
            for (const node2 of group2) {
              await this.restoreCommunication(node1, node2);
            }
          }
        }
      });
      
      return { success: true, groups: [group1, group2] };
    } catch (error) {
      console.error(`Failed to partition cluster: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger Redis Sentinel failover
   */
  async triggerSentinelFailover() {
    console.log(`🔄 Triggering Sentinel failover`);
    
    if (this.config.sentinelNodes.length === 0) {
      throw new Error('No sentinel nodes configured');
    }
    
    const sentinel = this.config.sentinelNodes[0];
    
    try {
      const authCmd = this.config.redisPassword ? `-a ${this.config.redisPassword}` : '';
      await execAsync(
        `redis-cli -h ${sentinel.host} -p ${sentinel.port} ${authCmd} SENTINEL FAILOVER ${this.config.masterName}`
      );
      
      this.activeFailures.push({
        type: 'sentinel_failover',
        sentinel,
        timestamp: Date.now()
      });
      
      return { success: true };
    } catch (error) {
      console.error(`Failed to trigger failover: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Slow down Redis node (simulate slow disk)
   */
  async slowDownNode(node) {
    console.log(`🐌 Slowing down Redis node: ${node.host}:${node.port}`);
    
    try {
      // Use tc to add delay to Redis port
      await execAsync(
        `sudo tc qdisc add dev lo root handle 1: prio && ` +
        `sudo tc filter add dev lo parent 1:0 protocol ip prio 1 u32 match ip dport ${node.port} 0xffff flowid 1:1 && ` +
        `sudo tc qdisc add dev lo parent 1:1 handle 10: netem delay 100ms 20ms`
      );
      
      this.activeFailures.push({
        type: 'node_slowdown',
        node,
        timestamp: Date.now(),
        recovery: async () => {
          await execAsync(`sudo tc qdisc del dev lo root`);
        }
      });
      
      return { success: true };
    } catch (error) {
      console.error(`Failed to slow down node: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fill Redis memory
   */
  async fillMemory(node, percentageFill = 80) {
    console.log(`💾 Filling Redis memory to ${percentageFill}% on ${node.host}:${node.port}`);
    
    try {
      const authCmd = this.config.redisPassword ? `-a ${this.config.redisPassword}` : '';
      
      // Get current memory usage
      const infoResult = await execAsync(
        `redis-cli -h ${node.host} -p ${node.port} ${authCmd} INFO memory`
      );
      
      const maxMemoryMatch = infoResult.stdout.match(/maxmemory:(\d+)/);
      const usedMemoryMatch = infoResult.stdout.match(/used_memory:(\d+)/);
      
      if (!maxMemoryMatch || !usedMemoryMatch) {
        throw new Error('Could not parse memory info');
      }
      
      const maxMemory = parseInt(maxMemoryMatch[1]);
      const usedMemory = parseInt(usedMemoryMatch[1]);
      const targetMemory = maxMemory * (percentageFill / 100);
      const toFill = targetMemory - usedMemory;
      
      if (toFill > 0) {
        // Create large keys to fill memory
        const keySize = 1024 * 1024; // 1MB per key
        const numKeys = Math.floor(toFill / keySize);
        
        for (let i = 0; i < numKeys; i++) {
          await execAsync(
            `redis-cli -h ${node.host} -p ${node.port} ${authCmd} SET chaos:fill:${i} "$(head -c ${keySize} /dev/zero | tr '\\0' 'X')"`
          );
        }
        
        this.activeFailures.push({
          type: 'memory_fill',
          node,
          numKeys,
          timestamp: Date.now(),
          recovery: async () => {
            // Delete fill keys
            for (let i = 0; i < numKeys; i++) {
              await execAsync(
                `redis-cli -h ${node.host} -p ${node.port} ${authCmd} DEL chaos:fill:${i}`
              );
            }
          }
        });
      }
      
      return { success: true, filled: toFill };
    } catch (error) {
      console.error(`Failed to fill memory: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Corrupt Redis AOF file
   */
  async corruptAOF(node) {
    console.log(`💥 Corrupting AOF file on ${node.host}:${node.port}`);
    
    try {
      // This is dangerous - only for testing!
      if (node.dockerContainer) {
        await execAsync(
          `docker exec ${node.dockerContainer} sh -c "echo 'CORRUPT' >> /data/appendonly.aof"`
        );
      }
      
      this.activeFailures.push({
        type: 'aof_corruption',
        node,
        timestamp: Date.now()
      });
      
      return { success: true };
    } catch (error) {
      console.error(`Failed to corrupt AOF: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Simulate Redis OOM (Out of Memory)
   */
  async simulateOOM(node) {
    console.log(`💣 Simulating OOM on ${node.host}:${node.port}`);
    
    try {
      const authCmd = this.config.redisPassword ? `-a ${this.config.redisPassword}` : '';
      
      // Set maxmemory to a very low value
      await execAsync(
        `redis-cli -h ${node.host} -p ${node.port} ${authCmd} CONFIG SET maxmemory 1mb`
      );
      
      this.activeFailures.push({
        type: 'oom_simulation',
        node,
        timestamp: Date.now(),
        recovery: async () => {
          // Reset maxmemory
          await execAsync(
            `redis-cli -h ${node.host} -p ${node.port} ${authCmd} CONFIG SET maxmemory 0`
          );
        }
      });
      
      return { success: true };
    } catch (error) {
      console.error(`Failed to simulate OOM: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Block communication between nodes
   */
  async blockCommunication(node1, node2) {
    // Use iptables to block traffic
    await execAsync(
      `sudo iptables -A INPUT -s ${node2.host} -p tcp --dport ${node1.port} -j DROP`
    );
    await execAsync(
      `sudo iptables -A INPUT -s ${node1.host} -p tcp --dport ${node2.port} -j DROP`
    );
  }

  /**
   * Restore communication between nodes
   */
  async restoreCommunication(node1, node2) {
    // Remove iptables rules
    await execAsync(
      `sudo iptables -D INPUT -s ${node2.host} -p tcp --dport ${node1.port} -j DROP`
    );
    await execAsync(
      `sudo iptables -D INPUT -s ${node1.host} -p tcp --dport ${node2.port} -j DROP`
    );
  }

  /**
   * Recover all active failures
   */
  async recoverAll() {
    console.log('🔧 Recovering all Redis chaos...');
    
    for (const failure of this.activeFailures) {
      if (failure.recovery) {
        try {
          await failure.recovery();
          console.log(`Recovered: ${failure.type}`);
        } catch (error) {
          console.error(`Failed to recover ${failure.type}: ${error.message}`);
        }
      }
    }
    
    this.activeFailures = [];
  }

  /**
   * Check Redis cluster health
   */
  async checkClusterHealth() {
    const results = [];
    
    for (const node of this.config.clusterNodes) {
      try {
        const authCmd = this.config.redisPassword ? `-a ${this.config.redisPassword}` : '';
        const result = await execAsync(
          `redis-cli -h ${node.host} -p ${node.port} ${authCmd} CLUSTER INFO`
        );
        
        const isOk = result.stdout.includes('cluster_state:ok');
        results.push({
          node: `${node.host}:${node.port}`,
          healthy: isOk,
          output: result.stdout
        });
      } catch (error) {
        results.push({
          node: `${node.host}:${node.port}`,
          healthy: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = RedisChaos;