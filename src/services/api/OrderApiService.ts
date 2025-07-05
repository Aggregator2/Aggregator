import axios, { AxiosInstance } from 'axios';
import { Order, OrderStatus, Trade } from '../matchingEngine/types';

export interface OrderHistoryParams {
  pair?: string;
  status?: OrderStatus[];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export interface SettlementProof {
  tradeId: string;
  epochId: string;
  epochNumber: number;
  settlementTime: Date;
  amount: number;
  price: number;
  fee: number;
  balanceChange?: number;
  blockchainProof?: string;
  status: string;
}

export class OrderApiService {
  private api: AxiosInstance;

  constructor(baseURL: string = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') {
    this.api = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add auth interceptor
    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('authToken');
      const userId = localStorage.getItem('userId');
      
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      if (userId) {
        config.headers['X-User-Id'] = userId;
      }
      
      return config;
    });

    // Add response interceptor for error handling
    this.api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Handle unauthorized
          window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        }
        return Promise.reject(error);
      }
    );
  }

  async getOrderStatus(orderId: string): Promise<{
    order: Order & { averagePrice: number };
    trades: Array<Trade & { fee: number; settlementStatus?: string }>;
  }> {
    const response = await this.api.get(`/api/orders/${orderId}`);
    return response.data;
  }

  async getOrderHistory(params?: OrderHistoryParams): Promise<{
    orders: Array<Order & { averagePrice: number; tradeCount: number }>;
    pagination: {
      limit: number;
      offset: number;
      total: number;
    };
  }> {
    const response = await this.api.get('/api/orders', { params });
    return response.data;
  }

  async getActiveOrders(pair?: string): Promise<{
    orders: Order[];
    count: number;
  }> {
    const response = await this.api.get('/api/orders/active', { 
      params: pair ? { pair } : undefined 
    });
    return response.data;
  }

  async getSettlementProof(orderId: string): Promise<{
    orderId: string;
    order: {
      pair: string;
      side: string;
      type: string;
      quantity: number;
      filledQuantity: number;
      status: string;
    };
    settlementProofs: SettlementProof[];
    summary: {
      totalTrades: number;
      settledTrades: number;
      pendingTrades: number;
    };
  }> {
    const response = await this.api.get(`/api/orders/${orderId}/settlement-proof`);
    return response.data;
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.api.post(`/api/orders/${orderId}/cancel`);
  }

  async submitOrder(order: {
    pair: string;
    side: 'BUY' | 'SELL';
    type: 'LIMIT' | 'MARKET';
    price?: number;
    quantity: number;
    timeInForce?: string;
    clientOrderId?: string;
  }): Promise<Order> {
    const response = await this.api.post('/api/orders', order);
    return response.data;
  }
}

// Singleton instance
export const orderApiService = new OrderApiService();