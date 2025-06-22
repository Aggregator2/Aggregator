import { ethers } from 'ethers';
import { 
  CrossChainSwapRequest, 
  SwapRoute, 
  ExecutionResult, 
  TransactionRecord,
  SwapStep 
} from './types';
import { PathFinder } from './PathFinder';
import { MockBridgeAggregator } from './MockBridgeAggregator';
import { MockDEXAggregator } from './MockDEXAggregator';
import { MockTokenService } from './MockTokenService';
import { validateSwapRequest } from './utils';

/**
 * Test version of CrossChainRouter that uses mock services
 * This allows testing without external API dependencies
 */
export class TestCrossChainRouter {
  private pathFinder: PathFinder;
  private bridgeAggregator: MockBridgeAggregator;
  private dexAggregator: MockDEXAggregator;
  private tokenService: MockTokenService;

  constructor() {
    this.bridgeAggregator = new MockBridgeAggregator();
    this.dexAggregator = new MockDEXAggregator();
    this.tokenService = new MockTokenService();
    this.pathFinder = new PathFinder(
      this.bridgeAggregator as any,
      this.dexAggregator as any,
      this.tokenService as any
    );
  }

  /**
   * Get available routes for a cross-chain swap
   */
  async getRoutes(request: CrossChainSwapRequest): Promise<SwapRoute[]> {
    // Validate request
    const validation = await validateSwapRequest(request);
    if (!validation.valid) {
      throw new Error(`Invalid swap request: ${validation.error}`);
    }

    // Find optimal routes using mock services
    const routes = await this.pathFinder.findOptimalRoute(request);
    
    if (routes.length === 0) {
      throw new Error('No routes found for the requested swap');
    }

    return routes;
  }

  /**
   * Get quote for a cross-chain swap (best route output amount)
   */
  async getQuote(request: CrossChainSwapRequest): Promise<{
    outputAmount: string;
    route: SwapRoute;
    priceImpact: number;
    executionTime: number;
    totalFeeUSD: number;
  }> {
    const routes = await this.getRoutes(request);
    const bestRoute = routes[0];

    return {
      outputAmount: bestRoute.estimatedOutput,
      route: bestRoute,
      priceImpact: bestRoute.priceImpact,
      executionTime: bestRoute.estimatedTime,
      totalFeeUSD: bestRoute.totalFeeUSD + bestRoute.totalGasCostUSD
    };
  }

