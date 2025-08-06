import { EventEmitter } from 'events';
import * as promClient from 'prom-client';
import { Pool } from 'pg';
import Redis from 'ioredis';

export interface BusinessMetrics {
  orders: {
    totalCount: number;
    countByStatus: Record<string, number>;
    countByPair: Record<string, number>;
    averageSize: number;
    largeOrderCount: number;
  };
  volume: {
    total24h: number;
    byPair24h: Record<string, number>;
    byHour: number[];
    movingAverage: number;
  };
  fees: {
    total24h: number;
    byPair24h: Record<string, number>;
    averagePerOrder: number;
    byFeeType: Record<string, number>;
  };
  users: {
    activeDaily: number;
    activeWeekly: number;
    newToday: number;
    totalRegistered: number;
    topTraders: Array<{ userId: string; volume: number }>;
  };
  liquidity: {
    totalValueLocked: number;
    byPair: Record<string, number>;
    utilizationRate: number;
    turnoverRate: number;
  };
  market: {
    spreads: Record<string, number>;
    depths: Record<string, { bid: number; ask: number }>;
    volatility: Record<string, number>;
    priceImpact: Record<string, number>;
  };
}

export class BusinessMetricsCollector extends EventEmitter {
  private db: Pool;
  private redis: Redis;
  private metricsCache: Map<string, any> = new Map();
  private updateInterval?: NodeJS.Timeout;
  
  // Prometheus metrics
  private ordersPerMinute: promClient.Gauge;
  private orderVolume24h: promClient.Gauge;
  private tradingFees24h: promClient.Gauge;
  private activeUsers: promClient.Gauge;
  private totalValueLocked: promClient.Gauge;
  private marketSpread: promClient.Gauge;
  private liquidityDepth: promClient.Gauge;
  private userRetention: promClient.Gauge;
  private revenuePerUser: promClient.Gauge;
  private marketShare: promClient.Gauge;
  
  constructor(db: Pool, redis: Redis) {
    super();
    this.db = db;
    this.redis = redis;
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    // Orders metrics
    this.ordersPerMinute = new promClient.Gauge({
      name: 'dex_orders_per_minute',
      help: 'Number of orders placed per minute',
      labelNames: ['pair', 'type', 'status'],
    });

    // Volume metrics
    this.orderVolume24h = new promClient.Gauge({
      name: 'dex_trading_volume_24h_usd',
      help: 'Trading volume in USD over last 24 hours',
      labelNames: ['pair', 'side'],
    });

    // Fee metrics
    this.tradingFees24h = new promClient.Gauge({
      name: 'dex_trading_fees_24h_usd',
      help: 'Trading fees collected in USD over last 24 hours',
      labelNames: ['pair', 'fee_type'],
    });

    // User metrics
    this.activeUsers = new promClient.Gauge({
      name: 'dex_active_users',
      help: 'Number of active users',
      labelNames: ['period', 'user_type'],
    });

    // Liquidity metrics
    this.totalValueLocked = new promClient.Gauge({
      name: 'dex_total_value_locked_usd',
      help: 'Total value locked in the DEX in USD',
      labelNames: ['pair', 'token'],
    });

    // Market metrics
    this.marketSpread = new promClient.Gauge({
      name: 'dex_market_spread_percent',
      help: 'Market spread as percentage',
      labelNames: ['pair'],
    });

    this.liquidityDepth = new promClient.Gauge({
      name: 'dex_liquidity_depth_usd',
      help: 'Liquidity depth at various price levels',
      labelNames: ['pair', 'side', 'depth_percent'],
    });

    // Business KPIs
    this.userRetention = new promClient.Gauge({
      name: 'dex_user_retention_rate',
      help: 'User retention rate',
      labelNames: ['cohort', 'period'],
    });

    this.revenuePerUser = new promClient.Gauge({
      name: 'dex_revenue_per_user_usd',
      help: 'Average revenue per user in USD',
      labelNames: ['user_segment', 'period'],
    });

    this.marketShare = new promClient.Gauge({
      name: 'dex_market_share_percent',
      help: 'DEX market share percentage',
      labelNames: ['market', 'competitor'],
    });
  }

