import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { BalanceCheckService, TokenBalance } from '../services/balanceManager/BalanceCheckService';

export interface UseBalancesConfig {
  provider: ethers.Provider;
  settlementContract: string;
  userAddress?: string;
  tokens?: { address: string; isNative: boolean; symbol?: string }[];
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
  cacheTTL?: number;
}

export interface BalanceState {
  balances: Map<string, TokenBalance>;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

export interface UseBalancesReturn extends BalanceState {
  refresh: () => Promise<void>;
  refreshToken: (tokenAddress: string, isNative?: boolean) => Promise<void>;
  checkSufficientBalance: (tokenAddress: string, amount: bigint, isNative?: boolean) => boolean;
  checkSufficientAllowance: (tokenAddress: string, amount: bigint) => boolean;
  formatBalance: (tokenAddress: string, decimals?: number) => string;
  getBalance: (tokenAddress: string) => TokenBalance | undefined;
}

export function useBalances(config: UseBalancesConfig): UseBalancesReturn {
  const [state, setState] = useState<BalanceState>({
    balances: new Map(),
    loading: false,
    error: null,
    lastUpdated: null
  });

  const balanceServiceRef = useRef<BalanceCheckService>();
  const refreshIntervalRef = useRef<NodeJS.Timeout>();
  const isMountedRef = useRef(true);

  // Initialize balance service
  useEffect(() => {
    balanceServiceRef.current = new BalanceCheckService({
      provider: config.provider,
      settlementContract: config.settlementContract,
      cacheTTL: config.cacheTTL || 30000
    });

    // Set up event listeners
    const handleBalanceValidated = (data: any) => {
      if (isMountedRef.current) {
        console.log('Balance validated:', data);
      }
    };

    const handleBalanceChanged = (data: any) => {
      if (isMountedRef.current) {
        console.log('Balance changed:', data);
        // Auto-refresh on balance change
        fetchBalances();
      }
    };

    balanceServiceRef.current.on('balanceValidated', handleBalanceValidated);
    balanceServiceRef.current.on('balanceChanged', handleBalanceChanged);

    return () => {
      balanceServiceRef.current?.removeListener('balanceValidated', handleBalanceValidated);
      balanceServiceRef.current?.removeListener('balanceChanged', handleBalanceChanged);
    };
  }, [config.provider, config.settlementContract, config.cacheTTL]);

  // Fetch all balances
  const fetchBalances = useCallback(async () => {
    if (!config.userAddress || !config.tokens || !balanceServiceRef.current) {
      return;
    }

    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const balanceMap = await balanceServiceRef.current.getMultipleBalances(
        config.userAddress,
        config.tokens
      );

      if (isMountedRef.current) {
        setState({
          balances: balanceMap,
          loading: false,
          error: null,
          lastUpdated: Date.now()
        });
      }
    } catch (error) {
      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to fetch balances'
        }));
      }
    }
  }, [config.userAddress, config.tokens]);

  // Initial fetch and auto-refresh setup
  useEffect(() => {
    if (config.userAddress && config.tokens && config.tokens.length > 0) {
      fetchBalances();

      if (config.autoRefresh && config.refreshInterval) {
        refreshIntervalRef.current = setInterval(fetchBalances, config.refreshInterval);
      }
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [config.userAddress, config.tokens, config.autoRefresh, config.refreshInterval, fetchBalances]);

  // Manual refresh
  const refresh = useCallback(async () => {
    if (config.userAddress && balanceServiceRef.current) {
      // Clear cache for user
      balanceServiceRef.current.clearUserCache(config.userAddress);
      await fetchBalances();
    }
  }, [config.userAddress, fetchBalances]);

  // Refresh specific token
  const refreshToken = useCallback(async (tokenAddress: string, isNative: boolean = false) => {
    if (!config.userAddress || !balanceServiceRef.current) {
      return;
    }

    setState(prev => ({ ...prev, loading: true }));

    try {
      const balance = await balanceServiceRef.current.refreshBalance(
        config.userAddress,
        tokenAddress,
        isNative
      );

      if (isMountedRef.current) {
        setState(prev => {
          const newBalances = new Map(prev.balances);
          newBalances.set(tokenAddress, balance);
          return {
            ...prev,
            balances: newBalances,
            loading: false,
            lastUpdated: Date.now()
          };
        });
      }
    } catch (error) {
      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to refresh token balance'
        }));
      }
    }
  }, [config.userAddress]);

  // Check if user has sufficient balance
  const checkSufficientBalance = useCallback((
    tokenAddress: string,
    amount: bigint,
    isNative: boolean = false
  ): boolean => {
    const key = isNative ? 'NATIVE' : tokenAddress;
    const balance = state.balances.get(key);
    return balance ? balance.balance >= amount : false;
  }, [state.balances]);

  // Check if user has sufficient allowance
  const checkSufficientAllowance = useCallback((
    tokenAddress: string,
    amount: bigint
  ): boolean => {
    const balance = state.balances.get(tokenAddress);
    return balance ? balance.allowance >= amount : false;
  }, [state.balances]);

  // Format balance for display
  const formatBalance = useCallback((
    tokenAddress: string,
    decimals?: number
  ): string => {
    const balance = state.balances.get(tokenAddress);
    if (!balance) return '0';

    const displayDecimals = decimals ?? Math.min(balance.decimals, 6);
    const formatted = ethers.formatUnits(balance.balance, balance.decimals);
    
    // Parse and format with fixed decimals
    const value = parseFloat(formatted);
    return value.toFixed(displayDecimals);
  }, [state.balances]);

  // Get balance object
  const getBalance = useCallback((tokenAddress: string): TokenBalance | undefined => {
    return state.balances.get(tokenAddress);
  }, [state.balances]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    ...state,
    refresh,
    refreshToken,
    checkSufficientBalance,
    checkSufficientAllowance,
    formatBalance,
    getBalance
  };
}

