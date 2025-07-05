import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  isTokenBlacklisted,
  isWrappedNativeToken,
  getTokenWarnings,
} from '../../src/config/tokenRegistry';
import { enhancedLifiTokenService, EnhancedToken } from '../../src/services/enhancedLifiTokenService';
import type { Token } from '../../types/wallet';

interface UseTokenSelectionProps {
  defaultSellToken: Token;
  defaultBuyToken: Token;
  showError: (message: string) => void;
}

interface UseTokenSelectionReturn {
  sellToken: Token;
  buyToken: Token;
  showSellTokenPicker: boolean;
  showBuyTokenPicker: boolean;
  showUnwrapOption: boolean;
  dismissedWarnings: Set<string>;
  availableTokens: EnhancedToken[];
  popularTokens: EnhancedToken[];
  isLoadingTokens: boolean;
  tokenError: string | null;
  handleSellTokenSelect: (token: Token) => void;
  handleBuyTokenSelect: (token: Token) => void;
  handleSwitch: () => void;
  setShowSellTokenPicker: (show: boolean) => void;
  setShowBuyTokenPicker: (show: boolean) => void;
  dismissWarning: (warningKey: string) => void;
  getSellTokenWarnings: () => string[];
  getBuyTokenWarnings: () => string[];
  searchTokens: (query: string) => Promise<EnhancedToken[]>;
  refreshTokens: () => Promise<void>;
}

