import { EventEmitter } from 'events';
import { Order, OrderSide, OrderType, Trade, ExecutionReport, OrderStatus } from './types';
import { MatchingEngine } from './MatchingEngine';
import { LiquidityAggregator, ExternalQuote, ExternalLiquidityProvider } from './ExternalLiquidityProvider';

export interface RouteSegment {
  source: 'internal' | 'external';
  provider?: string; // For external sources
  quantity: number;
  price: number;
  estimatedGas?: string;
  estimatedTime?: number;
  confidence?: number;
}

export interface ExecutionRoute {
  segments: RouteSegment[];
  totalQuantity: number;
  averagePrice: number;
  estimatedGas: string;
  estimatedTime: number;
  confidence: number; // 0-1, overall confidence in execution
}

export interface RouterConfig {
  enableExternal: boolean;
  externalThreshold: number; // Min quantity to consider external sources
  priceImprovementRequired: number; // % better price required to use external
  maxExternalSplits: number; // Max number of external providers to use
  smartRouting: boolean; // Enable ML-based routing
  urgencyMultiplier: number; // How much to weight execution speed
}

export interface ExecutionPlan {
  orderId: string;
  route: ExecutionRoute;
  internalOrders: Order[];
  externalQuotes: Array<{
    provider: string;
    quote: ExternalQuote;
  }>;
  estimatedOutcome: {
    fillRate: number; // 0-1
    averagePrice: number;
    totalFees: number;
    executionTime: number;
  };
}

export class SmartOrderRouter extends EventEmitter {
  private matchingEngine: MatchingEngine;
  private liquidityAggregator: LiquidityAggregator;
  private config: RouterConfig;
  private executionPlans: Map<string, ExecutionPlan> = new Map();
  private historicalData: Array<{
    timestamp: number;
    pair: string;
    internalLiquidity: number;
    externalLiquidity: number;
    spread: number;
  }> = [];

  constructor(
    matchingEngine: MatchingEngine,
    liquidityAggregator: LiquidityAggregator,
    config?: RouterConfig
  ) {
    super();
    this.matchingEngine = matchingEngine;
    this.liquidityAggregator = liquidityAggregator;
    this.config = config || {
      enableExternal: true,
      externalThreshold: 0.1,
      priceImprovementRequired: 0.001,
      maxExternalSplits: 3,
      smartRouting: true,
      urgencyMultiplier: 1.0
    };
    
    // Start liquidity monitoring
    this.startLiquidityMonitoring();
  }

  // Simplified execution method for tests
  async executeOrder(request: {
    userId: string;
    pair: string;
    side: OrderSide;
    quantity: number;
    maxSlippage?: number;
    optimizeFor?: 'price' | 'speed' | 'fill';
  }): Promise<{
    fills: Array<{
      venue: string;
      quantity: number;
      price: number;
      fee?: number;
    }>;
    averagePrice: number;
  }> {
    const fills: Array<{
      venue: string;
      quantity: number;
      price: number;
      fee?: number;
    }> = [];

    let remainingQuantity = request.quantity;

    // Try internal first
    const orderBook = this.matchingEngine.getOrderBook(request.pair);
    if (orderBook) {
      const availableInternal = request.side === OrderSide.BUY 
        ? orderBook.asks?.[0]?.quantity || 0
        : orderBook.bids?.[0]?.quantity || 0;
      
      if (availableInternal > 0) {
        const internalQuantity = Math.min(remainingQuantity, availableInternal);
        const internalPrice = request.side === OrderSide.BUY
          ? orderBook.asks?.[0]?.price || 0
          : orderBook.bids?.[0]?.price || 0;
        
        fills.push({
          venue: 'internal',
          quantity: internalQuantity,
          price: internalPrice,
          fee: internalQuantity * internalPrice * 0.002
        });
        
        remainingQuantity -= internalQuantity;
      }
    }

    // Try external if still need more
    if (remainingQuantity > 0) {
      const externalQuotes = await this.liquidityAggregator.getAllQuotes(
        request.pair,
        request.side === OrderSide.BUY ? 'buy' : 'sell',
        remainingQuantity
      );

      if (externalQuotes.length > 0) {
        const bestQuote = externalQuotes[0];
        const externalQuantity = Math.min(remainingQuantity, bestQuote.quote.quantity);
        
        fills.push({
          venue: bestQuote.quote.provider,
          quantity: externalQuantity,
          price: bestQuote.quote.price,
          fee: externalQuantity * bestQuote.quote.price * 0.003
        });
      }
    }

    const totalQuantity = fills.reduce((sum, fill) => sum + fill.quantity, 0);
    const totalValue = fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
    const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;

    return { fills, averagePrice };
  }

