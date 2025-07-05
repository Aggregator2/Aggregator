import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export interface TokenBalance {
  token: string;
  balance: bigint;
  allowance: bigint;
  symbol: string;
  decimals: number;
  lastUpdated: number;
}

export interface BalanceCheckConfig {
  provider: ethers.Provider;
  settlementContract: string;
  cacheTTL?: number; // milliseconds
  batchSize?: number; // for batch balance queries
  nativeTokenSymbol?: string;
  nativeTokenDecimals?: number;
}

export interface BalanceValidation {
  hasBalance: boolean;
  hasAllowance: boolean;
  balance: bigint;
  allowance: bigint;
  required: bigint;
  token: string;
  symbol: string;
  errors: string[];
}

// Minimal ERC20 ABI for balance and allowance checks
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

export class BalanceCheckService extends EventEmitter {
  private provider: ethers.Provider;
  private settlementContract: string;
  private balanceCache: Map<string, TokenBalance> = new Map();
  private cacheTTL: number;
  private batchSize: number;
  private nativeTokenSymbol: string;
  private nativeTokenDecimals: number;
  private pendingQueries: Map<string, Promise<TokenBalance>> = new Map();

  constructor(config: BalanceCheckConfig) {
    super();
    this.provider = config.provider;
    this.settlementContract = config.settlementContract;
    this.cacheTTL = config.cacheTTL || 30000; // 30 seconds default
    this.batchSize = config.batchSize || 10;
    this.nativeTokenSymbol = config.nativeTokenSymbol || 'ETH';
    this.nativeTokenDecimals = config.nativeTokenDecimals || 18;
  }

  // Check if user has sufficient balance and allowance for an order
  async validateOrderBalance(
    userAddress: string,
    tokenAddress: string,
    amount: bigint,
    isNativeToken: boolean = false
  ): Promise<BalanceValidation> {
    const errors: string[] = [];
    
    try {
      let balance: TokenBalance;
      
      if (isNativeToken) {
        balance = await this.getNativeBalance(userAddress);
      } else {
        balance = await this.getTokenBalance(userAddress, tokenAddress);
      }
      
      const hasBalance = balance.balance >= amount;
      const hasAllowance = isNativeToken || balance.allowance >= amount;
      
      if (!hasBalance) {
        errors.push(`Insufficient ${balance.symbol} balance. Required: ${ethers.formatUnits(amount, balance.decimals)}, Available: ${ethers.formatUnits(balance.balance, balance.decimals)}`);
      }
      
      if (!hasAllowance && !isNativeToken) {
        errors.push(`Insufficient ${balance.symbol} allowance. Required: ${ethers.formatUnits(amount, balance.decimals)}, Approved: ${ethers.formatUnits(balance.allowance, balance.decimals)}`);
      }
      
      const validation: BalanceValidation = {
        hasBalance,
        hasAllowance,
        balance: balance.balance,
        allowance: balance.allowance,
        required: amount,
        token: tokenAddress,
        symbol: balance.symbol,
        errors
      };
      
      this.emit('balanceValidated', {
        userAddress,
        tokenAddress,
        validation,
        timestamp: Date.now()
      });
      
      return validation;
      
    } catch (error) {
      errors.push(`Failed to check balance: ${error.message}`);
      
      return {
        hasBalance: false,
        hasAllowance: false,
        balance: BigInt(0),
        allowance: BigInt(0),
        required: amount,
        token: tokenAddress,
        symbol: 'UNKNOWN',
        errors
      };
    }
  }

  // Get native token (ETH) balance
  async getNativeBalance(userAddress: string): Promise<TokenBalance> {
    const cacheKey = `${userAddress}:NATIVE`;
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    // Check if there's already a pending query
    const pending = this.pendingQueries.get(cacheKey);
    if (pending) {
      return pending;
    }
    
    // Create new query
    const queryPromise = this.queryNativeBalance(userAddress);
    this.pendingQueries.set(cacheKey, queryPromise);
    
    try {
      const balance = await queryPromise;
      this.setCache(cacheKey, balance);
      return balance;
    } finally {
      this.pendingQueries.delete(cacheKey);
    }
  }

  // Query native balance from blockchain
  private async queryNativeBalance(userAddress: string): Promise<TokenBalance> {
    const balance = await this.provider.getBalance(userAddress);
    
    return {
      token: 'NATIVE',
      balance,
      allowance: ethers.MaxUint256, // Native tokens don't need allowance
      symbol: this.nativeTokenSymbol,
      decimals: this.nativeTokenDecimals,
      lastUpdated: Date.now()
    };
  }

