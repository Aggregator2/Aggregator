import React, { useMemo } from 'react';
import { useOrderBook } from '../src/hooks/useOrderBook';
import { formatNumber } from '../src/utils/format';

export interface OrderBookProps {
  pair: string;
  depth?: number;
  showSpread?: boolean;
  className?: string;
}

export const OrderBook: React.FC<OrderBookProps> = ({
  pair,
  depth = 20,
  showSpread = true,
  className = ''
}) => {
  const { orderBook, loading, error, spread, midPrice, connected } = useOrderBook({ pair, depth });

  // Calculate cumulative volumes
  const { bidsWithCumulative, asksWithCumulative, maxCumulative } = useMemo(() => {
    let bidCumulative = 0;
    const bidsWithCum = orderBook.bids.map(([price, quantity]) => {
      bidCumulative += quantity;
      return { price, quantity, cumulative: bidCumulative };
    });

    let askCumulative = 0;
    const asksWithCum = orderBook.asks.map(([price, quantity]) => {
      askCumulative += quantity;
      return { price, quantity, cumulative: askCumulative };
    });

    const maxCum = Math.max(bidCumulative, askCumulative);

    return {
      bidsWithCumulative: bidsWithCum,
      asksWithCumulative: asksWithCum,
      maxCumulative: maxCum
    };
  }, [orderBook]);

  if (loading) {
    return (
      <div className={`order-book-loading ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="space-y-1">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-6 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`order-book-error ${className}`}>
        <div className="text-red-600 text-center p-4">
          <p>Failed to load order book</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className={`order-book-disconnected ${className}`}>
        <div className="text-yellow-600 text-center p-4">
          <p>Disconnected from market data</p>
          <p className="text-sm">Attempting to reconnect...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`order-book ${className}`}>
      <div className="order-book-header mb-4">
        <h3 className="text-lg font-semibold">Order Book</h3>
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`}></span>
          <span>Last update: {new Date(orderBook.lastUpdate).toLocaleTimeString()}</span>
        </div>
      </div>

      <div className="order-book-content">
        {/* Headers */}
        <div className="order-book-headers grid grid-cols-3 text-xs text-gray-600 mb-2 px-2">
          <div className="text-left">Price</div>
          <div className="text-right">Amount</div>
          <div className="text-right">Total</div>
        </div>

        {/* Asks (reversed for display) */}
        <div className="order-book-asks mb-2">
          {asksWithCumulative.slice().reverse().map((ask, index) => (
            <div
              key={`ask-${ask.price}-${index}`}
              className="order-book-row ask grid grid-cols-3 px-2 py-1 relative hover:bg-red-50"
            >
              <div
                className="depth-bar ask-bar"
                style={{
                  width: `${(ask.cumulative / maxCumulative) * 100}%`
                }}
              />
              <div className="text-red-600 z-10">{formatNumber(ask.price, 2)}</div>
              <div className="text-right z-10">{formatNumber(ask.quantity, 4)}</div>
              <div className="text-right z-10">{formatNumber(ask.cumulative, 4)}</div>
            </div>
          ))}
        </div>

        {/* Spread */}
        {showSpread && spread > 0 && (
          <div className="order-book-spread py-2 px-2 bg-gray-100 text-center">
            <div className="text-sm">
              <span className="text-gray-600">Spread: </span>
              <span className="font-medium">{formatNumber(spread, 2)}</span>
              <span className="text-gray-600 ml-2">
                ({formatNumber((spread / midPrice) * 100, 2)}%)
              </span>
            </div>
            <div className="text-xs text-gray-600">
              Mid: {formatNumber(midPrice, 2)}
            </div>
          </div>
        )}

        {/* Bids */}
        <div className="order-book-bids mt-2">
          {bidsWithCumulative.map((bid, index) => (
            <div
              key={`bid-${bid.price}-${index}`}
              className="order-book-row bid grid grid-cols-3 px-2 py-1 relative hover:bg-green-50"
            >
              <div
                className="depth-bar bid-bar"
                style={{
                  width: `${(bid.cumulative / maxCumulative) * 100}%`
                }}
              />
              <div className="text-green-600 z-10">{formatNumber(bid.price, 2)}</div>
              <div className="text-right z-10">{formatNumber(bid.quantity, 4)}</div>
              <div className="text-right z-10">{formatNumber(bid.cumulative, 4)}</div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        
        .status-indicator.connected {
          background-color: #10b981;
        }
        
        .status-indicator.disconnected {
          background-color: #ef4444;
        }
        
        .depth-bar {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          opacity: 0.2;
        }
        
        .ask-bar {
          background-color: #ef4444;
        }
        
        .bid-bar {
          background-color: #10b981;
        }
      `}</style>
    </div>
  );
};