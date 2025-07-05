import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import Redis from 'redis';
import os from 'os';
import fs from 'fs';
import { promisify } from 'util';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    websocket: ServiceHealth;
    external: ServiceHealth;
  };
  system: {
    memory: MemoryUsage;
    cpu: CPUUsage;
    disk: DiskUsage;
  };
  application: {
    activeConnections: number;
    requestsPerSecond: number;
    averageResponseTime: number;
    errorRate: number;
  };
}

interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  latency: number;
  error?: string;
}

interface MemoryUsage {
  total: number;
  used: number;
  free: number;
  percentage: number;
}

interface CPUUsage {
  count: number;
  loadAverage: number[];
  percentage: number;
}

interface DiskUsage {
  total: number;
  used: number;
  free: number;
  percentage: number;
}

export class HealthCheckService {
  private pool: Pool;
  private redisClient: Redis.RedisClient;
  private metrics: {
    requests: number;
    errors: number;
    totalResponseTime: number;
    startTime: number;
  };

  constructor(pool: Pool, redisClient: Redis.RedisClient) {
    this.pool = pool;
    this.redisClient = redisClient;
    this.metrics = {
      requests: 0,
      errors: 0,
      totalResponseTime: 0,
      startTime: Date.now()
    };
  }

  async getHealth(detailed: boolean = false): Promise<HealthStatus> {
    const [dbHealth, redisHealth, wsHealth, externalHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkWebSocket(),
      this.checkExternalServices()
    ]);

    const services = {
      database: dbHealth,
      redis: redisHealth,
      websocket: wsHealth,
      external: externalHealth
    };

    const system = detailed ? await this.getSystemMetrics() : null;
    const application = this.getApplicationMetrics();

