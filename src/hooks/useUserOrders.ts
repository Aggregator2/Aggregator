import { useEffect, useState, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { Order, OrderStatus, ExecutionReport } from '../services/matchingEngine/types';

export interface UseUserOrdersOptions {
  status?: OrderStatus;
  autoSubscribe?: boolean;
}

export const useUserOrders = ({ status, autoSubscribe = true }: UseUserOrdersOptions = {}) => {
  const { subscribe, on, send, state: wsState } = useWebSocket();
  const [orders, setOrders] = useState<Order[]>([]);
  const [executionReports, setExecutionReports] = useState<ExecutionReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter orders by status
  const filteredOrders = status 
    ? orders.filter(order => order.status === status)
    : orders;

  // Get active orders
  const activeOrders = orders.filter(order => 
    order.status === OrderStatus.NEW || 
    order.status === OrderStatus.PARTIALLY_FILLED
  );

  // Get filled orders
  const filledOrders = orders.filter(order => 
    order.status === OrderStatus.FILLED
  );

  // Get cancelled orders
  const cancelledOrders = orders.filter(order => 
    order.status === OrderStatus.CANCELLED
  );

  useEffect(() => {
    if (!wsState.connected || !wsState.authenticated || !autoSubscribe) return;

    setLoading(true);
    setError(null);

    const channel = 'orders';
    const unsubscribe = subscribe(channel, { status });

    // Handle initial orders
    const unsubOrders = on('user:orders', (data: any) => {
      if (data.channel === channel) {
        setOrders(data.data);
        setLoading(false);
      }
    });

    // Handle order updates
    const unsubUpdate = on('order:update', (data: any) => {
      if (data.channel === channel) {
        const updatedOrder: Order = data.data;
        
        setOrders(prevOrders => {
          const index = prevOrders.findIndex(o => o.id === updatedOrder.id);
          
          if (index !== -1) {
            // Update existing order
            const newOrders = [...prevOrders];
            newOrders[index] = updatedOrder;
            return newOrders;
          } else {
            // Add new order
            return [updatedOrder, ...prevOrders];
          }
        });
      }
    });

    // Handle execution reports
    const unsubExecution = on('order:execution', (data: any) => {
      if (data.channel === channel) {
        const report: ExecutionReport = data.data;
        
        setExecutionReports(prev => [report, ...prev].slice(0, 100));
        
        // Update corresponding order
        setOrders(prevOrders => {
          const index = prevOrders.findIndex(o => o.id === report.orderId);
          
          if (index !== -1) {
            const newOrders = [...prevOrders];
            const order = newOrders[index];
            
            // Update order based on execution report
            order.status = report.orderStatus;
            order.filledQuantity = report.cumQuantity;
            order.lastUpdateTime = report.timestamp;
            
            return newOrders;
          }
          
          return prevOrders;
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
      unsubOrders();
      unsubUpdate();
      unsubExecution();
      unsubError();
    };
  }, [status, wsState.connected, wsState.authenticated, autoSubscribe, subscribe, on]);

  // Cancel order
  const cancelOrder = useCallback((orderId: string) => {
    if (wsState.connected && wsState.authenticated) {
      send('order:cancel', { orderId });
    }
  }, [wsState.connected, wsState.authenticated, send]);

  // Cancel all orders
  const cancelAllOrders = useCallback((pair?: string) => {
    if (wsState.connected && wsState.authenticated) {
      send('order:cancel:all', { pair });
    }
  }, [wsState.connected, wsState.authenticated, send]);

  // Refresh orders
  const refresh = useCallback(() => {
    if (wsState.connected && wsState.authenticated) {
      send('orders:refresh', { status });
    }
  }, [wsState.connected, wsState.authenticated, status, send]);

  return {
    orders: filteredOrders,
    allOrders: orders,
    activeOrders,
    filledOrders,
    cancelledOrders,
    executionReports,
    loading,
    error,
    cancelOrder,
    cancelAllOrders,
    refresh,
    connected: wsState.connected,
    authenticated: wsState.authenticated
  };
};