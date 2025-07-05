import { useEffect, useState, useRef } from 'react';
import { useWebSocket } from './useWebSocket';
import { Trade } from '../services/matchingEngine/types';

export interface UseTradesOptions {
  pair: string;
  limit?: number;
}

export const useTrades = ({ pair, limit = 50 }: UseTradesOptions) => {
  const { subscribe, on, state: wsState } = useWebSocket();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const tradesRef = useRef<Trade[]>([]);

  useEffect(() => {
    if (!wsState.connected || !pair) return;

    setLoading(true);
    setError(null);

    const channel = `trades:${pair}`;
    const unsubscribe = subscribe(channel);

    // Handle recent trades
    const unsubRecent = on('trades:recent', (data: any) => {
      if (data.channel === channel) {
        const recentTrades: Trade[] = data.data;
        tradesRef.current = recentTrades;
        setTrades(recentTrades.slice(0, limit));
        setLoading(false);
      }
    });

    // Handle new trades
    const unsubNew = on('trade', (data: any) => {
      if (data.channel === channel) {
        const newTrade: Trade = data.data;
        
        // Add to beginning of array
        tradesRef.current = [newTrade, ...tradesRef.current].slice(0, limit * 2);
        setTrades(tradesRef.current.slice(0, limit));
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
      unsubRecent();
      unsubNew();
      unsubError();
    };
  }, [pair, limit, wsState.connected, subscribe, on]);

  // Calculate volume
  const volume24h = trades.reduce((sum, trade) => {
    const tradeTime = new Date(trade.timestamp).getTime();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return tradeTime > dayAgo ? sum + parseFloat(trade.quantity) : sum;
  }, 0);

  return {
    trades,
    loading,
    error,
    volume24h,
    connected: wsState.connected
  };
};