    const overallStatus = this.determineOverallStatus(services);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services,
      system: system || {
        memory: { total: 0, used: 0, free: 0, percentage: 0 },
        cpu: { count: 0, loadAverage: [0, 0, 0], percentage: 0 },
        disk: { total: 0, used: 0, free: 0, percentage: 0 }
      },
      application
    };
  }

  private async checkDatabase(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const result = await this.pool.query('SELECT 1');
      const latency = Date.now() - start;
      
      return {
        status: latency < 100 ? 'up' : 'degraded',
        latency
      };
    } catch (error) {
      return {
        status: 'down',
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkRedis(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      const pingAsync = promisify(this.redisClient.ping).bind(this.redisClient);
      await pingAsync();
      const latency = Date.now() - start;
      
      return {
        status: latency < 50 ? 'up' : 'degraded',
        latency
      };
    } catch (error) {
      return {
        status: 'down',
        latency: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkWebSocket(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      // Check WebSocket server health endpoint
      const response = await fetch(`http://localhost:${process.env.WS_PORT || 3001}/health`);
      const latency = Date.now() - start;
      
      return {
        status: response.ok ? 'up' : 'degraded',
        latency
      };
    } catch (error) {
      return {
        status: 'down',
        latency: Date.now() - start,
        error: 'WebSocket server unreachable'
      };
    }
  }

  private async checkExternalServices(): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      // Check critical external services (e.g., blockchain RPC)
      const checks = await Promise.all([
        this.checkRPCEndpoint(),
        this.checkLiFiAPI()
      ]);
      
      const allHealthy = checks.every(check => check);
      const latency = Date.now() - start;
      
      return {
        status: allHealthy ? 'up' : 'degraded',
        latency
      };
    } catch (error) {
      return {
        status: 'down',
        latency: Date.now() - start,
        error: 'External services check failed'
      };
    }
  }

  private async checkRPCEndpoint(): Promise<boolean> {
    try {
      const response = await fetch(process.env.RPC_URL || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1
        }),
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkLiFiAPI(): Promise<boolean> {
    try {
      const response = await fetch('https://li.quest/v1/status', {
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async getSystemMetrics(): Promise<{
    memory: MemoryUsage;
    cpu: CPUUsage;
    disk: DiskUsage;
  }> {
    const memory = this.getMemoryUsage();
    const cpu = this.getCPUUsage();
    const disk = await this.getDiskUsage();
    
    return { memory, cpu, disk };
  }

  private getMemoryUsage(): MemoryUsage {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const percentage = (used / total) * 100;
    
    return { total, used, free, percentage };
  }

  private getCPUUsage(): CPUUsage {
    const cpus = os.cpus();
    const loadAverage = os.loadavg();
    
    // Calculate CPU percentage
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    });
    
    const percentage = 100 - (100 * totalIdle / totalTick);
    
    return {
      count: cpus.length,
      loadAverage,
      percentage
    };
  }

  private async getDiskUsage(): Promise<DiskUsage> {
    try {
      const stats = await promisify(fs.statfs)('/');
      const total = stats.blocks * stats.bsize;
      const free = stats.bavail * stats.bsize;
      const used = total - free;
      const percentage = (used / total) * 100;
      
      return { total, used, free, percentage };
    } catch {
      return { total: 0, used: 0, free: 0, percentage: 0 };
    }
  }

  private getApplicationMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    const requestsPerSecond = this.metrics.requests / (uptime / 1000);
    const averageResponseTime = this.metrics.requests > 0 
      ? this.metrics.totalResponseTime / this.metrics.requests 
      : 0;
    const errorRate = this.metrics.requests > 0 
      ? (this.metrics.errors / this.metrics.requests) * 100 
      : 0;
    
    return {
      activeConnections: 0, // Would get from connection pool
      requestsPerSecond,
      averageResponseTime,
      errorRate
    };
  }

  private determineOverallStatus(services: HealthStatus['services']): HealthStatus['status'] {
    const statuses = Object.values(services);
    
    if (statuses.some(s => s.status === 'down')) {
      return 'unhealthy';
    }
    
    if (statuses.filter(s => s.status === 'degraded').length >= 2) {
      return 'unhealthy';
    }
    
    if (statuses.some(s => s.status === 'degraded')) {
      return 'degraded';
    }
    
    return 'healthy';
  }

  updateMetrics(responseTime: number, error: boolean = false) {
    this.metrics.requests++;
    this.metrics.totalResponseTime += responseTime;
    if (error) {
      this.metrics.errors++;
    }
  }
}

// Express routes
export function createHealthRoutes(healthService: HealthCheckService): Router {
  const router = Router();

  // Simple health check
  router.get('/health', async (req: Request, res: Response) => {
    try {
      const health = await healthService.getHealth(false);
      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json({
        status: health.status,
        timestamp: health.timestamp
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: 'Health check failed'
      });
    }
  });

  // Detailed health check
  router.get('/health/detailed', async (req: Request, res: Response) => {
    try {
      const health = await healthService.getHealth(true);
      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(health);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: 'Detailed health check failed'
      });
    }
  });

  // Liveness probe (for Kubernetes)
  router.get('/health/live', (req: Request, res: Response) => {
    res.status(200).send('OK');
  });

  // Readiness probe (for Kubernetes)
  router.get('/health/ready', async (req: Request, res: Response) => {
    try {
      const health = await healthService.getHealth(false);
      if (health.status === 'healthy' || health.status === 'degraded') {
        res.status(200).send('OK');
      } else {
        res.status(503).send('Not Ready');
      }
    } catch {
      res.status(503).send('Not Ready');
    }
  });

  // Metrics endpoint (for Prometheus)
  router.get('/metrics', (req: Request, res: Response) => {
    // In production, use prom-client for proper Prometheus metrics
    const metrics = `
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total ${healthService['metrics'].requests}

# HELP http_errors_total Total number of HTTP errors
# TYPE http_errors_total counter
http_errors_total ${healthService['metrics'].errors}

# HELP http_response_time_seconds HTTP response time
# TYPE http_response_time_seconds summary
http_response_time_seconds_sum ${healthService['metrics'].totalResponseTime / 1000}
http_response_time_seconds_count ${healthService['metrics'].requests}

# HELP nodejs_heap_size_total_bytes Process heap size
# TYPE nodejs_heap_size_total_bytes gauge
nodejs_heap_size_total_bytes ${process.memoryUsage().heapTotal}

# HELP nodejs_heap_size_used_bytes Process heap used
# TYPE nodejs_heap_size_used_bytes gauge
nodejs_heap_size_used_bytes ${process.memoryUsage().heapUsed}

# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total ${process.cpuUsage().user / 1000000}

# HELP nodejs_version_info Node.js version info
# TYPE nodejs_version_info gauge
nodejs_version_info{version="${process.version}"} 1
`;
    
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  });

  return router;
}

export default createHealthRoutes;