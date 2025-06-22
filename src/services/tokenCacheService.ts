import { Token } from '../../types/wallet';
import { lifiService } from './lifiService';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string;
}

interface TokenCacheStats {
  hits: number;
  misses: number;
  updates: number;
  lastUpdate: number;
  size: number;
}

class TokenCacheService {
  private static instance: TokenCacheService;
  private tokenCache: Map<string, CacheEntry<Token[]>> = new Map();
  private chainCache: Map<number, CacheEntry<any>> = new Map();
  private allTokensCache: CacheEntry<Map<number, Token[]>> | null = null;
  
  // Cache configuration
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly STALE_WHILE_REVALIDATE = 60 * 60 * 1000; // 1 hour
  private readonly MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
  
  // Performance tracking
  private stats: TokenCacheStats = {
    hits: 0,
    misses: 0,
    updates: 0,
    lastUpdate: 0,
    size: 0
  };
  
  // IndexedDB for persistent cache
  private dbName = 'TokenCacheDB';
  private dbVersion = 1;
  private db: IDBDatabase | null = null;

  private constructor() {
    this.initializeIndexedDB();
    this.startPeriodicUpdate();
  }

  static getInstance(): TokenCacheService {
    if (!TokenCacheService.instance) {
      TokenCacheService.instance = new TokenCacheService();
    }
    return TokenCacheService.instance;
  }

  private async initializeIndexedDB() {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return; // Not in browser environment
    }

