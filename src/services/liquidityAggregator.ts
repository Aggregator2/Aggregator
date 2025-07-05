import { getMatchingEngine } from './matchingEngine/singleton';
import { LifiService } from './lifiService';
import { OrderType, OrderSide, TimeInForce } from './matchingEngine/types';
import { ethers } from 'ethers';
import { executeRoute, getQuote, RouteExecutionUpdate } from '@lifi/sdk';
import { EventEmitter } from 'events';

interface LiquiditySource {
  type: 'internal' | 'external';
  name: string;
  available: boolean;
}

interface AggregatedQuote {
  price: number;
  quantity: number;
  sources: Array<{
    type: 'internal' | 'external';
    name: string;
    price: number;
    quantity: number;
    gasCost?: string;
  }>;
  bestPrice: number;
  totalQuantity: number;
  averagePrice: number;
}

interface ExternalTradeStatus {
  orderId: string;
  status: 'PENDING' | 'QUOTE_RECEIVED' | 'SIGNING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';
  txHash?: string;
  error?: string;
  route?: any;
  gasEstimate?: string;
  confirmations?: number;
  timestamp: number;
}

export class LiquidityAggregator extends EventEmitter {
  private matchingEngine = getMatchingEngine();
  private lifiService = new LifiService();
  private enabled = true;
  private externalTrades: Map<string, ExternalTradeStatus> = new Map();
  private pendingTransactions: Map<string, ExternalTradeStatus> = new Map();

  constructor() {
    super();
    console.log('✅ Liquidity Aggregator initialized');
    this.startTransactionMonitoring();
  }

  /**
   * Get aggregated quote combining internal order book and external DEXs
   */
  async getAggregatedQuote(
    pair: string,
    side: OrderSide,
    quantity: number,
    slippageTolerance: number = 0.01
  ): Promise<AggregatedQuote> {
    const sources: AggregatedQuote['sources'] = [];
    
    // 1. Check internal order book first
    const internalQuote = await this.getInternalQuote(pair, side, quantity);
    if (internalQuote && internalQuote.quantity > 0) {
      sources.push({
        type: 'internal',
        name: 'Order Book',
        price: internalQuote.price,
        quantity: internalQuote.quantity
      });
    }

    // 2. If internal liquidity insufficient, check external sources
    const remainingQuantity = quantity - (internalQuote?.quantity || 0);
    
    if (remainingQuantity > 0 && this.enabled) {
      try {
        const externalQuotes = await this.getExternalQuotes(
          pair, 
          side, 
          remainingQuantity,
          slippageTolerance
        );
        
        sources.push(...externalQuotes);
      } catch (error) {
        console.error('Failed to get external quotes:', error);
      }
    }

    // 3. Calculate aggregated metrics
    const totalQuantity = sources.reduce((sum, s) => sum + s.quantity, 0);
    const weightedPriceSum = sources.reduce((sum, s) => sum + (s.price * s.quantity), 0);
    const averagePrice = totalQuantity > 0 ? weightedPriceSum / totalQuantity : 0;
    const bestPrice = this.getBestPrice(sources, side);

    return {
      price: averagePrice,
      quantity: totalQuantity,
      sources,
      bestPrice,
      totalQuantity,
      averagePrice
    };
  }

  /**
   * Execute order using best available liquidity
   */
  async executeWithBestLiquidity(
    userId: string,
    pair: string,
    side: OrderSide,
    quantity: number,
    maxSlippage: number = 0.02
  ): Promise<any> {
    // Get aggregated quote
    const quote = await this.getAggregatedQuote(pair, side, quantity, maxSlippage);
    
    if (quote.totalQuantity < quantity * 0.95) {
      throw new Error('Insufficient liquidity across all sources');
    }

    const results = [];

    // Execute on each source
    for (const source of quote.sources) {
      if (source.quantity === 0) continue;

      try {
        if (source.type === 'internal') {
          // Submit to internal matching engine
          const result = await this.matchingEngine.submitOrder({
            userId,
            pair,
            side,
            type: OrderType.MARKET,
            quantity: source.quantity,
            timeInForce: TimeInForce.IOC
          });
          
          results.push({
            source: source.name,
            result,
            success: result.status !== 'CANCELLED'
          });
        } else {
          // Execute on external DEX
          const result = await this.executeExternalTrade(
            userId,
            pair,
            side,
            source.quantity,
            source.name
          );
          
          results.push({
            source: source.name,
            result,
            success: true
          });
        }
      } catch (error) {
        console.error(`Failed to execute on ${source.name}:`, error);
        results.push({
          source: source.name,
          error: error.message,
          success: false
        });
      }
    }

    return {
      quote,
      executions: results,
      totalExecuted: results.filter(r => r.success).reduce((sum, r) => 
        sum + (r.result?.filledQuantity || 0), 0
      )
    };
  }

