import { useState, useCallback, useMemo } from 'react';
import {
  isTokenBlacklisted,
  isWrappedNativeToken,
  getTokenWarnings,
} from '../../src/config/tokenRegistry';
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
  handleSellTokenSelect: (token: Token) => void;
  handleBuyTokenSelect: (token: Token) => void;
  handleSwitch: () => void;
  setShowSellTokenPicker: (show: boolean) => void;
  setShowBuyTokenPicker: (show: boolean) => void;
  dismissWarning: (warningKey: string) => void;
  getSellTokenWarnings: () => string[];
  getBuyTokenWarnings: () => string[];
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
    handleSellTokenSelect,
    handleBuyTokenSelect,
    handleSwitch,
    setShowSellTokenPicker,
    setShowBuyTokenPicker,
    dismissWarning,
    getSellTokenWarnings,
    getBuyTokenWarnings,
  };
}