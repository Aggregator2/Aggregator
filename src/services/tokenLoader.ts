import { tokenAggregator } from './tokenAggregator';
import { lifiService } from './lifiService';
import { logger } from '../utils/logger';

class TokenLoader {
  private static instance: TokenLoader;
  private loadingInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;

  static getInstance(): TokenLoader {
    if (!TokenLoader.instance) {
      TokenLoader.instance = new TokenLoader();
    }
    return TokenLoader.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    logger.info('Initializing token loader...');

    try {
      // Start initial load
      await this.loadTokens();

      // Set up periodic refresh (every 6 hours)
      this.loadingInterval = setInterval(async () => {
        try {
          await this.loadTokens();
        } catch (error) {
          logger.error('Periodic token refresh failed:', error);
        }
      }, 6 * 60 * 60 * 1000); // 6 hours

      this.isInitialized = true;
      logger.info('Token loader initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize token loader:', error);
      throw error;
    }
  }

  async loadTokens(): Promise<void> {
    try {
      logger.info('Starting token loading process...');
      const startTime = Date.now();

      await tokenAggregator.loadAllTokens();

      const stats = tokenAggregator.getStats();
      const loadTime = Date.now() - startTime;

      logger.info(`Token loading completed in ${loadTime}ms`);
      logger.info(`Total tokens loaded: ${stats.total}`);
      
      // Log chain breakdown
      for (const [chainId, count] of Object.entries(stats.byChain)) {
        logger.info(`Chain ${chainId}: ${count} tokens`);
      }

    } catch (error) {
      logger.error('Token loading failed:', error);
      throw error;
    }
  }

  getStats() {
    return tokenAggregator.getStats();
  }

  async refreshTokens(): Promise<void> {
    await this.loadTokens();
  }

  // Health check for token loading system
  getHealthStatus() {
    const stats = this.getStats();
    const lifiCacheValid = lifiService.isCacheValid();
    
    return {
      isInitialized: this.isInitialized,
      totalTokens: stats.total,
      chainCount: Object.keys(stats.byChain).length,
      lastUpdate: stats.lastUpdate,
      lifiCacheValid,
      status: stats.total > 100 ? 'healthy' : 'degraded'
    };
  }

  // Force refresh LiFi cache specifically
  async refreshLifiTokens(): Promise<void> {
    try {
      logger.info('Refreshing LiFi token cache...');
      await lifiService.refreshTokens();
      logger.info('LiFi token cache refreshed successfully');
    } catch (error) {
      logger.error('Failed to refresh LiFi token cache:', error);
      throw error;
    }
  }

  destroy(): void {
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = null;
    }
    this.isInitialized = false;
  }
}

export const tokenLoader = TokenLoader.getInstance();

// Removed auto-initialization to prevent stack overflow
// Token loading is now handled on-demand by API routes