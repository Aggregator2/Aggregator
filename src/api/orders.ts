import { Router, Request, Response } from 'express';
import { DatabaseMatchingEngine } from '../services/matchingEngine/DatabaseMatchingEngine';
import { OrderRepository } from '../database/repositories/OrderRepository';
import { TradeRepository } from '../database/repositories/TradeRepository';
import { SettlementRepository } from '../database/repositories/SettlementRepository';
import { OrderStatus } from '../services/matchingEngine/types';
import { logger } from '../utils/logger';

const router = Router();
const orderRepo = new OrderRepository();
const tradeRepo = new TradeRepository();
const settlementRepo = new SettlementRepository();

// Middleware for authentication (simplified - implement proper auth)
const authenticateUser = (req: Request, res: Response, next: Function) => {
  const userId = req.headers['x-user-id'] as string;
  if (!userId) {
    res.status(401).json({ error: 'User ID required' });
    return;
  }
  (req as any).userId = userId;
  next();
};

// GET /api/orders/:orderId - Get order status by ID
router.get('/orders/:orderId', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = (req as any).userId;
    
    const order = await orderRepo.getOrderById(orderId);
    
    if (!order) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    
    // Check if user owns this order
    if (order.userId !== userId) {
      res.status(403).json({ error: 'Unauthorized' });
      return;
    }
    
    // Get trades for this order
    const trades = await tradeRepo.getTradesByOrderId(orderId);
    
    // Calculate average execution price
    let avgPrice = 0;
    if (trades.length > 0) {
      const totalValue = trades.reduce((sum, trade) => sum + (trade.price * trade.quantity), 0);
      const totalQuantity = trades.reduce((sum, trade) => sum + trade.quantity, 0);
      avgPrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
    }
    
    const response = {
      order: {
        id: order.id,
        clientOrderId: order.clientOrderId,
        pair: order.pair,
        side: order.side,
        type: order.type,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        remainingQuantity: order.quantity - order.filledQuantity,
        status: order.status,
        timeInForce: order.timeInForce,
        averagePrice: avgPrice,
        timestamp: order.timestamp,
        lastUpdateTime: order.lastUpdateTime,
      },
      trades: trades.map(trade => ({
        id: trade.id,
        price: trade.price,
        quantity: trade.quantity,
        timestamp: trade.timestamp,
        fee: order.userId === trade.takerOrderId ? trade.takerFee : trade.makerFee,
        side: trade.takerSide,
        settlementStatus: trade.settlementStatus,
      })),
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching order', { orderId: req.params.orderId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders - Get order history with filters
router.get('/orders', authenticateUser, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const {
      pair,
      status,
      startTime,
      endTime,
      limit = '50',
      offset = '0',
    } = req.query;
    
    // Parse status filter
    let statusFilter: OrderStatus[] | undefined;
    if (status) {
      statusFilter = Array.isArray(status) 
        ? status as OrderStatus[]
        : [status as OrderStatus];
    }
    
    const orders = await orderRepo.getOrdersByUser(userId, {
      pair: pair as string,
      status: statusFilter,
      startTime: startTime ? parseInt(startTime as string) : undefined,
      endTime: endTime ? parseInt(endTime as string) : undefined,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
    
    // Get trades for all orders in parallel
    const orderIds = orders.map(o => o.id);
    const tradesPromises = orderIds.map(id => tradeRepo.getTradesByOrderId(id));
    const tradesResults = await Promise.all(tradesPromises);
    
    // Create trades map
    const tradesMap = new Map<string, any[]>();
    orderIds.forEach((orderId, index) => {
      tradesMap.set(orderId, tradesResults[index]);
    });
    
    const response = {
      orders: orders.map(order => {
        const trades = tradesMap.get(order.id) || [];
        const totalValue = trades.reduce((sum, trade) => sum + (trade.price * trade.quantity), 0);
        const totalQuantity = trades.reduce((sum, trade) => sum + trade.quantity, 0);
        const avgPrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;
        
        return {
          id: order.id,
          clientOrderId: order.clientOrderId,
          pair: order.pair,
          side: order.side,
          type: order.type,
          price: order.price,
          quantity: order.quantity,
          filledQuantity: order.filledQuantity,
          remainingQuantity: order.quantity - order.filledQuantity,
          status: order.status,
          timeInForce: order.timeInForce,
          averagePrice: avgPrice,
          timestamp: order.timestamp,
          lastUpdateTime: order.lastUpdateTime,
          tradeCount: trades.length,
        };
      }),
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        total: orders.length,
      },
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching order history', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:orderId/settlement-proof - Get settlement proof for an order
router.get('/orders/:orderId/settlement-proof', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { orderId } = req.params;
    const userId = (req as any).userId;
    
    // Verify order ownership
    const order = await orderRepo.getOrderById(orderId);
    if (!order || order.userId !== userId) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    
    // Get trades for this order
    const trades = await tradeRepo.getTradesByOrderId(orderId);
    
    if (trades.length === 0) {
      res.json({ 
        orderId,
        settlementProofs: [],
        message: 'No trades executed for this order',
      });
      return;
    }
    
    // Get settlement information for each trade
    const settlementProofs = [];
    
    for (const trade of trades) {
      if (trade.settlementStatus === 'settled' && (trade as any).settlementEpochId) {
        const epoch = await settlementRepo.getSettlementEpochById((trade as any).settlementEpochId);
        const details = await settlementRepo.getSettlementDetails((trade as any).settlementEpochId);
        
        const userDetail = details.find(d => 
          d.userId === userId && 
          d.tradeId === trade.id
        );
        
        settlementProofs.push({
          tradeId: trade.id,
          epochId: (trade as any).settlementEpochId,
          epochNumber: epoch?.epochNumber,
          settlementTime: epoch?.processingCompletedAt,
          amount: trade.quantity,
          price: trade.price,
          fee: order!.userId === trade.takerOrderId ? trade.takerFee : trade.makerFee,
          balanceChange: userDetail?.amount,
          blockchainProof: epoch?.settlementProof,
          status: trade.settlementStatus,
        });
      }
    }
    
    res.json({
      orderId,
      order: {
        pair: order!.pair,
        side: order!.side,
        type: order!.type,
        quantity: order!.quantity,
        filledQuantity: order!.filledQuantity,
        status: order!.status,
      },
      settlementProofs,
      summary: {
        totalTrades: trades.length,
        settledTrades: settlementProofs.length,
        pendingTrades: trades.filter(t => t.settlementStatus === 'pending').length,
      },
    });
  } catch (error) {
    logger.error('Error fetching settlement proof', { orderId: req.params.orderId, error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/active - Get all active orders for a user
router.get('/orders/active', authenticateUser, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { pair } = req.query;
    
    const activeOrders = await orderRepo.getOrdersByUser(userId, {
      pair: pair as string,
      status: [OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
    });
    
    const response = {
      orders: activeOrders.map(order => ({
        id: order.id,
        clientOrderId: order.clientOrderId,
        pair: order.pair,
        side: order.side,
        type: order.type,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
        remainingQuantity: order.quantity - order.filledQuantity,
        status: order.status,
        timestamp: order.timestamp,
      })),
      count: activeOrders.length,
    };
    
    res.json(response);
  } catch (error) {
    logger.error('Error fetching active orders', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;