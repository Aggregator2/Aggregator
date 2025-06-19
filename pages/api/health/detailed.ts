import type { NextApiRequest, NextApiResponse } from 'next';
import { PrismaClient } from '@prisma/client';
import EventListener from '../../../src/services/eventListener';
import { logger } from '../../../src/utils/logger';

const prisma = new PrismaClient();

interface DetailedHealth {
  timestamp: string;
  system: {
    nodeVersion: string;
    platform: string;
    architecture: string;
    uptime: number;
    memory: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
  database: {
    status: string;
    connectionCount: number;
    slowQueries: any[];
    recentErrors: any[];
  };
  eventListener: {
    status: string;
    lastProcessedBlock: number;
    currentBlock: number;
    blocksBehind: number;
    eventsProcessed24h: number;
  };
  performance: {
    averageResponseTime: number;
    requestsPerMinute: number;
    errorRate: number;
  };
  security: {
    rateLimitStatus: any;
    failedAuthAttempts: number;
    suspiciousActivity: any[];
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DetailedHealth | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // This endpoint should be protected in production
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const [
      systemInfo,
      databaseInfo,
      eventListenerInfo,
      performanceInfo,
      securityInfo
    ] = await Promise.allSettled([
      getSystemInfo(),
      getDatabaseInfo(),
      getEventListenerInfo(),
      getPerformanceInfo(),
      getSecurityInfo()
    ]);

    const detailedHealth: DetailedHealth = {
      timestamp: new Date().toISOString(),
      system: systemInfo.status === 'fulfilled' ? systemInfo.value : getDefaultSystemInfo(),
      database: databaseInfo.status === 'fulfilled' ? databaseInfo.value : getDefaultDatabaseInfo(),
      eventListener: eventListenerInfo.status === 'fulfilled' ? eventListenerInfo.value : getDefaultEventListenerInfo(),
      performance: performanceInfo.status === 'fulfilled' ? performanceInfo.value : getDefaultPerformanceInfo(),
      security: securityInfo.status === 'fulfilled' ? securityInfo.value : getDefaultSecurityInfo()
    };

    res.status(200).json(detailedHealth);
  } catch (error) {
    logger.error('Detailed health check failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getSystemInfo() {
  const cpuUsage = process.cpuUsage();
  
  return {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpuUsage
  };
}

async function getDatabaseInfo() {
  try {
    // Get connection info (this would need to be implemented based on your setup)
    const connectionCount = await getActiveConnections();
    
    // Get slow queries from the last hour
    const slowQueries = await getSlowQueries();
    
    // Get recent database errors
    const recentErrors = await getRecentDatabaseErrors();

    return {
      status: 'connected',
      connectionCount,
      slowQueries,
      recentErrors
    };
  } catch (error) {
    return {
      status: 'error',
      connectionCount: 0,
      slowQueries: [],
      recentErrors: [{ message: error instanceof Error ? error.message : 'Unknown error' }]
    };
  }
}

async function getEventListenerInfo() {
  try {
    // In a real implementation, you'd have a singleton EventListener instance
    const eventListener = new EventListener(1, process.env.ESCROW_CONTRACT_ADDRESS || '');
    const health = await eventListener.getHealthStatus();
    
    // Get events processed in last 24 hours
    const eventsProcessed24h = await prisma.escrowEvent.count({
      where: {
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
        }
      }
    });

    return {
      status: health.isListening ? 'listening' : 'stopped',
      lastProcessedBlock: health.lastProcessedBlock,
      currentBlock: health.currentBlock,
      blocksBehind: health.blocksBehind,
      eventsProcessed24h
    };
  } catch (error) {
    return getDefaultEventListenerInfo();
  }
}

async function getPerformanceInfo() {
  // In a real implementation, you'd track these metrics over time
  // For now, return mock data
  return {
    averageResponseTime: 250,
    requestsPerMinute: 45,
    errorRate: 0.02
  };
}

async function getSecurityInfo() {
  try {
    // Get failed auth attempts from the last hour
    const failedAuthAttempts = await getFailedAuthAttempts();
    
    // Get rate limit status
    const rateLimitStatus = await getRateLimitStatus();
    
    // Get suspicious activity
    const suspiciousActivity = await getSuspiciousActivity();

    return {
      rateLimitStatus,
      failedAuthAttempts,
      suspiciousActivity
    };
  } catch (error) {
    return getDefaultSecurityInfo();
  }
}

// Helper functions that would be implemented based on your specific setup
async function getActiveConnections(): Promise<number> {
  // This would query your database for active connections
  return 5; // Mock value
}

async function getSlowQueries(): Promise<any[]> {
  // This would query your database for slow queries
  return []; // Mock value
}

async function getRecentDatabaseErrors(): Promise<any[]> {
  // This would get recent database errors from logs
  return []; // Mock value
}

async function getFailedAuthAttempts(): Promise<number> {
  // This would query your auth logs
  return 3; // Mock value
}

async function getRateLimitStatus(): Promise<any> {
  // This would check rate limiting status
  return {
    enabled: true,
    currentRequests: 45,
    limit: 100,
    window: '15m'
  };
}

async function getSuspiciousActivity(): Promise<any[]> {
  // This would check for suspicious activity patterns
  return []; // Mock value
}

// Default values for when checks fail
function getDefaultSystemInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpuUsage: { user: 0, system: 0 }
  };
}

function getDefaultDatabaseInfo() {
  return {
    status: 'unknown',
    connectionCount: 0,
    slowQueries: [],
    recentErrors: []
  };
}

function getDefaultEventListenerInfo() {
  return {
    status: 'unknown',
    lastProcessedBlock: 0,
    currentBlock: 0,
    blocksBehind: 0,
    eventsProcessed24h: 0
  };
}

function getDefaultPerformanceInfo() {
  return {
    averageResponseTime: 0,
    requestsPerMinute: 0,
    errorRate: 0
  };
}

function getDefaultSecurityInfo() {
  return {
    rateLimitStatus: { enabled: false },
    failedAuthAttempts: 0,
    suspiciousActivity: []
  };
}