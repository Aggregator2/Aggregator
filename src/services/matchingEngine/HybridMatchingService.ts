import { EventEmitter } from 'events';
import { getMatchingEngine, tokenToSymbol } from './singleton';
import { lifiService, LifiQuoteRequest, LifiRoute } from '../lifiService';
import { ethers } from 'ethers';
import {
  Order,
  OrderType,
  OrderSide,
  TimeInForce,
  ExecutionReport,
  Trade,
  OrderStatus
} from './types';

export interface HybridQuote {
  source: 'internal' | 'external';
  price: number;
  quantity: number;
  totalValue: number;
  fees: number;
  route?: LifiRoute;
  internalTrades?: Trade[];
}

export interface HybridExecutionResult {
  orderId: string;
  status: 'filled' | 'partially_filled' | 'pending_external' | 'failed';
  internalExecution?: ExecutionReport;
  externalExecution?: {
    route: LifiRoute;
    txHash?: string;
    status: 'pending' | 'completed' | 'failed';
  };
  totalFilled: number;
  averagePrice: number;
  breakdown: {
    internal: {
      quantity: number;
      value: number;
      averagePrice: number;
    };
    external: {
      quantity: number;
      value: number;
      averagePrice: number;
    };
  };
}

interface TokenInfo {
  symbol: string;
  address: string;
  decimals: number;
  chainId: number;
}

export class HybridMatchingService extends EventEmitter {
  private matchingEngine = getMatchingEngine();
  private tokenRegistry: Map<string, TokenInfo> = new Map();
  private pendingExternalOrders: Map<string, HybridExecutionResult> = new Map();

  constructor() {
    super();
    this.initializeTokenRegistry();
  }

  private initializeTokenRegistry() {
    // Initialize with known tokens
    // In production, this would be loaded from a config or database
    this.tokenRegistry.set('ETH', {
      symbol: 'ETH',
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18,
      chainId: 1
    });
    
    this.tokenRegistry.set('USDC', {
      symbol: 'USDC',
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
      chainId: 1
    });
    
    this.tokenRegistry.set('USDT', {
      symbol: 'USDT',
      address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      decimals: 6,
      chainId: 1
    });
    
    this.tokenRegistry.set('WBTC', {
      symbol: 'WBTC',
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      decimals: 8,
      chainId: 1
    });
  }

  async executeHybridOrder(order: Order): Promise<HybridExecutionResult> {
    // First, try to fill from internal order book
    const internalResult = await this.tryInternalExecution(order);
    
    let remainingQuantity = order.quantity - internalResult.filledQuantity;
    let hybridResult: HybridExecutionResult = {
      orderId: order.id,
      status: 'filled',
      internalExecution: internalResult,
      totalFilled: internalResult.filledQuantity,
      averagePrice: internalResult.averagePrice,
      breakdown: {
        internal: {
          quantity: internalResult.filledQuantity,
          value: internalResult.filledQuantity * internalResult.averagePrice,
          averagePrice: internalResult.averagePrice
        },
        external: {
          quantity: 0,
          value: 0,
          averagePrice: 0
        }
      }
    };

    // If order is not fully filled, try external liquidity
    if (remainingQuantity > 0 && order.timeInForce !== TimeInForce.IOC) {
      try {
        const externalResult = await this.tryExternalExecution(
          order,
          remainingQuantity
        );

        if (externalResult) {
          hybridResult.externalExecution = {
            route: externalResult.route,
            status: 'pending'
          };
          
          hybridResult.status = 'pending_external';
          hybridResult.breakdown.external = {
            quantity: remainingQuantity,
            value: parseFloat(externalResult.route.toAmount),
            averagePrice: parseFloat(externalResult.route.toAmount) / remainingQuantity
          };

          // Store pending external order
          this.pendingExternalOrders.set(order.id, hybridResult);
          
          // Emit event for external execution
          this.emit('external-execution-pending', {
            orderId: order.id,
            route: externalResult.route
          });
        } else if (internalResult.filledQuantity > 0) {
          hybridResult.status = 'partially_filled';
        } else {
          hybridResult.status = 'failed';
        }
      } catch (error) {
        console.error('External execution failed:', error);
        if (internalResult.filledQuantity > 0) {
          hybridResult.status = 'partially_filled';
        } else {
          hybridResult.status = 'failed';
        }
      }
    }

    // Calculate combined average price
    if (hybridResult.breakdown.internal.quantity > 0 || hybridResult.breakdown.external.quantity > 0) {
      const totalValue = hybridResult.breakdown.internal.value + hybridResult.breakdown.external.value;
      const totalQuantity = hybridResult.breakdown.internal.quantity + hybridResult.breakdown.external.quantity;
      hybridResult.averagePrice = totalValue / totalQuantity;
      hybridResult.totalFilled = totalQuantity;
    }

    this.emit('hybrid-execution-complete', hybridResult);
    return hybridResult;
  }

