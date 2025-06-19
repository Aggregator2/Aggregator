import type { NextApiRequest, NextApiResponse } from 'next';
import { tokenListManager } from '../../../src/services/tokenListManager';
import { tokenListSyncJob } from '../../../src/jobs/tokenListSync';
import { TOKEN_LIST_SOURCES } from '../../../src/config/tokens/tokenLists';
import { SUPPORTED_CHAINS } from '../../../src/types/token';
import { logger } from '../../../src/utils/logger';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const startTime = Date.now();
    
    // Get sync job status
    const syncStatus = tokenListSyncJob.getStatus();
    
    // Test token search functionality
    const searchTest = await testTokenSearch();
    
    // Test auto-import functionality
    const importTest = await testAutoImport();
    
    // Get token counts by chain
    const tokenCounts = await getTokenCountsByChain();
    
    // Check token list sources availability
    const sourceHealth = await checkSourceHealth();
    
    const responseTime = Date.now() - startTime;
    
    const healthStatus = {
      status: determineOverallHealth([searchTest, importTest, sourceHealth]),
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      
      sync: {
        status: syncStatus.isRunning ? 'running' : 'idle',
        lastRun: syncStatus.lastRun?.toISOString() || null,
        nextRun: syncStatus.nextRun?.toISOString() || null
      },
      
      functionality: {
        search: searchTest,
        autoImport: importTest
      },
      
      sources: {
        total: TOKEN_LIST_SOURCES.length,
        healthy: sourceHealth.healthy,
        unhealthy: sourceHealth.unhealthy,
        lastChecked: new Date().toISOString()
      },
      
      tokenCounts,
      
      configuration: {
        supportedChains: Object.keys(SUPPORTED_CHAINS).length,
        evmChains: Object.values(SUPPORTED_CHAINS).filter(c => c.type === 'EVM').length,
        nonEvmChains: Object.values(SUPPORTED_CHAINS).filter(c => c.type !== 'EVM').length
      }
    };
    
    const statusCode = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 200 : 503;
    
    res.status(statusCode).json(healthStatus);
  } catch (error) {
    logger.error('Token health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed'
    });
  }
}

async function testTokenSearch(): Promise<{ status: string; responseTime: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    // Test searching for a common token
    const results = await tokenListManager.searchTokens('USDT');
    
    if (results.length === 0) {
      return {
        status: 'degraded',
        responseTime: Date.now() - startTime,
        error: 'No search results for common token'
      };
    }
    
    return {
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: error.message
    };
  }
}

async function testAutoImport(): Promise<{ status: string; responseTime: number; error?: string }> {
  const startTime = Date.now();
  
  try {
    // Test with a known token address (USDT on Ethereum)
    const testAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
    const result = await tokenListManager.autoImportToken(testAddress, 1);
    
    if (!result) {
      return {
        status: 'degraded',
        responseTime: Date.now() - startTime,
        error: 'Auto-import failed for known token'
      };
    }
    
    return {
      status: 'healthy',
      responseTime: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: error.message
    };
  }
}

async function getTokenCountsByChain(): Promise<Record<number, { count: number; chainName: string }>> {
  const counts: Record<number, { count: number; chainName: string }> = {};
  
  for (const [chainIdStr, chainConfig] of Object.entries(SUPPORTED_CHAINS)) {
    const chainId = parseInt(chainIdStr);
    
    try {
      const tokens = await tokenListManager.getTokensByChain(chainId, 10000);
      counts[chainId] = {
        count: tokens.length,
        chainName: chainConfig.name
      };
    } catch (error) {
      counts[chainId] = {
        count: 0,
        chainName: chainConfig.name
      };
    }
  }
  
  return counts;
}

async function checkSourceHealth(): Promise<{ healthy: number; unhealthy: number; details: any[] }> {
  const results = {
    healthy: 0,
    unhealthy: 0,
    details: [] as any[]
  };
  
  // Check a sample of sources (not all to avoid rate limiting)
  const samplesToCheck = TOKEN_LIST_SOURCES.slice(0, 5);
  
  for (const source of samplesToCheck) {
    try {
      const response = await fetch(source.url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        results.healthy++;
        results.details.push({
          name: source.name,
          status: 'healthy',
          responseCode: response.status
        });
      } else {
        results.unhealthy++;
        results.details.push({
          name: source.name,
          status: 'unhealthy',
          responseCode: response.status
        });
      }
    } catch (error: any) {
      results.unhealthy++;
      results.details.push({
        name: source.name,
        status: 'unhealthy',
        error: error.message
      });
    }
  }
  
  return results;
}

function determineOverallHealth(tests: Array<{ status: string }>): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = tests.map(test => test.status);
  
  if (statuses.every(status => status === 'healthy')) {
    return 'healthy';
  }
  
  if (statuses.some(status => status === 'healthy')) {
    return 'degraded';
  }
  
  return 'unhealthy';
}