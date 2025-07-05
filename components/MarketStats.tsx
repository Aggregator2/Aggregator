import React from 'react';
import { useMarketData } from '../src/hooks/useMarketData';
import { formatNumber, formatPercent, formatCurrency } from '../src/utils/format';

export interface MarketStatsProps {
  pair: string;
  showFullStats?: boolean;
  className?: string;
}

export const MarketStats: React.FC<MarketStatsProps> = ({
  pair,
  showFullStats = true,
  className = ''
}) => {
  const { marketData, ticker, loading, error, connected } = useMarketData({ pair });

  if (loading) {
    return (
      <div className={`market-stats-loading ${className}`}>
        <div className="animate-pulse flex gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-6 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !marketData) {
    return (
      <div className={`market-stats-error ${className}`}>
        <div className="text-red-600 text-center p-4">
          <p>Failed to load market data</p>
        </div>
      </div>
    );
  }

  const priceChangePercent = ticker?.priceChangePercent24h || 0;
  const priceChange = ticker?.priceChange24h || 0;
  const isPositive = priceChange >= 0;

  return (
    <div className={`market-stats ${className}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Last Price */}
        <div className="stat-item">
          <div className="text-xs text-gray-600 mb-1">Last Price</div>
          <div className="text-xl font-bold">
            {formatCurrency(marketData.lastPrice)}
          </div>
          <div className={`text-sm ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? '+' : ''}{formatCurrency(priceChange)} ({formatPercent(priceChangePercent)})
          </div>
        </div>

        {/* 24h Volume */}
        <div className="stat-item">
          <div className="text-xs text-gray-600 mb-1">24h Volume</div>
          <div className="text-lg font-semibold">
            {formatNumber(marketData.volume24h, 2)}
          </div>
        </div>

        {/* Bid/Ask */}
        <div className="stat-item">
          <div className="text-xs text-gray-600 mb-1">Bid/Ask</div>
          <div className="text-sm">
            <span className="text-green-600">{formatCurrency(marketData.bidPrice)}</span>
            <span className="mx-1">/</span>
            <span className="text-red-600">{formatCurrency(marketData.askPrice)}</span>
          </div>
          <div className="text-xs text-gray-500">
            Spread: {formatCurrency(marketData.askPrice - marketData.bidPrice)}
          </div>
        </div>

        {/* 24h Range */}
        <div className="stat-item">
          <div className="text-xs text-gray-600 mb-1">24h Range</div>
          <div className="text-sm">
            {formatCurrency(marketData.low24h)} - {formatCurrency(marketData.high24h)}
          </div>
          <div className="relative mt-1">
            <div className="h-1 bg-gray-200 rounded">
              <div
                className="absolute h-1 bg-blue-500 rounded"
                style={{
                  left: `${((marketData.lastPrice - marketData.low24h) / (marketData.high24h - marketData.low24h)) * 100}%`,
                  width: '2px'
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {showFullStats && ticker && (
        <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Open: </span>
            <span className="font-medium">{formatCurrency(marketData.openPrice24h)}</span>
          </div>
          <div>
            <span className="text-gray-600">Bid Size: </span>
            <span className="font-medium">{formatNumber(marketData.bidQuantity, 4)}</span>
          </div>
          <div>
            <span className="text-gray-600">Ask Size: </span>
            <span className="font-medium">{formatNumber(marketData.askQuantity, 4)}</span>
          </div>
          <div>
            <span className="text-gray-600">Last Update: </span>
            <span className="font-medium">
              {new Date(marketData.lastUpdateTime).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {!connected && (
        <div className="mt-2 text-xs text-yellow-600 text-center">
          Real-time updates paused - Reconnecting...
        </div>
      )}
    </div>
  );
};