  async routeOrder(order: Order): Promise<ExecutionPlan> {
    const startTime = Date.now();
    
    try {
      // Analyze available liquidity
      const liquidityAnalysis = await this.analyzeLiquidity(
        order.pair,
        order.side,
        order.quantity
      );

      // Generate execution routes
      const routes = await this.generateRoutes(order, liquidityAnalysis);

      // Select optimal route
      const optimalRoute = this.selectOptimalRoute(routes, order);

      // Create execution plan
      const plan = await this.createExecutionPlan(order, optimalRoute);

      // Store plan
      this.executionPlans.set(order.id, plan);

      // Emit routing completed event
      this.emit('routing-completed', {
        orderId: order.id,
        plan,
        duration: Date.now() - startTime
      });

      return plan;
    } catch (error) {
      this.emit('routing-failed', {
        orderId: order.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime
      });
      throw error;
    }
  }

  private async analyzeLiquidity(
    pair: string,
    side: OrderSide,
    quantity: number
  ): Promise<{
    internal: {
      available: number;
      avgPrice: number;
      depth: Array<{ price: number; quantity: number }>;
    };
    external: Array<{
      provider: string;
      available: number;
      price: number;
      confidence: number;
    }>;
  }> {
    // Get internal liquidity
    const orderBook = this.matchingEngine.getOrderBookSnapshot(pair);
    const internalSide = side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
    
    let internalAvailable = 0;
    let internalValue = 0;
    const internalDepth: Array<{ price: number; quantity: number }> = [];

    for (const [price, qty] of internalSide) {
      const levelQty = Math.min(quantity - internalAvailable, qty);
      internalAvailable += levelQty;
      internalValue += levelQty * price;
      internalDepth.push({ price, quantity: qty });
      
      if (internalAvailable >= quantity) break;
    }

    const internalAvgPrice = internalAvailable > 0 ? internalValue / internalAvailable : 0;

    // Get external liquidity if enabled
    const external: Array<{
      provider: string;
      available: number;
      price: number;
      confidence: number;
    }> = [];

    if (this.config.enableExternal && quantity >= this.config.externalThreshold) {
      const externalQuotes = await this.liquidityAggregator.getAllQuotes(
        pair,
        side === OrderSide.BUY ? 'buy' : 'sell',
        quantity
      );

      for (const { quote, provider } of externalQuotes) {
        external.push({
          provider: provider.getName(),
          available: quote.quantity,
          price: quote.price,
          confidence: quote.confidence || 0.8
        });
      }
    }

    return {
      internal: {
        available: internalAvailable,
        avgPrice: internalAvgPrice,
        depth: internalDepth
      },
      external
    };
  }

