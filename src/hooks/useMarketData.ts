import { useEffect, useState } from 'react';
import { useWebSocket } from './useWebSocket';
import { MarketData } from '../services/matchingEngine/types';

export interface Ticker {
  pair: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
}

export interface UseMarketDataOptions {
  pair: string;
}

export const useMarketData = ({ pair }: UseMarketDataOptions) => {
  const { subscribe, on, state: wsState } = useWebSocket();
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wsState.connected || !pair) return;

    setLoading(true);
    setError(null);

    const marketChannel = `market:${pair}`;
    const tickerChannel = `ticker:${pair}`;
    
    const unsubMarket = subscribe(marketChannel);
    const unsubTicker = subscribe(tickerChannel);

    // Handle market data updates
    const unsubMarketUpdate = on('market:update', (data: any) => {
      if (data.channel === marketChannel) {
        setMarketData(data.data);
        setLoading(false);
      }
    });

    // Handle ticker updates
    const unsubTickerUpdate = on('ticker', (data: any) => {
      if (data.channel === tickerChannel) {
        setTicker(data.data);
      }
    });

    // Handle errors
    const unsubError = on('subscription:error', (data: any) => {
      if (data.channel === marketChannel || data.channel === tickerChannel) {
        setError(data.error);
        setLoading(false);
      }
    });

    return () => {
      unsubMarket();
      unsubTicker();
      unsubMarketUpdate();
      unsubTickerUpdate();
      unsubError();
    };
  }, [pair, wsState.connected, subscribe, on]);

  return {
    marketData,
    ticker,
    loading,
    error,
    connected: wsState.connected
  };
};