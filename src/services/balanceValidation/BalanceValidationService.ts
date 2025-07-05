import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export interface TokenBalance {
  token: string;
  symbol: string;
  decimals: number;
  balance: string; // Balance in wei/smallest unit
  balanceFormatted: string; // Human-readable balance
  allowance: string; // Allowance in wei/smallest unit
  allowanceFormatted: string; // Human-readable allowance
  timestamp: number;
}

export interface BalanceCheckResult {
  success: boolean;
  balance?: TokenBalance;
  error?: string;
  cached: boolean;
}

export interface ValidationResult {
  isValid: boolean;
  hasBalance: boolean;
  hasAllowance: boolean;
  balance: string;
  allowance: string;
  required: string;
  errors: string[];
}

interface CacheEntry {
  data: TokenBalance;
  expiresAt: number;
}

// Minimal ERC20 ABI for balance and allowance checks
const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

export class BalanceValidationService extends EventEmitter {
  private cache: Map<string, CacheEntry> = new Map();
  private provider: ethers.BrowserProvider | null = null;
  private readonly cacheTTL: number = 30000; // 30 seconds
  private readonly nativeTokenAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  private settlementContract: string;
  private refreshTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(settlementContract: string) {
    super();
    this.settlementContract = settlementContract;
    this.initializeProvider();
  }

  private async initializeProvider() {
    if (typeof window !== 'undefined' && window.ethereum) {
      this.provider = new ethers.BrowserProvider(window.ethereum);
    }
  }

  /**
   * Get balance for a token with caching
   */
  async getBalance(
    userAddress: string,
    tokenAddress: string,
    tokenSymbol?: string,
    tokenDecimals?: number
  ): Promise<BalanceCheckResult> {
    const cacheKey = `${userAddress}-${tokenAddress}`.toLowerCase();
    
    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      return {
        success: true,
        balance: cached,
        cached: true
      };
    }

