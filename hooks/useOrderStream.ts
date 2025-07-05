import { useEffect, useState, useCallback, useRef } from 'react';
import io, { Socket } from 'socket.io-client';

interface OrderUpdate {
  type: 'submitted' | 'added-to-book' | 'filled' | 'cancelled';
  orderId: string;
  order: any;
  timestamp: number;
}

interface ExecutionReport {
  orderId: string;
  report: {
    executionId: string;
    status: string;
    filledQuantity: number;
    remainingQuantity: number;
    averagePrice: number;
    trades: Array<{
      id: string;
      price: number;
      quantity: number;
      timestamp: number;
      fee: number;
    }>;
  };
  timestamp: number;
}

interface MarketData {
  pair: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  bidQuantity: number;
  askQuantity: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

interface HybridExecution {
  type: 'complete' | 'external-pending' | 'external-update';
  orderId: string;
  status?: string;
  totalFilled?: number;
  averagePrice?: number;
  breakdown?: any;
  routeId?: string;
  txHash?: string;
  timestamp: number;
}

export function useOrderStream(userId?: string) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [orderUpdates, setOrderUpdates] = useState<OrderUpdate[]>([]);
  const [executionReports, setExecutionReports] = useState<ExecutionReport[]>([]);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [hybridExecutions, setHybridExecutions] = useState<HybridExecution[]>([]);
  
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Initialize socket connection
    const initSocket = async () => {
      await fetch('/api/orders/stream');
      
      const newSocket = io({
        path: '/api/orders/stream',
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      socketRef.current = newSocket;
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to order stream');
        setConnected(true);
        
        // Subscribe to user's orders if userId provided
        if (userId) {
          newSocket.emit('subscribe-user', userId);
        }
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from order stream');
        setConnected(false);
      });

      // Listen for order updates
      newSocket.on('order-update', (update: OrderUpdate) => {
        console.log('Order update:', update);
        setOrderUpdates(prev => [update, ...prev].slice(0, 100)); // Keep last 100
        
        // Trigger notification for user's orders
        if (userId && update.order.userId === userId) {
          notifyOrderUpdate(update);
        }
      });

      // Listen for execution reports
      newSocket.on('execution-report', (report: ExecutionReport) => {
        console.log('Execution report:', report);
        setExecutionReports(prev => [report, ...prev].slice(0, 50));
      });

      // Listen for market data
      newSocket.on('market-data', (data: MarketData) => {
        setMarketData(prev => ({
          ...prev,
          [data.pair]: data
        }));
      });

      // Listen for hybrid executions
      newSocket.on('hybrid-execution', (execution: HybridExecution) => {
        console.log('Hybrid execution:', execution);
        setHybridExecutions(prev => [execution, ...prev].slice(0, 50));
      });
    };

    initSocket();

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        if (userId) {
          socketRef.current.emit('unsubscribe-user', userId);
        }
        socketRef.current.disconnect();
      }
    };
  }, [userId]);

  // Subscribe to specific order updates
  const subscribeToOrder = useCallback((orderId: string) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('subscribe-order', orderId);
    }
  }, [connected]);

  // Unsubscribe from order updates
  const unsubscribeFromOrder = useCallback((orderId: string) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('unsubscribe-order', orderId);
    }
  }, [connected]);

  // Subscribe to market data for a pair
  const subscribeToMarket = useCallback((pair: string) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('subscribe-market', pair);
    }
  }, [connected]);

  // Unsubscribe from market data
  const unsubscribeFromMarket = useCallback((pair: string) => {
    if (socketRef.current && connected) {
      socketRef.current.emit('unsubscribe-market', pair);
    }
  }, [connected]);

  // Get latest order update for a specific order
  const getOrderUpdate = useCallback((orderId: string) => {
    return orderUpdates.find(update => update.orderId === orderId);
  }, [orderUpdates]);

  // Get execution report for a specific order
  const getExecutionReport = useCallback((orderId: string) => {
    return executionReports.find(report => report.orderId === orderId);
  }, [executionReports]);

  // Get hybrid execution for a specific order
  const getHybridExecution = useCallback((orderId: string) => {
    return hybridExecutions.find(exec => exec.orderId === orderId);
  }, [hybridExecutions]);

  return {
    connected,
    orderUpdates,
    executionReports,
    marketData,
    hybridExecutions,
    subscribeToOrder,
    unsubscribeFromOrder,
    subscribeToMarket,
    unsubscribeFromMarket,
    getOrderUpdate,
    getExecutionReport,
    getHybridExecution
  };
}

// Helper function to show notifications
function notifyOrderUpdate(update: OrderUpdate) {
  if ('Notification' in window && Notification.permission === 'granted') {
    const title = `Order ${update.type}`;
    const body = `Order ${update.orderId.slice(0, 8)}... is now ${update.type}`;
    new Notification(title, { body });
  }
}