  async start(intervalMs: number = 60000): Promise<void> {
    // Initial collection
    await this.collectAllMetrics();
    
    // Schedule periodic updates
    this.updateInterval = setInterval(async () => {
      try {
        await this.collectAllMetrics();
      } catch (error) {
        console.error('Error collecting business metrics:', error);
        this.emit('error', error);
      }
    }, intervalMs);
    
    console.log(`📊 Business metrics collector started (interval: ${intervalMs}ms)`);
  }

  private async collectAllMetrics(): Promise<void> {
    const [
      orderMetrics,
      volumeMetrics,
      feeMetrics,
      userMetrics,
      liquidityMetrics,
      marketMetrics,
    ] = await Promise.all([
      this.collectOrderMetrics(),
      this.collectVolumeMetrics(),
      this.collectFeeMetrics(),
      this.collectUserMetrics(),
      this.collectLiquidityMetrics(),
      this.collectMarketMetrics(),
    ]);

    const metrics: BusinessMetrics = {
      orders: orderMetrics,
      volume: volumeMetrics,
      fees: feeMetrics,
      users: userMetrics,
      liquidity: liquidityMetrics,
      market: marketMetrics,
    };

    // Update Prometheus metrics
    this.updatePrometheusMetrics(metrics);
    
    // Cache metrics
    this.metricsCache.set('current', metrics);
    this.metricsCache.set('timestamp', Date.now());
    
    // Store in Redis for historical data
    await this.storeMetricsInRedis(metrics);
    
    this.emit('metrics-updated', metrics);
  }

  private async collectOrderMetrics(): Promise<BusinessMetrics['orders']> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get order statistics
    const orderStats = await this.db.query(`
      SELECT 
        COUNT(*) as total_count,
        status,
        pair,
        AVG(quantity * price) as avg_size,
        COUNT(CASE WHEN quantity * price > 10000 THEN 1 END) as large_orders
      FROM orders
      WHERE created_at >= $1
      GROUP BY status, pair
    `, [oneDayAgo]);
    
    // Get orders per minute
    const ordersPerMin = await this.db.query(`
      SELECT COUNT(*) as count
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '1 minute'
    `);
    
    // Process results
    const countByStatus: Record<string, number> = {};
    const countByPair: Record<string, number> = {};
    let totalCount = 0;
    let totalSize = 0;
    let largeOrderCount = 0;
    
    for (const row of orderStats.rows) {
      const count = parseInt(row.total_count);
      totalCount += count;
      totalSize += parseFloat(row.avg_size) * count;
      largeOrderCount += parseInt(row.large_orders);
      
      countByStatus[row.status] = (countByStatus[row.status] || 0) + count;
      countByPair[row.pair] = (countByPair[row.pair] || 0) + count;
    }
    
    // Update real-time metric
    const currentOrdersPerMin = parseInt(ordersPerMin.rows[0]?.count || '0');
    
