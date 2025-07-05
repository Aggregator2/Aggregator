import { RiskAwareMatchingEngine, RiskAwareMatchingEngineConfig } from './RiskAwareMatchingEngine';
import { RiskManagementService } from '../riskManagement/RiskManagementService';
import { BalanceCheckService, BalanceValidation } from '../balanceManager/BalanceCheckService';
import { Order, OrderStatus, ExecutionReport, OrderSide } from './types';
import { ethers } from 'ethers';

export interface BalanceAwareMatchingEngineConfig extends RiskAwareMatchingEngineConfig {
  balanceCheckEnabled: boolean;
  rejectInsufficientBalance: boolean;
  rejectInsufficientAllowance: boolean;
  balanceCheckTimeout?: number; // milliseconds
  settlementContract: string;
  tokenMapping?: { [pair: string]: { baseToken: string; quoteToken: string; baseIsNative?: boolean; quoteIsNative?: boolean } };
}

export class BalanceAwareMatchingEngine extends RiskAwareMatchingEngine {
  private balanceService: BalanceCheckService;
  private balanceConfig: BalanceAwareMatchingEngineConfig;

  constructor(
    config: BalanceAwareMatchingEngineConfig,
    riskService: RiskManagementService,
    provider: ethers.Provider
  ) {
    super(config, riskService);
    this.balanceConfig = config;
    
    // Initialize balance check service
    this.balanceService = new BalanceCheckService({
      provider,
      settlementContract: config.settlementContract,
      cacheTTL: 30000, // 30 seconds
      batchSize: 10
    });
    
    this.setupBalanceEventHandlers();
  }

  private setupBalanceEventHandlers(): void {
    // Listen to balance events
    this.balanceService.on('balanceValidated', (data) => {
      this.emit('balanceChecked', data);
    });

    this.balanceService.on('balanceChanged', (data) => {
      this.emit('userBalanceChanged', data);
    });
  }

  // Override submitOrder to add balance checks
  async submitOrder(orderRequest: Partial<Order>): Promise<ExecutionReport> {
    // First perform risk checks via parent class
    const riskCheckResult = await super.submitOrder(orderRequest);
    
    // If order was rejected by risk checks, return immediately
    if (riskCheckResult.status === 'CANCELLED' || riskCheckResult.status === 'REJECTED') {
      return riskCheckResult;
    }
    
    // Get the order that was created
    const order = this.orders.get(riskCheckResult.orderId);
    if (!order) {
      throw new Error('Order not found after risk check');
    }
    
    // Perform balance checks if enabled and order is not already cancelled
    if (this.balanceConfig.balanceCheckEnabled && order.status !== OrderStatus.CANCELLED) {
      try {
        const balanceCheckResult = await this.performBalanceCheck(order);
        
        if (!balanceCheckResult.isValid) {
          // Cancel the order
          order.status = OrderStatus.CANCELLED;
          order.metadata = {
            ...order.metadata,
            rejectionReason: 'BALANCE_CHECK_FAILED',
            balanceErrors: balanceCheckResult.errors
          };
          
          const report = this.generateExecutionReport(order, []);
          report.message = this.formatBalanceRejectionMessage(balanceCheckResult.errors);
          
          this.emit('orderRejected', {
            order,
            reason: 'Balance check failed',
            balanceErrors: balanceCheckResult.errors
          });
          this.emit('executionReport', report);
          
          return report;
        }
        
        // Add balance info to order metadata
        order.metadata = {
          ...order.metadata,
          balanceInfo: {
            balance: balanceCheckResult.balance?.balance.toString(),
            allowance: balanceCheckResult.balance?.allowance.toString(),
            required: balanceCheckResult.requiredAmount.toString(),
            token: balanceCheckResult.tokenAddress,
            symbol: balanceCheckResult.balance?.symbol
          }
        };
        
      } catch (error) {
        // Handle balance check error
        if (this.balanceConfig.rejectInsufficientBalance) {
          order.status = OrderStatus.CANCELLED;
          order.metadata = {
            ...order.metadata,
            rejectionReason: 'BALANCE_CHECK_ERROR',
            error: error.message
          };
          
          const report = this.generateExecutionReport(order, []);
          report.message = `Balance check error: ${error.message}`;
          
          this.emit('orderRejected', {
            order,
            reason: 'Balance check error',
            error: error.message
          });
          this.emit('executionReport', report);
          
          return report;
        } else {
          // Log error but continue
          console.error('Balance check error (non-blocking):', error);
          order.metadata = {
            ...order.metadata,
            balanceCheckError: error.message
          };
        }
      }
    }
    
    // Return the original execution report
    return riskCheckResult;
  }

