import { ethers } from 'ethers';
import { getMatchingEngine } from './matchingEngine/singleton';
import { LifiService } from './lifiService';
import { OrderType, OrderSide, TimeInForce } from './matchingEngine/types';
import { getQuote, getRoutes, executeRoute, RouteExecutionUpdate, StatusResponse } from '@lifi/sdk';
import { EventEmitter } from 'events';

interface ExternalTradeOrder {
  orderId: string;
  userId: string;
  pair: string;
  side: OrderSide;
  quantity: number;
  status: 'PENDING' | 'BUILDING' | 'SIGNING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'REVERTED';
  route?: any;
  txHash?: string;
  gasEstimate?: string;
  actualGasUsed?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  confirmations?: number;
  requiredConfirmations: number;
}

interface ExecutionResult {
  success: boolean;
  orderId: string;
  txHash?: string;
  status: string;
  filledQuantity?: number;
  averagePrice?: number;
  gasUsed?: string;
  error?: string;
  route?: any;
}

interface FallbackDEX {
  name: string;
  priority: number;
  supported: boolean;
  execute: (order: ExternalTradeOrder) => Promise<ExecutionResult>;
}

export class EnhancedLiquidityAggregator extends EventEmitter {
  private matchingEngine = getMatchingEngine();
  private lifiService = new LifiService();
  private enabled = true;
  
  // Order tracking
  private externalOrders: Map<string, ExternalTradeOrder> = new Map();
  private orderMonitoringInterval?: NodeJS.Timer;
  
  // Transaction monitoring
  private pendingTransactions: Map<string, ExternalTradeOrder> = new Map();
  private confirmationInterval?: NodeJS.Timer;
  
  // Configuration
  private config = {
    maxSlippage: 0.02, // 2%
    gasBuffer: 1.2, // 20% buffer on gas estimates
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds
    confirmationTimeout: 300000, // 5 minutes
    requiredConfirmations: 2,
    monitoringInterval: 3000, // 3 seconds
    fallbackEnabled: true
  };

  // Token mappings (in production, use a token registry)
  private tokenMap: Record<string, Record<number, string>> = {
    'ETH': {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
      137: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH on Polygon
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' // WETH on Arbitrum
    },
    'USDC': {
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      137: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC on Polygon
      42161: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8' // USDC on Arbitrum
    },
    'USDT': {
      1: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT on Ethereum
      137: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT on Polygon
      42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' // USDT on Arbitrum
    },
    'WBTC': {
      1: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC on Ethereum
      137: '0x1bfd67037b42cf73acF2047067bd4F2C47D9BfD6', // WBTC on Polygon
      42161: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' // WBTC on Arbitrum
    }
  };

  constructor() {
    super();
    this.startMonitoring();
    console.log('✅ Enhanced Liquidity Aggregator initialized');
  }

  /**
   * Execute external trade with complete LiFi integration
   */
  async executeExternalTrade(
    userId: string,
    pair: string,
    side: OrderSide,
    quantity: number,
    signer: ethers.Signer,
    options?: {
      maxSlippage?: number;
      chainId?: number;
      fallbackDEXs?: string[];
    }
  ): Promise<ExecutionResult> {
    const orderId = this.generateOrderId();
    const order: ExternalTradeOrder = {
      orderId,
      userId,
      pair,
      side,
      quantity,
      status: 'PENDING',
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      requiredConfirmations: this.config.requiredConfirmations
    };

    this.externalOrders.set(orderId, order);
    this.emit('order:created', order);

    try {
      // 1. Get quote from LiFi
      const quote = await this.getLiFiQuote(order, options?.chainId || 1, options?.maxSlippage);
      
      if (!quote || quote.routes.length === 0) {
        throw new Error('No routes available for this trade');
      }

      // Select best route
      const selectedRoute = this.selectBestRoute(quote.routes);
      order.route = selectedRoute;
      order.status = 'BUILDING';
      this.updateOrder(order);

      // 2. Build transaction using executeRoute
      const executionResult = await this.buildAndExecuteTransaction(
        order,
        selectedRoute,
        signer
      );

      return executionResult;

    } catch (error) {
      console.error('External trade execution failed:', error);
      
      // Try fallback DEXs if enabled
      if (this.config.fallbackEnabled && options?.fallbackDEXs) {
        return await this.tryFallbackDEXs(order, signer, options.fallbackDEXs);
      }

      order.status = 'FAILED';
      order.error = error instanceof Error ? error.message : 'Unknown error';
      this.updateOrder(order);

      return {
        success: false,
        orderId,
        status: 'FAILED',
        error: order.error
      };
    }
  }

