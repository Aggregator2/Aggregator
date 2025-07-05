import { useEffect, useRef, useState, useCallback } from 'react';
import { WebSocketClient, ConnectionState, createWebSocketClient } from '../services/websocket/WebSocketClient';

export interface WebSocketHookConfig {
  url?: string;
  authToken?: string;
  autoConnect?: boolean;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onError?: (error: any) => void;
  onAuthenticated?: (data: any) => void;
}

export interface WebSocketHookReturn {
  // Connection state
  isConnected: boolean;
  connectionState: ConnectionState;
  latency: number;
  
  // Connection methods
  connect: () => void;
  disconnect: () => void;
  
  // Subscription methods
  subscribeOrderBook: (pair: string, callback?: (data: any) => void) => void;
  unsubscribeOrderBook: (pair: string) => void;
  subscribeTrades: (pair: string, callback?: (data: any) => void) => void;
  unsubscribeTrades: (pair: string) => void;
  subscribeTicker: (pair: string, callback?: (data: any) => void) => void;
  unsubscribeTicker: (pair: string) => void;
  subscribeMarketData: (pair: string, callback?: (data: any) => void) => void;
  unsubscribeMarketData: (pair: string) => void;
  subscribeUserOrders: (callback?: (data: any) => void) => void;
  unsubscribeUserOrders: () => void;
  subscribeUserTrades: (callback?: (data: any) => void) => void;
  unsubscribeUserTrades: () => void;
  
  // Request methods
  requestOrderBookSnapshot: (pair: string) => Promise<any>;
  requestRecentTrades: (pair: string, limit?: number) => Promise<any>;
  requestUserOrders: (pair?: string) => Promise<any>;
  requestUserTrades: (pair?: string, limit?: number) => Promise<any>;
  requestMarketData: (pair: string) => Promise<any>;
  
  // Event handling
  on: (event: string, handler: (data: any) => void) => void;
  off: (event: string, handler: (data: any) => void) => void;
  
  // Client instance (for advanced usage)
  client: WebSocketClient | null;
}

export function useEnhancedWebSocket(config: WebSocketHookConfig = {}): WebSocketHookReturn {
  const clientRef = useRef<WebSocketClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [latency, setLatency] = useState(0);

  // Initialize WebSocket client
  useEffect(() => {
    const wsUrl = config.url || process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
    
    const client = createWebSocketClient({
      url: wsUrl,
      authToken: config.authToken,
      autoConnect: config.autoConnect !== false
    });

    clientRef.current = client;

    // Set up event listeners
    client.on('connected', () => {
      setIsConnected(true);
      config.onConnected?.();
    });

    client.on('disconnected', (reason) => {
      setIsConnected(false);
      config.onDisconnected?.(reason);
    });

    client.on('stateChange', (state) => {
      setConnectionState(state);
    });

    client.on('heartbeat', (data) => {
      setLatency(data.latency);
    });

    client.on('error', (error) => {
      config.onError?.(error);
    });

    client.on('authenticated', (data) => {
      config.onAuthenticated?.(data);
    });

    // Cleanup
    return () => {
      client.disconnect();
    };
  }, [config.url, config.authToken]);

  // Connection methods
  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  // Subscription methods
  const subscribeOrderBook = useCallback((pair: string, callback?: (data: any) => void) => {
    clientRef.current?.subscribeOrderBook(pair, callback);
  }, []);

  const unsubscribeOrderBook = useCallback((pair: string) => {
    clientRef.current?.unsubscribe('orderbook', { pair });
  }, []);

  const subscribeTrades = useCallback((pair: string, callback?: (data: any) => void) => {
    clientRef.current?.subscribeTrades(pair, callback);
  }, []);

  const unsubscribeTrades = useCallback((pair: string) => {
    clientRef.current?.unsubscribe('trades', { pair });
  }, []);

  const subscribeTicker = useCallback((pair: string, callback?: (data: any) => void) => {
    clientRef.current?.subscribeTicker(pair, callback);
  }, []);

  const unsubscribeTicker = useCallback((pair: string) => {
    clientRef.current?.unsubscribe('ticker', { pair });
  }, []);

  const subscribeMarketData = useCallback((pair: string, callback?: (data: any) => void) => {
    clientRef.current?.subscribeMarketData(pair, callback);
  }, []);

  const unsubscribeMarketData = useCallback((pair: string) => {
    clientRef.current?.unsubscribe('market', { pair });
  }, []);

  const subscribeUserOrders = useCallback((callback?: (data: any) => void) => {
    clientRef.current?.subscribeUserOrders(callback);
  }, []);

  const unsubscribeUserOrders = useCallback(() => {
    clientRef.current?.unsubscribe('orders');
  }, []);

  const subscribeUserTrades = useCallback((callback?: (data: any) => void) => {
    clientRef.current?.subscribeUserTrades(callback);
  }, []);

  const unsubscribeUserTrades = useCallback(() => {
    clientRef.current?.unsubscribe('user_trades');
  }, []);

  // Request methods
  const requestOrderBookSnapshot = useCallback((pair: string) => {
    return clientRef.current?.requestOrderBookSnapshot(pair) || Promise.reject(new Error('Not connected'));
  }, []);

  const requestRecentTrades = useCallback((pair: string, limit?: number) => {
    return clientRef.current?.requestRecentTrades(pair, limit) || Promise.reject(new Error('Not connected'));
  }, []);

  const requestUserOrders = useCallback((pair?: string) => {
    return clientRef.current?.requestUserOrders(pair) || Promise.reject(new Error('Not connected'));
  }, []);

  const requestUserTrades = useCallback((pair?: string, limit?: number) => {
    return clientRef.current?.requestUserTrades(pair, limit) || Promise.reject(new Error('Not connected'));
  }, []);

  const requestMarketData = useCallback((pair: string) => {
    return clientRef.current?.requestMarketData(pair) || Promise.reject(new Error('Not connected'));
  }, []);

  // Event handling
  const on = useCallback((event: string, handler: (data: any) => void) => {
    clientRef.current?.on(event, handler);
  }, []);

  const off = useCallback((event: string, handler: (data: any) => void) => {
    clientRef.current?.off(event, handler);
  }, []);

  return {
    // Connection state
    isConnected,
    connectionState,
    latency,
    
    // Connection methods
    connect,
    disconnect,
    
    // Subscription methods
    subscribeOrderBook,
    unsubscribeOrderBook,
    subscribeTrades,
    unsubscribeTrades,
    subscribeTicker,
    unsubscribeTicker,
    subscribeMarketData,
    unsubscribeMarketData,
    subscribeUserOrders,
    unsubscribeUserOrders,
    subscribeUserTrades,
    unsubscribeUserTrades,
    
    // Request methods
    requestOrderBookSnapshot,
    requestRecentTrades,
    requestUserOrders,
    requestUserTrades,
    requestMarketData,
    
    // Event handling
    on,
    off,
    
    // Client instance
    client: clientRef.current
  };
}

