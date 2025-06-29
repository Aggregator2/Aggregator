import {
  Order,
  OrderSide,
  OrderStatus,
  OrderBookLevel,
  OrderBookSnapshot,
  OrderBookUpdate,
  Trade,
} from './types';

export class OrderBook {
  private pair: string;
  private bids: Map<number, OrderBookLevel>; // Price -> Level
  private asks: Map<number, OrderBookLevel>; // Price -> Level
  private orderIndex: Map<string, Order>; // OrderId -> Order
  private sequenceNumber: number;
  private tickSize: number;

  constructor(pair: string, tickSize: number = 0.01) {
    this.pair = pair;
    this.tickSize = tickSize;
    this.bids = new Map();
    this.asks = new Map();
    this.orderIndex = new Map();
    this.sequenceNumber = 0;
  }

  // Add a new order to the order book
  addOrder(order: Order): OrderBookUpdate | null {
    if (this.orderIndex.has(order.id)) {
      throw new Error(`Order ${order.id} already exists in the order book`);
    }

    // Validate price is multiple of tick size
    if (!this.isValidPrice(order.price)) {
      throw new Error(`Invalid price ${order.price}. Must be multiple of tick size ${this.tickSize}`);
    }

    const side = order.side === OrderSide.BUY ? this.bids : this.asks;
    let level = side.get(order.price);

    if (!level) {
      level = {
        price: order.price,
        quantity: 0,
        orders: [],
      };
      side.set(order.price, level);
    }

    // Add order to the level (FIFO - price-time priority)
    level.orders.push(order);
    level.quantity += order.quantity - order.filledQuantity;
    this.orderIndex.set(order.id, order);

    return {
      type: 'ADD',
      side: order.side,
      price: order.price,
      quantity: order.quantity - order.filledQuantity,
      orderId: order.id,
      timestamp: Date.now(),
      sequenceNumber: ++this.sequenceNumber,
    };
  }

  // Remove an order from the order book
  removeOrder(orderId: string): OrderBookUpdate | null {
    const order = this.orderIndex.get(orderId);
    if (!order) {
      return null;
    }

    const side = order.side === OrderSide.BUY ? this.bids : this.asks;
    const level = side.get(order.price);

    if (level) {
      const orderIndex = level.orders.findIndex(o => o.id === orderId);
      if (orderIndex !== -1) {
        level.orders.splice(orderIndex, 1);
        level.quantity -= (order.quantity - order.filledQuantity);

        // Remove empty levels
        if (level.orders.length === 0) {
          side.delete(order.price);
        }
      }
    }

    this.orderIndex.delete(orderId);

    return {
      type: 'REMOVE',
      side: order.side,
      price: order.price,
      quantity: order.quantity - order.filledQuantity,
      orderId: order.id,
      timestamp: Date.now(),
      sequenceNumber: ++this.sequenceNumber,
    };
  }

  // Update an order's filled quantity
  updateOrderFill(orderId: string, filledQuantity: number): OrderBookUpdate | null {
    const order = this.orderIndex.get(orderId);
    if (!order) {
      return null;
    }

    const previousRemaining = order.quantity - order.filledQuantity;
    order.filledQuantity = filledQuantity;
    const newRemaining = order.quantity - order.filledQuantity;
    const quantityDelta = previousRemaining - newRemaining;

    // Update level quantity
    const side = order.side === OrderSide.BUY ? this.bids : this.asks;
    const level = side.get(order.price);
    if (level) {
      level.quantity -= quantityDelta;
    }

    // Remove fully filled orders
    if (order.filledQuantity >= order.quantity) {
      this.removeOrder(orderId);
    }

    return {
      type: 'UPDATE',
      side: order.side,
      price: order.price,
      quantity: -quantityDelta,
      orderId: order.id,
      timestamp: Date.now(),
      sequenceNumber: ++this.sequenceNumber,
    };
  }

  // Get the best bid price
  getBestBid(): OrderBookLevel | null {
    if (this.bids.size === 0) return null;
    const bestPrice = Math.max(...this.bids.keys());
    return this.bids.get(bestPrice) || null;
  }

  // Get the best ask price
  getBestAsk(): OrderBookLevel | null {
    if (this.asks.size === 0) return null;
    const bestPrice = Math.min(...this.asks.keys());
    return this.asks.get(bestPrice) || null;
  }

  // Get order book snapshot
  getSnapshot(depth: number = 50): OrderBookSnapshot {
    const sortedBids = Array.from(this.bids.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, depth)
      .map(([_, level]) => level);

    const sortedAsks = Array.from(this.asks.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, depth)
      .map(([_, level]) => level);

    return {
      pair: this.pair,
      bids: sortedBids,
      asks: sortedAsks,
      lastUpdateTime: Date.now(),
      sequenceNumber: this.sequenceNumber,
    };
  }

