import { lifiService } from './lifiService';
import { Token } from '../../types/wallet';

interface TokenCache {
  tokens: Map<number, Token[]>; // chainId -> tokens
  lastUpdated: Date;
  updateInterval: number; // milliseconds
}

export class TokenMonitoringService {
  private static cache: TokenCache = {
    tokens: new Map(),
    lastUpdated: new Date(0),
    updateInterval: 3600000 // 1 hour
  };
  
  private static updateTimer: NodeJS.Timeout | null = null;
  private static isUpdating = false;
  
  /**
   * Initialize the token monitoring service
   */
  static async initialize(): Promise<void> {
    console.log('🔄 [TokenMonitoring] Initializing token monitoring service...');
    
    try {
      // Load initial tokens
      await this.updateTokenCache();
      console.log(`✅ [TokenMonitoring] Service initialized with ${this.getTotalTokenCount()} tokens from ${this.cache.tokens.size} chains`);
    } catch (error) {
      console.error('❌ [TokenMonitoring] Failed to initialize token monitoring service:', error);
      if (error instanceof Error) {
        console.error('[TokenMonitoring] Init error details:', {
          message: error.message,
          stack: error.stack
        });
      }
      // Don't throw - service can still work without initial cache
    }
    
    // Set up periodic updates every hour
    this.startPeriodicUpdates();
  }
  
  /**
   * Start periodic token updates
   */
  private static startPeriodicUpdates(): void {
    // Clear any existing timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    // Update every hour
    this.updateTimer = setInterval(async () => {
      await this.updateTokenCache();
    }, this.cache.updateInterval);
    
    console.log('⏰ Token monitoring service started - updating every hour');
  }
  
  /**
   * Stop periodic updates
   */
  static stopPeriodicUpdates(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
      console.log('⏹️ Token monitoring service stopped');
    }
  }
  
  /**
   * Update the token cache from LI.FI
   */
  private static async updateTokenCache(): Promise<void> {
    if (this.isUpdating) {
      console.log('⏳ [TokenMonitoring] Token update already in progress, skipping...');
      return;
    }
    
    this.isUpdating = true;
    const startTime = Date.now();
    
    try {
      console.log('🔍 [TokenMonitoring] Fetching latest tokens from LI.FI...');
      
      // Get all tokens from LI.FI
      const allTokensMap = await lifiService.getAllTokens();
      
      // Store previous token count for comparison
      const previousTokenCount = this.getTotalTokenCount();
      
      // Clear and update cache
      this.cache.tokens.clear();
      
      let totalTokens = 0;
      allTokensMap.forEach((tokens, chainId) => {
        const formattedTokens: Token[] = tokens.map(token => ({
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          logoURI: token.logoURI || '/fallback.svg',
          chainId: token.chainId,
          decimals: token.decimals,
          type: 'ERC-20' as const,
          tags: []
        }));
        
        this.cache.tokens.set(chainId, formattedTokens);
        totalTokens += formattedTokens.length;
      });
      
      this.cache.lastUpdated = new Date();
      
      const updateTime = Date.now() - startTime;
      const newTokensCount = totalTokens - previousTokenCount;
      
      console.log(`✅ Token cache updated in ${updateTime}ms`);
      console.log(`📊 Total tokens: ${totalTokens} across ${this.cache.tokens.size} chains`);
      
      if (newTokensCount > 0) {
        console.log(`🆕 ${newTokensCount} new tokens added since last update!`);
        
        // Notify about new tokens (could trigger UI update here)
        this.notifyNewTokens(newTokensCount);
      } else if (newTokensCount < 0) {
        console.log(`⚠️ ${Math.abs(newTokensCount)} tokens removed since last update`);
      }
      
    } catch (error) {
      console.error('❌ Failed to update token cache:', error);
    } finally {
      this.isUpdating = false;
    }
  }
  
  /**
   * Get total token count across all chains
   */
  private static getTotalTokenCount(): number {
    let count = 0;
    this.cache.tokens.forEach(tokens => {
      count += tokens.length;
    });
    return count;
  }
  
  /**
   * Notify about new tokens (could be extended to send notifications)
   */
  private static notifyNewTokens(count: number): void {
    // This could be extended to:
    // - Send browser notifications
    // - Update UI badges
    // - Log to analytics
    // - Send webhooks
    console.log(`🔔 Notification: ${count} new tokens available!`);
  }
  
  /**
   * Get all cached tokens
   */
  static getCachedTokens(): Map<number, Token[]> {
    // Return a copy to prevent external modifications
    return new Map(this.cache.tokens);
  }
  
  /**
   * Get tokens for a specific chain
   */
  static getTokensByChain(chainId: number): Token[] {
    return this.cache.tokens.get(chainId) || [];
  }
  
  /**
   * Get time since last update
   */
  static getTimeSinceLastUpdate(): number {
    return Date.now() - this.cache.lastUpdated.getTime();
  }
  
  /**
   * Check if cache needs update
   */
  static needsUpdate(): boolean {
    return this.getTimeSinceLastUpdate() > this.cache.updateInterval;
  }
  
  /**
   * Force an immediate update
   */
  static async forceUpdate(): Promise<void> {
    console.log('🔄 Forcing token cache update...');
    await this.updateTokenCache();
  }
  
  /**
   * Get newly added tokens since a specific date
   */
  static async getNewTokensSince(sinceDate: Date): Promise<Token[]> {
    // This would require storing historical data
    // For now, we'll return empty array
    // In production, this would query a database of token additions
    console.log(`📅 Checking for tokens added since ${sinceDate.toISOString()}`);
    return [];
  }
  
  /**
   * Search for a specific token across all chains
   */
  static findToken(query: string): Token[] {
    const results: Token[] = [];
    const searchQuery = query.toLowerCase();
    
    this.cache.tokens.forEach(tokens => {
      const matches = tokens.filter(token =>
        token.symbol.toLowerCase().includes(searchQuery) ||
        token.name.toLowerCase().includes(searchQuery) ||
        token.address.toLowerCase() === searchQuery
      );
      results.push(...matches);
    });
    
    return results;
  }
  
  /**
   * Get cache statistics
   */
  static getStats() {
    const chains = Array.from(this.cache.tokens.keys());
    const tokenCounts = chains.map(chainId => ({
      chainId,
      count: this.cache.tokens.get(chainId)?.length || 0
    }));
    
    return {
      lastUpdated: this.cache.lastUpdated,
      timeSinceUpdate: this.getTimeSinceLastUpdate(),
      totalChains: chains.length,
      totalTokens: this.getTotalTokenCount(),
      tokensByChain: tokenCounts,
      updateInterval: this.cache.updateInterval,
      isUpdating: this.isUpdating
    };
  }
}