  // Get ERC20 token balance and allowance
  async getTokenBalance(userAddress: string, tokenAddress: string): Promise<TokenBalance> {
    const cacheKey = `${userAddress}:${tokenAddress}`;
    const cached = this.getFromCache(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    // Check if there's already a pending query
    const pending = this.pendingQueries.get(cacheKey);
    if (pending) {
      return pending;
    }
    
    // Create new query
    const queryPromise = this.queryTokenBalance(userAddress, tokenAddress);
    this.pendingQueries.set(cacheKey, queryPromise);
    
    try {
      const balance = await queryPromise;
      this.setCache(cacheKey, balance);
      return balance;
    } finally {
      this.pendingQueries.delete(cacheKey);
    }
  }

  // Query token balance from blockchain
  private async queryTokenBalance(userAddress: string, tokenAddress: string): Promise<TokenBalance> {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
    
    try {
      // Batch all calls together
      const [balance, allowance, symbol, decimals] = await Promise.all([
        token.balanceOf(userAddress),
        token.allowance(userAddress, this.settlementContract),
        token.symbol(),
        token.decimals()
      ]);
      
      return {
        token: tokenAddress,
        balance: BigInt(balance.toString()),
        allowance: BigInt(allowance.toString()),
        symbol: symbol as string,
        decimals: Number(decimals),
        lastUpdated: Date.now()
      };
    } catch (error) {
      // Some tokens might not have symbol/decimals
      try {
        const [balance, allowance] = await Promise.all([
          token.balanceOf(userAddress),
          token.allowance(userAddress, this.settlementContract)
        ]);
        
        return {
          token: tokenAddress,
          balance: BigInt(balance.toString()),
          allowance: BigInt(allowance.toString()),
          symbol: 'UNKNOWN',
          decimals: 18, // Default to 18
          lastUpdated: Date.now()
        };
      } catch (innerError) {
        throw new Error(`Failed to query token ${tokenAddress}: ${innerError.message}`);
      }
    }
  }

  // Get multiple token balances in batch
  async getMultipleBalances(
    userAddress: string,
    tokens: { address: string; isNative: boolean }[]
  ): Promise<Map<string, TokenBalance>> {
    const results = new Map<string, TokenBalance>();
    
    // Process in batches
    for (let i = 0; i < tokens.length; i += this.batchSize) {
      const batch = tokens.slice(i, i + this.batchSize);
      
      const promises = batch.map(token => 
        token.isNative 
          ? this.getNativeBalance(userAddress)
          : this.getTokenBalance(userAddress, token.address)
      );
      
      const balances = await Promise.all(promises);
      
      batch.forEach((token, index) => {
        results.set(token.address, balances[index]);
      });
    }
    
    return results;
  }

  // Force refresh a specific balance
  async refreshBalance(userAddress: string, tokenAddress: string, isNative: boolean = false): Promise<TokenBalance> {
    const cacheKey = isNative ? `${userAddress}:NATIVE` : `${userAddress}:${tokenAddress}`;
    
    // Remove from cache
    this.balanceCache.delete(cacheKey);
    
    // Fetch fresh balance
    const balance = isNative 
      ? await this.getNativeBalance(userAddress)
      : await this.getTokenBalance(userAddress, tokenAddress);
    
    this.emit('balanceRefreshed', {
      userAddress,
      tokenAddress,
      balance,
      timestamp: Date.now()
    });
    
    return balance;
  }

  // Clear cache for a specific user
  clearUserCache(userAddress: string): void {
    const keysToDelete: string[] = [];
    
    for (const key of this.balanceCache.keys()) {
      if (key.startsWith(`${userAddress}:`)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.balanceCache.delete(key));
    
    this.emit('cacheCleared', {
      userAddress,
      entriesCleared: keysToDelete.length
    });
  }

  // Clear entire cache
  clearAllCache(): void {
    const size = this.balanceCache.size;
    this.balanceCache.clear();
    
    this.emit('cacheCleared', {
      entriesCleared: size
    });
  }

  // Get from cache if not expired
  private getFromCache(key: string): TokenBalance | null {
    const cached = this.balanceCache.get(key);
    
    if (cached && Date.now() - cached.lastUpdated < this.cacheTTL) {
      return cached;
    }
    
    // Remove expired entry
    if (cached) {
      this.balanceCache.delete(key);
    }
    
    return null;
  }

  // Set cache entry
  private setCache(key: string, balance: TokenBalance): void {
    this.balanceCache.set(key, balance);
  }

  // Get cache statistics
  getCacheStats(): {
    size: number;
    entries: { key: string; age: number }[];
  } {
    const entries = Array.from(this.balanceCache.entries()).map(([key, value]) => ({
      key,
      age: Date.now() - value.lastUpdated
    }));
    
    return {
      size: this.balanceCache.size,
      entries
    };
  }

  // Monitor balance changes (optional WebSocket or polling implementation)
  async startBalanceMonitoring(
    userAddress: string,
    tokens: { address: string; isNative: boolean }[],
    interval: number = 60000 // 1 minute default
  ): Promise<NodeJS.Timeout> {
    const checkBalances = async () => {
      for (const token of tokens) {
        const oldBalance = this.getFromCache(
          token.isNative ? `${userAddress}:NATIVE` : `${userAddress}:${token.address}`
        );
        
        const newBalance = await this.refreshBalance(
          userAddress,
          token.address,
          token.isNative
        );
        
        if (oldBalance && oldBalance.balance !== newBalance.balance) {
          this.emit('balanceChanged', {
            userAddress,
            tokenAddress: token.address,
            oldBalance: oldBalance.balance,
            newBalance: newBalance.balance,
            symbol: newBalance.symbol,
            timestamp: Date.now()
          });
        }
      }
    };
    
    // Initial check
    await checkBalances();
    
    // Set up interval
    return setInterval(checkBalances, interval);
  }

  // Calculate required approval amount with buffer
  calculateApprovalAmount(amount: bigint, buffer: number = 1.1): bigint {
    return amount * BigInt(Math.floor(buffer * 100)) / BigInt(100);
  }

  // Format balance for display
  formatBalance(balance: TokenBalance, decimals?: number): string {
    const displayDecimals = decimals ?? Math.min(balance.decimals, 6);
    return ethers.formatUnits(balance.balance, balance.decimals);
  }

  // Check if approval is needed
  needsApproval(balance: TokenBalance, amount: bigint): boolean {
    return balance.allowance < amount;
  }
}