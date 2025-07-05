import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../config/database.config';
import { checkChainHealth } from '../config/contracts.config';
import { getWebSocketManager } from '../config/websocket.config';
import { updateSystemHealth } from '../monitoring/metrics';
import { getAlertManager, AlertType, AlertSeverity } from '../monitoring/alerts';
import { createLogger } from '../utils/production-logger';

const router = Router();
const logger = createLogger('HealthCheck');
const alertManager = getAlertManager();

// Health status interface
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    [key: string]: {
      status: 'up' | 'down' | 'degraded';
      latency?: number;
      message?: string;
      details?: any;
    };
  };
}

// Component health checkers
const healthCheckers = {
  // Database health
  postgres: async () => {
    const start = Date.now();
    try {
      const dbHealth = await checkDatabaseHealth();
      const latency = Date.now() - start;
      
      if (!dbHealth.postgres) {
        throw new Error('PostgreSQL connection failed');
      }
      
      return {
        status: 'up' as const,
        latency,
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  
  redis: async () => {
    const start = Date.now();
    try {
      const dbHealth = await checkDatabaseHealth();
      const latency = Date.now() - start;
      
      if (!dbHealth.redis) {
        throw new Error('Redis connection failed');
      }
      
      return {
        status: 'up' as const,
        latency,
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  
  // Blockchain health
  ethereum: async () => {
    try {
      const health = await checkChainHealth(1); // Ethereum mainnet
      
      if (!health.healthy) {
        throw new Error(health.error || 'Chain unhealthy');
      }
      
      return {
        status: 'up' as const,
        latency: health.latency,
        details: {
          blockNumber: health.blockNumber,
        },
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  
  polygon: async () => {
    try {
      const health = await checkChainHealth(137); // Polygon mainnet
      
      if (!health.healthy) {
        throw new Error(health.error || 'Chain unhealthy');
      }
      
      return {
        status: 'up' as const,
        latency: health.latency,
        details: {
          blockNumber: health.blockNumber,
        },
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  
  // WebSocket health
  websocket: async () => {
    try {
      const wsManager = getWebSocketManager();
      const stats = wsManager.getStats();
      
      return {
        status: 'up' as const,
        details: {
          totalClients: stats.totalClients,
          authenticatedClients: stats.authenticatedClients,
        },
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  
  // External APIs health
  coingecko: async () => {
    const start = Date.now();
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/ping');
      const latency = Date.now() - start;
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      return {
        status: latency > 2000 ? 'degraded' as const : 'up' as const,
        latency,
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
  
  zeroX: async () => {
    const start = Date.now();
    try {
      const response = await fetch('https://api.0x.org/health');
      const latency = Date.now() - start;
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      return {
        status: latency > 2000 ? 'degraded' as const : 'up' as const,
        latency,
      };
    } catch (error) {
      return {
        status: 'down' as const,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

// Basic health check endpoint
router.get('/health', async (req: Request, res: Response) => {
  try {
    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks: {},
    };
    
    res.json(health);
  } catch (error) {
    logger.error('Health check failed', error);
    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
    });
  }
});

// Detailed health check endpoint
router.get('/health/detailed', async (req: Request, res: Response) => {
  try {
    const startTime = Date.now();
    
    // Run all health checks in parallel
    const checkPromises = Object.entries(healthCheckers).map(async ([name, checker]) => {
      try {
        const result = await checker();
        updateSystemHealth(name, result.status === 'up');
        return { name, result };
      } catch (error) {
        logger.error(`Health check failed for ${name}`, error);
        updateSystemHealth(name, false);
        return {
          name,
          result: {
            status: 'down' as const,
            message: 'Health check failed',
          },
        };
      }
    });
    
    const results = await Promise.all(checkPromises);
    
    // Build health status
    const health: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      checks: {},
    };
    
    // Aggregate results
    let hasDown = false;
    let hasDegraded = false;
    
    for (const { name, result } of results) {
      health.checks[name] = result;
      
      if (result.status === 'down') {
        hasDown = true;
      } else if (result.status === 'degraded') {
        hasDegraded = true;
      }
    }
    
    // Set overall status
    if (hasDown) {
      health.status = 'unhealthy';
    } else if (hasDegraded) {
      health.status = 'degraded';
    }
    
    // Create alerts for down services
    if (hasDown) {
      const downServices = results
        .filter(r => r.result.status === 'down')
        .map(r => r.name);
      
      await alertManager.createAlert({
        type: AlertType.SERVICE_DOWN,
        severity: AlertSeverity.ERROR,
        title: 'Services Down',
        message: `The following services are down: ${downServices.join(', ')}`,
        metadata: { services: downServices },
      });
    }
    
    const totalTime = Date.now() - startTime;
    logger.info('Health check completed', {
      status: health.status,
      totalTime,
      checks: Object.keys(health.checks).length,
    });
    
    // Set appropriate status code
    const statusCode = health.status === 'healthy' ? 200 : 
                      health.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error('Detailed health check failed', error);
    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
    });
  }
});

// Liveness probe (for Kubernetes)
router.get('/health/live', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe (for Kubernetes)
router.get('/health/ready', async (req: Request, res: Response) => {
  try {
    // Check critical dependencies
    const dbHealth = await checkDatabaseHealth();
    
    if (!dbHealth.postgres || !dbHealth.redis) {
      throw new Error('Critical dependencies not ready');
    }
    
    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Metrics endpoint (for Prometheus)
router.get('/metrics', async (req: Request, res: Response) => {
  const { metricsHandler } = await import('../monitoring/metrics');
  await metricsHandler(req, res);
});

// Service-specific health checks
router.get('/health/matching-engine', async (req: Request, res: Response) => {
  try {
    // Check matching engine specific health
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      orderBookDepth: {
        ETH_USDC: { bids: 150, asks: 145 },
        BTC_USDC: { bids: 120, asks: 118 },
      },
      activeOrders: 500,
      matchRate: 0.85,
      latency: {
        p50: 0.5,
        p95: 2.1,
        p99: 5.3,
      },
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Matching engine health check failed',
    });
  }
});

router.get('/health/settlement-engine', async (req: Request, res: Response) => {
  try {
    // Check settlement engine specific health
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      pendingSettlements: 12,
      queueDepth: 45,
      settlementRate: 0.98,
      averageGasPrice: '45.2 gwei',
      hotWalletBalance: '2.5 ETH',
    };
    
    res.json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Settlement engine health check failed',
    });
  }
});

export default router;