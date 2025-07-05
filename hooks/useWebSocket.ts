import { useEffect, useRef, useCallback, useState } from 'react';
import io, { Socket } from 'socket.io-client';

interface WebSocketOptions {
  userId?: string;
  autoConnect?: boolean;
  reconnectionDelay?: number;
  reconnectionAttempts?: number;
}

interface WebSocketState {
  connected: boolean;
  error: Error | null;
  lastUpdate: number;
}

export function useWebSocket(options: WebSocketOptions = {}) {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    error: null,
    lastUpdate: Date.now()
  });

  const socketRef = useRef<Socket | null>(null);
  const subscriptionsRef = useRef({
    orderBook: new Set<string>(),
    trades: new Set<string>(),
    market: new Set<string>(),
    orders: false
  });

  // Initialize connection
  useEffect(() => {
    if (!options.autoConnect && options.autoConnect !== undefined) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:3001';
    
    socketRef.current = io(wsUrl, {
      reconnectionDelay: options.reconnectionDelay || 1000,
      reconnectionAttempts: options.reconnectionAttempts || 5,
      transports: ['websocket', 'polling']
    });

    const socket = socketRef.current;

    // Connection handlers
    socket.on('connect', () => {
      console.log('WebSocket connected');
      setState(prev => ({ ...prev, connected: true, error: null }));

      // Authenticate if userId provided
      if (options.userId) {
        socket.emit('auth', { userId: options.userId });
      }

      // Restore subscriptions
      const subs = subscriptionsRef.current;
      if (subs.orderBook.size > 0) {
        socket.emit('subscribe:orderbook', Array.from(subs.orderBook));
      }
      if (subs.trades.size > 0) {
        socket.emit('subscribe:trades', Array.from(subs.trades));
      }
      if (subs.market.size > 0) {
        socket.emit('subscribe:market', Array.from(subs.market));
      }
      if (subs.orders) {
        socket.emit('subscribe:orders');
      }
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
      setState(prev => ({ ...prev, connected: false }));
    });

    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      setState(prev => ({ ...prev, error: new Error(error.message || 'WebSocket error') }));
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
      setState(prev => ({ ...prev, error: new Error('Failed to connect to WebSocket server') }));
    });

    // Cleanup
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [options.userId, options.autoConnect, options.reconnectionDelay, options.reconnectionAttempts]);

  // Subscribe to order book
  const subscribeOrderBook = useCallback((pairs: string[], callback: (data: any) => void) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    // Track subscriptions
    pairs.forEach(pair => subscriptionsRef.current.orderBook.add(pair));
    
    // Subscribe
    socket.emit('subscribe:orderbook', pairs);

    // Listen for updates
    socket.on('orderbook:snapshot', callback);
    socket.on('orderbook:update', callback);

    // Return unsubscribe function
    return () => {
      pairs.forEach(pair => subscriptionsRef.current.orderBook.delete(pair));
      socket.emit('unsubscribe:orderbook', pairs);
      socket.off('orderbook:snapshot', callback);
      socket.off('orderbook:update', callback);
    };
  }, []);

  // Subscribe to trades
  const subscribeTrades = useCallback((pairs: string[], callback: (data: any) => void) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    // Track subscriptions
    pairs.forEach(pair => subscriptionsRef.current.trades.add(pair));
    
    // Subscribe
    socket.emit('subscribe:trades', pairs);

    // Listen for updates
    socket.on('trades:history', callback);
    socket.on('trade:new', callback);

    // Return unsubscribe function
    return () => {
      pairs.forEach(pair => subscriptionsRef.current.trades.delete(pair));
      socket.emit('unsubscribe:trades', pairs);
      socket.off('trades:history', callback);
      socket.off('trade:new', callback);
    };
  }, []);

  // Subscribe to market data
  const subscribeMarket = useCallback((pairs: string[], callback: (data: any) => void) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    // Track subscriptions
    pairs.forEach(pair => subscriptionsRef.current.market.add(pair));
    
    // Subscribe
    socket.emit('subscribe:market', pairs);

    // Listen for updates
    socket.on('market:snapshot', callback);
    socket.on('market:update', callback);

    // Return unsubscribe function
    return () => {
      pairs.forEach(pair => subscriptionsRef.current.market.delete(pair));
      socket.emit('unsubscribe:market', pairs);
      socket.off('market:snapshot', callback);
      socket.off('market:update', callback);
    };
  }, []);

  // Subscribe to user orders
  const subscribeOrders = useCallback((callback: (data: any) => void) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    // Track subscription
    subscriptionsRef.current.orders = true;
    
    // Subscribe
    socket.emit('subscribe:orders');

    // Listen for updates
    socket.on('orders:snapshot', callback);
    socket.on('order:submitted', callback);
    socket.on('order:filled', callback);
    socket.on('order:cancelled', callback);
    socket.on('execution:report', callback);

    // Return unsubscribe function
    return () => {
      subscriptionsRef.current.orders = false;
      socket.off('orders:snapshot', callback);
      socket.off('order:submitted', callback);
      socket.off('order:filled', callback);
      socket.off('order:cancelled', callback);
      socket.off('execution:report', callback);
    };
  }, []);

  // Send ping to check connection
  const ping = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    socket.emit('ping');
    socket.once('pong', (data: { timestamp: number }) => {
      const latency = Date.now() - data.timestamp;
      console.log(`WebSocket latency: ${latency}ms`);
    });
  }, []);

  return {
    connected: state.connected,
    error: state.error,
    subscribeOrderBook,
    subscribeTrades,
    subscribeMarket,
    subscribeOrders,
    ping
  };
}

// Hook for real-time order book
export function useOrderBook(pair: string) {
  const [orderBook, setOrderBook] = useState<any>(null);
  const { subscribeOrderBook, connected } = useWebSocket();

  useEffect(() => {
    if (!connected || !pair) return;

    const unsubscribe = subscribeOrderBook([pair], (data) => {
      if (data.pair === pair) {
        if (data.snapshot) {
          setOrderBook(data.snapshot);
        } else if (data.action) {
          // Handle incremental updates
          setOrderBook((prev: any) => {
            if (!prev) return null;
            
            const newBook = { ...prev };
            const side = data.side === 'BUY' ? 'bids' : 'asks';
            
            if (data.action === 'add') {
              // Add or update price level
              const levels = [...newBook[side]];
              const index = levels.findIndex(l => l.price === data.order.price);
              
              if (index >= 0) {
                levels[index].quantity += data.order.quantity;
                levels[index].orderCount += 1;
              } else {
                levels.push({
                  price: data.order.price,
                  quantity: data.order.quantity,
                  orderCount: 1
                });
                levels.sort((a, b) => 
                  side === 'bids' ? b.price - a.price : a.price - b.price
                );
              }
              
              newBook[side] = levels;
            } else if (data.action === 'remove') {
              // Remove order from price level
              // This would need order-level tracking for accurate updates
            }
            
            return newBook;
          });
        }
      }
    });

    return unsubscribe;
  }, [pair, connected, subscribeOrderBook]);

  return orderBook;
}