export function useTokenSelection({
  defaultSellToken,
  defaultBuyToken,
  showError,
}: UseTokenSelectionProps): UseTokenSelectionReturn {
  const [sellToken, setSellToken] = useState<Token>(defaultSellToken);
  const [buyToken, setBuyToken] = useState<Token>(defaultBuyToken);
  const [showSellTokenPicker, setShowSellTokenPicker] = useState(false);
  const [showBuyTokenPicker, setShowBuyTokenPicker] = useState(false);
  const [showUnwrapOption, setShowUnwrapOption] = useState(false);
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const [availableTokens, setAvailableTokens] = useState<EnhancedToken[]>([]);
  const [popularTokens, setPopularTokens] = useState<EnhancedToken[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Get current chain ID from sellToken
  const currentChainId = sellToken.chainId ?? 1;

  /**
   * Load tokens for the current chain
   */
  const loadTokens = useCallback(async (chainId: number) => {
    setIsLoadingTokens(true);
    setTokenError(null);
    
    try {
      // Load available tokens and popular tokens in parallel
      const [allTokens, popularTokensList] = await Promise.all([
        enhancedLifiTokenService.getTokensForChain(chainId, {
          includeWarnings: true,
          includeBlacklisted: false
        }),
        enhancedLifiTokenService.getPopularTokens(chainId, 20)
      ]);
      
      setAvailableTokens(allTokens);
      setPopularTokens(popularTokensList);
      
      console.log(`Loaded ${allTokens.length} tokens for chain ${chainId}`);
    } catch (error) {
      console.error('Error loading tokens:', error);
      setTokenError(error instanceof Error ? error.message : 'Failed to load tokens');
      
      // Try to load fallback tokens
      try {
        const fallbackTokens = await enhancedLifiTokenService.getTokensForChain(chainId, {
          forceRefresh: false,
          includeWarnings: false
        });
        setAvailableTokens(fallbackTokens);
        setPopularTokens(fallbackTokens.slice(0, 10));
      } catch (fallbackError) {
        console.error('Fallback token loading also failed:', fallbackError);
      }
    } finally {
      setIsLoadingTokens(false);
    }
  }, []);

  /**
   * Refresh tokens for current chain
   */
  const refreshTokens = useCallback(async () => {
    enhancedLifiTokenService.clearCache();
    await loadTokens(currentChainId);
  }, [currentChainId, loadTokens]);

  /**
   * Search tokens
   */
  const searchTokens = useCallback(async (query: string): Promise<EnhancedToken[]> => {
    if (!query || query.length < 2) {
      return popularTokens;
    }
    
    try {
      const results = await enhancedLifiTokenService.searchTokens(query, currentChainId, {
        includeWarnings: true,
        includeBlacklisted: false
      });
      return results;
    } catch (error) {
      console.error('Error searching tokens:', error);
      // Fallback to local search
      const localResults = availableTokens.filter(token =>
        token.symbol.toLowerCase().includes(query.toLowerCase()) ||
        token.name.toLowerCase().includes(query.toLowerCase()) ||
        token.address.toLowerCase() === query.toLowerCase()
      );
      return localResults;
    }
  }, [currentChainId, popularTokens, availableTokens]);

  // Load tokens when chain changes
  useEffect(() => {
    loadTokens(currentChainId);
  }, [currentChainId, loadTokens]);

  /**
   * Handle sell token selection
   */
  const handleSellTokenSelect = useCallback((token: Token) => {
    // Check if token is blacklisted
    if (isTokenBlacklisted(token.address, token.chainId ?? 1)) {
      showError(`${token.symbol} has been flagged and cannot be traded`);
      return;
    }
    
    setSellToken(token);
    setShowSellTokenPicker(false);
    
    // If selecting the same token as buy token, swap them
    if (token.address.toLowerCase() === buyToken.address.toLowerCase()) {
      setBuyToken(sellToken);
    }
    
    // Check if token is wrapped native
    setShowUnwrapOption(isWrappedNativeToken(token.address, token.chainId ?? 1));
  }, [buyToken, sellToken, showError]);

  /**
   * Handle buy token selection
   */
  const handleBuyTokenSelect = useCallback((token: Token) => {
    // Check if token is blacklisted
    if (isTokenBlacklisted(token.address, token.chainId ?? 1)) {
      showError(`${token.symbol} has been flagged and cannot be traded`);
      return;
    }
    
    setBuyToken(token);
    setShowBuyTokenPicker(false);
    
    // If selecting the same token as sell token, swap them
    if (token.address.toLowerCase() === sellToken.address.toLowerCase()) {
      setSellToken(buyToken);
    }
  }, [buyToken, sellToken, showError]);

  /**
   * Switch sell and buy tokens
   */
  const handleSwitch = useCallback(() => {
    const tempToken = sellToken;
    setSellToken(buyToken);
    setBuyToken(tempToken);
    
    // Update unwrap option for the new sell token
    setShowUnwrapOption(isWrappedNativeToken(buyToken.address, buyToken.chainId ?? 1));
  }, [sellToken, buyToken]);

  /**
   * Dismiss a warning for a specific token
   */
  const dismissWarning = useCallback((warningKey: string) => {
    setDismissedWarnings(prev => new Set([...prev, warningKey]));
  }, []);

  /**
   * Get warnings for sell token
   */
  const getSellTokenWarnings = useCallback(() => {
    if (dismissedWarnings.has(`sell-${sellToken.address}`)) {
      return [];
    }
    return getTokenWarnings(sellToken.address, sellToken.chainId ?? 1);
  }, [sellToken, dismissedWarnings]);

  /**
   * Get warnings for buy token
   */
  const getBuyTokenWarnings = useCallback(() => {
    if (dismissedWarnings.has(`buy-${buyToken.address}`)) {
      return [];
    }
    return getTokenWarnings(buyToken.address, buyToken.chainId ?? 1);
  }, [buyToken, dismissedWarnings]);

  return {
    sellToken,
    buyToken,
    showSellTokenPicker,
    showBuyTokenPicker,
    showUnwrapOption,
    dismissedWarnings,
    availableTokens,
    popularTokens,
    isLoadingTokens,
    tokenError,
    handleSellTokenSelect,
    handleBuyTokenSelect,
    handleSwitch,
    setShowSellTokenPicker,
    setShowBuyTokenPicker,
    dismissWarning,
    getSellTokenWarnings,
    getBuyTokenWarnings,
    searchTokens,
    refreshTokens,
  };
}