  private async generateRoutes(
    order: Order,
    liquidityAnalysis: any
  ): Promise<ExecutionRoute[]> {
    const routes: ExecutionRoute[] = [];

    // Route 1: Internal only
    if (liquidityAnalysis.internal.available > 0) {
      routes.push({
        segments: [{
          source: 'internal',
          quantity: Math.min(order.quantity, liquidityAnalysis.internal.available),
          price: liquidityAnalysis.internal.avgPrice,
          estimatedTime: 1,
          confidence: 0.99
        }],
        totalQuantity: Math.min(order.quantity, liquidityAnalysis.internal.available),
        averagePrice: liquidityAnalysis.internal.avgPrice,
        estimatedGas: '0',
        estimatedTime: 1,
        confidence: 0.99
      });
    }

    // Route 2: External only (best provider)
    if (liquidityAnalysis.external.length > 0) {
      const bestExternal = liquidityAnalysis.external[0];
      routes.push({
        segments: [{
          source: 'external',
          provider: bestExternal.provider,
          quantity: Math.min(order.quantity, bestExternal.available),
          price: bestExternal.price,
          estimatedGas: '200000',
          estimatedTime: 30,
          confidence: bestExternal.confidence
        }],
        totalQuantity: Math.min(order.quantity, bestExternal.available),
        averagePrice: bestExternal.price,
        estimatedGas: '200000',
        estimatedTime: 30,
        confidence: bestExternal.confidence
      });
    }

    // Route 3: Hybrid (internal first, then external)
    if (
      liquidityAnalysis.internal.available > 0 &&
      liquidityAnalysis.internal.available < order.quantity &&
      liquidityAnalysis.external.length > 0
    ) {
      const segments: RouteSegment[] = [];
      let remainingQty = order.quantity;
      let totalValue = 0;
      let totalGas = BigInt(0);
      let maxTime = 0;
      let minConfidence = 1;

      // Add internal segment
      const internalQty = liquidityAnalysis.internal.available;
      segments.push({
        source: 'internal',
        quantity: internalQty,
        price: liquidityAnalysis.internal.avgPrice,
        estimatedTime: 1,
        confidence: 0.99
      });
      remainingQty -= internalQty;
      totalValue += internalQty * liquidityAnalysis.internal.avgPrice;
      maxTime = Math.max(maxTime, 1);
      minConfidence = Math.min(minConfidence, 0.99);

      // Add external segments
      for (const external of liquidityAnalysis.external.slice(0, this.config.maxExternalSplits)) {
        if (remainingQty <= 0) break;

        const externalQty = Math.min(remainingQty, external.available);
        segments.push({
          source: 'external',
          provider: external.provider,
          quantity: externalQty,
          price: external.price,
          estimatedGas: '200000',
          estimatedTime: 30,
          confidence: external.confidence
        });
        remainingQty -= externalQty;
        totalValue += externalQty * external.price;
        totalGas += BigInt(200000);
        maxTime = Math.max(maxTime, 30);
        minConfidence = Math.min(minConfidence, external.confidence);
      }

      const totalQuantity = order.quantity - remainingQty;
      routes.push({
        segments,
        totalQuantity,
        averagePrice: totalValue / totalQuantity,
        estimatedGas: totalGas.toString(),
        estimatedTime: maxTime,
        confidence: minConfidence
      });
    }

    // Route 4: Smart split across multiple external providers
    if (liquidityAnalysis.external.length > 1 && this.config.smartRouting) {
      const segments: RouteSegment[] = [];
      let remainingQty = order.quantity;
      let totalValue = 0;
      let totalGas = BigInt(0);
      let maxTime = 0;
      let weightedConfidence = 0;
      let totalWeight = 0;

      // Distribute across providers based on price and confidence
      const viableProviders = liquidityAnalysis.external
        .filter((p: any) => p.available > order.quantity * 0.1) // At least 10% of order
        .slice(0, this.config.maxExternalSplits);

      for (const provider of viableProviders) {
        if (remainingQty <= 0) break;

        // Calculate allocation based on price and confidence
        const priceScore = order.side === OrderSide.BUY 
          ? 1 / provider.price 
          : provider.price;
        const allocationScore = priceScore * provider.confidence;
        const allocation = Math.min(
          remainingQty,
          provider.available,
          order.quantity * 0.5 // Max 50% per provider
        );

        if (allocation > 0) {
          segments.push({
            source: 'external',
            provider: provider.provider,
            quantity: allocation,
            price: provider.price,
            estimatedGas: '200000',
            estimatedTime: 30,
            confidence: provider.confidence
          });

          remainingQty -= allocation;
          totalValue += allocation * provider.price;
          totalGas += BigInt(200000);
          maxTime = Math.max(maxTime, 30);
          weightedConfidence += provider.confidence * allocation;
          totalWeight += allocation;
        }
      }

      if (segments.length > 0) {
        const totalQuantity = order.quantity - remainingQty;
        routes.push({
          segments,
          totalQuantity,
          averagePrice: totalValue / totalQuantity,
          estimatedGas: totalGas.toString(),
          estimatedTime: maxTime,
          confidence: weightedConfidence / totalWeight
        });
      }
    }

    return routes;
  }

