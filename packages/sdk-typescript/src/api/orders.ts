import { RequestClient } from '../utils/request';
import {
  Order,
  CreateOrderRequest,
  UpdateOrderRequest,
  OrderFilter,
  PaginatedResponse,
  ApiResponse
} from '../types';
import { ValidationError } from '../types/errors';

export class OrdersAPI {
  constructor(private client: RequestClient) {}

  /**
   * Create a new order
   */
  async create(request: CreateOrderRequest): Promise<Order> {
    this.validateCreateOrderRequest(request);
    
    const response = await this.client.post<ApiResponse<Order>>('/orders', request);
    return this.parseOrder(response.data);
  }

  /**
   * Get order by ID
   */
  async get(orderId: string): Promise<Order> {
    if (!orderId) {
      throw new ValidationError('Order ID is required');
    }

    const response = await this.client.get<ApiResponse<Order>>(`/orders/${orderId}`);
    return this.parseOrder(response.data);
  }

  /**
   * Get user orders with filtering
   */
  async list(filter?: OrderFilter): Promise<PaginatedResponse<Order>> {
    const response = await this.client.get<PaginatedResponse<Order>>('/orders', filter);
    
    return {
      ...response,
      data: response.data.map(order => this.parseOrder(order))
    };
  }

  /**
   * Update an existing order
   */
  async update(orderId: string, update: UpdateOrderRequest): Promise<Order> {
    if (!orderId) {
      throw new ValidationError('Order ID is required');
    }

    const response = await this.client.put<ApiResponse<Order>>(
      `/orders/${orderId}`,
      update
    );
    return this.parseOrder(response.data);
  }

  /**
   * Cancel an order
   */
  async cancel(orderId: string): Promise<Order> {
    if (!orderId) {
      throw new ValidationError('Order ID is required');
    }

    const response = await this.client.delete<ApiResponse<Order>>(`/orders/${orderId}`);
    return this.parseOrder(response.data);
  }

  /**
   * Cancel all orders for a pair
   */
  async cancelAll(pair?: string): Promise<{ cancelled: number; orders: Order[] }> {
    const params = pair ? { pair } : {};
    const response = await this.client.delete<ApiResponse<{
      cancelled: number;
      orders: Order[];
    }>>('/orders', params);

    return {
      cancelled: response.data.cancelled,
      orders: response.data.orders.map(order => this.parseOrder(order))
    };
  }

  /**
   * Get order history
   */
  async history(filter?: OrderFilter): Promise<PaginatedResponse<Order>> {
    const response = await this.client.get<PaginatedResponse<Order>>(
      '/orders/history',
      filter
    );

    return {
      ...response,
      data: response.data.map(order => this.parseOrder(order))
    };
  }

  /**
   * Validate create order request
   */
  private validateCreateOrderRequest(request: CreateOrderRequest): void {
    if (!request.pair) {
      throw new ValidationError('Pair is required');
    }

    if (!request.side) {
      throw new ValidationError('Side is required');
    }

    if (!request.type) {
      throw new ValidationError('Order type is required');
    }

    if (!request.quantity || parseFloat(request.quantity) <= 0) {
      throw new ValidationError('Valid quantity is required');
    }

    // Validate price for limit orders
    if ((request.type === 'limit' || request.type === 'stop_limit') && !request.price) {
      throw new ValidationError('Price is required for limit orders');
    }

    // Validate stop price for stop orders
    if ((request.type === 'stop' || request.type === 'stop_limit') && !request.stopPrice) {
      throw new ValidationError('Stop price is required for stop orders');
    }
  }

  /**
   * Parse order from API response
   */
  private parseOrder(order: any): Order {
    return {
      ...order,
      createdAt: new Date(order.createdAt),
      updatedAt: new Date(order.updatedAt),
      expiresAt: order.expiresAt ? new Date(order.expiresAt) : undefined
    };
  }
}