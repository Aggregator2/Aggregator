import { useState, useEffect, useCallback, useRef } from 'react';
import { BalanceValidationService, TokenBalance, BalanceCheckResult, ValidationResult } from '../src/services/balanceValidation/BalanceValidationService';

export interface UseBalanceOptions {
  userAddress?: string;
  tokens?: Array<{ address: string; symbol?: string; decimals?: number }>;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds, default 30000 (30 seconds)
  settlementContract?: string;
}

export interface UseBalanceReturn {
  balances: Map<string, TokenBalance>;
  loading: boolean;
  error: string | null;
  refreshBalance: (tokenAddress: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  validateBalance: (tokenAddress: string, requiredAmount: string) => Promise<ValidationResult>;
  approveToken: (tokenAddress: string, amount: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  clearCache: (tokenAddress?: string) => void;
  isRefreshing: boolean;
}

// Default settlement contract address from escrow config
const DEFAULT_SETTLEMENT_CONTRACT = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';

export function useBalance(options: UseBalanceOptions = {}): UseBalanceReturn {
  const {
    userAddress,
    tokens = [],
    autoRefresh = true,
    refreshInterval = 30000,
    settlementContract = DEFAULT_SETTLEMENT_CONTRACT
  } = options;

  const [balances, setBalances] = useState<Map<string, TokenBalance>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const serviceRef = useRef<BalanceValidationService | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Initialize service
  useEffect(() => {
    serviceRef.current = new BalanceValidationService(settlementContract);

    // Subscribe to balance updates
    const handleBalanceUpdate = (balance: TokenBalance) => {
      if (isMountedRef.current) {
        setBalances(prev => {
          const updated = new Map(prev);
          updated.set(balance.token.toLowerCase(), balance);
          return updated;
        });
      }
    };

    serviceRef.current.on('balanceUpdate', handleBalanceUpdate);

    return () => {
      isMountedRef.current = false;
      if (serviceRef.current) {
        serviceRef.current.off('balanceUpdate', handleBalanceUpdate);
        serviceRef.current.destroy();
      }
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [settlementContract]);

  // Fetch single balance
  const fetchBalance = useCallback(async (tokenAddress: string, tokenSymbol?: string, tokenDecimals?: number) => {
    if (!serviceRef.current || !userAddress) return;

    try {
      const result = await serviceRef.current.getBalance(
        userAddress,
        tokenAddress,
        tokenSymbol,
        tokenDecimals
      );

      if (result.success && result.balance && isMountedRef.current) {
        setBalances(prev => {
          const updated = new Map(prev);
          updated.set(tokenAddress.toLowerCase(), result.balance!);
          return updated;
        });
      } else if (!result.success) {
        console.error(`Failed to fetch balance for ${tokenAddress}:`, result.error);
      }
    } catch (err) {
      console.error(`Error fetching balance for ${tokenAddress}:`, err);
    }
  }, [userAddress]);

  // Fetch all balances
  const fetchAllBalances = useCallback(async () => {
    if (!serviceRef.current || !userAddress || tokens.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      const results = await serviceRef.current.getMultipleBalances(userAddress, tokens);
      
      if (isMountedRef.current) {
        const newBalances = new Map<string, TokenBalance>();
        
        results.forEach((result, address) => {
          if (result.success && result.balance) {
            newBalances.set(address.toLowerCase(), result.balance);
          }
        });

        setBalances(newBalances);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to fetch balances');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [userAddress, tokens]);

  // Initial fetch and auto-refresh setup
  useEffect(() => {
    if (userAddress && tokens.length > 0) {
      fetchAllBalances();

      if (autoRefresh) {
        // Set up interval for auto-refresh
        refreshTimerRef.current = setInterval(() => {
          if (isMountedRef.current && !isRefreshing) {
            setIsRefreshing(true);
            fetchAllBalances().finally(() => {
              if (isMountedRef.current) {
                setIsRefreshing(false);
              }
            });
          }
        }, refreshInterval);

        return () => {
          if (refreshTimerRef.current) {
            clearInterval(refreshTimerRef.current);
          }
        };
      }
    }
  }, [userAddress, tokens, autoRefresh, refreshInterval, fetchAllBalances, isRefreshing]);

  // Refresh single balance
  const refreshBalance = useCallback(async (tokenAddress: string) => {
    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());
    await fetchBalance(tokenAddress, token?.symbol, token?.decimals);
  }, [tokens, fetchBalance]);

  // Refresh all balances manually
  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    await fetchAllBalances();
    setIsRefreshing(false);
  }, [fetchAllBalances]);

  // Validate balance for a transaction
  const validateBalance = useCallback(async (
    tokenAddress: string,
    requiredAmount: string
  ): Promise<ValidationResult> => {
    if (!serviceRef.current || !userAddress) {
      return {
        isValid: false,
        hasBalance: false,
        hasAllowance: false,
        balance: '0',
        allowance: '0',
        required: requiredAmount,
        errors: ['No service or user address available']
      };
    }

    const token = tokens.find(t => t.address.toLowerCase() === tokenAddress.toLowerCase());
    return await serviceRef.current.validateBalance(
      userAddress,
      tokenAddress,
      requiredAmount,
      token?.decimals
    );
  }, [userAddress, tokens]);

  // Approve token spending
  const approveToken = useCallback(async (
    tokenAddress: string,
    amount: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
    if (!serviceRef.current || !userAddress) {
      return {
        success: false,
        error: 'No service or user address available'
      };
    }

    const result = await serviceRef.current.approveToken(tokenAddress, amount, userAddress);
    
    if (result.success) {
      // Refresh the balance after approval
      await refreshBalance(tokenAddress);
    }

    return result;
  }, [userAddress, refreshBalance]);

  // Clear cache
  const clearCache = useCallback((tokenAddress?: string) => {
    if (serviceRef.current) {
      serviceRef.current.clearCache(userAddress, tokenAddress);
      
      if (tokenAddress) {
        setBalances(prev => {
          const updated = new Map(prev);
          updated.delete(tokenAddress.toLowerCase());
          return updated;
        });
      } else {
        setBalances(new Map());
      }
    }
  }, [userAddress]);

  return {
    balances,
    loading,
    error,
    refreshBalance,
    refreshAll,
    validateBalance,
    approveToken,
    clearCache,
    isRefreshing
  };
}

// Helper hook for single token balance
export function useTokenBalance(
  userAddress?: string,
  tokenAddress?: string,
  tokenSymbol?: string,
  tokenDecimals?: number,
  options: Omit<UseBalanceOptions, 'userAddress' | 'tokens'> = {}
): {
  balance: TokenBalance | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  validate: (amount: string) => Promise<ValidationResult>;
  approve: (amount: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
} {
  const tokens = tokenAddress ? [{ address: tokenAddress, symbol: tokenSymbol, decimals: tokenDecimals }] : [];
  
  const {
    balances,
    loading,
    error,
    refreshBalance,
    validateBalance,
    approveToken
  } = useBalance({
    ...options,
    userAddress,
    tokens
  });

  const balance = tokenAddress ? balances.get(tokenAddress.toLowerCase()) || null : null;

  const refresh = useCallback(async () => {
    if (tokenAddress) {
      await refreshBalance(tokenAddress);
    }
  }, [tokenAddress, refreshBalance]);

  const validate = useCallback(async (amount: string) => {
    if (!tokenAddress) {
      return {
        isValid: false,
        hasBalance: false,
        hasAllowance: false,
        balance: '0',
        allowance: '0',
        required: amount,
        errors: ['No token address provided']
      };
    }
    return validateBalance(tokenAddress, amount);
  }, [tokenAddress, validateBalance]);

  const approve = useCallback(async (amount: string) => {
    if (!tokenAddress) {
      return {
        success: false,
        error: 'No token address provided'
      };
    }
    return approveToken(tokenAddress, amount);
  }, [tokenAddress, approveToken]);

  return {
    balance,
    loading,
    error,
    refresh,
    validate,
    approve
  };
}