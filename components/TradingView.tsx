import React, { useState } from 'react';
import { OrderBook } from './OrderBook';
import { TradeHistory } from './TradeHistory';
import { UserOrders } from './UserOrders';
import { MarketStats } from './MarketStats';
import { WebSocketProvider } from '../src/providers/WebSocketProvider';

export interface TradingViewProps {
  pair: string;
  onPairChange?: (pair: string) => void;
  availablePairs?: string[];
}

export const TradingView: React.FC<TradingViewProps> = ({
  pair,
  onPairChange,
  availablePairs = ['ETH/USDC', 'BTC/USDC', 'MATIC/USDC']
}) => {
  const [selectedTab, setSelectedTab] = useState<'orderbook' | 'trades'>('orderbook');

  return (
    <WebSocketProvider>
      <div className="trading-view">
        {/* Header with pair selector and market stats */}
        <div className="trading-header mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <select
                value={pair}
                onChange={(e) => onPairChange?.(e.target.value)}
                className="px-4 py-2 border rounded-lg font-medium"
              >
                {availablePairs.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          
          <MarketStats pair={pair} />
        </div>

        {/* Main trading interface */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Order Book / Trade History */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="tabs flex gap-4 mb-4 border-b">
                <button
                  className={`tab pb-2 px-1 ${
                    selectedTab === 'orderbook'
                      ? 'border-b-2 border-blue-500 font-medium'
                      : 'text-gray-600'
                  }`}
                  onClick={() => setSelectedTab('orderbook')}
                >
                  Order Book
                </button>
                <button
                  className={`tab pb-2 px-1 ${
                    selectedTab === 'trades'
                      ? 'border-b-2 border-blue-500 font-medium'
                      : 'text-gray-600'
                  }`}
                  onClick={() => setSelectedTab('trades')}
                >
                  Recent Trades
                </button>
              </div>

              {selectedTab === 'orderbook' ? (
                <OrderBook pair={pair} depth={20} />
              ) : (
                <TradeHistory pair={pair} limit={50} />
              )}
            </div>
          </div>

          {/* Middle column - Chart (placeholder) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-4 h-96">
              <h3 className="text-lg font-semibold mb-4">Price Chart</h3>
              <div className="h-full flex items-center justify-center text-gray-500">
                Chart component would go here
              </div>
            </div>
          </div>

          {/* Right column - Trading Form (placeholder) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow p-4 mb-4">
              <h3 className="text-lg font-semibold mb-4">Place Order</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
                    Buy
                  </button>
                  <button className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
                    Sell
                  </button>
                </div>
                <input
                  type="number"
                  placeholder="Price"
                  className="w-full px-3 py-2 border rounded"
                />
                <input
                  type="number"
                  placeholder="Amount"
                  className="w-full px-3 py-2 border rounded"
                />
                <button className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                  Place Order
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom section - User Orders */}
        <div className="mt-6">
          <div className="bg-white rounded-lg shadow p-4">
            <UserOrders />
          </div>
        </div>
      </div>
    </WebSocketProvider>
  );
};