  // Perform balance check with timeout
  private async performBalanceCheck(order: Order): Promise<{
    isValid: boolean;
    errors: string[];
    balance?: BalanceValidation;
    tokenAddress: string;
    requiredAmount: bigint;
  }> {
    const timeout = this.balanceConfig.balanceCheckTimeout || 5000; // 5 seconds default
    
    return Promise.race([
      this.executeBalanceCheck(order),
      new Promise<any>((_, reject) => 
        setTimeout(() => reject(new Error('Balance check timeout')), timeout)
      )
    ]);
  }

  // Execute the actual balance check
  private async executeBalanceCheck(order: Order): Promise<{
    isValid: boolean;
    errors: string[];
    balance?: BalanceValidation;
    tokenAddress: string;
    requiredAmount: bigint;
  }> {
    // Get token addresses for the pair
    const tokenInfo = this.getTokenInfo(order.pair);
    if (!tokenInfo) {
      return {
        isValid: false,
        errors: ['Unknown trading pair'],
        tokenAddress: '',
        requiredAmount: BigInt(0)
      };
    }
    
    // Determine which token to check based on order side
    let tokenToCheck: string;
    let isNativeToken: boolean;
    let requiredAmount: bigint;
    
    if (order.side === OrderSide.BUY) {
      // Buying base token with quote token - check quote token balance
      tokenToCheck = tokenInfo.quoteToken;
      isNativeToken = tokenInfo.quoteIsNative || false;
      // For limit orders, calculate required quote amount
      requiredAmount = order.type === 'LIMIT' 
        ? BigInt(Math.floor(order.quantity * order.price * 1e18))
        : BigInt(0); // Market orders need dynamic calculation
    } else {
      // Selling base token for quote token - check base token balance
      tokenToCheck = tokenInfo.baseToken;
      isNativeToken = tokenInfo.baseIsNative || false;
      requiredAmount = BigInt(Math.floor(order.quantity * 1e18));
    }
    
    // Validate balance and allowance
    const validation = await this.balanceService.validateOrderBalance(
      order.userId,
      tokenToCheck,
      requiredAmount,
      isNativeToken
    );
    
    const errors: string[] = [...validation.errors];
    
    // Check specific conditions
    if (!validation.hasBalance && this.balanceConfig.rejectInsufficientBalance) {
      return {
        isValid: false,
        errors,
        balance: validation,
        tokenAddress: tokenToCheck,
        requiredAmount
      };
    }
    
    if (!validation.hasAllowance && this.balanceConfig.rejectInsufficientAllowance && !isNativeToken) {
      return {
        isValid: false,
        errors,
        balance: validation,
        tokenAddress: tokenToCheck,
        requiredAmount
      };
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      balance: validation,
      tokenAddress: tokenToCheck,
      requiredAmount
    };
  }

