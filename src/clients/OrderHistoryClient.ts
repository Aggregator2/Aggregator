import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  OrderHistoryRequest,
  OrderHistoryResponse,
  OrderHistoryError,
  OrderStatus,
  OrderSide,
  OrderSortField
} from '../types/orderHistory';

export interface OrderHistoryClientConfig {
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class OrderHistoryClient {
  private client: AxiosInstance;
  private config: OrderHistoryClientConfig;

  constructor(config: OrderHistoryClientConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: this.buildHeaders()
    });

    // Add response interceptor for retry logic
    this.client.interceptors.response.use(
      response => response,
      this.handleError.bind(this)
    );
  }

  /**
   * Get order history with filters and pagination
   */
  async getOrderHistory(request: OrderHistoryRequest = {}): Promise<OrderHistoryResponse> {
    const params = this.buildQueryParams(request);
    
    const response = await this.client.get<OrderHistoryResponse>('/api/orders/history', {
      params
    });

    return response.data;
  }

  /**
   * Get all orders using cursor pagination
   */
  async *getAllOrders(
    request: Omit<OrderHistoryRequest, 'cursor'> = {}
  ): AsyncGenerator<OrderHistoryResponse, void, unknown> {
    let cursor: string | undefined;
    
    do {
      const response = await this.getOrderHistory({
        ...request,
        cursor
      });
      
      yield response;
      
      cursor = response.cursor.next;
    } while (cursor);
  }

  /**
   * Get orders for a specific date range
   */
  async getOrdersByDateRange(
    dateFrom: Date,
    dateTo: Date,
    filters: Omit<OrderHistoryRequest, 'dateFrom' | 'dateTo'> = {}
  ): Promise<OrderHistoryResponse> {
    return this.getOrderHistory({
      ...filters,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString()
    });
  }

  /**
   * Get filled orders only
   */
  async getFilledOrders(
    filters: Omit<OrderHistoryRequest, 'status'> = {}
  ): Promise<OrderHistoryResponse> {
    return this.getOrderHistory({
      ...filters,
      status: [OrderStatus.FILLED]
    });
  }

  /**
   * Get open orders (pending, open, partially filled)
   */
  async getOpenOrders(
    filters: Omit<OrderHistoryRequest, 'status'> = {}
  ): Promise<OrderHistoryResponse> {
    return this.getOrderHistory({
      ...filters,
      status: [
        OrderStatus.PENDING,
        OrderStatus.OPEN,
        OrderStatus.PARTIALLY_FILLED
      ]
    });
  }

  /**
   * Get orders sorted by P&L
   */
  async getOrdersByPnL(
    filters: Omit<OrderHistoryRequest, 'sortBy'> = {}
  ): Promise<OrderHistoryResponse> {
    return this.getOrderHistory({
      ...filters,
      sortBy: OrderSortField.PNL
    });
  }

  /**
   * Get today's orders
   */
  async getTodaysOrders(
    filters: Omit<OrderHistoryRequest, 'dateFrom' | 'dateTo'> = {}
  ): Promise<OrderHistoryResponse> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.getOrdersByDateRange(today, tomorrow, filters);
  }

  /**
   * Get orders for a specific trading pair
   */
  async getOrdersByPair(
    pair: string,
    filters: Omit<OrderHistoryRequest, 'pair'> = {}
  ): Promise<OrderHistoryResponse> {
    return this.getOrderHistory({
      ...filters,
      pair
    });
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    if (this.config.bearerToken) {
      headers['Authorization'] = `Bearer ${this.config.bearerToken}`;
    }

    return headers;
  }

  /**
   * Build query parameters
   */
  private buildQueryParams(request: OrderHistoryRequest): Record<string, any> {
    const params: Record<string, any> = {};

    // Add all defined parameters
    if (request.cursor !== undefined) params.cursor = request.cursor;
    if (request.limit !== undefined) params.limit = request.limit;
    if (request.dateFrom !== undefined) params.dateFrom = request.dateFrom;
    if (request.dateTo !== undefined) params.dateTo = request.dateTo;
    if (request.pair !== undefined) params.pair = request.pair;
    if (request.side !== undefined) params.side = request.side;
    if (request.sortBy !== undefined) params.sortBy = request.sortBy;
    if (request.sortOrder !== undefined) params.sortOrder = request.sortOrder;

    // Handle status array
    if (request.status !== undefined) {
      if (Array.isArray(request.status)) {
        params['status[]'] = request.status;
      } else {
        params.status = request.status;
      }
    }

    return params;
  }

  /**
   * Handle errors with retry logic
   */
  private async handleError(error: AxiosError): Promise<any> {
    // Don't retry on client errors
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      const errorData = error.response.data as any;
      throw new OrderHistoryError(
        errorData?.error || error.message,
        errorData?.code || 'CLIENT_ERROR',
        error.response.status,
        errorData?.details
      );
    }

    // Retry on server errors or network errors
    const retryCount = (error.config as any)?.retryCount || 0;
    
    if (retryCount < this.config.retryAttempts!) {
      const delay = this.config.retryDelay! * Math.pow(2, retryCount); // Exponential backoff
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const config = {
        ...error.config,
        retryCount: retryCount + 1
      } as any;
      return this.client.request(config);
    }

    throw new OrderHistoryError(
      error.message,
      'NETWORK_ERROR',
      error.response?.status || 0
    );
  }

  /**
   * Update authentication
   */
  setAuthentication(auth: { apiKey?: string; bearerToken?: string }): void {
    if (auth.apiKey) {
      this.config.apiKey = auth.apiKey;
      this.client.defaults.headers.common['X-API-Key'] = auth.apiKey;
    }

    if (auth.bearerToken) {
      this.config.bearerToken = auth.bearerToken;
      this.client.defaults.headers.common['Authorization'] = `Bearer ${auth.bearerToken}`;
    }
  }
}

// Export convenience functions
export async function createOrderHistoryClient(
  config: OrderHistoryClientConfig
): Promise<OrderHistoryClient> {
  const client = new OrderHistoryClient(config);
  
  // Optionally validate connection
  try {
    await client.getOrderHistory({ limit: 1 });
  } catch (error) {
    console.warn('Failed to validate order history client connection:', error);
  }
  
  return client;
}