import { EventEmitter } from 'events';
import { MatchingEngine } from './MatchingEngine';
import { SmartOrderRouter, ExecutionPlan, RouterConfig } from './SmartOrderRouter';
import { LiquidityAggregator, LiFiProvider, UniswapProvider } from './ExternalLiquidityProvider';
import { lifiService } from '../lifiService';
import {
  Order,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce,
  ExecutionReport,
  Trade
} from './types';

export interface HybridMatchingConfig {
  enableHybridMatching: boolean;
  routerConfig: RouterConfig;
  fallbackConfig: {
    maxRetries: number;
    retryDelay: number;
    useInternalOnlyFallback: boolean;
  };
  liquidityProviders: {
    lifi: boolean;
    uniswap: boolean;
    // Add more providers as needed
  };
}

export interface HybridExecutionReport extends ExecutionReport {
  executionPlan?: ExecutionPlan;
  externalExecutions?: Array<{
    provider: string;
    status: 'pending' | 'completed' | 'failed';
    txHash?: string;
    quantity?: number;
    price?: number;
    error?: string;
  }>;
  routingMetrics?: {
    routingTime: number;
    executionTime: number;
    gasUsed?: string;
    gasPrice?: string;
  };
}

export class EnhancedHybridMatchingEngine extends EventEmitter {
  private matchingEngine: MatchingEngine;
  private smartRouter: SmartOrderRouter;
  private liquidityAggregator: LiquidityAggregator;
  private config: HybridMatchingConfig;
  private activeExecutions: Map<string, {
    order: Order;
    plan: ExecutionPlan;
    status: 'routing' | 'executing' | 'completed' | 'failed';
    startTime: number;
  }> = new Map();

  constructor(matchingEngine: MatchingEngine, config: HybridMatchingConfig) {
    super();
    this.matchingEngine = matchingEngine;
    this.config = config;

    // Initialize liquidity aggregator
    this.liquidityAggregator = new LiquidityAggregator();
    this.initializeLiquidityProviders();

    // Initialize smart router
    this.smartRouter = new SmartOrderRouter(
      matchingEngine,
      this.liquidityAggregator,
      config.routerConfig
    );

    this.setupEventHandlers();
  }

  private initializeLiquidityProviders(): void {
    // Token registry for mapping symbols to addresses
    const tokenRegistry = new Map([
      ['ETH', { address: '0x0000000000000000000000000000000000000000', decimals: 18, chainId: 1 }],
      ['USDC', { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, chainId: 1 }],
      ['USDT', { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6, chainId: 1 }],
      ['WBTC', { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8, chainId: 1 }],
    ]);

    // Add LiFi provider
    if (this.config.liquidityProviders.lifi) {
      const lifiProvider = new LiFiProvider(lifiService, tokenRegistry);
      this.liquidityAggregator.addProvider(lifiProvider);
    }

    // Add Uniswap provider
    if (this.config.liquidityProviders.uniswap) {
      const uniswapProvider = new UniswapProvider();
      this.liquidityAggregator.addProvider(uniswapProvider);
    }
  }

  private setupEventHandlers(): void {
    // Smart router events
    this.smartRouter.on('routing-completed', (data) => {
      this.emit('hybrid:routing-completed', data);
    });

    this.smartRouter.on('routing-failed', (data) => {
      this.emit('hybrid:routing-failed', data);
      this.handleRoutingFailure(data.orderId, data.error);
    });

    this.smartRouter.on('execution-completed', (data) => {
      this.emit('hybrid:execution-completed', data);
    });

    // Liquidity aggregator events
    this.liquidityAggregator.on('provider-execution-completed', (data) => {
      this.handleExternalExecutionUpdate(data);
    });

    this.liquidityAggregator.on('provider-execution-failed', (data) => {
      this.handleExternalExecutionFailure(data);
    });
  }

  async submitOrder(orderRequest: Partial<Order>): Promise<HybridExecutionReport> {
    // Create order
    const order: Order = {
      id: this.generateOrderId(),
      userId: orderRequest.userId!,
      pair: orderRequest.pair!,
      side: orderRequest.side!,
      type: orderRequest.type!,
      price: orderRequest.price || 0,
      quantity: orderRequest.quantity!,
      filledQuantity: 0,
      status: OrderStatus.PENDING,
      timeInForce: orderRequest.timeInForce || TimeInForce.GTC,
      timestamp: Date.now(),
      lastUpdateTime: Date.now(),
      clientOrderId: orderRequest.clientOrderId,
      metadata: orderRequest.metadata
    };

    const startTime = Date.now();

    try {
      // Check if hybrid matching is enabled
      if (!this.config.enableHybridMatching || order.quantity < this.config.routerConfig.externalThreshold) {
        // Use traditional internal matching only
        return await this.executeInternalOnly(order);
      }

      // Route order through smart router
      this.activeExecutions.set(order.id, {
        order,
        plan: null as any, // Will be set after routing
        status: 'routing',
        startTime
      });

      const executionPlan = await this.smartRouter.routeOrder(order);

      // Update active execution
      const activeExecution = this.activeExecutions.get(order.id)!;
      activeExecution.plan = executionPlan;
      activeExecution.status = 'executing';

      // Execute the plan
      const executionResults = await this.smartRouter.executePlan(order.id);

      // Create hybrid execution report
      const report = this.createHybridExecutionReport(
        order,
        executionPlan,
        executionResults,
        startTime
      );

      // Update order status
      order.status = this.determineOrderStatus(report);
      order.filledQuantity = report.filledQuantity;
      order.lastUpdateTime = Date.now();

      // Update active execution
      activeExecution.status = order.status === OrderStatus.FILLED ? 'completed' : 'failed';

      this.emit('hybrid:order-executed', { order, report });

      return report;

    } catch (error) {
      console.error('Hybrid execution error:', error);
      
      // Fallback handling
      if (this.config.fallbackConfig.useInternalOnlyFallback) {
        this.emit('hybrid:fallback-triggered', { orderId: order.id, reason: error });
        return await this.executeInternalOnly(order);
      }

      throw error;
    } finally {
      // Cleanup after some delay
      setTimeout(() => {
        this.activeExecutions.delete(order.id);
      }, 60000); // Keep for 1 minute for status queries
    }
  }

