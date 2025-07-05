import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ethers } from 'ethers';
import { useBalances, useOrderValidation } from '../../hooks/useBalances';
import { OrderSide, OrderType, TimeInForce } from '../../services/matchingEngine/types';
import './BalanceAwareOrderForm.css';

interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  isNative?: boolean;
}

interface BalanceAwareOrderFormProps {
  pair: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  provider: ethers.Provider;
  settlementContract: string;
  userAddress?: string;
  onSubmit: (order: {
    pair: string;
    side: OrderSide;
    type: OrderType;
    price?: number;
    quantity: number;
    timeInForce: TimeInForce;
  }) => Promise<void>;
  currentPrice?: number;
}

export const BalanceAwareOrderForm: React.FC<BalanceAwareOrderFormProps> = ({
  pair,
  baseToken,
  quoteToken,
  provider,
  settlementContract,
  userAddress,
  onSubmit,
  currentPrice = 0
}) => {
  const [side, setSide] = useState<OrderSide>(OrderSide.BUY);
  const [orderType, setOrderType] = useState<OrderType>(OrderType.LIMIT);
  const [price, setPrice] = useState<string>(currentPrice.toString());
  const [quantity, setQuantity] = useState<string>('');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>(TimeInForce.GTC);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Balance hooks
  const { balances, loading, refresh, checkSufficientBalance, checkSufficientAllowance, formatBalance } = useBalances({
    provider,
    settlementContract,
    userAddress,
    tokens: [
      { address: baseToken.address, isNative: baseToken.isNative || false, symbol: baseToken.symbol },
      { address: quoteToken.address, isNative: quoteToken.isNative || false, symbol: quoteToken.symbol }
    ],
    autoRefresh: true,
    refreshInterval: 30000 // 30 seconds
  });

  const { validateOrder, validating, validation } = useOrderValidation(
    provider,
    settlementContract,
    userAddress
  );

  // Calculate required amount based on order
  const requiredAmount = useMemo(() => {
    const qty = parseFloat(quantity) || 0;
    const prc = orderType === OrderType.LIMIT ? (parseFloat(price) || 0) : currentPrice;

    if (side === OrderSide.BUY) {
      // Buying base with quote - need quote amount
      return ethers.parseUnits((qty * prc).toFixed(quoteToken.decimals), quoteToken.decimals);
    } else {
      // Selling base for quote - need base amount
      return ethers.parseUnits(qty.toFixed(baseToken.decimals), baseToken.decimals);
    }
  }, [side, orderType, price, quantity, currentPrice, baseToken.decimals, quoteToken.decimals]);

  // Get relevant token for current side
  const relevantToken = useMemo(() => {
    return side === OrderSide.BUY ? quoteToken : baseToken;
  }, [side, baseToken, quoteToken]);

  // Check balance sufficiency
  const hasSufficientBalance = useMemo(() => {
    if (!userAddress || !requiredAmount) return false;
    
    const tokenKey = relevantToken.isNative ? 'NATIVE' : relevantToken.address;
    const balance = balances.get(tokenKey);
    
    return balance ? balance.balance >= requiredAmount : false;
  }, [userAddress, requiredAmount, relevantToken, balances]);

  // Check allowance sufficiency
  const hasSufficientAllowance = useMemo(() => {
    if (!userAddress || !requiredAmount || relevantToken.isNative) return true;
    
    const balance = balances.get(relevantToken.address);
    return balance ? balance.allowance >= requiredAmount : false;
  }, [userAddress, requiredAmount, relevantToken, balances]);

  // Validate on changes
  useEffect(() => {
    if (userAddress && requiredAmount > 0) {
      validateOrder(relevantToken.address, requiredAmount, relevantToken.isNative);
    }
  }, [userAddress, requiredAmount, relevantToken, validateOrder]);

  // Update price when market price changes
  useEffect(() => {
    if (orderType === OrderType.MARKET) {
      setPrice(currentPrice.toString());
    }
  }, [currentPrice, orderType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!userAddress) {
      setError('Please connect your wallet');
      return;
    }

    if (!hasSufficientBalance) {
      setError(`Insufficient ${relevantToken.symbol} balance`);
      return;
    }

    if (!hasSufficientAllowance) {
      setError(`Please approve ${relevantToken.symbol} for trading`);
      return;
    }

    setSubmitting(true);

    try {
      await onSubmit({
        pair,
        side,
        type: orderType,
        price: orderType === OrderType.LIMIT ? parseFloat(price) : undefined,
        quantity: parseFloat(quantity),
        timeInForce
      });

      // Reset form
      setQuantity('');
      if (orderType === OrderType.LIMIT) {
        setPrice(currentPrice.toString());
      }

      // Refresh balances after order
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit order');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTokenBalance = (token: TokenInfo) => {
    const key = token.isNative ? 'NATIVE' : token.address;
    const balance = balances.get(key);
    
    if (!balance) return '0';
    
    const formatted = ethers.formatUnits(balance.balance, balance.decimals);
    const value = parseFloat(formatted);
    
    return value > 1000000 
      ? `${(value / 1000000).toFixed(2)}M`
      : value > 1000
      ? `${(value / 1000).toFixed(2)}K`
      : value.toFixed(4);
  };

  const getBalanceStatus = () => {
    if (!userAddress) return null;
    if (loading) return 'loading';
    if (!requiredAmount || requiredAmount === BigInt(0)) return null;
    
    if (!hasSufficientBalance) return 'insufficient';
    if (!hasSufficientAllowance) return 'needs-approval';
    
    return 'sufficient';
  };

  const balanceStatus = getBalanceStatus();

  return (
    <div className="balance-aware-order-form">
      <div className="order-form-header">
        <h3>{pair} Order</h3>
        {currentPrice > 0 && (
          <span className="current-price">
            ${currentPrice.toFixed(2)}
          </span>
        )}
      </div>

      {/* Balance Display */}
      <div className="balance-section">
        <div className="balance-item">
          <span className="balance-label">{baseToken.symbol}:</span>
          <span className="balance-value">
            {loading ? '...' : formatTokenBalance(baseToken)}
          </span>
        </div>
        <div className="balance-item">
          <span className="balance-label">{quoteToken.symbol}:</span>
          <span className="balance-value">
            {loading ? '...' : formatTokenBalance(quoteToken)}
          </span>
        </div>
        <button 
          className="refresh-button"
          onClick={refresh}
          disabled={loading}
          title="Refresh balances"
        >
          ↻
        </button>
      </div>

      <form onSubmit={handleSubmit} className="order-form">
        {/* Side Selection */}
        <div className="form-group side-selector">
          <button
            type="button"
            className={`side-button buy ${side === OrderSide.BUY ? 'active' : ''}`}
            onClick={() => setSide(OrderSide.BUY)}
          >
            Buy {baseToken.symbol}
          </button>
          <button
            type="button"
            className={`side-button sell ${side === OrderSide.SELL ? 'active' : ''}`}
            onClick={() => setSide(OrderSide.SELL)}
          >
            Sell {baseToken.symbol}
          </button>
        </div>

        {/* Order Type */}
        <div className="form-group">
          <label>Order Type</label>
          <select
            value={orderType}
            onChange={(e) => setOrderType(e.target.value as OrderType)}
            className="form-control"
          >
            <option value={OrderType.LIMIT}>Limit</option>
            <option value={OrderType.MARKET}>Market</option>
          </select>
        </div>

        {/* Price (for limit orders) */}
        {orderType === OrderType.LIMIT && (
          <div className="form-group">
            <label>Price ({quoteToken.symbol})</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              step="0.01"
              min="0"
              required
              className="form-control"
              placeholder="0.00"
            />
          </div>
        )}

        {/* Quantity */}
        <div className="form-group">
          <label>Quantity ({baseToken.symbol})</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            step="0.0001"
            min="0"
            required
            className="form-control"
            placeholder="0.0000"
          />
          {quantity && (
            <div className="input-hint">
              ≈ {quoteToken.symbol} {
                (parseFloat(quantity) * (orderType === OrderType.LIMIT ? parseFloat(price) : currentPrice)).toFixed(2)
              }
            </div>
          )}
        </div>

        {/* Time in Force */}
        <div className="form-group">
          <label>Time in Force</label>
          <select
            value={timeInForce}
            onChange={(e) => setTimeInForce(e.target.value as TimeInForce)}
            className="form-control"
          >
            <option value="GTC">Good Till Cancel</option>
            <option value="IOC">Immediate or Cancel</option>
            <option value="FOK">Fill or Kill</option>
          </select>
        </div>

        {/* Balance Status */}
        {balanceStatus && (
          <div className={`balance-status ${balanceStatus}`}>
            {balanceStatus === 'loading' && (
              <span>Checking balance...</span>
            )}
            {balanceStatus === 'insufficient' && (
              <span className="error">
                Insufficient {relevantToken.symbol} balance. 
                Need: {ethers.formatUnits(requiredAmount, relevantToken.decimals)}
              </span>
            )}
            {balanceStatus === 'needs-approval' && (
              <span className="warning">
                {relevantToken.symbol} approval needed for settlement contract
              </span>
            )}
            {balanceStatus === 'sufficient' && (
              <span className="success">
                ✓ Sufficient balance
              </span>
            )}
          </div>
        )}

        {/* Validation Messages */}
        {validation && validation.errors.length > 0 && (
          <div className="validation-errors">
            {validation.errors.map((err, idx) => (
              <div key={idx} className="error-message">{err}</div>
            ))}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="error-message">{error}</div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={
            submitting || 
            loading || 
            !userAddress ||
            !quantity ||
            (orderType === OrderType.LIMIT && !price) ||
            balanceStatus === 'insufficient' ||
            balanceStatus === 'needs-approval'
          }
          className={`submit-button ${side === OrderSide.BUY ? 'buy' : 'sell'}`}
        >
          {submitting ? (
            'Submitting...'
          ) : !userAddress ? (
            'Connect Wallet'
          ) : balanceStatus === 'insufficient' ? (
            `Insufficient ${relevantToken.symbol}`
          ) : balanceStatus === 'needs-approval' ? (
            `Approve ${relevantToken.symbol}`
          ) : (
            `${side === OrderSide.BUY ? 'Buy' : 'Sell'} ${baseToken.symbol}`
          )}
        </button>
      </form>

      {/* Order Summary */}
      {quantity && parseFloat(quantity) > 0 && (
        <div className="order-summary">
          <h4>Order Summary</h4>
          <div className="summary-item">
            <span>Type:</span>
            <span>{orderType}</span>
          </div>
          <div className="summary-item">
            <span>Side:</span>
            <span className={side === OrderSide.BUY ? 'buy' : 'sell'}>
              {side === OrderSide.BUY ? 'Buy' : 'Sell'}
            </span>
          </div>
          <div className="summary-item">
            <span>Quantity:</span>
            <span>{quantity} {baseToken.symbol}</span>
          </div>
          {orderType === OrderType.LIMIT && (
            <div className="summary-item">
              <span>Price:</span>
              <span>{price} {quoteToken.symbol}</span>
            </div>
          )}
          <div className="summary-item total">
            <span>Total:</span>
            <span>
              {(parseFloat(quantity) * (orderType === OrderType.LIMIT ? parseFloat(price) : currentPrice)).toFixed(2)} {quoteToken.symbol}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};