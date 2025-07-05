import { Request, Response } from 'express';
import { sendPaginatedResponse } from '../middleware';
import { Order, Trade } from '../types';
import { OrderService } from './service';

export class OrderController {
  private orderService: OrderService;

  constructor() {
    this.orderService = new OrderService();
  }

  /**
   * Get user's orders
   */
  getUserOrders = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const filters = req.query;
    const pagination = req.pagination!;

    const { orders, total } = await this.orderService.getUserOrders(
      userId,
      filters,
      pagination
    );

    sendPaginatedResponse(res, orders, total, pagination);
  };

  /**
   * Get all orders (admin only)
   */
  getAllOrders = async (req: Request, res: Response): Promise<void> => {
    const filters = req.query;
    const pagination = req.pagination!;

    const { orders, total } = await this.orderService.getAllOrders(
      filters,
      pagination
    );

    sendPaginatedResponse(res, orders, total, pagination);
  };

  /**
   * Get order by ID
   */
  getOrderById = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = req.params;
    const userId = req.user!.id;
    const userRole = req.user!.role;

    const order = await this.orderService.getOrderById(orderId, userId, userRole);

    res.json({
      success: true,
      data: order
    });
  };

  /**
   * Create a new order
   */
  createOrder = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const orderData = req.body;

    const order = await this.orderService.createOrder(userId, orderData);

    res.status(201).json({
      success: true,
      data: order
    });
  };

  /**
   * Update an order
   */
  updateOrder = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = req.params;
    const userId = req.user!.id;
    const updates = req.body;

    const order = await this.orderService.updateOrder(orderId, userId, updates);

    res.json({
      success: true,
      data: order
    });
  };

  /**
   * Cancel an order
   */
  cancelOrder = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = req.params;
    const userId = req.user!.id;

    const order = await this.orderService.cancelOrder(orderId, userId);

    res.json({
      success: true,
      data: order
    });
  };

  /**
   * Create multiple orders
   */
  createBatchOrders = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { orders } = req.body;

    const results = await this.orderService.createBatchOrders(userId, orders);

    res.status(201).json({
      success: true,
      data: results
    });
  };

  /**
   * Cancel multiple orders
   */
  cancelBatchOrders = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { orderIds } = req.body;

    const results = await this.orderService.cancelBatchOrders(userId, orderIds);

    res.json({
      success: true,
      data: results
    });
  };

  /**
   * Get order fills
   */
  getOrderFills = async (req: Request, res: Response): Promise<void> => {
    const { orderId } = req.params;
    const userId = req.user!.id;
    const pagination = req.pagination!;

    const { fills, total } = await this.orderService.getOrderFills(
      orderId,
      userId,
      pagination
    );

    sendPaginatedResponse(res, fills, total, pagination);
  };
}