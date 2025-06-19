import { tokenListManager } from '../services/tokenListManager';
import { TOKEN_LIST_SOURCES } from '../config/tokens/tokenLists';
import { logger } from '../utils/logger';
import { alertService } from '../services/alertService';

export class TokenListSyncJob {
  private isRunning = false;
  private lastRun: Date | null = null;
  private intervalId: NodeJS.Timeout | null = null;

  start(): void {
    if (this.intervalId) {
      logger.warn('Token list sync job is already running');
      return;
    }

    logger.info('Starting token list sync job');
    
    // Run immediately on start
    this.runSync();

    // Schedule regular runs every 6 hours
    this.intervalId = setInterval(() => {
      this.runSync();
    }, 6 * 60 * 60 * 1000); // 6 hours
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Token list sync job stopped');
    }
  }

  async runSync(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Token list sync already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
      logger.info('Starting scheduled token list synchronization');
      
      // Track success metrics
      const metrics = {
        totalSources: TOKEN_LIST_SOURCES.length,
        successfulSources: 0,
        failedSources: 0,
        totalTokens: 0,
        errors: [] as string[]
      };

      // Sync all token lists
      await tokenListManager.fetchAllTokenLists();
      
      // Sync chain-specific APIs
      const chainApis = [1001, 118, 301, 0, 2024, 1729]; // Non-EVM chains
      for (const chainId of chainApis) {
        try {
          const tokens = await tokenListManager.fetchTokensFromChainAPI(chainId);
          metrics.totalTokens += tokens.length;
          metrics.successfulSources++;
          logger.info(`Synced ${tokens.length} tokens from chain ${chainId}`);
        } catch (error: any) {
          metrics.failedSources++;
          metrics.errors.push(`Chain ${chainId}: ${error.message}`);
          logger.error(`Failed to sync chain ${chainId}:`, error);
        }
      }

      const duration = Date.now() - startTime;
      this.lastRun = new Date();

      logger.info('Token list sync completed', {
        duration: `${duration}ms`,
        metrics
      });

      // Send alert if there were significant failures
      if (metrics.failedSources > metrics.totalSources * 0.3) {
        await alertService.warning(
          'Token List Sync Issues',
          `Token list sync completed with ${metrics.failedSources} failures out of ${metrics.totalSources} sources`,
          {
            duration,
            metrics,
            timestamp: new Date().toISOString()
          }
        );
      }

      // Send info alert for successful completion
      if (metrics.successfulSources > 0) {
        await alertService.info(
          'Token List Sync Completed',
          `Successfully synced ${metrics.totalTokens} tokens from ${metrics.successfulSources} sources`,
          {
            duration,
            metrics
          }
        );
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Token list sync failed:', error);
      
      await alertService.error(
        'Token List Sync Failed',
        `Critical error during token list synchronization: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          duration,
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack
          } : error,
          timestamp: new Date().toISOString()
        }
      );
    } finally {
      this.isRunning = false;
    }
  }

  getStatus(): {
    isRunning: boolean;
    lastRun: Date | null;
    nextRun: Date | null;
  } {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: this.intervalId ? new Date(Date.now() + 6 * 60 * 60 * 1000) : null
    };
  }

  async forceSync(): Promise<void> {
    logger.info('Manual token list sync requested');
    await this.runSync();
  }
}

// Singleton instance
export const tokenListSyncJob = new TokenListSyncJob();

// Auto-start in production
if (process.env.NODE_ENV === 'production') {
  tokenListSyncJob.start();
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, stopping token list sync job');
    tokenListSyncJob.stop();
  });
  
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, stopping token list sync job');
    tokenListSyncJob.stop();
  });
}