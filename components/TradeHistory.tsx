import React from 'react';
import { useTrades } from '../src/hooks/useTrades';
import { formatNumber, formatTime } from '../src/utils/format';

export interface TradeHistoryProps {
  pair: string;
  limit?: number;
  showVolume?: boolean;
  className?: string;
}

export const TradeHistory: React.FC<TradeHistoryProps> = ({
  pair,
  limit = 50,
  showVolume = true,
  className = ''
}) => {
  const { trades, loading, error, volume24h, connected } = useTrades({ pair, limit });

  if (loading) {
    return (
      <div className={`trade-history-loading ${className}`}>
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
      <div className={`trade-history-error ${className}`}>
        <div className="text-red-600 text-center p-4">
          <p>Failed to load trades</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`trade-history ${className}`}>
      <div className="trade-history-header mb-4">
        <h3 className="text-lg font-semibold">Recent Trades</h3>
        {showVolume && (
          <div className="text-sm text-gray-600">
            24h Volume: {formatNumber(volume24h, 4)}
          </div>
        )}
      </div>

      <div className="trade-history-content">
        {/* Headers */}
        <div className="trade-history-headers grid grid-cols-4 text-xs text-gray-600 mb-2 px-2">
          <div className="text-left">Time</div>
          <div className="text-left">Side</div>
          <div className="text-right">Price</div>
          <div className="text-right">Amount</div>
        </div>

        {/* Trades */}
        <div className="trade-history-list max-h-96 overflow-y-auto">
          {trades.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              No trades yet
            </div>
          ) : (
            trades.map((trade, index) => (
              <div
                key={`${trade.id}-${index}`}
                className={`trade-row grid grid-cols-4 px-2 py-1 hover:bg-gray-50 ${
                  index === 0 ? 'trade-new' : ''
                }`}
              >
                <div className="text-xs text-gray-600">
                  {formatTime(trade.timestamp)}
                </div>
                <div className={`text-sm font-medium ${
                  trade.side === 'BUY' ? 'text-green-600' : 'text-red-600'
                }`}>
                  {trade.side}
                </div>
                <div className="text-right">
                  {formatNumber(trade.price, 2)}
                </div>
                <div className="text-right text-gray-700">
                  {formatNumber(trade.quantity, 4)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .trade-new {
          animation: highlight 1s ease-out;
        }
        
        @keyframes highlight {
          0% {
            background-color: #fef3c7;
          }
          100% {
            background-color: transparent;
          }
        }
      `}</style>
    </div>
  );
};