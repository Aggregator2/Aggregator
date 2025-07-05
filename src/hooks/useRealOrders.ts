import { useState, useEffect, useCallback, useRef } from 'react';
import { orderApiService } from '../services/api/OrderApiService';
import { OrderWebSocketClient } from '../services/websocket/OrderWebSocketClient';
import { Order, OrderStatus } from '../services/matchingEngine/types';

export interface UseRealOrdersReturn {
  // Order data
  openOrders: Order[];
  orderHistory: Order[];
  selectedOrder: (Order & { averagePrice: number; trades: any[] }) | null;
  settlementProof: any | null;
  
  // Loading states
  loading: boolean;
  orderLoading: boolean;
  proofLoading: boolean;
  
  // Connection state
  isConnected: boolean;
  
  // Actions
  selectOrder: (orderId: string) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
  refreshOrders: () => Promise<void>;
  loadSettlementProof: (orderId: string) => Promise<void>;
}

export function useRealOrders(authToken?: string): UseRealOrdersReturn {
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [settlementProof, setSettlementProof] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orderLoading, setOrderLoading] = useState(false);
  const [proofLoading, setProofLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const wsClient = useRef<OrderWebSocketClient | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000/ws/orders';
    
    wsClient.current = new OrderWebSocketClient({
      url: wsUrl,
      authToken: authToken || localStorage.getItem('authToken') || '',
    });

    // Set up WebSocket event handlers
    wsClient.current.on('connected', () => {
      console.log('Order WebSocket connected');
      setIsConnected(true);
    });

    wsClient.current.on('disconnected', () => {
      console.log('Order WebSocket disconnected');
      setIsConnected(false);
    });

    wsClient.current.on('authenticated', () => {
      console.log('Order WebSocket authenticated');
      // Subscribe to all user orders
      wsClient.current?.subscribeToAllOrders();
    });

    wsClient.current.on('activeOrders', (orders) => {
      console.log('Received active orders:', orders);
      setOpenOrders(orders.filter((o: Order) => 
        o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIALLY_FILLED
      ));
    });

    wsClient.current.on('orderUpdate', (data) => {
      console.log('Order update:', data);
      handleOrderUpdate(data.order);
    });

    wsClient.current.on('order:filled', (order) => {
      console.log('Order filled:', order);
      handleOrderUpdate(order);
    });

    wsClient.current.on('order:cancelled', (order) => {
      console.log('Order cancelled:', order);
      handleOrderUpdate(order);
    });

    wsClient.current.on('executionReport', (report) => {
      console.log('Execution report:', report);
      // Update selected order if it matches
      if (selectedOrder?.id === report.orderId) {
        selectOrder(report.orderId);
      }
    });

    // Connect
    wsClient.current.connect();

    // Cleanup
    return () => {
      wsClient.current?.disconnect();
    };
  }, [authToken]);

  // Load initial orders
  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      
      // Load active orders
      const activeResponse = await orderApiService.getActiveOrders();
      setOpenOrders(activeResponse.orders);
      
      // Load order history
      const historyResponse = await orderApiService.getOrderHistory({
        limit: 100,
        offset: 0,
      });
      setOrderHistory(historyResponse.orders);
      
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOrderUpdate = (order: Order) => {
    // Update open orders
    setOpenOrders(prev => {
      const isOpen = order.status === OrderStatus.OPEN || 
                     order.status === OrderStatus.PARTIALLY_FILLED;
      
      const filtered = prev.filter(o => o.id !== order.id);
      
      if (isOpen) {
        return [order, ...filtered];
      } else {
        return filtered;
      }
    });
    
    // Update order history
    setOrderHistory(prev => {
      const filtered = prev.filter(o => o.id !== order.id);
      return [order, ...filtered].slice(0, 100);
    });
    
    // Update selected order if it matches
    if (selectedOrder?.id === order.id) {
      selectOrder(order.id);
    }
  };

  const selectOrder = async (orderId: string) => {
    try {
      setOrderLoading(true);
      const orderData = await orderApiService.getOrderStatus(orderId);
      setSelectedOrder(orderData);
    } catch (error) {
      console.error('Error loading order details:', error);
    } finally {
      setOrderLoading(false);
    }
  };

  const cancelOrder = async (orderId: string) => {
    try {
      await orderApiService.cancelOrder(orderId);
      // WebSocket will handle the update
    } catch (error) {
      console.error('Error cancelling order:', error);
      throw error;
    }
  };

  const refreshOrders = async () => {
    await loadOrders();
  };

  const loadSettlementProof = async (orderId: string) => {
    try {
      setProofLoading(true);
      const proof = await orderApiService.getSettlementProof(orderId);
      setSettlementProof(proof);
    } catch (error) {
      console.error('Error loading settlement proof:', error);
      setSettlementProof(null);
    } finally {
      setProofLoading(false);
    }
  };

  return {
    openOrders,
    orderHistory,
    selectedOrder,
    settlementProof,
    loading,
    orderLoading,
    proofLoading,
    isConnected,
    selectOrder,
    cancelOrder,
    refreshOrders,
    loadSettlementProof,
  };
}