  private selectOptimalRoute(routes: ExecutionRoute[], order: Order): ExecutionRoute {
    if (routes.length === 0) {
      throw new Error('No viable routes found');
    }

    // Score each route
    const scoredRoutes = routes.map(route => {
      let score = 0;

      // Fill rate score (0-40 points)
      const fillRate = route.totalQuantity / order.quantity;
      score += fillRate * 40;

      // Price score (0-30 points)
      const priceScore = this.calculatePriceScore(route.averagePrice, order);
      score += priceScore * 30;

      // Confidence score (0-20 points)
      score += route.confidence * 20;

      // Speed score (0-10 points)
      const speedScore = Math.max(0, 1 - (route.estimatedTime / 60)); // Normalize to 1 minute
      score += speedScore * 10 * this.config.urgencyMultiplier;

      // Gas cost penalty
      const gasUSD = parseFloat(route.estimatedGas) * 0.00005; // Rough estimate
      const gasImpact = gasUSD / (order.quantity * route.averagePrice);
      score -= gasImpact * 10; // Penalty for high gas costs

      return { route, score };
    });

    // Sort by score
    scoredRoutes.sort((a, b) => b.score - a.score);

    this.emit('route-selection', {
      orderId: order.id,
      routes: scoredRoutes.map(sr => ({
        route: sr.route,
        score: sr.score
      })),
      selected: scoredRoutes[0].route
    });

    return scoredRoutes[0].route;
  }

  private calculatePriceScore(price: number, order: Order): number {
    if (order.type === OrderType.MARKET) {
      // For market orders, any price is acceptable
      return 1;
    }

    const limitPrice = order.price;
    const priceRatio = order.side === OrderSide.BUY
      ? limitPrice / price  // Lower is better for buys
      : price / limitPrice;  // Higher is better for sells

    // Score based on how much better than limit price
    if (priceRatio >= 1) {
      return 1; // Meeting or beating limit price
    } else if (priceRatio >= 0.95) {
      return 0.8; // Within 5% of limit
    } else {
      return Math.max(0, priceRatio); // Proportional score
    }
  }

  private async createExecutionPlan(
    order: Order,
    route: ExecutionRoute
  ): Promise<ExecutionPlan> {
    const internalOrders: Order[] = [];
    const externalQuotes: Array<{ provider: string; quote: ExternalQuote }> = [];

    // Create sub-orders for each segment
    for (const segment of route.segments) {
      if (segment.source === 'internal') {
        const internalOrder: Order = {
          ...order,
          id: `${order.id}-INT-${Date.now()}`,
          quantity: segment.quantity,
          price: segment.price
        };
        internalOrders.push(internalOrder);
      } else if (segment.provider) {
        // Get fresh quote for execution
        const quotes = await this.liquidityAggregator.getAllQuotes(
          order.pair,
          order.side === OrderSide.BUY ? 'buy' : 'sell',
          segment.quantity,
          order.userId
        );

        const providerQuote = quotes.find(q => q.provider.getName() === segment.provider);
        if (providerQuote) {
          externalQuotes.push({
            provider: segment.provider,
            quote: providerQuote.quote
          });
        }
      }
    }

    // Calculate estimated outcome
    const totalFees = route.segments.reduce((sum, seg) => {
      if (seg.source === 'internal') {
        return sum + (seg.quantity * seg.price * 0.002); // 0.2% fee
      } else {
        return sum + (seg.quantity * seg.price * 0.003); // 0.3% external fee estimate
      }
    }, 0);

    return {
      orderId: order.id,
      route,
      internalOrders,
      externalQuotes,
      estimatedOutcome: {
        fillRate: route.totalQuantity / order.quantity,
        averagePrice: route.averagePrice,
        totalFees,
        executionTime: route.estimatedTime
      }
    };
  }