  // Get token info for a trading pair
  private getTokenInfo(pair: string): {
    baseToken: string;
    quoteToken: string;
    baseIsNative?: boolean;
    quoteIsNative?: boolean;
  } | null {
    // Check configured mapping first
    if (this.balanceConfig.tokenMapping && this.balanceConfig.tokenMapping[pair]) {
      return this.balanceConfig.tokenMapping[pair];
    }
    
    // Default mappings for common pairs
    const defaultMappings: { [key: string]: any } = {
      'ETH/USDC': {
        baseToken: 'NATIVE',
        quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mainnet
        baseIsNative: true,
        quoteIsNative: false
      },
      'BTC/USDC': {
        baseToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC mainnet
        quoteToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mainnet
        baseIsNative: false,
        quoteIsNative: false
      },
      'ETH/USDT': {
        baseToken: 'NATIVE',
        quoteToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT mainnet
        baseIsNative: true,
        quoteIsNative: false
      }
    };
    
    return defaultMappings[pair] || null;
  }

  // Format balance rejection message
  private formatBalanceRejectionMessage(errors: string[]): string {
    if (errors.length === 0) return 'Balance check failed';
    return errors.join('; ');
  }

  // Get user balances for all tokens in a pair
  async getUserBalances(userId: string, pair: string): Promise<{
    baseToken: any;
    quoteToken: any;
  } | null> {
    const tokenInfo = this.getTokenInfo(pair);
    if (!tokenInfo) return null;
    
    const [baseBalance, quoteBalance] = await Promise.all([
      tokenInfo.baseIsNative
        ? this.balanceService.getNativeBalance(userId)
        : this.balanceService.getTokenBalance(userId, tokenInfo.baseToken),
      tokenInfo.quoteIsNative
        ? this.balanceService.getNativeBalance(userId)
        : this.balanceService.getTokenBalance(userId, tokenInfo.quoteToken)
    ]);
    
    return {
      baseToken: baseBalance,
      quoteToken: quoteBalance
    };
  }

  // Refresh user balance
  async refreshUserBalance(
    userId: string,
    tokenAddress: string,
    isNative: boolean = false
  ): Promise<any> {
    return this.balanceService.refreshBalance(userId, tokenAddress, isNative);
  }

  // Clear balance cache for a user
  clearUserBalanceCache(userId: string): void {
    this.balanceService.clearUserCache(userId);
  }

  // Start monitoring user balances
  async startBalanceMonitoring(
    userId: string,
    pairs: string[],
    interval: number = 60000
  ): Promise<NodeJS.Timeout> {
    const tokens: { address: string; isNative: boolean }[] = [];
    
    // Collect all unique tokens from pairs
    const seenTokens = new Set<string>();
    
    for (const pair of pairs) {
      const tokenInfo = this.getTokenInfo(pair);
      if (tokenInfo) {
        if (!seenTokens.has(tokenInfo.baseToken)) {
          seenTokens.add(tokenInfo.baseToken);
          tokens.push({
            address: tokenInfo.baseToken,
            isNative: tokenInfo.baseIsNative || false
          });
        }
        
        if (!seenTokens.has(tokenInfo.quoteToken)) {
          seenTokens.add(tokenInfo.quoteToken);
          tokens.push({
            address: tokenInfo.quoteToken,
            isNative: tokenInfo.quoteIsNative || false
          });
        }
      }
    }
    
    return this.balanceService.startBalanceMonitoring(userId, tokens, interval);
  }

  // Get balance service instance
  getBalanceService(): BalanceCheckService {
    return this.balanceService;
  }

  // Check if order should be auto-cancelled due to balance
  async checkAndCancelInsufficientOrders(userId: string): Promise<string[]> {
    const cancelledOrders: string[] = [];
    const userOrders = this.getOrders(userId).filter(
      o => o.status === OrderStatus.OPEN || o.status === OrderStatus.PARTIALLY_FILLED
    );
    
    for (const order of userOrders) {
      try {
        const balanceCheck = await this.performBalanceCheck(order);
        
        if (!balanceCheck.isValid) {
          await this.cancelOrder(order.id);
          cancelledOrders.push(order.id);
          
          this.emit('orderAutoCancelled', {
            orderId: order.id,
            userId,
            reason: 'Insufficient balance',
            errors: balanceCheck.errors
          });
        }
      } catch (error) {
        console.error(`Failed to check balance for order ${order.id}:`, error);
      }
    }
    
    return cancelledOrders;
  }
}