    return {
      totalCount,
      countByStatus,
      countByPair,
      averageSize: totalCount > 0 ? totalSize / totalCount : 0,
      largeOrderCount,
    };
  }

  private async collectVolumeMetrics(): Promise<BusinessMetrics['volume']> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Get 24h volume
    const volumeStats = await this.db.query(`
      SELECT 
        pair,
        SUM(quantity * price) as volume,
        DATE_TRUNC('hour', executed_at) as hour
      FROM trades
      WHERE executed_at >= $1
      GROUP BY pair, hour
      ORDER BY hour
    `, [oneDayAgo]);
    
    // Process results
    const byPair24h: Record<string, number> = {};
    const byHour: number[] = new Array(24).fill(0);
    let total24h = 0;
    
    for (const row of volumeStats.rows) {
      const volume = parseFloat(row.volume);
      total24h += volume;
      byPair24h[row.pair] = (byPair24h[row.pair] || 0) + volume;
      
      const hourIndex = new Date(row.hour).getHours();
      byHour[hourIndex] += volume;
    }
    
    // Calculate moving average (7-day)
    const movingAvgResult = await this.db.query(`
      SELECT AVG(daily_volume) as avg_volume
      FROM (
        SELECT DATE_TRUNC('day', executed_at) as day, 
               SUM(quantity * price) as daily_volume
        FROM trades
        WHERE executed_at >= NOW() - INTERVAL '7 days'
        GROUP BY day
      ) daily_volumes
    `);
    
    const movingAverage = parseFloat(movingAvgResult.rows[0]?.avg_volume || '0');
    
    return {
      total24h,
      byPair24h,
      byHour,
      movingAverage,
    };
  }

  private async collectFeeMetrics(): Promise<BusinessMetrics['fees']> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    // Get fee statistics
    const feeStats = await this.db.query(`
      SELECT 
        pair,
        fee_type,
        SUM(fee_amount) as total_fees,
        COUNT(*) as trade_count
      FROM trades
      WHERE executed_at >= $1
      GROUP BY pair, fee_type
    `, [oneDayAgo]);
    
    // Process results
    const byPair24h: Record<string, number> = {};
    const byFeeType: Record<string, number> = {};
    let total24h = 0;
    let totalTrades = 0;
    
    for (const row of feeStats.rows) {
      const fees = parseFloat(row.total_fees);
      const trades = parseInt(row.trade_count);
      
      total24h += fees;
      totalTrades += trades;
      byPair24h[row.pair] = (byPair24h[row.pair] || 0) + fees;
      byFeeType[row.fee_type] = (byFeeType[row.fee_type] || 0) + fees;
    }
    
    return {
      total24h,
      byPair24h,
      averagePerOrder: totalTrades > 0 ? total24h / totalTrades : 0,
      byFeeType,
    };
  }

  private async collectUserMetrics(): Promise<BusinessMetrics['users']> {
    // Daily active users
    const dauResult = await this.db.query(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM user_activity
      WHERE last_activity >= NOW() - INTERVAL '1 day'
    `);
    
    // Weekly active users
    const wauResult = await this.db.query(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM user_activity
      WHERE last_activity >= NOW() - INTERVAL '7 days'
    `);
    
    // New users today
    const newUsersResult = await this.db.query(`
      SELECT COUNT(*) as count
      FROM users
      WHERE created_at >= CURRENT_DATE
    `);
    
    // Total registered users
    const totalUsersResult = await this.db.query(`
      SELECT COUNT(*) as count FROM users
    `);
    
    // Top traders by volume
    const topTradersResult = await this.db.query(`
      SELECT 
        user_id,
        SUM(quantity * price) as volume
      FROM trades
      WHERE executed_at >= NOW() - INTERVAL '24 hours'
      GROUP BY user_id
      ORDER BY volume DESC
      LIMIT 10
    `);
    
    return {
      activeDaily: parseInt(dauResult.rows[0]?.count || '0'),
      activeWeekly: parseInt(wauResult.rows[0]?.count || '0'),
      newToday: parseInt(newUsersResult.rows[0]?.count || '0'),
      totalRegistered: parseInt(totalUsersResult.rows[0]?.count || '0'),
      topTraders: topTradersResult.rows.map(row => ({
        userId: row.user_id,
        volume: parseFloat(row.volume),
      })),
    };
  }

  private async collectLiquidityMetrics(): Promise<BusinessMetrics['liquidity']> {
    // Get TVL from liquidity pools
    const tvlResult = await this.db.query(`
      SELECT 
        pair,
        token,
        SUM(amount * price_usd) as value_locked
      FROM liquidity_pools
      WHERE active = true
      GROUP BY pair, token
    `);
    
    // Calculate metrics
    const byPair: Record<string, number> = {};
    let totalValueLocked = 0;
    
    for (const row of tvlResult.rows) {
      const value = parseFloat(row.value_locked);
      totalValueLocked += value;
      byPair[row.pair] = (byPair[row.pair] || 0) + value;
    }
    
    // Get utilization rate
    const utilizationResult = await this.db.query(`
      SELECT 
        AVG(utilized_amount / total_amount) as utilization_rate
      FROM liquidity_pools
      WHERE active = true AND total_amount > 0
    `);
    
    // Get turnover rate (24h volume / TVL)
    const volumeResult = await this.db.query(`
      SELECT SUM(quantity * price) as volume
      FROM trades
      WHERE executed_at >= NOW() - INTERVAL '24 hours'
    `);
    
    const volume24h = parseFloat(volumeResult.rows[0]?.volume || '0');
    const turnoverRate = totalValueLocked > 0 ? volume24h / totalValueLocked : 0;
    
    return {
      totalValueLocked,
      byPair,
      utilizationRate: parseFloat(utilizationResult.rows[0]?.utilization_rate || '0'),
      turnoverRate,
    };
  }

  private async collectMarketMetrics(): Promise<BusinessMetrics['market']> {
    // Get current order book data from Redis
    const pairs = ['ETH/USDT', 'BTC/USDT', 'MATIC/USDT']; // Add more pairs as needed
    
    const spreads: Record<string, number> = {};
    const depths: Record<string, { bid: number; ask: number }> = {};
    const volatility: Record<string, number> = {};
    const priceImpact: Record<string, number> = {};
    
    for (const pair of pairs) {
      // Get order book snapshot
      const orderBookKey = `orderbook:${pair}`;
      const [bids, asks] = await Promise.all([
        this.redis.zrevrange(`${orderBookKey}:bids`, 0, -1, 'WITHSCORES'),
        this.redis.zrange(`${orderBookKey}:asks`, 0, -1, 'WITHSCORES'),
      ]);
      
      if (bids.length >= 2 && asks.length >= 2) {
        const bestBid = parseFloat(bids[1]);
        const bestAsk = parseFloat(asks[1]);
        
        // Calculate spread
        spreads[pair] = ((bestAsk - bestBid) / bestAsk) * 100;
        
        // Calculate depth at 1% from mid price
        const midPrice = (bestBid + bestAsk) / 2;
        const depthBid = this.calculateDepthAtPrice(bids, midPrice * 0.99);
        const depthAsk = this.calculateDepthAtPrice(asks, midPrice * 1.01);
        
        depths[pair] = { bid: depthBid, ask: depthAsk };
      }
      
      // Get volatility (24h price range)
      const priceStats = await this.db.query(`
        SELECT 
          STDDEV(price) / AVG(price) as volatility,
          MAX(price) - MIN(price) as price_range
        FROM trades
        WHERE pair = $1 AND executed_at >= NOW() - INTERVAL '24 hours'
      `, [pair]);
      
      if (priceStats.rows.length > 0) {
        volatility[pair] = parseFloat(priceStats.rows[0].volatility || '0') * 100;
      }
      
      // Calculate price impact for $10k order
      priceImpact[pair] = this.calculatePriceImpact(asks, 10000);
    }
    
    return {
      spreads,
      depths,
      volatility,
      priceImpact,
    };
  }

  private calculateDepthAtPrice(orders: string[], targetPrice: number): number {
    let totalValue = 0;
    
    for (let i = 0; i < orders.length; i += 2) {
      const price = parseFloat(orders[i + 1]);
      const quantity = parseFloat(orders[i]);
      
      if (price <= targetPrice) {
        totalValue += price * quantity;
      }
    }
    
    return totalValue;
  }

  private calculatePriceImpact(asks: string[], orderValue: number): number {
    let remainingValue = orderValue;
    let totalQuantity = 0;
    let weightedPrice = 0;
    
    for (let i = 0; i < asks.length && remainingValue > 0; i += 2) {
      const price = parseFloat(asks[i + 1]);
      const quantity = parseFloat(asks[i]);
      const orderValue = price * quantity;
      
      if (orderValue <= remainingValue) {
        totalQuantity += quantity;
        weightedPrice += price * quantity;
        remainingValue -= orderValue;
      } else {
        const partialQuantity = remainingValue / price;
        totalQuantity += partialQuantity;
        weightedPrice += price * partialQuantity;
        remainingValue = 0;
      }
    }
    
    if (totalQuantity === 0) return 0;
    
    const avgExecutionPrice = weightedPrice / totalQuantity;
    const bestAskPrice = asks.length >= 2 ? parseFloat(asks[1]) : 0;
    
    return bestAskPrice > 0 ? ((avgExecutionPrice - bestAskPrice) / bestAskPrice) * 100 : 0;
  }

  private updatePrometheusMetrics(metrics: BusinessMetrics): void {
    // Update orders metrics
    for (const [pair, count] of Object.entries(metrics.orders.countByPair)) {
      for (const [status, statusCount] of Object.entries(metrics.orders.countByStatus)) {
        this.ordersPerMinute.set(
          { pair, type: 'all', status },
          statusCount / 60 // Convert to per minute
        );
      }
    }
    
    // Update volume metrics
    for (const [pair, volume] of Object.entries(metrics.volume.byPair24h)) {
      this.orderVolume24h.set({ pair, side: 'all' }, volume);
    }
    
    // Update fee metrics
    for (const [pair, fees] of Object.entries(metrics.fees.byPair24h)) {
      this.tradingFees24h.set({ pair, fee_type: 'all' }, fees);
    }
    
    // Update user metrics
    this.activeUsers.set({ period: '1d', user_type: 'all' }, metrics.users.activeDaily);
    this.activeUsers.set({ period: '7d', user_type: 'all' }, metrics.users.activeWeekly);
    
    // Update liquidity metrics
    this.totalValueLocked.set({ pair: 'all', token: 'all' }, metrics.liquidity.totalValueLocked);
    
    for (const [pair, value] of Object.entries(metrics.liquidity.byPair)) {
      this.totalValueLocked.set({ pair, token: 'all' }, value);
    }
    
    // Update market metrics
    for (const [pair, spread] of Object.entries(metrics.market.spreads)) {
      this.marketSpread.set({ pair }, spread);
    }
    
    for (const [pair, depth] of Object.entries(metrics.market.depths)) {
      this.liquidityDepth.set({ pair, side: 'bid', depth_percent: '1' }, depth.bid);
      this.liquidityDepth.set({ pair, side: 'ask', depth_percent: '1' }, depth.ask);
    }
  }

  private async storeMetricsInRedis(metrics: BusinessMetrics): Promise<void> {
    const timestamp = Date.now();
    const key = `business_metrics:${timestamp}`;
    
    // Store with 7-day TTL
    await this.redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(metrics));
    
    // Add to sorted set for time-based queries
    await this.redis.zadd('business_metrics:timeline', timestamp, key);
    
    // Cleanup old entries (keep 30 days)
    const cutoff = timestamp - 30 * 24 * 60 * 60 * 1000;
    await this.redis.zremrangebyscore('business_metrics:timeline', 0, cutoff);
  }

  async getHistoricalMetrics(
    startTime: number,
    endTime: number,
    interval: 'hour' | 'day' = 'hour'
  ): Promise<Array<BusinessMetrics & { timestamp: number }>> {
    const keys = await this.redis.zrangebyscore(
      'business_metrics:timeline',
      startTime,
      endTime
    );
    
    const metrics: Array<BusinessMetrics & { timestamp: number }> = [];
    
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const timestamp = parseInt(key.split(':')[1]);
        metrics.push({
          ...JSON.parse(data),
          timestamp,
        });
      }
    }
    
    // Aggregate by interval if needed
    if (interval === 'day' && metrics.length > 24) {
      return this.aggregateMetricsByDay(metrics);
    }
    
    return metrics;
  }

  private aggregateMetricsByDay(
    metrics: Array<BusinessMetrics & { timestamp: number }>
  ): Array<BusinessMetrics & { timestamp: number }> {
    const dailyMetrics = new Map<string, BusinessMetrics[]>();
    
    // Group by day
    for (const metric of metrics) {
      const date = new Date(metric.timestamp);
      const dayKey = date.toISOString().split('T')[0];
      
      if (!dailyMetrics.has(dayKey)) {
        dailyMetrics.set(dayKey, []);
      }
      dailyMetrics.get(dayKey)!.push(metric);
    }
    
    // Aggregate each day
    const aggregated: Array<BusinessMetrics & { timestamp: number }> = [];
    
    for (const [day, dayMetrics] of dailyMetrics) {
      // For simplicity, take the average of numeric values
      // In production, you might want more sophisticated aggregation
      const avgMetric = this.averageMetrics(dayMetrics);
      aggregated.push({
        ...avgMetric,
        timestamp: new Date(day).getTime(),
      });
    }
    
    return aggregated.sort((a, b) => a.timestamp - b.timestamp);
  }

  private averageMetrics(metrics: BusinessMetrics[]): BusinessMetrics {
    // Implementation would average all numeric fields
    // For brevity, returning the last metric
    return metrics[metrics.length - 1];
  }

  getCurrentMetrics(): BusinessMetrics | null {
    return this.metricsCache.get('current') || null;
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
  }
}