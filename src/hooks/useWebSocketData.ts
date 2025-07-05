import { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketClient, ConnectionState } from '../services/websocket/WebSocketClientManager';

export interface UseWebSocketConfig {
  url: string;
  token?: string;
  apiKey?: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  onConnected?: () => void;
  onDisconnected?: (reason: string) => void;
  onError?: (error: any) => void;
}

export interface UseWebSocketReturn {
  client: WebSocketClient | null;
  connectionState: ConnectionState;
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  subscribe: (
    channel: string,
    handler: (data: any) => void,
    options?: { pair?: string; userId?: string }
  ) => string | null;
  unsubscribe: (subscriptionId: string) => void;
}

export function useWebSocket(config: UseWebSocketConfig): UseWebSocketReturn {
  const [client, setClient] = useState<WebSocketClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.DISCONNECTED);
  const [isConnected, setIsConnected] = useState(false);
  
  const clientRef = useRef<WebSocketClient | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // Initialize client
  useEffect(() => {
    const wsClient = new WebSocketClient({
      url: config.url,
      token: config.token,
      apiKey: config.apiKey,
      reconnection: config.reconnection !== false
    });

    // Set up event handlers
    wsClient.on('connected', () => {
      setConnectionState(ConnectionState.CONNECTED);
      setIsConnected(true);
      configRef.current.onConnected?.();
    });

    wsClient.on('disconnected', (reason) => {
      setConnectionState(ConnectionState.DISCONNECTED);
      setIsConnected(false);
      configRef.current.onDisconnected?.(reason);
    });

    wsClient.on('stateChange', ({ newState }) => {
      setConnectionState(newState);
      setIsConnected(newState === ConnectionState.CONNECTED);
    });

    wsClient.on('error', (error) => {
      configRef.current.onError?.(error);
    });

    clientRef.current = wsClient;
    setClient(wsClient);

    // Auto-connect if enabled
    if (config.autoConnect !== false) {
      wsClient.connect();
    }

    // Cleanup
    return () => {
      wsClient.disconnect();
      clientRef.current = null;
    };
  }, [config.url]); // Only recreate if URL changes

  // Connect method
  const connect = useCallback(() => {
    clientRef.current?.connect();
  }, []);

  // Disconnect method
  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
  }, []);

  // Subscribe method
  const subscribe = useCallback((
    channel: string,
    handler: (data: any) => void,
    options?: { pair?: string; userId?: string }
  ): string | null => {
    if (!clientRef.current) return null;
    return clientRef.current.subscribe(channel, handler, options);
  }, []);

  // Unsubscribe method
  const unsubscribe = useCallback((subscriptionId: string) => {
    clientRef.current?.unsubscribe(subscriptionId);
  }, []);

  return {
    client,
    connectionState,
    isConnected,
    connect,
    disconnect,
    subscribe,
    unsubscribe
  };
}

// Hook for order book subscription
export function useOrderBook(pair: string, wsConfig: UseWebSocketConfig) {
  const [orderBook, setOrderBook] = useState<{
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
    lastUpdateId: number;
  } | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { subscribe, unsubscribe, isConnected } = useWebSocket(wsConfig);
  const subscriptionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !pair) return;

    setLoading(true);
    setError(null);

    // Subscribe to order book updates
    subscriptionRef.current = subscribe(
      'orderbook',
      (message) => {
        if (message.type === 'snapshot' || message.type === 'update') {
          setOrderBook(message.data);
          setLoading(false);
        } else if (message.type === 'error') {
          setError(message.data.message || 'Order book error');
          setLoading(false);
        }
      },
      { pair }
    );

    // Cleanup
    return () => {
      if (subscriptionRef.current) {
        unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [pair, isConnected, subscribe, unsubscribe]);

  return { orderBook, loading, error };
}

// Hook for trades subscription
export function useTrades(pair: string, wsConfig: UseWebSocketConfig) {
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { subscribe, unsubscribe, isConnected } = useWebSocket(wsConfig);
  const subscriptionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !pair) return;

    setLoading(true);

    // Subscribe to trade updates
    subscriptionRef.current = subscribe(
      'trades',
      (message) => {
        if (message.type === 'snapshot') {
          setTrades(message.data);
          setLoading(false);
        } else if (message.type === 'trade') {
          setTrades(prevTrades => [message.data, ...prevTrades].slice(0, 100));
        }
      },
      { pair }
    );

    // Cleanup
    return () => {
      if (subscriptionRef.current) {
        unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [pair, isConnected, subscribe, unsubscribe]);

  return { trades, loading };
}

// Hook for user orders subscription
export function useUserOrders(userId: string | undefined, wsConfig: UseWebSocketConfig) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const { subscribe, unsubscribe, isConnected } = useWebSocket(wsConfig);
  const subscriptionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected || !userId) return;

    setLoading(true);

    // Subscribe to order updates
    subscriptionRef.current = subscribe(
      'orders',
      (message) => {
        if (message.type === 'snapshot') {
          setOrders(message.data);
          setLoading(false);
        } else if (message.type === 'update') {
          setOrders(prevOrders => {
            const updatedOrders = [...prevOrders];
            const index = updatedOrders.findIndex(o => o.orderId === message.data.orderId);
            
            if (index >= 0) {
              updatedOrders[index] = { ...updatedOrders[index], ...message.data };
            } else if (message.data.event === 'NEW') {
              updatedOrders.unshift(message.data);
            }
            
            return updatedOrders;
          });
        }
      },
      { userId }
    );

    // Cleanup
    return () => {
      if (subscriptionRef.current) {
        unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [userId, isConnected, subscribe, unsubscribe]);

  return { orders, loading };
}

// Hook for ticker subscription
export function useTicker(pair: string | 'all', wsConfig: UseWebSocketConfig) {
  const [tickers, setTickers] = useState<any>(pair === 'all' ? {} : null);
  const [loading, setLoading] = useState(true);
  
  const { subscribe, unsubscribe, isConnected } = useWebSocket(wsConfig);
  const subscriptionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isConnected) return;

    setLoading(true);

    // Subscribe to ticker updates
    subscriptionRef.current = subscribe(
      'tickers',
      (message) => {
        if (message.type === 'snapshot') {
          if (pair === 'all') {
            const tickerMap = {};
            message.data.forEach((ticker: any) => {
              tickerMap[ticker.pair] = ticker;
            });
            setTickers(tickerMap);
          } else {
            setTickers(message.data);
          }
          setLoading(false);
        } else if (message.type === 'update') {
          if (pair === 'all') {
            setTickers((prev: any) => ({
              ...prev,
              [message.data.pair]: message.data
            }));
          } else if (message.data.pair === pair) {
            setTickers(message.data);
          }
        }
      },
      pair !== 'all' ? { pair } : undefined
    );

    // Cleanup
    return () => {
      if (subscriptionRef.current) {
        unsubscribe(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [pair, isConnected, subscribe, unsubscribe]);

  return { tickers: pair === 'all' ? tickers : { [pair]: tickers }, loading };
}