  private async tryInternalExecution(order: Order): Promise<ExecutionReport> {
    try {
      // Submit to internal matching engine
      const executionReport = await this.matchingEngine.submitOrder(order);
      return executionReport;
    } catch (error) {
      console.error('Internal execution error:', error);
      // Return empty execution report
      return {
        orderId: order.id,
        clientOrderId: order.clientOrderId,
        executionId: `EXEC-${Date.now()}`,
        status: OrderStatus.CANCELLED,
        side: order.side,
        pair: order.pair,
        price: order.price,
        quantity: order.quantity,
        filledQuantity: 0,
        remainingQuantity: order.quantity,
        averagePrice: 0,
        trades: [],
        timestamp: Date.now(),
        message: 'Internal execution failed'
      };
    }
  }

  private async tryExternalExecution(
    order: Order,
    quantity: number
  ): Promise<{ route: LifiRoute; quote: HybridQuote } | null> {
    try {
      // Parse the trading pair
      const [baseSymbol, quoteSymbol] = order.pair.split('/');
      
      // Get token info
      const baseToken = this.tokenRegistry.get(baseSymbol);
      const quoteToken = this.tokenRegistry.get(quoteSymbol);
      
      if (!baseToken || !quoteToken) {
        console.error('Token info not found for', baseSymbol, quoteSymbol);
        return null;
      }

      // Determine from/to tokens based on order side
      let fromToken: TokenInfo;
      let toToken: TokenInfo;
      let fromAmount: string;

      if (order.side === OrderSide.BUY) {
        // Buying base with quote
        fromToken = quoteToken;
        toToken = baseToken;
        fromAmount = ethers.parseUnits(
          (quantity * order.price).toFixed(fromToken.decimals),
          fromToken.decimals
        ).toString();
      } else {
        // Selling base for quote
        fromToken = baseToken;
        toToken = quoteToken;
        fromAmount = ethers.parseUnits(
          quantity.toFixed(fromToken.decimals),
          fromToken.decimals
        ).toString();
      }

      // Get quote from LiFi
      const lifiRequest: LifiQuoteRequest = {
        fromChain: fromToken.chainId,
        toChain: toToken.chainId,
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAmount: fromAmount,
        fromAddress: order.userId, // In production, map to actual wallet
        slippage: 1 // 1% slippage
      };

      const routes = await lifiService.getQuote(lifiRequest);
      
      if (!routes || routes.length === 0) {
        console.log('No external routes found');
        return null;
      }

      // Select best route (first one is usually the best)
      const bestRoute = routes[0];
      
      // Calculate effective price
      const toAmount = parseFloat(
        ethers.formatUnits(bestRoute.toAmount, toToken.decimals)
      );
      const fromAmountParsed = parseFloat(
        ethers.formatUnits(bestRoute.fromAmount, fromToken.decimals)
      );

      let effectivePrice: number;
      if (order.side === OrderSide.BUY) {
        effectivePrice = fromAmountParsed / toAmount;
      } else {
        effectivePrice = toAmount / fromAmountParsed;
      }

      // Check if external price is acceptable
      const priceSlippage = Math.abs(effectivePrice - order.price) / order.price;
      if (priceSlippage > 0.05) { // 5% price slippage threshold
        console.log('External price slippage too high:', priceSlippage);
        return null;
      }

      const quote: HybridQuote = {
        source: 'external',
        price: effectivePrice,
        quantity: quantity,
        totalValue: quantity * effectivePrice,
        fees: parseFloat(bestRoute.gasCostUSD || '0'),
        route: bestRoute
      };

      return { route: bestRoute, quote };
    } catch (error) {
      console.error('Error getting external quote:', error);
      return null;
    }
  }