  // Match orders and generate trades
  matchOrders(aggressiveOrder: Order): Trade[] {
    const trades: Trade[] = [];
    const side = aggressiveOrder.side === OrderSide.BUY ? this.asks : this.bids;
    
    // Get sorted price levels (best prices first)
    const sortedLevels = Array.from(side.entries()).sort((a, b) => {
      return aggressiveOrder.side === OrderSide.BUY ? a[0] - b[0] : b[0] - a[0];
    });

    let remainingQuantity = aggressiveOrder.quantity - aggressiveOrder.filledQuantity;

    for (const [price, level] of sortedLevels) {
      // Check if aggressive order can match at this price
      if (!this.canMatch(aggressiveOrder, price)) {
        break;
      }

      // Match against orders at this level (FIFO)
      let i = 0;
      while (i < level.orders.length && remainingQuantity > 0) {
        const passiveOrder = level.orders[i];
        const passiveRemaining = passiveOrder.quantity - passiveOrder.filledQuantity;

        if (passiveRemaining <= 0) {
          i++;
          continue;
        }

        // Calculate match quantity
        const matchQuantity = Math.min(remainingQuantity, passiveRemaining);

        // Create trade
        const trade: Trade = {
          id: this.generateTradeId(),
          pair: this.pair,
          takerOrderId: aggressiveOrder.id,
          makerOrderId: passiveOrder.id,
          price: price,
          quantity: matchQuantity,
          takerSide: aggressiveOrder.side,
          timestamp: Date.now(),
          takerFee: 0, // Fee calculation should be done by the matching engine
          makerFee: 0,
        };

        trades.push(trade);

        // Update filled quantities
        aggressiveOrder.filledQuantity += matchQuantity;
        passiveOrder.filledQuantity += matchQuantity;
        remainingQuantity -= matchQuantity;

        // Update order status
        if (passiveOrder.filledQuantity >= passiveOrder.quantity) {
          passiveOrder.status = OrderStatus.FILLED;
        } else {
          passiveOrder.status = OrderStatus.PARTIALLY_FILLED;
        }

        i++;
      }
    }

    // Update aggressive order status
    if (aggressiveOrder.filledQuantity >= aggressiveOrder.quantity) {
      aggressiveOrder.status = OrderStatus.FILLED;
    } else if (aggressiveOrder.filledQuantity > 0) {
      aggressiveOrder.status = OrderStatus.PARTIALLY_FILLED;
    }

    return trades;
  }

  // Check if an aggressive order can match at a given price
  private canMatch(aggressiveOrder: Order, passivePrice: number): boolean {
    if (aggressiveOrder.side === OrderSide.BUY) {
      // Buy order matches if its price >= ask price
      return aggressiveOrder.price >= passivePrice;
    } else {
      // Sell order matches if its price <= bid price
      return aggressiveOrder.price <= passivePrice;
    }
  }

  // Validate price against tick size
  private isValidPrice(price: number): boolean {
    const remainder = price % this.tickSize;
    return Math.abs(remainder) < 1e-9 || Math.abs(remainder - this.tickSize) < 1e-9;
  }

  // Generate unique trade ID
  private generateTradeId(): string {
    return `${this.pair}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Get order by ID
  getOrder(orderId: string): Order | null {
    return this.orderIndex.get(orderId) || null;
  }

  // Get all orders at a specific price level
  getOrdersAtPrice(price: number, side: OrderSide): Order[] {
    const bookSide = side === OrderSide.BUY ? this.bids : this.asks;
    const level = bookSide.get(price);
    return level ? [...level.orders] : [];
  }

  // Get market depth up to a certain level
  getMarketDepth(levels: number = 10): { bids: number[][], asks: number[][] } {
    const snapshot = this.getSnapshot(levels);
    
    return {
      bids: snapshot.bids.map(level => [level.price, level.quantity]),
      asks: snapshot.asks.map(level => [level.price, level.quantity]),
    };
  }

  // Clear all orders from the book
  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.orderIndex.clear();
    this.sequenceNumber = 0;
  }

  // Get order book statistics
  getStats(): {
    bidCount: number;
    askCount: number;
    totalBidVolume: number;
    totalAskVolume: number;
    spread: number | null;
    midPrice: number | null;
  } {
    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();

    let totalBidVolume = 0;
    let bidCount = 0;
    for (const level of this.bids.values()) {
      totalBidVolume += level.quantity;
      bidCount += level.orders.length;
    }

    let totalAskVolume = 0;
    let askCount = 0;
    for (const level of this.asks.values()) {
      totalAskVolume += level.quantity;
      askCount += level.orders.length;
    }

    const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;
    const midPrice = bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : null;

    return {
      bidCount,
      askCount,
      totalBidVolume,
      totalAskVolume,
      spread,
      midPrice,
    };
  }
}