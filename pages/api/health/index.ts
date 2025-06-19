import type { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { logger } from '../../../src/utils/logger';

const prisma = new PrismaClient();

interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
    blockchain: ServiceHealth;
  };
  metrics: {
    totalOrders: number;
    pendingOrders: number;
    successfulOrders: number;
    failedOrders: number;
  };
}

interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime?: number;
  error?: string;
  lastCheck: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthCheck>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({} as any);
  }

  const startTime = Date.now();
  
  try {
    const [dbHealth, redisHealth, blockchainHealth, metrics] = await Promise.allSettled([
      checkDatabaseHealth(),
      checkRedisHealth(),
      checkBlockchainHealth(),
      getMetrics()
    ]);

    const services = {
      database: dbHealth.status === 'fulfilled' ? dbHealth.value : {
        status: 'unhealthy' as const,
        error: dbHealth.status === 'rejected' ? dbHealth.reason.message : 'Unknown error',
        lastCheck: new Date().toISOString()
      },
      redis: redisHealth.status === 'fulfilled' ? redisHealth.value : {
        status: 'unhealthy' as const,
        error: redisHealth.status === 'rejected' ? redisHealth.reason.message : 'Unknown error',
        lastCheck: new Date().toISOString()
      },
      blockchain: blockchainHealth.status === 'fulfilled' ? blockchainHealth.value : {
        status: 'unhealthy' as const,
        error: blockchainHealth.status === 'rejected' ? blockchainHealth.reason.message : 'Unknown error',
        lastCheck: new Date().toISOString()
      }
    };

    const overallStatus = determineOverallStatus(services);
    
    const healthCheck: HealthCheck = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      services,
      metrics: metrics.status === 'fulfilled' ? metrics.value : {
        totalOrders: 0,
        pendingOrders: 0,
        successfulOrders: 0,
        failedOrders: 0
      }
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    
    logger.info('Health check completed', {
      status: overallStatus,
      responseTime: Date.now() - startTime,
      services: Object.keys(services).reduce((acc, key) => {
        acc[key] = services[key as keyof typeof services].status;
        return acc;
      }, {} as Record<string, string>)
    });

    res.status(statusCode).json(healthCheck);
  } catch (error) {
    logger.error('Health check failed:', error);
    
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      services: {
        database: { status: 'unhealthy', error: 'Health check failed', lastCheck: new Date().toISOString() },
        redis: { status: 'unhealthy', error: 'Health check failed', lastCheck: new Date().toISOString() },
        blockchain: { status: 'unhealthy', error: 'Health check failed', lastCheck: new Date().toISOString() }
      },
      metrics: {
        totalOrders: 0,
        pendingOrders: 0,
        successfulOrders: 0,
        failedOrders: 0
      }
    });
  }
}

async function checkDatabaseHealth(): Promise<ServiceHealth> {
  const start = Date.now();
  
  try {
    // Simple query to check DB connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    return {
      status: 'healthy',
      responseTime: Date.now() - start,
      lastCheck: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now() - start,
      lastCheck: new Date().toISOString()
    };
  }
}

async function checkRedisHealth(): Promise<ServiceHealth> {
  const start = Date.now();
  let redis: Redis | null = null;
  
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      connectTimeout: 5000,
      commandTimeout: 5000
    });

    await redis.ping();
    
    return {
      status: 'healthy',
      responseTime: Date.now() - start,
      lastCheck: new Date().toISOString()
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now() - start,
      lastCheck: new Date().toISOString()
    };
  } finally {
    if (redis) {
      redis.disconnect();
    }
  }
}

async function checkBlockchainHealth(): Promise<ServiceHealth> {
  const start = Date.now();
  
  try {
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(
      process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com'
    );
    
    // Check if we can get the latest block
    const blockNumber = await provider.getBlockNumber();
    
    if (blockNumber > 0) {
      return {
        status: 'healthy',
        responseTime: Date.now() - start,
        lastCheck: new Date().toISOString()
      };
    }
    
    throw new Error('Invalid block number received');
  } catch (error: any) {
    return {
      status: 'unhealthy',
      error: error.message,
      responseTime: Date.now() - start,
      lastCheck: new Date().toISOString()
    };
  }
}

async function getMetrics() {
  try {
    const [totalOrders, pendingOrders, successfulOrders, failedOrders] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING'] } } }),
      prisma.order.count({ where: { status: 'COMPLETED' } }),
      prisma.order.count({ where: { status: { in: ['CANCELLED', 'REFUNDED'] } } })
    ]);

    return {
      totalOrders,
      pendingOrders,
      successfulOrders,
      failedOrders
    };
  } catch (error) {
    logger.error('Error getting metrics:', error);
    return {
      totalOrders: 0,
      pendingOrders: 0,
      successfulOrders: 0,
      failedOrders: 0
    };
  }
}

function determineOverallStatus(services: HealthCheck['services']): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = Object.values(services).map(service => service.status);
  
  if (statuses.every(status => status === 'healthy')) {
    return 'healthy';
  }
  
  if (statuses.some(status => status === 'healthy')) {
    return 'degraded';
  }
  
  return 'unhealthy';
}