  async executePlan(planId: string): Promise<{
    success: boolean;
    results: Array<{
      source: string;
      status: string;
      executedQuantity?: number;
      executedPrice?: number;
      error?: string;
    }>;
  }> {
    const plan = this.executionPlans.get(planId);
    if (!plan) {
      throw new Error('Execution plan not found');
    }

    const results: Array<any> = [];

    // Execute internal orders first
    for (const internalOrder of plan.internalOrders) {
      try {
        const executionReport = await this.matchingEngine.submitOrder(internalOrder);
        results.push({
          source: 'internal',
          status: 'completed',
          executedQuantity: executionReport.filledQuantity,
          executedPrice: executionReport.averagePrice
        });
      } catch (error) {
        results.push({
          source: 'internal',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Execute external orders
    for (const { provider, quote } of plan.externalQuotes) {
      try {
        const result = await this.liquidityAggregator.executeWithProvider(provider, {
          provider,
          quote,
          userAddress: plan.internalOrders[0]?.userId || '',
          slippage: 1
        });

        results.push({
          source: `external-${provider}`,
          status: result.status,
          executedQuantity: result.executedQuantity,
          executedPrice: result.executedPrice,
          error: result.error
        });
      } catch (error) {
        results.push({
          source: `external-${provider}`,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const success = results.some(r => r.status === 'completed' || r.status === 'pending');

    this.emit('execution-completed', {
      planId,
      success,
      results
    });

    return { success, results };
  }

  private startLiquidityMonitoring(): void {
    setInterval(() => {
      // Monitor liquidity depth for all active pairs
      const pairs = this.matchingEngine.getActivePairs();
      
      for (const pair of pairs) {
        const snapshot = this.matchingEngine.getOrderBookSnapshot(pair);
        const bestBid = snapshot.bids[0]?.[0] || 0;
        const bestAsk = snapshot.asks[0]?.[0] || 0;
        const spread = bestAsk - bestBid;
        
        const internalLiquidity = 
          snapshot.bids.reduce((sum, [_, qty]) => sum + qty, 0) +
          snapshot.asks.reduce((sum, [_, qty]) => sum + qty, 0);

        this.historicalData.push({
          timestamp: Date.now(),
          pair,
          internalLiquidity,
          externalLiquidity: 0, // Would need to query external sources
          spread
        });

        // Keep only last hour of data
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        this.historicalData = this.historicalData.filter(d => d.timestamp > oneHourAgo);
      }
    }, 10000); // Every 10 seconds
  }

  getExecutionPlan(orderId: string): ExecutionPlan | undefined {
    return this.executionPlans.get(orderId);
  }

  getLiquidityMetrics(pair: string): {
    avgInternalLiquidity: number;
    avgSpread: number;
    liquidityTrend: 'increasing' | 'decreasing' | 'stable';
  } {
    const pairData = this.historicalData.filter(d => d.pair === pair);
    
    if (pairData.length === 0) {
      return {
        avgInternalLiquidity: 0,
        avgSpread: 0,
        liquidityTrend: 'stable'
      };
    }

    const avgInternalLiquidity = pairData.reduce((sum, d) => sum + d.internalLiquidity, 0) / pairData.length;
    const avgSpread = pairData.reduce((sum, d) => sum + d.spread, 0) / pairData.length;

    // Calculate trend
    const recentData = pairData.slice(-6); // Last minute
    const olderData = pairData.slice(-12, -6); // Previous minute
    
    const recentAvg = recentData.reduce((sum, d) => sum + d.internalLiquidity, 0) / (recentData.length || 1);
    const olderAvg = olderData.reduce((sum, d) => sum + d.internalLiquidity, 0) / (olderData.length || 1);

    let liquidityTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (recentAvg > olderAvg * 1.1) {
      liquidityTrend = 'increasing';
    } else if (recentAvg < olderAvg * 0.9) {
      liquidityTrend = 'decreasing';
    }

    return {
      avgInternalLiquidity,
      avgSpread,
      liquidityTrend
    };
  }
}