    try {
      if (!this.provider) {
        throw new Error('No provider available');
      }

      let balance: TokenBalance;

      if (this.isNativeToken(tokenAddress)) {
        // Native ETH balance
        balance = await this.getNativeBalance(userAddress);
      } else {
        // ERC-20 token balance
        balance = await this.getERC20Balance(
          userAddress,
          tokenAddress,
          tokenSymbol,
          tokenDecimals
        );
      }

      // Cache the result
      this.setCached(cacheKey, balance);

      // Set up auto-refresh
      this.scheduleRefresh(userAddress, tokenAddress, tokenSymbol, tokenDecimals);

      return {
        success: true,
        balance,
        cached: false
      };
    } catch (error: any) {
      console.error('Error fetching balance:', error);
      return {
        success: false,
        error: error.message || 'Failed to fetch balance',
        cached: false
      };
    }
  }

  /**
   * Validate if user has sufficient balance and allowance for a trade
   */
  async validateBalance(
    userAddress: string,
    tokenAddress: string,
    requiredAmount: string,
    tokenDecimals?: number
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    
    try {
      const balanceResult = await this.getBalance(
        userAddress,
        tokenAddress,
        undefined,
        tokenDecimals
      );

      if (!balanceResult.success || !balanceResult.balance) {
        return {
          isValid: false,
          hasBalance: false,
          hasAllowance: false,
          balance: '0',
          allowance: '0',
          required: requiredAmount,
          errors: ['Failed to fetch balance']
        };
      }

      const { balance, allowance } = balanceResult.balance;
      const hasBalance = BigInt(balance) >= BigInt(requiredAmount);
      const hasAllowance = this.isNativeToken(tokenAddress) || 
                          BigInt(allowance) >= BigInt(requiredAmount);

      if (!hasBalance) {
        errors.push(`Insufficient balance. Required: ${ethers.formatUnits(
          requiredAmount,
          balanceResult.balance.decimals
        )} ${balanceResult.balance.symbol}`);
      }

      if (!hasAllowance && !this.isNativeToken(tokenAddress)) {
        errors.push(`Insufficient allowance. Required: ${ethers.formatUnits(
          requiredAmount,
          balanceResult.balance.decimals
        )} ${balanceResult.balance.symbol}`);
      }

      return {
        isValid: hasBalance && hasAllowance,
        hasBalance,
        hasAllowance,
        balance,
        allowance,
        required: requiredAmount,
        errors
      };
    } catch (error: any) {
      return {
        isValid: false,
        hasBalance: false,
        hasAllowance: false,
        balance: '0',
        allowance: '0',
        required: requiredAmount,
        errors: [error.message || 'Validation failed']
      };
    }
  }

  /**
   * Get native ETH balance
   */
  private async getNativeBalance(userAddress: string): Promise<TokenBalance> {
    if (!this.provider) throw new Error('No provider available');

    const balance = await this.provider.getBalance(userAddress);
    const balanceFormatted = ethers.formatEther(balance);

    return {
      token: this.nativeTokenAddress,
      symbol: 'ETH',
      decimals: 18,
      balance: balance.toString(),
      balanceFormatted,
      allowance: ethers.MaxUint256.toString(), // Native ETH doesn't need allowance
      allowanceFormatted: 'Unlimited',
      timestamp: Date.now()
    };
  }

  /**
   * Get ERC-20 token balance and allowance
   */
  private async getERC20Balance(
    userAddress: string,
    tokenAddress: string,
    tokenSymbol?: string,
    tokenDecimals?: number
  ): Promise<TokenBalance> {
    if (!this.provider) throw new Error('No provider available');

    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);

    // Fetch all data in parallel
    const [balance, allowance, decimals, symbol] = await Promise.all([
      contract.balanceOf(userAddress),
      contract.allowance(userAddress, this.settlementContract),
      tokenDecimals !== undefined ? 
        Promise.resolve(tokenDecimals) : 
        contract.decimals(),
      tokenSymbol !== undefined ? 
        Promise.resolve(tokenSymbol) : 
        contract.symbol()
    ]);

    const balanceFormatted = ethers.formatUnits(balance, decimals);
    const allowanceFormatted = allowance.toString() === ethers.MaxUint256.toString() ?
      'Unlimited' :
      ethers.formatUnits(allowance, decimals);

    return {
      token: tokenAddress,
      symbol: symbol,
      decimals: decimals,
      balance: balance.toString(),
      balanceFormatted,
      allowance: allowance.toString(),
      allowanceFormatted,
      timestamp: Date.now()
    };
  }

  /**
   * Approve token spending
   */
  async approveToken(
    tokenAddress: string,
    amount: string,
    userAddress: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      if (!this.provider) throw new Error('No provider available');
      if (this.isNativeToken(tokenAddress)) {
        return { success: true }; // Native ETH doesn't need approval
      }

      const signer = await this.provider.getSigner(userAddress);
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

      const tx = await contract.approve(this.settlementContract, amount);
      await tx.wait();

      // Clear cache after approval
      const cacheKey = `${userAddress}-${tokenAddress}`.toLowerCase();
      this.cache.delete(cacheKey);

      // Emit approval event
      this.emit('approval', {
        tokenAddress,
        userAddress,
        amount,
        txHash: tx.hash
      });

      return { success: true, txHash: tx.hash };
    } catch (error: any) {
      console.error('Approval error:', error);
      return {
        success: false,
        error: error.message || 'Approval failed'
      };
    }
  }

  /**
   * Get multiple balances at once
   */
  async getMultipleBalances(
    userAddress: string,
    tokens: Array<{ address: string; symbol?: string; decimals?: number }>
  ): Promise<Map<string, BalanceCheckResult>> {
    const results = new Map<string, BalanceCheckResult>();
    
    // Fetch all balances in parallel
    const promises = tokens.map(async (token) => {
      const result = await this.getBalance(
        userAddress,
        token.address,
        token.symbol,
        token.decimals
      );
      return { address: token.address, result };
    });

    const balances = await Promise.all(promises);
    
    for (const { address, result } of balances) {
      results.set(address, result);
    }

    return results;
  }

  /**
   * Check if token is native ETH
   */
  private isNativeToken(tokenAddress: string): boolean {
    const normalized = tokenAddress.toLowerCase();
    return normalized === this.nativeTokenAddress.toLowerCase() ||
           normalized === '0x0000000000000000000000000000000000000000';
  }

  /**
   * Get cached balance
   */
  private getCached(key: string): TokenBalance | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Set cached balance
   */
  private setCached(key: string, data: TokenBalance): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTTL
    });

    // Emit balance update event
    this.emit('balanceUpdate', data);
  }

  /**
   * Schedule automatic refresh
   */
  private scheduleRefresh(
    userAddress: string,
    tokenAddress: string,
    tokenSymbol?: string,
    tokenDecimals?: number
  ): void {
    const key = `${userAddress}-${tokenAddress}`.toLowerCase();
    
    // Clear existing timer
    const existingTimer = this.refreshTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(async () => {
      try {
        const result = await this.getBalance(
          userAddress,
          tokenAddress,
          tokenSymbol,
          tokenDecimals
        );
        
        if (result.success) {
          // Schedule next refresh
          this.scheduleRefresh(userAddress, tokenAddress, tokenSymbol, tokenDecimals);
        }
      } catch (error) {
        console.error('Auto-refresh failed:', error);
      }
    }, this.cacheTTL);

    this.refreshTimers.set(key, timer);
  }

  /**
   * Clear cache for specific token/user
   */
  clearCache(userAddress?: string, tokenAddress?: string): void {
    if (userAddress && tokenAddress) {
      const key = `${userAddress}-${tokenAddress}`.toLowerCase();
      this.cache.delete(key);
      
      const timer = this.refreshTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        this.refreshTimers.delete(key);
      }
    } else if (userAddress) {
      // Clear all entries for a user
      for (const [key] of this.cache) {
        if (key.startsWith(userAddress.toLowerCase())) {
          this.cache.delete(key);
          
          const timer = this.refreshTimers.get(key);
          if (timer) {
            clearTimeout(timer);
            this.refreshTimers.delete(key);
          }
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
      for (const timer of this.refreshTimers.values()) {
        clearTimeout(timer);
      }
      this.refreshTimers.clear();
    }
  }

  /**
   * Destroy service and clear all timers
   */
  destroy(): void {
    this.clearCache();
    this.removeAllListeners();
  }
}