// Specialized hooks for specific use cases
export function useOrderBook(pair: string) {
  const [orderBook, setOrderBook] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const ws = useEnhancedWebSocket();

  useEffect(() => {
    if (!ws.isConnected || !pair) return;

    // Request initial snapshot
    ws.requestOrderBookSnapshot(pair)
      .then(data => {
        setOrderBook(data.snapshot);
        setLoading(false);
      })
      .catch(console.error);

    // Subscribe to updates
    const handleSnapshot = (data: any) => {
      if (data.pair === pair) {
        setOrderBook(data.snapshot);
      }
    };

    const handleUpdate = (data: any) => {
      if (data.pair === pair) {
        // Apply updates to order book
        // This would need implementation based on your update format
      }
    };

    ws.on('orderbook:snapshot', handleSnapshot);
    ws.on('orderbook:update', handleUpdate);
    ws.subscribeOrderBook(pair);

    return () => {
      ws.off('orderbook:snapshot', handleSnapshot);
      ws.off('orderbook:update', handleUpdate);
      ws.unsubscribeOrderBook(pair);
    };
  }, [pair, ws.isConnected]);

  return { orderBook, loading };
}

export function useTrades(pair: string, limit: number = 50) {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const ws = useEnhancedWebSocket();

  useEffect(() => {
    if (!ws.isConnected || !pair) return;

    // Request initial trades
    ws.requestRecentTrades(pair, limit)
      .then(data => {
        setTrades(data.trades);
        setLoading(false);
      })
      .catch(console.error);

    // Subscribe to new trades
    const handleNewTrades = (data: any) => {
      if (data.pair === pair) {
        setTrades(prev => [...data.trades, ...prev].slice(0, limit));
      }
    };

    ws.on('trades:new', handleNewTrades);
    ws.subscribeTrades(pair);

    return () => {
      ws.off('trades:new', handleNewTrades);
      ws.unsubscribeTrades(pair);
    };
  }, [pair, limit, ws.isConnected]);

  return { trades, loading };
}

export function useTicker(pair: string) {
  const [ticker, setTicker] = useState<any>(null);
  const ws = useEnhancedWebSocket();

  useEffect(() => {
    if (!ws.isConnected || !pair) return;

    // Request initial market data
    ws.requestMarketData(pair)
      .then(data => {
        setTicker(data.data);
      })
      .catch(console.error);

    // Subscribe to ticker updates
    const handleTickerUpdate = (data: any) => {
      if (data.pair === pair) {
        setTicker(data);
      }
    };

    ws.on('ticker:update', handleTickerUpdate);
    ws.subscribeTicker(pair);

    return () => {
      ws.off('ticker:update', handleTickerUpdate);
      ws.unsubscribeTicker(pair);
    };
  }, [pair, ws.isConnected]);

  return ticker;
}

export function useUserOrders() {
  const [openOrders, setOpenOrders] = useState<any[]>([]);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const ws = useEnhancedWebSocket();

  useEffect(() => {
    if (!ws.isConnected) return;

    // Request initial orders
    ws.requestUserOrders()
      .then(data => {
        setOpenOrders(data.openOrders || []);
        setOrderHistory(data.orderHistory || []);
        setLoading(false);
      })
      .catch(console.error);

    // Subscribe to order updates
    const handleOrderUpdate = (data: any) => {
      const { order } = data;
      
      // Update open orders
      setOpenOrders(prev => {
        const index = prev.findIndex(o => o.id === order.id);
        if (order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED') {
          if (index >= 0) {
            return [...prev.slice(0, index), order, ...prev.slice(index + 1)];
          } else {
            return [order, ...prev];
          }
        } else {
          // Remove from open orders if filled or cancelled
          return index >= 0 ? [...prev.slice(0, index), ...prev.slice(index + 1)] : prev;
        }
      });
      
      // Add to history
      setOrderHistory(prev => [order, ...prev.filter(o => o.id !== order.id)].slice(0, 100));
    };

    ws.on('order:update', handleOrderUpdate);
    ws.subscribeUserOrders();

    return () => {
      ws.off('order:update', handleOrderUpdate);
      ws.unsubscribeUserOrders();
    };
  }, [ws.isConnected]);

  return { openOrders, orderHistory, loading };
}