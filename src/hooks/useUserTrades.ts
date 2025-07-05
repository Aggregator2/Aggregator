import { useEffect, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { Trade } from '../services/matchingEngine/types';

export interface UseUserTradesOptions {
  limit?: number;
  pair?: string;
}

export const useUserTrades = ({ limit = 100, pair }: UseUserTradesOptions = {}) => {
  const { subscribe, on, state: wsState } = useWebSocket();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter trades by pair if specified
  const filteredTrades = pair 
    ? trades.filter(trade => trade.pair === pair)
    : trades;

  useEffect(() => {
    if (!wsState.connected || !wsState.authenticated) return;

    setLoading(true);
    setError(null);

    const channel = 'user_trades';
    const unsubscribe = subscribe(channel, { limit });

    // Handle initial trades
    const unsubTrades = on('user:trades', (data: any) => {
      if (data.channel === channel) {
        setTrades(data.data);
        setLoading(false);
      }
    });

    // Handle new trades
    const unsubNewTrade = on('user:trade', (data: any) => {
      if (data.channel === channel) {
        const newTrade: Trade = data.data;
        
        setTrades(prevTrades => {
          // Add to beginning and maintain limit
          return [newTrade, ...prevTrades].slice(0, limit);
        });
      }
    });

    // Handle errors
    const unsubError = on('subscription:error', (data: any) => {
      if (data.channel === channel) {
        setError(data.error);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      unsubTrades();
      unsubNewTrade();
      unsubError();
    };
  }, [limit, wsState.connected, wsState.authenticated, subscribe, on]);

  // Calculate statistics
  const stats = filteredTrades.reduce((acc, trade) => {
    const value = parseFloat(trade.price) * parseFloat(trade.quantity);
    
    return {
      totalTrades: acc.totalTrades + 1,
      totalVolume: acc.totalVolume + parseFloat(trade.quantity),
      totalValue: acc.totalValue + value,
      fees: acc.fees + (parseFloat(trade.fee || '0'))
    };
  }, {
    totalTrades: 0,
    totalVolume: 0,
    totalValue: 0,
    fees: 0
  });

  // Group trades by pair
  const tradesByPair = trades.reduce((acc, trade) => {
    if (!acc[trade.pair]) {
      acc[trade.pair] = [];
    }
    acc[trade.pair].push(trade);
    return acc;
  }, {} as Record<string, Trade[]>);

  return {
    trades: filteredTrades,
    allTrades: trades,
    tradesByPair,
    stats,
    loading,
    error,
    connected: wsState.connected,
    authenticated: wsState.authenticated
  };
};