  async getHybridQuote(
    pair: string,
    side: OrderSide,
    quantity: number
  ): Promise<{
    internal: HybridQuote | null;
    external: HybridQuote | null;
    recommended: 'internal' | 'external' | 'split';
    splitRatio?: { internal: number; external: number };
  }> {
    // Get internal quote from order book
    const internalQuote = this.getInternalQuote(pair, side, quantity);
    
    // Get external quote from DEX
    const externalQuote = await this.getExternalQuote(pair, side, quantity);

    // Determine recommendation
    let recommended: 'internal' | 'external' | 'split' = 'internal';
    let splitRatio = undefined;

    if (!internalQuote && externalQuote) {
      recommended = 'external';
    } else if (internalQuote && !externalQuote) {
      recommended = 'internal';
    } else if (internalQuote && externalQuote) {
      // Compare prices and liquidity
      if (internalQuote.quantity < quantity && externalQuote.quantity >= quantity - internalQuote.quantity) {
        recommended = 'split';
        splitRatio = {
          internal: internalQuote.quantity / quantity,
          external: (quantity - internalQuote.quantity) / quantity
        };
      } else if (externalQuote.price < internalQuote.price * 1.02) {
        // External is cheaper (including 2% threshold for fees)
        recommended = 'external';
      }
    }

    return {
      internal: internalQuote,
      external: externalQuote,
      recommended,
      splitRatio
    };
  }

  private getInternalQuote(
    pair: string,
    side: OrderSide,
    quantity: number
  ): HybridQuote | null {
    const orderBook = this.matchingEngine.getOrderBook(pair, 50);
    if (!orderBook) return null;

    const levels = side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
    let remainingQty = quantity;
    let totalValue = 0;
    let filledQty = 0;

    for (const level of levels) {
      const levelQty = Math.min(remainingQty, level.quantity);
      totalValue += levelQty * level.price;
      filledQty += levelQty;
      remainingQty -= levelQty;

      if (remainingQty <= 0) break;
    }

    if (filledQty === 0) return null;

    return {
      source: 'internal',
      price: totalValue / filledQty,
      quantity: filledQty,
      totalValue: totalValue,
      fees: totalValue * 0.002 // 0.2% taker fee
    };
  }

  private async getExternalQuote(
    pair: string,
    side: OrderSide,
    quantity: number
  ): Promise<HybridQuote | null> {
    try {
      const [baseSymbol, quoteSymbol] = pair.split('/');
      const baseToken = this.tokenRegistry.get(baseSymbol);
      const quoteToken = this.tokenRegistry.get(quoteSymbol);
      
      if (!baseToken || !quoteToken) return null;

      // Create a dummy order to get external quote
      const dummyOrder: Order = {
        id: `QUOTE-${Date.now()}`,
        userId: '0x0000000000000000000000000000000000000000',
        pair,
        side,
        type: OrderType.MARKET,
        price: 0,
        quantity,
        filledQuantity: 0,
        status: OrderStatus.PENDING,
        timeInForce: TimeInForce.IOC,
        timestamp: Date.now(),
        lastUpdateTime: Date.now()
      };

      const externalResult = await this.tryExternalExecution(dummyOrder, quantity);
      
      if (!externalResult) return null;

      return externalResult.quote;
    } catch (error) {
      console.error('Error getting external quote:', error);
      return null;
    }
  }

  updateExternalOrderStatus(
    orderId: string,
    status: 'completed' | 'failed',
    txHash?: string
  ): void {
    const hybridResult = this.pendingExternalOrders.get(orderId);
    if (!hybridResult || !hybridResult.externalExecution) return;

    hybridResult.externalExecution.status = status;
    if (txHash) {
      hybridResult.externalExecution.txHash = txHash;
    }

    if (status === 'completed') {
      hybridResult.status = 'filled';
      hybridResult.totalFilled = hybridResult.breakdown.internal.quantity + hybridResult.breakdown.external.quantity;
    } else {
      hybridResult.status = hybridResult.breakdown.internal.quantity > 0 ? 'partially_filled' : 'failed';
    }

    this.emit('external-execution-update', {
      orderId,
      status,
      txHash,
      hybridResult
    });

    // Clean up if completed or failed
    if (status === 'completed' || status === 'failed') {
      this.pendingExternalOrders.delete(orderId);
    }
  }

  getPendingExternalOrders(): HybridExecutionResult[] {
    return Array.from(this.pendingExternalOrders.values());
  }
}