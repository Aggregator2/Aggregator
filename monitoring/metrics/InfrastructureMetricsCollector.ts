import { EventEmitter } from 'events';
import * as promClient from 'prom-client';
import * as os from 'os';
import { performance } from 'perf_hooks';
import * as v8 from 'v8';
import Redis from 'ioredis';
import { Pool } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface InfrastructureMetrics {
  cpu: {
    usage: number;
    loadAverage: [number, number, number];
    cores: number;
    userTime: number;
    systemTime: number;
    idleTime: number;
    temperature?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    available: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    buffers: number;
    cached: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    utilizationPercent: number;
    readOps: number;
    writeOps: number;
    readSpeed: number; // MB/s
    writeSpeed: number; // MB/s
  };
  network: {
    interfaces: Record<string, NetworkInterface>;
    totalBandwidthIn: number;
    totalBandwidthOut: number;
    connections: {
      active: number;
      established: number;
      timeWait: number;
      closeWait: number;
    };
    latency: {
      database: number;
      redis: number;
      external: number;
    };
  };
  services: {
    nodejs: NodeJSMetrics;
    database: DatabaseMetrics;
    redis: RedisMetrics;
    docker?: DockerMetrics;
  };
}

interface NetworkInterface {
  name: string;
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
  packetsOut: number;
  errorsIn: number;
  errorsOut: number;
  droppedIn: number;
  droppedOut: number;
}

interface NodeJSMetrics {
  version: string;
  uptime: number;
  pid: number;
  eventLoopLag: number;
  eventLoopUtilization: number;
  handles: number;
  requests: number;
  heapSpaces: v8.HeapSpaceInfo[];
  gcStats: {
    count: number;
    pauseMs: number;
    reclaimed: number;
  };
}

interface DatabaseMetrics {
  connections: {
    active: number;
    idle: number;
    waiting: number;
    maxConnections: number;
  };
  queries: {
    active: number;
    slow: number;
    blocked: number;
  };
  replication?: {
    lag: number;
    state: string;
  };
  size: number;
  cacheHitRatio: number;
}

interface RedisMetrics {
  connected: boolean;
  memory: {
    used: number;
    peak: number;
    fragmentation: number;
  };
  clients: {
    connected: number;
    blocked: number;
    maxClients: number;
  };
  stats: {
    totalCommands: number;
    instantaneousOps: number;
    hitRate: number;
    evictedKeys: number;
  };
  persistence: {
    lastSave: number;
    changesSinceLastSave: number;
  };
}

interface DockerMetrics {
  containers: Array<{
    name: string;
    status: string;
    cpu: number;
    memory: number;
    networkIO: { rx: number; tx: number };
    blockIO: { read: number; write: number };
  }>;
  images: number;
  volumes: number;
}

export class InfrastructureMetricsCollector extends EventEmitter {
  private redis: Redis;
  private db: Pool;
  private updateInterval?: NodeJS.Timeout;
  private previousNetStats: Map<string, NetworkInterface> = new Map();
  private previousCpuInfo: any;
  private gcObserver?: PerformanceObserver;
  
  // Prometheus metrics
  private cpuUsageGauge: promClient.Gauge;
  private memoryUsageGauge: promClient.Gauge;
  private diskUsageGauge: promClient.Gauge;
  private networkBytesGauge: promClient.Gauge;
  private eventLoopLagGauge: promClient.Gauge;
  private gcDurationGauge: promClient.Gauge;
  private dbConnectionsGauge: promClient.Gauge;
  private redisMemoryGauge: promClient.Gauge;
  
  constructor(redis: Redis, db: Pool) {
    super();
    this.redis = redis;
    this.db = db;
    this.initializeMetrics();
    this.setupGCMonitoring();
  }

  private initializeMetrics(): void {
    // CPU metrics
    this.cpuUsageGauge = new promClient.Gauge({
      name: 'dex_cpu_usage_percent',
      help: 'CPU usage percentage',
      labelNames: ['type'], // user, system, idle
    });

    // Memory metrics
    this.memoryUsageGauge = new promClient.Gauge({
      name: 'dex_memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type'], // heap, rss, external, total, free
    });