    try {
      const request = window.indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => {
        console.error('Failed to open IndexedDB');
      };
      
      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        this.loadFromPersistentCache();
      };
      
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        
        if (!db.objectStoreNames.contains('tokens')) {
          db.createObjectStore('tokens', { keyPath: 'chainId' });
        }
        
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    } catch (error) {
      console.error('IndexedDB initialization failed:', error);
    }
  }

  private async loadFromPersistentCache() {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction(['tokens', 'metadata'], 'readonly');
      const tokenStore = transaction.objectStore('tokens');
      const metadataStore = transaction.objectStore('metadata');
      
      // Load metadata
      const metadataRequest = metadataStore.get('cache_stats');
      metadataRequest.onsuccess = (event: any) => {
        if (event.target.result) {
          this.stats = event.target.result.value;
        }
      };
      
      // Load all tokens
      const tokensRequest = tokenStore.getAll();
      tokensRequest.onsuccess = (event: any) => {
        const results = event.target.result;
        const tokenMap = new Map<number, Token[]>();
        
        results.forEach((entry: any) => {
          tokenMap.set(entry.chainId, entry.tokens);
          this.tokenCache.set(`chain-${entry.chainId}`, {
            data: entry.tokens,
            timestamp: entry.timestamp
          });
        });
        
        if (tokenMap.size > 0) {
          this.allTokensCache = {
            data: tokenMap,
            timestamp: Date.now()
          };
          console.log(`Loaded ${tokenMap.size} chains from persistent cache`);
        }
      };
    } catch (error) {
      console.error('Failed to load from persistent cache:', error);
    }
  }

  private async saveToPersistentCache(chainId: number, tokens: Token[]) {
    if (!this.db) return;

    try {
      const transaction = this.db.transaction(['tokens'], 'readwrite');
      const store = transaction.objectStore('tokens');
      
      store.put({
        chainId,
        tokens,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('Failed to save to persistent cache:', error);
    }
  }

  async getTokens(chainId?: number): Promise<Token[]> {
    // If requesting all tokens
    if (!chainId) {
      return this.getAllTokens();
    }

    const cacheKey = `chain-${chainId}`;
    const cached = this.tokenCache.get(cacheKey);
    
    // Check if cache is valid
    if (cached && this.isCacheValid(cached)) {
      this.stats.hits++;
      return cached.data;
    }

    // Check if cache is stale but usable
    if (cached && this.isCacheStale(cached)) {
      this.stats.hits++;
      // Return stale data immediately, update in background
      this.updateTokensInBackground(chainId);
      return cached.data;
    }

    // Cache miss - fetch from API
    this.stats.misses++;
    return this.fetchAndCacheTokens(chainId);
  }

  private async getAllTokens(): Promise<Token[]> {
    if (this.allTokensCache && this.isCacheValid(this.allTokensCache)) {
      this.stats.hits++;
      const allTokens: Token[] = [];
      this.allTokensCache.data.forEach(tokens => allTokens.push(...tokens));
      return allTokens;
    }

    this.stats.misses++;
    return this.fetchAndCacheAllTokens();
  }

  private async fetchAndCacheTokens(chainId: number): Promise<Token[]> {
    try {
      const tokens = await lifiService.getTokens(chainId);
      
      this.tokenCache.set(`chain-${chainId}`, {
        data: tokens,
        timestamp: Date.now()
      });
      
      this.stats.updates++;
      this.stats.lastUpdate = Date.now();
      
      // Save to persistent cache
      this.saveToPersistentCache(chainId, tokens);
      
      return tokens;
    } catch (error) {
      console.error(`Failed to fetch tokens for chain ${chainId}:`, error);
      
      // Return cached data if available, even if stale
      const cached = this.tokenCache.get(`chain-${chainId}`);
      if (cached) {
        return cached.data;
      }
      
      throw error;
    }
  }

  private async fetchAndCacheAllTokens(): Promise<Token[]> {
    try {
      const allTokensMap = await lifiService.getAllTokens();
      
      this.allTokensCache = {
        data: allTokensMap,
        timestamp: Date.now()
      };
      
      // Update individual chain caches
      allTokensMap.forEach((tokens, chainId) => {
        this.tokenCache.set(`chain-${chainId}`, {
          data: tokens,
          timestamp: Date.now()
        });
        this.saveToPersistentCache(chainId, tokens);
      });
      
      this.stats.updates++;
      this.stats.lastUpdate = Date.now();
      
      const allTokens: Token[] = [];
      allTokensMap.forEach(tokens => allTokens.push(...tokens));
      
      return allTokens;
    } catch (error) {
      console.error('Failed to fetch all tokens:', error);
      
      // Return any cached data if available
      if (this.allTokensCache) {
        const allTokens: Token[] = [];
        this.allTokensCache.data.forEach(tokens => allTokens.push(...tokens));
        return allTokens;
      }
      
      throw error;
    }
  }

  private async updateTokensInBackground(chainId: number) {
    // Fire and forget background update
    this.fetchAndCacheTokens(chainId).catch(error => {
      console.error(`Background update failed for chain ${chainId}:`, error);
    });
  }

  private isCacheValid(entry: CacheEntry<any>): boolean {
    return Date.now() - entry.timestamp < this.CACHE_TTL;
  }

  private isCacheStale(entry: CacheEntry<any>): boolean {
    const age = Date.now() - entry.timestamp;
    return age < this.CACHE_TTL + this.STALE_WHILE_REVALIDATE;
  }

  // Preload tokens for common chains
  async preloadCommonChains() {
    const commonChains = [1, 10, 56, 137, 42161, 43114]; // ETH, OP, BSC, Polygon, Arbitrum, Avalanche
    
    console.log('Preloading tokens for common chains...');
    const promises = commonChains.map(chainId => 
      this.getTokens(chainId).catch(error => 
        console.error(`Failed to preload chain ${chainId}:`, error)
      )
    );
    
    await Promise.all(promises);
    console.log('Token preloading complete');
  }

  // Start periodic cache updates
  private startPeriodicUpdate() {
    // Update cache every 6 hours
    setInterval(() => {
      this.preloadCommonChains();
    }, 6 * 60 * 60 * 1000);
  }

  // Get cache statistics
  getStats(): TokenCacheStats {
    // Calculate cache size
    let size = 0;
    this.tokenCache.forEach(entry => {
      size += JSON.stringify(entry.data).length;
    });
    
    this.stats.size = size;
    return { ...this.stats };
  }

  // Clear cache
  clearCache() {
    this.tokenCache.clear();
    this.chainCache.clear();
    this.allTokensCache = null;
    this.stats = {
      hits: 0,
      misses: 0,
      updates: 0,
      lastUpdate: 0,
      size: 0
    };
    
    if (this.db) {
      const transaction = this.db.transaction(['tokens', 'metadata'], 'readwrite');
      transaction.objectStore('tokens').clear();
      transaction.objectStore('metadata').clear();
    }
  }

  // Get cache hit rate
  getCacheHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? (this.stats.hits / total) * 100 : 0;
  }
}

export const tokenCacheService = TokenCacheService.getInstance();