  /**
   * Simulate swap execution (for testing without real transactions)
   */
  async simulateSwap(request: CrossChainSwapRequest): Promise<{
    success: boolean;
    route: SwapRoute;
    executionPlan: Array<{
      stepIndex: number;
      stepType: string;
      chainId: number;
      protocol: string;
      fromToken: any;
      toToken: any;
      estimatedGas: string;
      estimatedTime: number;
    }>;
    totalEstimatedTime: number;
    totalEstimatedGasUSD: number;
    warnings: string[];
  }> {
    try {
      const routes = await this.getRoutes(request);
      const selectedRoute = routes[0];

      // Check user balance (mock)
      const hasBalance = await this.checkUserBalance(
        request.sourceChainId,
        request.sourceToken,
        request.sourceAmount,
        request.recipientAddress
      );

      // Build execution plan
      const executionPlan = selectedRoute.steps.map((step, index) => ({
        stepIndex: index,
        stepType: step.type,
        chainId: step.chainId,
        protocol: step.protocol,
        fromToken: step.fromToken,
        toToken: step.toToken,
        estimatedGas: step.gasCost,
        estimatedTime: step.type === 'bridge' ? 600 : 30 // 10 min for bridge, 30s for swap
      }));

      const totalEstimatedTime = executionPlan.reduce((sum, step) => sum + step.estimatedTime, 0);
      const totalEstimatedGasUSD = selectedRoute.totalGasCostUSD;

      const warnings = [];
      if (!hasBalance) warnings.push('Insufficient balance for execution');
      if (selectedRoute.priceImpact > 500) warnings.push('High price impact (>5%)');
      if (totalEstimatedGasUSD > 50) warnings.push('High gas costs (>$50)');

      return {
        success: true,
        route: selectedRoute,
        executionPlan,
        totalEstimatedTime,
        totalEstimatedGasUSD,
        warnings
      };
    } catch (error) {
      return {
        success: false,
        route: {} as SwapRoute,
        executionPlan: [],
        totalEstimatedTime: 0,
        totalEstimatedGasUSD: 0,
        warnings: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Get supported chains
   */
  getSupportedChains(): number[] {
    const dexChains = new Set(this.dexAggregator.getSupportedChains());
    const bridgeChains = new Set(this.bridgeAggregator.getSupportedChains());
    
    // Return chains that have both DEX and bridge support
    return Array.from(dexChains).filter(chain => bridgeChains.has(chain));
  }

  /**
   * Get supported tokens for a chain
   */
  async getSupportedTokens(chainId: number): Promise<Array<{
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  }>> {
    const tokens = await this.tokenService.getPopularTokens(chainId);
    return tokens.map(token => ({
      address: token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals
    }));
  }

  /**
   * Estimate gas costs for a route
   */
  async estimateGasCosts(route: SwapRoute): Promise<{
    totalGasUnits: string;
    totalGasCostUSD: number;
    breakdown: Array<{
      step: number;
      chainId: number;
      gasUnits: string;
      gasCostUSD: number;
    }>;
  }> {
    const breakdown = [];
    let totalGasUnits = BigInt(0);
    let totalGasCostUSD = 0;

    for (let i = 0; i < route.steps.length; i++) {
      const step = route.steps[i];
      const gasPrice = await this.tokenService.getGasPrice(step.chainId);
      const nativeTokenPrice = await this.tokenService.getNativeTokenPrice(step.chainId);
      
      const gasUnits = BigInt(step.gasCost);
      const gasCostNative = gasUnits * gasPrice;
      const gasCostUSD = parseFloat(ethers.formatEther(gasCostNative)) * nativeTokenPrice;
      
      breakdown.push({
        step: i,
        chainId: step.chainId,
        gasUnits: gasUnits.toString(),
        gasCostUSD
      });
      
      totalGasUnits = totalGasUnits + gasUnits;
      totalGasCostUSD += gasCostUSD;
    }

    return {
      totalGasUnits: totalGasUnits.toString(),
      totalGasCostUSD,
      breakdown
    };
  }

  /**
   * Helper: Check user balance (mock)
   */
  private async checkUserBalance(
    chainId: number,
    tokenAddress: string,
    amount: string,
    userAddress: string
  ): Promise<boolean> {
    try {
      const balance = await this.tokenService.getTokenBalance(
        chainId,
        tokenAddress,
        userAddress
      );
      
      return BigInt(balance) >= BigInt(amount);
    } catch (error) {
      console.error('Error checking balance:', error);
      return false;
    }
  }

  /**
   * Get bridge and DEX information
   */
  getServiceInfo(): {
    supportedBridges: Array<{ id: string; name: string; chains: number[] }>;
    supportedDEXs: Array<{ id: string; name: string; chains: number[] }>;
    features: string[];
  } {
    return {
      supportedBridges: this.bridgeAggregator.getSupportedBridges(),
      supportedDEXs: this.dexAggregator.getSupportedDEXs(),
      features: [
        'Multi-chain routing',
        'Bridge aggregation',
        'DEX aggregation',
        'Gas optimization',
        'Slippage protection',
        'Route simulation'
      ]
    };
  }

  /**
   * Helper method to build transactions for manual execution
   */
  async buildTransaction(
    route: SwapRoute,
    stepIndex: number,
    userAddress: string
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    chainId: number;
  }> {
    const step = route.steps[stepIndex];
    
    if (step.type === 'swap') {
      const tx = await this.dexAggregator.getBuildTx(
        {
          dexId: step.protocol,
          dexName: step.protocol,
          chainId: step.chainId,
          fromToken: step.fromToken.address,
          toToken: step.toToken.address,
          fromAmount: step.fromAmount,
          toAmount: step.estimatedToAmount,
          priceImpact: 0,
          gasCost: step.gasCost,
          gasPrice: step.gasPrice || '0',
          path: [],
          data: step.data
        },
        userAddress
      );
      
      return {
        to: tx.to,
        data: tx.data,
        value: tx.value || '0',
        gasLimit: tx.gas || step.gasCost,
        chainId: step.chainId
      };
    } else if (step.type === 'bridge') {
      const tx = await this.bridgeAggregator.getBuildTx(
        {
          bridgeId: step.protocol,
          bridgeName: step.protocol,
          fromChainId: step.chainId,
          toChainId: step.toToken.chainId,
          fromToken: step.fromToken.address,
          toToken: step.toToken.address,
          fromAmount: step.fromAmount,
          toAmount: step.estimatedToAmount,
          toAmountMin: step.estimatedToAmount,
          bridgeFee: '0',
          bridgeFeeUSD: 0,
          estimatedTime: 0,
          reliability: 0,
          data: step.data
        },
        userAddress
      );
      
      return {
        to: tx.to,
        data: tx.data,
        value: tx.value || '0',
        gasLimit: step.gasCost,
        chainId: step.chainId
      };
    } else {
      throw new Error(`Unsupported step type: ${step.type}`);
    }
  }
}