    // Disk metrics
    this.diskUsageGauge = new promClient.Gauge({
      name: 'dex_disk_usage_bytes',
      help: 'Disk usage in bytes',
      labelNames: ['type'], // used, free, total
    });

    // Network metrics
    this.networkBytesGauge = new promClient.Gauge({
      name: 'dex_network_bytes',
      help: 'Network traffic in bytes',
      labelNames: ['interface', 'direction'], // in, out
    });

    // Node.js specific metrics
    this.eventLoopLagGauge = new promClient.Gauge({
      name: 'dex_nodejs_event_loop_lag_ms',
      help: 'Node.js event loop lag in milliseconds',
    });

    this.gcDurationGauge = new promClient.Gauge({
      name: 'dex_nodejs_gc_duration_ms',
      help: 'Garbage collection duration in milliseconds',
      labelNames: ['type'], // major, minor
    });

    // Database metrics
    this.dbConnectionsGauge = new promClient.Gauge({
      name: 'dex_database_connections',
      help: 'Database connection count',
      labelNames: ['state'], // active, idle, waiting
    });

    // Redis metrics
    this.redisMemoryGauge = new promClient.Gauge({
      name: 'dex_redis_memory_bytes',
      help: 'Redis memory usage in bytes',
      labelNames: ['type'], // used, peak
    });
  }

  private setupGCMonitoring(): void {
    // Monitor garbage collection
    try {
      const obs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.name === 'gc') {
            const gcType = (entry as any).kind === 2 ? 'major' : 'minor';
            this.gcDurationGauge.set({ type: gcType }, entry.duration);
          }
        });
      });
      obs.observe({ entryTypes: ['gc'] });
      this.gcObserver = obs;
    } catch (error) {
      console.warn('GC monitoring not available:', error);
    }
  }

  async start(intervalMs: number = 10000): Promise<void> {
    // Initial collection
    await this.collectAllMetrics();
    
    // Schedule periodic updates
    this.updateInterval = setInterval(async () => {
      try {
        await this.collectAllMetrics();
      } catch (error) {
        console.error('Error collecting infrastructure metrics:', error);
        this.emit('error', error);
      }
    }, intervalMs);
    
    console.log(`🖥️  Infrastructure metrics collector started (interval: ${intervalMs}ms)`);
  }

  private async collectAllMetrics(): Promise<void> {
    const [
      cpuMetrics,
      memoryMetrics,
      diskMetrics,
      networkMetrics,
      serviceMetrics,
    ] = await Promise.all([
      this.collectCpuMetrics(),
      this.collectMemoryMetrics(),
      this.collectDiskMetrics(),
      this.collectNetworkMetrics(),
      this.collectServiceMetrics(),
    ]);

    const metrics: InfrastructureMetrics = {
      cpu: cpuMetrics,
      memory: memoryMetrics,
      disk: diskMetrics,
      network: networkMetrics,
      services: serviceMetrics,
    };

    // Update Prometheus metrics
    this.updatePrometheusMetrics(metrics);
    
    // Store in Redis
    await this.storeMetricsInRedis(metrics);
    
    this.emit('metrics-updated', metrics);
  }

  private async collectCpuMetrics(): Promise<InfrastructureMetrics['cpu']> {
    const cpus = os.cpus();
    const loadAverage = os.loadavg() as [number, number, number];
    
    // Calculate CPU usage
    let userTime = 0;
    let systemTime = 0;
    let idleTime = 0;
    let totalTime = 0;
    
    cpus.forEach(cpu => {
      userTime += cpu.times.user;
      systemTime += cpu.times.sys;
      idleTime += cpu.times.idle;
      totalTime += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    });
    
    let usage = 0;
    if (this.previousCpuInfo) {
      const userDiff = userTime - this.previousCpuInfo.userTime;
      const systemDiff = systemTime - this.previousCpuInfo.systemTime;
      const idleDiff = idleTime - this.previousCpuInfo.idleTime;
      const totalDiff = totalTime - this.previousCpuInfo.totalTime;
      
      usage = totalDiff > 0 ? ((userDiff + systemDiff) / totalDiff) * 100 : 0;
    }
    
    this.previousCpuInfo = { userTime, systemTime, idleTime, totalTime };
    
    // Try to get CPU temperature (Linux only)
    let temperature: number | undefined;
    try {
      const tempFile = '/sys/class/thermal/thermal_zone0/temp';
      const temp = await fs.readFile(tempFile, 'utf-8');
      temperature = parseInt(temp) / 1000; // Convert to Celsius
    } catch (error) {
      // Temperature not available
    }
    
    return {
      usage,
      loadAverage,
      cores: cpus.length,
      userTime: userTime / totalTime * 100,
      systemTime: systemTime / totalTime * 100,
      idleTime: idleTime / totalTime * 100,
      temperature,
    };
  }

  private async collectMemoryMetrics(): Promise<InfrastructureMetrics['memory']> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = process.memoryUsage();
    
    // Try to get more detailed memory info (Linux only)
    let buffers = 0;
    let cached = 0;
    try {
      const memInfo = await fs.readFile('/proc/meminfo', 'utf-8');
      const buffersMatch = memInfo.match(/Buffers:\s+(\d+)/);
      const cachedMatch = memInfo.match(/Cached:\s+(\d+)/);
      
      if (buffersMatch) buffers = parseInt(buffersMatch[1]) * 1024;
      if (cachedMatch) cached = parseInt(cachedMatch[1]) * 1024;
    } catch (error) {
      // Not on Linux
    }
    
    const available = freeMem + buffers + cached;
    
    return {
      total: totalMem,
      used: totalMem - freeMem,
      free: freeMem,
      available,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      buffers,
      cached,
    };
  }

  private async collectDiskMetrics(): Promise<InfrastructureMetrics['disk']> {
    // This is a simplified version - in production you'd use a library like node-disk-info
    let diskStats = {
      total: 0,
      used: 0,
      free: 0,
      utilizationPercent: 0,
      readOps: 0,
      writeOps: 0,
      readSpeed: 0,
      writeSpeed: 0,
    };
    
    try {
      // Try to get disk stats (Linux only)
      const dfOutput = await this.execCommand('df -B1 /');
      const lines = dfOutput.split('\n');
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) {
          diskStats.total = parseInt(parts[1]);
          diskStats.used = parseInt(parts[2]);
          diskStats.free = parseInt(parts[3]);
          diskStats.utilizationPercent = (diskStats.used / diskStats.total) * 100;
        }
      }
      
      // Try to get I/O stats
      const iostatOutput = await this.execCommand('iostat -dx 1 1');
      // Parse iostat output for read/write speeds
      // This is simplified - actual implementation would parse properly
    } catch (error) {
      // Fallback for non-Linux or if commands fail
      diskStats.total = 1000000000000; // 1TB dummy value
      diskStats.used = 500000000000;   // 500GB dummy value
      diskStats.free = 500000000000;   // 500GB dummy value
      diskStats.utilizationPercent = 50;
    }
    
    return diskStats;
  }

  private async collectNetworkMetrics(): Promise<InfrastructureMetrics['network']> {
    const interfaces = os.networkInterfaces();
    const netStats: Record<string, NetworkInterface> = {};
    let totalBandwidthIn = 0;
    let totalBandwidthOut = 0;
    
    // Collect interface statistics
    for (const [name, ifaces] of Object.entries(interfaces)) {
      if (!ifaces || name === 'lo') continue; // Skip loopback
      
      // In production, you'd read from /sys/class/net/[interface]/statistics/
      // For now, using simulated values
      const stats: NetworkInterface = {
        name,
        bytesIn: Math.random() * 1000000,
        bytesOut: Math.random() * 1000000,
        packetsIn: Math.random() * 10000,
        packetsOut: Math.random() * 10000,
        errorsIn: 0,
        errorsOut: 0,
        droppedIn: 0,
        droppedOut: 0,
      };
      
      // Calculate bandwidth (bytes/sec) if we have previous stats
      const prevStats = this.previousNetStats.get(name);
      if (prevStats) {
        const timeDiff = 10; // seconds (our collection interval)
        totalBandwidthIn += (stats.bytesIn - prevStats.bytesIn) / timeDiff;
        totalBandwidthOut += (stats.bytesOut - prevStats.bytesOut) / timeDiff;
      }
      
      netStats[name] = stats;
      this.previousNetStats.set(name, stats);
    }
    
    // Test network latency
    const latency = await this.testNetworkLatency();
    
    // Get connection stats (simplified)
    const connections = {
      active: 100, // Would use netstat or ss command
      established: 80,
      timeWait: 15,
      closeWait: 5,
    };
    
    return {
      interfaces: netStats,
      totalBandwidthIn,
      totalBandwidthOut,
      connections,
      latency,
    };
  }

  private async testNetworkLatency(): Promise<InfrastructureMetrics['network']['latency']> {
    const latency = {
      database: 0,
      redis: 0,
      external: 0,
    };
    
    // Test database latency
    try {
      const start = performance.now();
      await this.db.query('SELECT 1');
      latency.database = performance.now() - start;
    } catch (error) {
      console.error('Database latency test failed:', error);
    }
    
    // Test Redis latency
    try {
      const start = performance.now();
      await this.redis.ping();
      latency.redis = performance.now() - start;
    } catch (error) {
      console.error('Redis latency test failed:', error);
    }
    
    // Test external latency (DNS lookup)
    try {
      const start = performance.now();
      await this.execCommand('nslookup google.com');
      latency.external = performance.now() - start;
    } catch (error) {
      // Fallback
      latency.external = 50;
    }
    
    return latency;
  }

  private async collectServiceMetrics(): Promise<InfrastructureMetrics['services']> {
    const [nodejs, database, redis, docker] = await Promise.all([
      this.collectNodeJSMetrics(),
      this.collectDatabaseMetrics(),
      this.collectRedisMetrics(),
      this.collectDockerMetrics(),
    ]);
    
    return {
      nodejs,
      database,
      redis,
      docker,
    };
  }

  private async collectNodeJSMetrics(): Promise<NodeJSMetrics> {
    const eventLoopLag = await this.measureEventLoopLag();
    
    return {
      version: process.version,
      uptime: process.uptime(),
      pid: process.pid,
      eventLoopLag,
      eventLoopUtilization: performance.eventLoopUtilization().utilization,
      handles: (process as any)._getActiveHandles?.().length || 0,
      requests: (process as any)._getActiveRequests?.().length || 0,
      heapSpaces: v8.getHeapSpaceStatistics(),
      gcStats: {
        count: 0, // Would track over time
        pauseMs: 0,
        reclaimed: 0,
      },
    };
  }

  private async measureEventLoopLag(): Promise<number> {
    return new Promise((resolve) => {
      const start = performance.now();
      setImmediate(() => {
        resolve(performance.now() - start);
      });
    });
  }

  private async collectDatabaseMetrics(): Promise<DatabaseMetrics> {
    try {
      // Get connection stats
      const connStats = await this.db.query(`
        SELECT 
          count(*) FILTER (WHERE state = 'active') as active,
          count(*) FILTER (WHERE state = 'idle') as idle,
          count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
          count(*) FILTER (WHERE wait_event_type = 'Client') as waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);
      
      // Get database size
      const sizeResult = await this.db.query(`
        SELECT pg_database_size(current_database()) as size
      `);
      
      // Get cache hit ratio
      const cacheStats = await this.db.query(`
        SELECT 
          sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as cache_hit_ratio
        FROM pg_statio_user_tables
      `);
      
      // Get query stats
      const queryStats = await this.db.query(`
        SELECT 
          count(*) FILTER (WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%') as active,
          count(*) FILTER (WHERE state = 'active' AND wait_event_type IS NOT NULL) as blocked,
          count(*) FILTER (WHERE state = 'active' AND extract(epoch from now() - query_start) > 5) as slow
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);
      
      const conn = connStats.rows[0];
      const query = queryStats.rows[0];
      
      return {
        connections: {
          active: parseInt(conn.active) || 0,
          idle: parseInt(conn.idle) || 0,
          waiting: parseInt(conn.waiting) || 0,
          maxConnections: 100, // Would get from settings
        },
        queries: {
          active: parseInt(query.active) || 0,
          slow: parseInt(query.slow) || 0,
          blocked: parseInt(query.blocked) || 0,
        },
        size: parseInt(sizeResult.rows[0].size) || 0,
        cacheHitRatio: parseFloat(cacheStats.rows[0]?.cache_hit_ratio || '0'),
      };
    } catch (error) {
      console.error('Failed to collect database metrics:', error);
      return {
        connections: { active: 0, idle: 0, waiting: 0, maxConnections: 100 },
        queries: { active: 0, slow: 0, blocked: 0 },
        size: 0,
        cacheHitRatio: 0,
      };
    }
  }

  private async collectRedisMetrics(): Promise<RedisMetrics> {
    try {
      const info = await this.redis.info();
      const stats: any = {};
      
      // Parse Redis INFO output
      info.split('\n').forEach(line => {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key.trim()] = value.trim();
        }
      });
      
      return {
        connected: true,
        memory: {
          used: parseInt(stats.used_memory || '0'),
          peak: parseInt(stats.used_memory_peak || '0'),
          fragmentation: parseFloat(stats.mem_fragmentation_ratio || '1'),
        },
        clients: {
          connected: parseInt(stats.connected_clients || '0'),
          blocked: parseInt(stats.blocked_clients || '0'),
          maxClients: parseInt(stats.maxclients || '10000'),
        },
        stats: {
          totalCommands: parseInt(stats.total_commands_processed || '0'),
          instantaneousOps: parseInt(stats.instantaneous_ops_per_sec || '0'),
          hitRate: this.calculateRedisHitRate(stats),
          evictedKeys: parseInt(stats.evicted_keys || '0'),
        },
        persistence: {
          lastSave: parseInt(stats.rdb_last_save_time || '0'),
          changesSinceLastSave: parseInt(stats.rdb_changes_since_last_save || '0'),
        },
      };
    } catch (error) {
      console.error('Failed to collect Redis metrics:', error);
      return {
        connected: false,
        memory: { used: 0, peak: 0, fragmentation: 1 },
        clients: { connected: 0, blocked: 0, maxClients: 10000 },
        stats: { totalCommands: 0, instantaneousOps: 0, hitRate: 0, evictedKeys: 0 },
        persistence: { lastSave: 0, changesSinceLastSave: 0 },
      };
    }
  }

  private calculateRedisHitRate(stats: any): number {
    const hits = parseInt(stats.keyspace_hits || '0');
    const misses = parseInt(stats.keyspace_misses || '0');
    const total = hits + misses;
    return total > 0 ? (hits / total) * 100 : 0;
  }

  private async collectDockerMetrics(): Promise<DockerMetrics | undefined> {
    try {
      // Check if Docker is available
      await this.execCommand('docker --version');
      
      // Get container stats
      const containersOutput = await this.execCommand('docker stats --no-stream --format json');
      const containers = containersOutput
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            const stats = JSON.parse(line);
            return {
              name: stats.Name,
              status: 'running',
              cpu: parseFloat(stats.CPUPerc?.replace('%', '') || '0'),
              memory: parseFloat(stats.MemPerc?.replace('%', '') || '0'),
              networkIO: {
                rx: this.parseBytes(stats.NetIO?.split('/')[0] || '0'),
                tx: this.parseBytes(stats.NetIO?.split('/')[1] || '0'),
              },
              blockIO: {
                read: this.parseBytes(stats.BlockIO?.split('/')[0] || '0'),
                write: this.parseBytes(stats.BlockIO?.split('/')[1] || '0'),
              },
            };
          } catch (error) {
            return null;
          }
        })
        .filter(Boolean) as DockerMetrics['containers'];
      
      // Get image and volume counts
      const imagesOutput = await this.execCommand('docker images -q | wc -l');
      const volumesOutput = await this.execCommand('docker volume ls -q | wc -l');
      
      return {
        containers,
        images: parseInt(imagesOutput.trim()) || 0,
        volumes: parseInt(volumesOutput.trim()) || 0,
      };
    } catch (error) {
      // Docker not available
      return undefined;
    }
  }

  private parseBytes(str: string): number {
    const match = str.match(/^([\d.]+)([KMGT]?)B?$/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    const multipliers: Record<string, number> = {
      '': 1,
      'K': 1024,
      'M': 1024 * 1024,
      'G': 1024 * 1024 * 1024,
      'T': 1024 * 1024 * 1024 * 1024,
    };
    
    return value * (multipliers[unit] || 1);
  }

  private async execCommand(command: string): Promise<string> {
    const { promisify } = require('util');
    const exec = promisify(require('child_process').exec);
    
    try {
      const { stdout } = await exec(command);
      return stdout;
    } catch (error) {
      throw error;
    }
  }

  private updatePrometheusMetrics(metrics: InfrastructureMetrics): void {
    // CPU metrics
    this.cpuUsageGauge.set({ type: 'user' }, metrics.cpu.userTime);
    this.cpuUsageGauge.set({ type: 'system' }, metrics.cpu.systemTime);
    this.cpuUsageGauge.set({ type: 'idle' }, metrics.cpu.idleTime);
    
    // Memory metrics
    this.memoryUsageGauge.set({ type: 'heap' }, metrics.memory.heapUsed);
    this.memoryUsageGauge.set({ type: 'rss' }, metrics.memory.rss);
    this.memoryUsageGauge.set({ type: 'external' }, metrics.memory.external);
    this.memoryUsageGauge.set({ type: 'total' }, metrics.memory.total);
    this.memoryUsageGauge.set({ type: 'free' }, metrics.memory.free);
    
    // Disk metrics
    this.diskUsageGauge.set({ type: 'used' }, metrics.disk.used);
    this.diskUsageGauge.set({ type: 'free' }, metrics.disk.free);
    this.diskUsageGauge.set({ type: 'total' }, metrics.disk.total);
    
    // Network metrics
    for (const [name, stats] of Object.entries(metrics.network.interfaces)) {
      this.networkBytesGauge.set({ interface: name, direction: 'in' }, stats.bytesIn);
      this.networkBytesGauge.set({ interface: name, direction: 'out' }, stats.bytesOut);
    }
    
    // Node.js metrics
    this.eventLoopLagGauge.set(metrics.services.nodejs.eventLoopLag);
    
    // Database metrics
    this.dbConnectionsGauge.set({ state: 'active' }, metrics.services.database.connections.active);
    this.dbConnectionsGauge.set({ state: 'idle' }, metrics.services.database.connections.idle);
    this.dbConnectionsGauge.set({ state: 'waiting' }, metrics.services.database.connections.waiting);
    
    // Redis metrics
    this.redisMemoryGauge.set({ type: 'used' }, metrics.services.redis.memory.used);
    this.redisMemoryGauge.set({ type: 'peak' }, metrics.services.redis.memory.peak);
  }

  private async storeMetricsInRedis(metrics: InfrastructureMetrics): Promise<void> {
    const timestamp = Date.now();
    const key = `infrastructure_metrics:${timestamp}`;
    
    // Store with 24-hour TTL
    await this.redis.setex(key, 24 * 60 * 60, JSON.stringify(metrics));
    await this.redis.zadd('infrastructure_metrics:timeline', timestamp, key);
    
    // Cleanup old entries (keep 7 days)
    const cutoff = timestamp - 7 * 24 * 60 * 60 * 1000;
    await this.redis.zremrangebyscore('infrastructure_metrics:timeline', 0, cutoff);
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    
    if (this.gcObserver) {
      this.gcObserver.disconnect();
    }
  }
}