  /**
   * Get quote from internal order book
   */
  private async getInternalQuote(
    pair: string,
    side: OrderSide,
    quantity: number
  ): Promise<{ price: number; quantity: number } | null> {
    const orderBook = this.matchingEngine.getOrderBook(pair, 100);
    if (!orderBook) return null;

    const levels = side === OrderSide.BUY ? orderBook.asks : orderBook.bids;
    if (levels.length === 0) return null;

    let remainingQty = quantity;
    let totalCost = 0;
    let filledQty = 0;

    for (const level of levels) {
      const levelQty = Math.min(remainingQty, level.quantity);
      totalCost += levelQty * level.price;
      filledQty += levelQty;
      remainingQty -= levelQty;

      if (remainingQty <= 0) break;
    }

    if (filledQty === 0) return null;

    return {
      price: totalCost / filledQty,
      quantity: filledQty
    };
  }

  /**
   * Get quotes from external DEXs via LiFi
   */
  private async getExternalQuotes(
    pair: string,
    side: OrderSide,
    quantity: number,
    slippage: number
  ): Promise<AggregatedQuote['sources']> {
    // Parse pair (e.g., "ETH/USDC")
    const [baseSymbol, quoteSymbol] = pair.split('/');
    
    // Convert to token addresses (simplified - in production use token registry)
    const tokenMap: Record<string, string> = {
      'ETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    };

    const fromToken = side === OrderSide.BUY ? tokenMap[quoteSymbol] : tokenMap[baseSymbol];
    const toToken = side === OrderSide.BUY ? tokenMap[baseSymbol] : tokenMap[quoteSymbol];
    
    if (!fromToken || !toToken) {
      console.warn(`Token mapping not found for pair ${pair}`);
      return [];
    }

    // Get quote from LiFi
    const lifiQuote = await this.lifiService.getQuote({
      fromChain: 1, // Ethereum mainnet
      toChain: 1,
      fromToken,
      toToken,
      fromAmount: ethers.parseUnits(quantity.toString(), 18).toString(),
      fromAddress: '0x0000000000000000000000000000000000000000', // Placeholder
      slippage: slippage * 100 // Convert to percentage
    });

    if (!lifiQuote || !lifiQuote.routes || lifiQuote.routes.length === 0) {
      return [];
    }

    // Convert LiFi routes to our format
    return lifiQuote.routes.slice(0, 3).map(route => ({
      type: 'external' as const,
      name: route.steps[0]?.toolDetails?.name || 'DEX Aggregator',
      price: parseFloat(route.toAmount) / parseFloat(route.fromAmount),
      quantity: quantity, // Assumes full quantity can be filled
      gasCost: route.gasCostUSD
    }));
  }

  /**
   * Execute trade on external DEX using LiFi SDK
   */
  async executeExternalTrade(
    userId: string,
    pair: string,
    side: OrderSide,
    quantity: number,
    signer: ethers.Signer,
    options?: {
      dexName?: string;
      maxSlippage?: number;
      maxRetries?: number;
    }
  ): Promise<any> {
    const orderId = `EXT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tradeStatus: ExternalTradeStatus = {
      orderId,
      status: 'PENDING',
      timestamp: Date.now()
    };

    this.externalTrades.set(orderId, tradeStatus);
    this.emit('trade:initiated', { orderId, userId, pair, side, quantity });

    try {
      // 1. Get quote from LiFi
      console.log(`Getting quote for external trade ${orderId}`);
      const quote = await this.getLiFiQuoteForTrade(pair, side, quantity, signer, options?.maxSlippage);
      
      if (!quote || !quote.routes || quote.routes.length === 0) {
        throw new Error('No routes available for this trade');
      }

      // Select best route (highest output amount with reasonable gas)
      const selectedRoute = this.selectBestRoute(quote.routes);
      tradeStatus.route = selectedRoute;
      tradeStatus.status = 'QUOTE_RECEIVED';
      tradeStatus.gasEstimate = selectedRoute.gasCostUSD;
      this.updateTradeStatus(tradeStatus);

      this.emit('quote:received', {
        orderId,
        route: selectedRoute,
        estimatedOutput: selectedRoute.toAmount,
        estimatedGas: selectedRoute.gasCostUSD
      });

      // 2. Build and execute transaction using LiFi SDK
      console.log(`Executing route for trade ${orderId}`);
      const executionResult = await this.executeLiFiRoute(
        selectedRoute,
        signer,
        tradeStatus,
        options?.maxRetries || 3
      );

      if (executionResult.success) {
        // 3. Update internal order records
        await this.updateInternalRecords(userId, pair, side, quantity, executionResult);
        
        return {
          orderId,
          txHash: executionResult.txHash,
          status: 'confirmed',
          dex: options?.dexName || 'LiFi Aggregator',
          route: selectedRoute,
          gasUsed: executionResult.gasUsed,
          filledQuantity: quantity,
          averagePrice: executionResult.averagePrice
        };
      } else {
        throw new Error(executionResult.error || 'Transaction execution failed');
      }

    } catch (error) {
      console.error(`External trade ${orderId} failed:`, error);
      
      tradeStatus.status = 'FAILED';
      tradeStatus.error = error instanceof Error ? error.message : 'Unknown error';
      this.updateTradeStatus(tradeStatus);

      // Try fallback DEXs if available
      if (options?.dexName && this.hasFallbackDEXs()) {
        return await this.tryFallbackDEXs(userId, pair, side, quantity, signer, options);
      }

      throw error;
    }
  }

  /**
   * Get LiFi quote for the trade
   */
  private async getLiFiQuoteForTrade(
    pair: string,
    side: OrderSide,
    quantity: number,
    signer: ethers.Signer,
    maxSlippage?: number
  ): Promise<any> {
    const [baseSymbol, quoteSymbol] = pair.split('/');
    const signerAddress = await signer.getAddress();
    
    // Token mappings (simplified - in production use token registry)
    const tokenMap: Record<string, string> = {
      'ETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      'USDC': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      'WBTC': '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    };

    const fromToken = side === OrderSide.BUY ? tokenMap[quoteSymbol] : tokenMap[baseSymbol];
    const toToken = side === OrderSide.BUY ? tokenMap[baseSymbol] : tokenMap[quoteSymbol];
    
    if (!fromToken || !toToken) {
      throw new Error(`Token mapping not found for pair ${pair}`);
    }

    // Get decimals for proper amount conversion
    const decimals = this.getTokenDecimals(side === OrderSide.BUY ? quoteSymbol : baseSymbol);
    const fromAmount = ethers.parseUnits(quantity.toString(), decimals).toString();

    return await getQuote({
      fromChain: 1, // Ethereum mainnet
      toChain: 1,
      fromToken,
      toToken,
      fromAmount,
      fromAddress: signerAddress,
      slippage: (maxSlippage || 0.02) // 2% default slippage
    });
  }

  /**
   * Execute LiFi route with proper error handling and retries
   */
  private async executeLiFiRoute(
    route: any,
    signer: ethers.Signer,
    tradeStatus: ExternalTradeStatus,
    maxRetries: number
  ): Promise<{
    success: boolean;
    txHash?: string;
    gasUsed?: string;
    averagePrice?: number;
    error?: string;
  }> {
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
      try {
        tradeStatus.status = 'SIGNING';
        this.updateTradeStatus(tradeStatus);
        
        this.emit('signature:required', { orderId: tradeStatus.orderId });

        // Execute route using LiFi SDK
        const executionConfig = {
          updateCallback: (update: RouteExecutionUpdate) => {
            this.handleExecutionUpdate(tradeStatus, update);
          },
          infiniteApproval: false,
          acceptSlippageUpdateHook: async (params: any) => {
            // Accept up to 5% slippage
            return params.newSlippage <= 5;
          }
        };

        const result = await executeRoute(signer, route, executionConfig);
        
        if (result.transactionHash) {
          tradeStatus.txHash = result.transactionHash;
          tradeStatus.status = 'SUBMITTED';
          this.updateTradeStatus(tradeStatus);
          
          // Add to pending transactions for monitoring
          this.pendingTransactions.set(result.transactionHash, tradeStatus);
          
          this.emit('transaction:submitted', {
            orderId: tradeStatus.orderId,
            txHash: result.transactionHash
          });

          // Wait for confirmation
          const confirmed = await this.waitForConfirmation(
            result.transactionHash,
            signer.provider!
          );

          if (confirmed) {
            const receipt = await signer.provider!.getTransactionReceipt(result.transactionHash);
            return {
              success: true,
              txHash: result.transactionHash,
              gasUsed: receipt?.gasUsed.toString(),
              averagePrice: this.calculateAveragePrice(route)
            };
          } else {
            throw new Error('Transaction failed or reverted');
          }
        }

        throw new Error('No transaction hash received');

      } catch (error) {
        console.error(`Route execution attempt ${retryCount + 1} failed:`, error);
        
        retryCount++;
        
        // Handle specific errors
        if (error instanceof Error) {
          if (error.message.includes('insufficient funds')) {
            tradeStatus.error = 'Insufficient funds for gas';
            break; // Don't retry
          } else if (error.message.includes('nonce')) {
            // Nonce issues can be retried
            await this.delay(2000 * retryCount);
            continue;
          } else if (error.message.includes('reverted')) {
            tradeStatus.error = 'Transaction reverted';
            
            // Check if it's slippage related
            if (error.message.includes('slippage')) {
              tradeStatus.error = 'Slippage tolerance exceeded';
            }
            break; // Don't retry reverts
          }
        }

        if (retryCount >= maxRetries) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }

        // Exponential backoff
        await this.delay(1000 * Math.pow(2, retryCount));
      }
    }

    return {
      success: false,
      error: tradeStatus.error || 'Max retries exceeded'
    };
  }

  /**
   * Handle execution updates from LiFi
   */
  private handleExecutionUpdate(tradeStatus: ExternalTradeStatus, update: RouteExecutionUpdate) {
    console.log(`Execution update for ${tradeStatus.orderId}:`, update.type);
    
    switch (update.type) {
      case 'process':
        if (update.process?.status === 'ACTION_REQUIRED') {
          this.emit('action:required', {
            orderId: tradeStatus.orderId,
            message: update.process.message
          });
        }
        break;
      case 'receipt':
        if (update.receipt?.transactionHash) {
          tradeStatus.txHash = update.receipt.transactionHash;
        }
        break;
      case 'error':
        tradeStatus.error = update.error?.message;
        break;
    }
    
    this.updateTradeStatus(tradeStatus);
  }

  /**
   * Wait for transaction confirmation
   */
  private async waitForConfirmation(
    txHash: string,
    provider: ethers.Provider,
    requiredConfirmations: number = 2,
    timeout: number = 300000 // 5 minutes
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        
        if (receipt) {
          if (receipt.status === 1) {
            const currentBlock = await provider.getBlockNumber();
            const confirmations = currentBlock - receipt.blockNumber;
            
            if (confirmations >= requiredConfirmations) {
              const tradeStatus = this.pendingTransactions.get(txHash);
              if (tradeStatus) {
                tradeStatus.status = 'CONFIRMED';
                tradeStatus.confirmations = confirmations;
                this.updateTradeStatus(tradeStatus);
                this.pendingTransactions.delete(txHash);
              }
              
              this.emit('transaction:confirmed', { txHash, confirmations });
              return true;
            }
          } else {
            // Transaction failed
            this.emit('transaction:failed', { txHash });
            return false;
          }
        }
        
        await this.delay(3000); // Check every 3 seconds
      } catch (error) {
        console.error('Error checking transaction:', error);
      }
    }
    
    this.emit('transaction:timeout', { txHash });
    return false;
  }

  /**
   * Update internal order records after successful external execution
   */
  private async updateInternalRecords(
    userId: string,
    pair: string,
    side: OrderSide,
    quantity: number,
    executionResult: any
  ): Promise<void> {
    // In production, this would update:
    // 1. User balance in the system
    // 2. Order history
    // 3. Settlement records
    // 4. Analytics data
    
    this.emit('records:updated', {
      userId,
      pair,
      side,
      quantity,
      txHash: executionResult.txHash,
      timestamp: Date.now()
    });
  }

  /**
   * Try fallback DEXs if primary execution fails
   */
  private async tryFallbackDEXs(
    userId: string,
    pair: string,
    side: OrderSide,
    quantity: number,
    signer: ethers.Signer,
    options: any
  ): Promise<any> {
    const fallbackDEXs = ['Uniswap', '1inch', '0x'];
    
    for (const dex of fallbackDEXs) {
      if (dex === options.dexName) continue; // Skip the one that already failed
      
      try {
        console.log(`Trying fallback DEX: ${dex}`);
        // In production, implement specific DEX integrations
        // For now, this is a placeholder
        throw new Error(`${dex} fallback not implemented`);
      } catch (error) {
        console.error(`Fallback ${dex} failed:`, error);
      }
    }
    
    throw new Error('All DEX attempts failed');
  }

  /**
   * Monitor pending transactions
   */
  private startTransactionMonitoring(): void {
    setInterval(async () => {
      for (const [txHash, tradeStatus] of this.pendingTransactions) {
        // Check if transaction needs monitoring
        if (Date.now() - tradeStatus.timestamp > 600000) { // 10 minutes timeout
          this.pendingTransactions.delete(txHash);
          tradeStatus.status = 'FAILED';
          tradeStatus.error = 'Transaction timeout';
          this.updateTradeStatus(tradeStatus);
        }
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Helper methods
   */
  private selectBestRoute(routes: any[]): any {
    // Select route with best output amount considering gas costs
    return routes.reduce((best, route) => {
      const bestValue = BigInt(best.toAmount) - BigInt(best.gasCostUSD || '0');
      const routeValue = BigInt(route.toAmount) - BigInt(route.gasCostUSD || '0');
      return routeValue > bestValue ? route : best;
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

  private hasFallbackDEXs(): boolean {
    // Check if fallback DEXs are configured and available
    return true;
  }

  private updateTradeStatus(status: ExternalTradeStatus): void {
    this.externalTrades.set(status.orderId, status);
    this.emit('trade:updated', status);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get external trade status
   */
  getExternalTradeStatus(orderId: string): ExternalTradeStatus | undefined {
    return this.externalTrades.get(orderId);
  }

  /**
   * Get all pending external trades
   */
  getPendingExternalTrades(): ExternalTradeStatus[] {
    return Array.from(this.externalTrades.values())
      .filter(trade => ['PENDING', 'QUOTE_RECEIVED', 'SIGNING', 'SUBMITTED'].includes(trade.status));
  }

  /**
   * Get best price from sources
   */
  private getBestPrice(sources: AggregatedQuote['sources'], side: OrderSide): number {
    if (sources.length === 0) return 0;

    const prices = sources.map(s => s.price).filter(p => p > 0);
    
    if (side === OrderSide.BUY) {
      return Math.min(...prices); // Best ask price
    } else {
      return Math.max(...prices); // Best bid price
    }
  }

  /**
   * Get available liquidity sources
   */
  async getAvailableSources(): Promise<LiquiditySource[]> {
    const sources: LiquiditySource[] = [
      {
        type: 'internal',
        name: 'Order Book',
        available: true
      }
    ];

    // Check LiFi availability
    try {
      const chains = await this.lifiService.getSupportedChains();
      if (chains && chains.length > 0) {
        sources.push({
          type: 'external',
          name: 'LiFi Aggregator',
          available: true
        });
      }
    } catch {
      sources.push({
        type: 'external',
        name: 'LiFi Aggregator',
        available: false
      });
    }

    return sources;
  }

  /**
   * Enable/disable external liquidity
   */
  setExternalLiquidityEnabled(enabled: boolean) {
    this.enabled = enabled;
    console.log(`External liquidity ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Reset the aggregator state (for testing)
   */
  reset() {
    this.externalTrades.clear();
    this.pendingTransactions.clear();
    this.removeAllListeners();
    this.enabled = true;
    console.log('Liquidity aggregator reset');
  }
}

// Export singleton
export const liquidityAggregator = new LiquidityAggregator();