  /**
   * Get quote from LiFi
   */
  private async getLiFiQuote(
    order: ExternalTradeOrder,
    chainId: number,
    maxSlippage?: number
  ): Promise<any> {
    const [baseSymbol, quoteSymbol] = order.pair.split('/');
    
    const fromToken = order.side === OrderSide.BUY ? 
      this.tokenMap[quoteSymbol]?.[chainId] : 
      this.tokenMap[baseSymbol]?.[chainId];
      
    const toToken = order.side === OrderSide.BUY ? 
      this.tokenMap[baseSymbol]?.[chainId] : 
      this.tokenMap[quoteSymbol]?.[chainId];
    
    if (!fromToken || !toToken) {
      throw new Error(`Token mapping not found for pair ${order.pair} on chain ${chainId}`);
    }

    // Convert quantity to appropriate decimals
    const decimals = this.getTokenDecimals(order.side === OrderSide.BUY ? quoteSymbol : baseSymbol);
    const fromAmount = ethers.parseUnits(order.quantity.toString(), decimals).toString();

    const quoteRequest = {
      fromChain: chainId,
      toChain: chainId,
      fromToken,
      toToken,
      fromAmount,
      fromAddress: await this.getUserAddress(order.userId),
      slippage: (maxSlippage || this.config.maxSlippage) * 100 // Convert to percentage
    };

    this.emit('quote:requesting', { orderId: order.orderId, request: quoteRequest });
    
    const quote = await this.lifiService.getQuote(quoteRequest);
    
    this.emit('quote:received', { 
      orderId: order.orderId, 
      routeCount: quote.routes?.length || 0 
    });

    return quote;
  }

  /**
   * Build and execute transaction using LiFi SDK
   */
  private async buildAndExecuteTransaction(
    order: ExternalTradeOrder,
    route: any,
    signer: ethers.Signer
  ): Promise<ExecutionResult> {
    try {
      order.status = 'BUILDING';
      this.updateOrder(order);

      // Configure execution
      const executionConfig = {
        updateCallback: (update: RouteExecutionUpdate) => {
          this.handleExecutionUpdate(order, update);
        },
        infiniteApproval: false, // Safer to use exact approvals
        acceptSlippageUpdateHook: async (params: any) => {
          // Accept slippage updates up to our max
          const newSlippage = params.newSlippage || 0;
          return newSlippage <= this.config.maxSlippage * 100;
        }
      };

      // Execute route using LiFi SDK
      this.emit('transaction:building', { orderId: order.orderId });
      
      const executionResult = await executeRoute(
        signer,
        route,
        executionConfig
      );

      // Extract transaction hash from execution
      if (executionResult.transactionHash) {
        order.txHash = executionResult.transactionHash;
        order.status = 'SUBMITTED';
        this.updateOrder(order);
        
        // Add to pending transactions for monitoring
        this.pendingTransactions.set(executionResult.transactionHash, order);
        
        this.emit('transaction:submitted', {
          orderId: order.orderId,
          txHash: executionResult.transactionHash
        });

        // Monitor for confirmation
        const confirmed = await this.waitForConfirmation(order);
        
        if (confirmed) {
          return {
            success: true,
            orderId: order.orderId,
            txHash: order.txHash,
            status: 'CONFIRMED',
            filledQuantity: order.quantity,
            averagePrice: this.calculateAveragePrice(route),
            gasUsed: order.actualGasUsed,
            route
          };
        }
      }

      throw new Error('Transaction execution failed');

    } catch (error) {
      console.error('Transaction building/execution failed:', error);
      
      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes('insufficient funds')) {
          order.error = 'Insufficient funds for gas';
        } else if (error.message.includes('reverted')) {
          order.error = 'Transaction reverted';
          order.status = 'REVERTED';
        } else if (error.message.includes('slippage')) {
          order.error = 'Slippage tolerance exceeded';
        } else {
          order.error = error.message;
        }
      }

      // Retry logic
      if (order.retryCount < order.maxRetries && this.shouldRetry(error)) {
        order.retryCount++;
        this.emit('transaction:retrying', {
          orderId: order.orderId,
          attempt: order.retryCount
        });
        
        await this.delay(this.config.retryDelay * order.retryCount);
        return await this.buildAndExecuteTransaction(order, route, signer);
      }

      order.status = 'FAILED';
      this.updateOrder(order);

