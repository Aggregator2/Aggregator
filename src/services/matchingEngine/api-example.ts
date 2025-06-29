// Example API integration for the matching engine
// This shows how you might integrate the matching engine into a Next.js API route

import { NextApiRequest, NextApiResponse } from 'next';
import { MatchingEngine, MatchingEngineConfig, OrderSide, OrderType, TimeInForce } from './index';

// Initialize matching engine (in production, this would be a singleton)
const config: MatchingEngineConfig = {
  maxOrderBookDepth: 100,
  minOrderSize: { 'ETH/USDC': 0.01, 'BTC/USDC': 0.0001 },
  maxOrderSize: { 'ETH/USDC': 1000, 'BTC/USDC': 100 },
  tickSize: { 'ETH/USDC': 0.01, 'BTC/USDC': 0.01 },
  makerFeeRate: 0.001,
  takerFeeRate: 0.002,
  enableStopOrders: false,
  enableIcebergOrders: false,
};

const matchingEngine = new MatchingEngine(config);
matchingEngine.initializePair('ETH/USDC');
matchingEngine.initializePair('BTC/USDC');

// API Routes Examples:

// POST /api/orders - Submit a new order
export async function submitOrderHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { userId, pair, side, type, price, quantity, timeInForce, clientOrderId } = req.body;

    // Validate input
    if (!userId || !pair || !side || !type || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Submit order
    const executionReport = await matchingEngine.submitOrder({
      userId,
      pair,
      side,
      type,
      price: type === OrderType.LIMIT ? price : undefined,
      quantity,
      timeInForce: timeInForce || TimeInForce.GTC,
      clientOrderId,
    });

    return res.status(200).json({
      success: true,
      data: {
        orderId: executionReport.orderId,
        clientOrderId: executionReport.clientOrderId,
        status: executionReport.status,
        filledQuantity: executionReport.filledQuantity,
        remainingQuantity: executionReport.remainingQuantity,
        averagePrice: executionReport.averagePrice,
        trades: executionReport.trades,
      },
    });
  } catch (error) {
    console.error('Order submission error:', error);
    return res.status(400).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Order submission failed' 
    });
  }
}

// DELETE /api/orders/:orderId - Cancel an order
export async function cancelOrderHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { orderId } = req.query;
    const { userId } = req.body;

    if (!orderId || typeof orderId !== 'string') {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const executionReport = await matchingEngine.cancelOrder(orderId, userId);

    return res.status(200).json({
      success: true,
      data: {
        orderId: executionReport.orderId,
        status: executionReport.status,
        message: 'Order cancelled successfully',
      },
    });
  } catch (error) {
    console.error('Order cancellation error:', error);
    return res.status(400).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Order cancellation failed' 
    });
  }
}

// GET /api/orderbook/:pair - Get order book snapshot
export async function getOrderBookHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { pair, depth } = req.query;

    if (!pair || typeof pair !== 'string') {
      return res.status(400).json({ error: 'Trading pair is required' });
    }

    const depthLimit = depth ? parseInt(depth as string) : 50;
    const orderBook = matchingEngine.getOrderBook(pair, depthLimit);

    if (!orderBook) {
      return res.status(404).json({ error: 'Order book not found for this pair' });
    }

    return res.status(200).json({
      success: true,
      data: {
        pair: orderBook.pair,
        bids: orderBook.bids.map(level => ({
          price: level.price,
          quantity: level.quantity,
          orderCount: level.orders.length,
        })),
        asks: orderBook.asks.map(level => ({
          price: level.price,
          quantity: level.quantity,
          orderCount: level.orders.length,
        })),
        lastUpdateTime: orderBook.lastUpdateTime,
      },
    });
  } catch (error) {
    console.error('Order book fetch error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch order book' 
    });
  }
}

// GET /api/orders - Get user orders
export async function getUserOrdersHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { userId, pair, status } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const orders = matchingEngine.getUserOrders(
      userId,
      pair as string | undefined,
      status as any
    );

    return res.status(200).json({
      success: true,
      data: orders.map(order => ({
        orderId: order.id,
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
        timestamp: order.timestamp,
        lastUpdateTime: order.lastUpdateTime,
      })),
    });
  } catch (error) {
    console.error('User orders fetch error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch user orders' 
    });
  }
}

// GET /api/trades/:pair - Get recent trades
export async function getRecentTradesHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { pair, limit } = req.query;

    if (!pair || typeof pair !== 'string') {
      return res.status(400).json({ error: 'Trading pair is required' });
    }

    const tradeLimit = limit ? parseInt(limit as string) : 100;
    const trades = matchingEngine.getRecentTrades(pair, tradeLimit);

    return res.status(200).json({
      success: true,
      data: trades.map(trade => ({
        tradeId: trade.id,
        price: trade.price,
        quantity: trade.quantity,
        side: trade.takerSide,
        timestamp: trade.timestamp,
        takerFee: trade.takerFee,
        makerFee: trade.makerFee,
      })),
    });
  } catch (error) {
    console.error('Recent trades fetch error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch recent trades' 
    });
  }
}

// GET /api/market/:pair - Get market data
export async function getMarketDataHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { pair } = req.query;

    if (!pair || typeof pair !== 'string') {
      return res.status(400).json({ error: 'Trading pair is required' });
    }

    const marketData = matchingEngine.getMarketData(pair);

    if (!marketData) {
      return res.status(404).json({ error: 'Market data not found for this pair' });
    }

    return res.status(200).json({
      success: true,
      data: {
        pair: marketData.pair,
        lastPrice: marketData.lastPrice,
        bidPrice: marketData.bidPrice,
        askPrice: marketData.askPrice,
        bidQuantity: marketData.bidQuantity,
        askQuantity: marketData.askQuantity,
        volume24h: marketData.volume24h,
        high24h: marketData.high24h,
        low24h: marketData.low24h,
        openPrice24h: marketData.openPrice24h,
        lastUpdateTime: marketData.lastUpdateTime,
      },
    });
  } catch (error) {
    console.error('Market data fetch error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch market data' 
    });
  }
}

// WebSocket integration example (for real-time updates)
export function setupWebSocketHandlers(ws: any) {
  // Subscribe to order book updates
  matchingEngine.on('orderAdded', (order) => {
    ws.send(JSON.stringify({
      type: 'orderbook_update',
      action: 'add',
      data: {
        pair: order.pair,
        side: order.side,
        price: order.price,
        quantity: order.quantity - order.filledQuantity,
      },
    }));
  });

  matchingEngine.on('orderFilled', (order) => {
    ws.send(JSON.stringify({
      type: 'orderbook_update',
      action: 'remove',
      data: {
        pair: order.pair,
        orderId: order.id,
      },
    }));
  });

  matchingEngine.on('executionReport', (report) => {
    if (report.trades.length > 0) {
      ws.send(JSON.stringify({
        type: 'trades',
        data: report.trades.map(trade => ({
          pair: report.pair,
          price: trade.price,
          quantity: trade.quantity,
          side: trade.takerSide,
          timestamp: trade.timestamp,
        })),
      }));
    }
  });

  matchingEngine.on('marketDataUpdate', (data) => {
    ws.send(JSON.stringify({
      type: 'market_data',
      data: data,
    }));
  });
}