  private async executeInternalOnly(order: Order): Promise<HybridExecutionReport> {
    const executionReport = await this.matchingEngine.submitOrder(order);
    
    // Convert to hybrid execution report
    return {
      ...executionReport,
      routingMetrics: {
        routingTime: 0,
        executionTime: 0
      }
    };
  }

  private createHybridExecutionReport(
    order: Order,
    plan: ExecutionPlan,
    executionResults: any,
    startTime: number
  ): HybridExecutionReport {
    let totalFilled = 0;
    let totalValue = 0;
    const trades: Trade[] = [];
    const externalExecutions: any[] = [];

    // Process execution results
    for (const result of executionResults.results) {
      if (result.source === 'internal' && result.executedQuantity) {
        totalFilled += result.executedQuantity;
        totalValue += result.executedQuantity * result.executedPrice;
        
        // Internal trades would be in the matching engine
        // We'd need to fetch them based on the internal order IDs
      } else if (result.source.startsWith('external-') && result.executedQuantity) {
        totalFilled += result.executedQuantity;
        totalValue += result.executedQuantity * result.executedPrice;
        
        externalExecutions.push({
          provider: result.source.replace('external-', ''),
          status: result.status,
          quantity: result.executedQuantity,
          price: result.executedPrice,
          error: result.error
        });
      }
    }

    const avgPrice = totalFilled > 0 ? totalValue / totalFilled : 0;

    return {
      orderId: order.id,
      clientOrderId: order.clientOrderId,
      executionId: `EXEC-${Date.now()}`,
      status: this.determineOrderStatus({ filledQuantity: totalFilled, quantity: order.quantity } as any),
      orderStatus: order.status,
      side: order.side,
      pair: order.pair,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: totalFilled,
      remainingQuantity: order.quantity - totalFilled,
      averagePrice: avgPrice,
      trades,
      timestamp: Date.now(),
      message: executionResults.success ? 'Order executed successfully' : 'Partial execution',
      executionPlan: plan,
      externalExecutions,
      routingMetrics: {
        routingTime: plan.route.estimatedTime,
        executionTime: Date.now() - startTime
      }
    };
  }

  private determineOrderStatus(report: { filledQuantity: number; quantity: number }): OrderStatus {
    if (report.filledQuantity === 0) {
      return OrderStatus.CANCELLED;
    } else if (report.filledQuantity >= report.quantity) {
      return OrderStatus.FILLED;
    } else {
      return OrderStatus.PARTIALLY_FILLED;
    }
  }

  private async handleRoutingFailure(orderId: string, error: string): Promise<void> {
    const execution = this.activeExecutions.get(orderId);
    if (!execution) return;

    if (this.config.fallbackConfig.maxRetries > 0) {
      // Implement retry logic
      this.emit('hybrid:retry-attempted', { orderId, attempt: 1 });
      
      // For now, just mark as failed
      execution.status = 'failed';
    }
  }

  private handleExternalExecutionUpdate(data: any): void {
    // Update order status based on external execution
    this.emit('hybrid:external-update', data);
  }

  private handleExternalExecutionFailure(data: any): void {
    // Handle external execution failures
    this.emit('hybrid:external-failure', data);
  }

  // Query methods
  getActiveExecutions(): Array<{
    orderId: string;
    status: string;
    startTime: number;
    plan?: ExecutionPlan;
  }> {
    return Array.from(this.activeExecutions.entries()).map(([orderId, exec]) => ({
      orderId,
      status: exec.status,
      startTime: exec.startTime,
      plan: exec.plan
    }));
  }

  getExecutionStatus(orderId: string): {
    status: string;
    plan?: ExecutionPlan;
    duration?: number;
  } | null {
    const execution = this.activeExecutions.get(orderId);
    if (!execution) return null;

    return {
      status: execution.status,
      plan: execution.plan,
      duration: Date.now() - execution.startTime
    };
  }

  getLiquidityMetrics(pair: string): any {
    return this.smartRouter.getLiquidityMetrics(pair);
  }

  // Admin methods
  updateProviderStatus(providerName: string, enabled: boolean): void {
    if (!enabled) {
      this.liquidityAggregator.removeProvider(providerName);
    }
    // To re-enable, would need to re-initialize the provider
  }

  updateRouterConfig(config: Partial<RouterConfig>): void {
    Object.assign(this.config.routerConfig, config);
    this.emit('hybrid:config-updated', { config });
  }

  private generateOrderId(): string {
    return `HYB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}