      throw error;
    }
  }

  /**
   * Handle execution updates from LiFi SDK
   */
  private handleExecutionUpdate(order: ExternalTradeOrder, update: RouteExecutionUpdate) {
    this.emit('execution:update', {
      orderId: order.orderId,
      type: update.type,
      data: update
    });

    switch (update.type) {
      case 'process':
        if (update.process?.status === 'ACTION_REQUIRED') {
          order.status = 'SIGNING';
          this.emit('signature:required', {
            orderId: order.orderId,
            message: update.process.message
          });
        }
        break;
        
      case 'receipt':
        if (update.receipt?.transactionHash) {
          order.txHash = update.receipt.transactionHash;
          order.gasEstimate = update.receipt.gasUsed?.toString();
        }
        break;
        
      case 'error':
        order.error = update.error?.message || 'Execution error';
        break;
    }

    this.updateOrder(order);
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForConfirmation(order: ExternalTradeOrder): Promise<boolean> {
    if (!order.txHash) return false;

    const startTime = Date.now();
    const provider = await this.getProvider();

    while (Date.now() - startTime < this.config.confirmationTimeout) {
      try {
        const receipt = await provider.getTransactionReceipt(order.txHash);
        
        if (receipt) {
          if (receipt.status === 1) {
            const currentBlock = await provider.getBlockNumber();
            const confirmations = currentBlock - receipt.blockNumber;
            
            order.confirmations = confirmations;
            order.actualGasUsed = receipt.gasUsed.toString();
            
            if (confirmations >= order.requiredConfirmations) {
              order.status = 'CONFIRMED';
              this.updateOrder(order);
              
              this.emit('transaction:confirmed', {
                orderId: order.orderId,
                txHash: order.txHash,
                confirmations,
                gasUsed: order.actualGasUsed
              });
              
              return true;
            }
          } else {
            // Transaction failed
            order.status = 'REVERTED';
            order.error = 'Transaction reverted on-chain';
            this.updateOrder(order);
            return false;
          }
        }
        
        await this.delay(this.config.monitoringInterval);
        
      } catch (error) {
        console.error('Error checking transaction:', error);
      }
    }

    // Timeout
    order.error = 'Confirmation timeout';
    return false;
  }

  /**
   * Try fallback DEXs if primary execution fails
   */
  private async tryFallbackDEXs(
    order: ExternalTradeOrder,
    signer: ethers.Signer,
    fallbackDEXs: string[]
  ): Promise<ExecutionResult> {
    const fallbacks = this.getFallbackDEXs(fallbackDEXs);
    
    for (const dex of fallbacks) {
      try {
        this.emit('fallback:trying', {
          orderId: order.orderId,
          dex: dex.name
        });
        
        const result = await dex.execute(order);
        
        if (result.success) {
          this.emit('fallback:success', {
            orderId: order.orderId,
            dex: dex.name
          });
          return result;
        }
      } catch (error) {
        console.error(`Fallback DEX ${dex.name} failed:`, error);
      }
    }

    return {
      success: false,
      orderId: order.orderId,
      status: 'FAILED',
      error: 'All DEX attempts failed'
    };
  }

  /**
   * Get fallback DEX implementations
   */
  private getFallbackDEXs(dexNames: string[]): FallbackDEX[] {
    const availableDEXs: FallbackDEX[] = [
      {
        name: 'Uniswap',
        priority: 1,
        supported: true,
        execute: async (order) => this.executeUniswapFallback(order)
      },
      {
        name: '1inch',
        priority: 2,
        supported: true,
        execute: async (order) => this.execute1inchFallback(order)
      },
      {
        name: '0x',
        priority: 3,
        supported: true,
        execute: async (order) => this.execute0xFallback(order)
      }
    ];

    return availableDEXs
      .filter(dex => dexNames.includes(dex.name) && dex.supported)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Fallback implementations (simplified)
   */
  private async executeUniswapFallback(order: ExternalTradeOrder): Promise<ExecutionResult> {
    // Implement Uniswap V3 direct execution
    throw new Error('Uniswap fallback not implemented');
  }

  private async execute1inchFallback(order: ExternalTradeOrder): Promise<ExecutionResult> {
    // Implement 1inch API execution
    throw new Error('1inch fallback not implemented');
  }

  private async execute0xFallback(order: ExternalTradeOrder): Promise<ExecutionResult> {
    // Implement 0x API execution
    throw new Error('0x fallback not implemented');
  }

  /**
   * Monitor pending transactions
   */
  private startMonitoring(): void {
    // Order monitoring
    this.orderMonitoringInterval = setInterval(() => {
      this.checkPendingOrders();
    }, this.config.monitoringInterval);

    // Transaction confirmation monitoring
    this.confirmationInterval = setInterval(() => {
      this.checkPendingTransactions();
    }, this.config.monitoringInterval);
  }

  private async checkPendingOrders(): Promise<void> {
    const now = Date.now();
    
    for (const [orderId, order] of this.externalOrders) {
      // Clean up old completed orders
      if (['CONFIRMED', 'FAILED', 'REVERTED'].includes(order.status) &&
          now - order.updatedAt > 3600000) { // 1 hour
        this.externalOrders.delete(orderId);
      }
      
      // Check for stuck orders
      if (order.status === 'SUBMITTED' && 
          now - order.updatedAt > this.config.confirmationTimeout) {
        order.status = 'FAILED';
        order.error = 'Transaction timeout';
        this.updateOrder(order);
      }
    }
  }

  private async checkPendingTransactions(): Promise<void> {
    const provider = await this.getProvider();
    
    for (const [txHash, order] of this.pendingTransactions) {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (receipt) {
          const currentBlock = await provider.getBlockNumber();
          const confirmations = currentBlock - receipt.blockNumber;
          
          if (confirmations >= order.requiredConfirmations) {
            this.pendingTransactions.delete(txHash);
            
            if (receipt.status === 1) {
              order.status = 'CONFIRMED';
              order.confirmations = confirmations;
              order.actualGasUsed = receipt.gasUsed.toString();
            } else {
              order.status = 'REVERTED';
              order.error = 'Transaction reverted';
            }
            
            this.updateOrder(order);
          }
        }
      } catch (error) {
        console.error(`Error checking transaction ${txHash}:`, error);
      }
    }
  }

  /**
   * Helper methods
   */
  private selectBestRoute(routes: any[]): any {
    // Select route with best output amount and reasonable gas cost
    return routes.reduce((best, route) => {
      const bestOutput = BigInt(best.toAmount);
      const routeOutput = BigInt(route.toAmount);
      const bestGas = BigInt(best.gasCostUSD || '0');
      const routeGas = BigInt(route.gasCostUSD || '0');
      
      // Prefer higher output unless gas cost is significantly higher
      if (routeOutput > bestOutput && routeGas < bestGas * BigInt(2)) {
        return route;
      }
      
      return best;
    }, routes[0]);
  }

  private calculateAveragePrice(route: any): number {
    const fromAmount = parseFloat(route.fromAmount);
    const toAmount = parseFloat(route.toAmount);
    return toAmount / fromAmount;
  }

  private getTokenDecimals(symbol: string): number {
    const decimals: Record<string, number> = {
      'ETH': 18,
      'WETH': 18,
      'USDC': 6,
      'USDT': 6,
      'WBTC': 8
    };
    return decimals[symbol] || 18;
  }

  private async getUserAddress(userId: string): Promise<string> {
    // In production, retrieve user's wallet address from database
    return '0x0000000000000000000000000000000000000000';
  }

  private async getProvider(): Promise<ethers.Provider> {
    // In production, use configured provider
    return new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY');
  }

  private shouldRetry(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return message.includes('nonce') || 
             message.includes('timeout') ||
             message.includes('network') ||
             message.includes('gas price');
    }
    return false;
  }

  private generateOrderId(): string {
    return `EXT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateOrder(order: ExternalTradeOrder): void {
    order.updatedAt = Date.now();
    this.externalOrders.set(order.orderId, order);
    this.emit('order:updated', order);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Public API
   */
  getOrder(orderId: string): ExternalTradeOrder | undefined {
    return this.externalOrders.get(orderId);
  }

  getOrdersByUser(userId: string): ExternalTradeOrder[] {
    return Array.from(this.externalOrders.values())
      .filter(order => order.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getPendingOrders(): ExternalTradeOrder[] {
    return Array.from(this.externalOrders.values())
      .filter(order => !['CONFIRMED', 'FAILED', 'REVERTED'].includes(order.status));
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.externalOrders.get(orderId);
    if (!order) return false;

    if (['PENDING', 'BUILDING'].includes(order.status)) {
      order.status = 'FAILED';
      order.error = 'Cancelled by user';
      this.updateOrder(order);
      return true;
    }

    return false;
  }

  updateConfig(updates: Partial<typeof this.config>): void {
    Object.assign(this.config, updates);
    this.emit('config:updated', this.config);
  }

  stop(): void {
    if (this.orderMonitoringInterval) {
      clearInterval(this.orderMonitoringInterval);
    }
    if (this.confirmationInterval) {
      clearInterval(this.confirmationInterval);
    }
    this.emit('aggregator:stopped');
  }
}