// Hook for single token balance
export function useTokenBalance(
  provider: ethers.Provider,
  settlementContract: string,
  userAddress?: string,
  tokenAddress?: string,
  isNative: boolean = false
) {
  const { balances, loading, error, refresh, formatBalance } = useBalances({
    provider,
    settlementContract,
    userAddress,
    tokens: tokenAddress ? [{ address: tokenAddress, isNative }] : [],
    autoRefresh: true,
    refreshInterval: 30000 // 30 seconds
  });

  const balance = tokenAddress ? balances.get(isNative ? 'NATIVE' : tokenAddress) : undefined;

  return {
    balance,
    loading,
    error,
    refresh,
    formatBalance: (decimals?: number) => formatBalance(tokenAddress || '', decimals)
  };
}

// Hook for order validation
export function useOrderValidation(
  provider: ethers.Provider,
  settlementContract: string,
  userAddress?: string
) {
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);

  const balanceServiceRef = useRef<BalanceCheckService>();

  useEffect(() => {
    balanceServiceRef.current = new BalanceCheckService({
      provider,
      settlementContract
    });
  }, [provider, settlementContract]);

  const validateOrder = useCallback(async (
    tokenAddress: string,
    amount: bigint,
    isNative: boolean = false
  ) => {
    if (!userAddress || !balanceServiceRef.current) {
      return {
        isValid: false,
        errors: ['User address not provided'],
        warnings: []
      };
    }

    setValidating(true);
    setValidation(null);

    try {
      const result = await balanceServiceRef.current.validateOrderBalance(
        userAddress,
        tokenAddress,
        amount,
        isNative
      );

      const validationResult = {
        isValid: result.hasBalance && (isNative || result.hasAllowance),
        errors: result.errors,
        warnings: []
      };

      if (!result.hasBalance) {
        validationResult.warnings.push(
          `Low ${result.symbol} balance: ${ethers.formatUnits(result.balance, 18)}`
        );
      }

      if (!isNative && result.hasBalance && !result.hasAllowance) {
        validationResult.warnings.push(
          `Approval needed for ${result.symbol}`
        );
      }

      setValidation(validationResult);
      return validationResult;

    } catch (error) {
      const errorResult = {
        isValid: false,
        errors: [error.message || 'Validation failed'],
        warnings: []
      };
      setValidation(errorResult);
      return errorResult;
    } finally {
      setValidating(false);
    }
  }, [userAddress]);

  return {
    validateOrder,
    validating,
    validation
  };
}