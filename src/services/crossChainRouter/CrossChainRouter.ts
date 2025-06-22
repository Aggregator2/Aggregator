import { ethers } from 'ethers';
import { 
  CrossChainSwapRequest, 
  SwapRoute, 
  ExecutionResult, 
  TransactionRecord,
  SwapStep 
} from './types';
import { PathFinder } from './PathFinder';
import { BridgeAggregator } from './BridgeAggregator';
import { DEXAggregator } from './DEXAggregator';
import { TokenService } from './TokenService';
import { ExecutionEngine } from './ExecutionEngine';
import { validateSwapRequest, createRetryWithBackoff } from './utils';

export class CrossChainRouter {
  private pathFinder: PathFinder;
  private bridgeAggregator: BridgeAggregator;
  private dexAggregator: DEXAggregator;
  private tokenService: TokenService;
  private executionEngine: ExecutionEngine;

  constructor(config?: {
    providers?: Map<number, ethers.Provider>;
    signers?: Map<number, ethers.Signer>;
  }) {
    this.bridgeAggregator = new BridgeAggregator();
    this.dexAggregator = new DEXAggregator();
    this.tokenService = new TokenService(config?.providers);
    this.pathFinder = new PathFinder(
      this.bridgeAggregator,
      this.dexAggregator,
      this.tokenService
    );
    this.executionEngine = new ExecutionEngine(
      this.bridgeAggregator,
      this.dexAggregator,
      this.tokenService,
      config?.signers
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

    // Find optimal routes
    const routes = await this.pathFinder.findOptimalRoute(request);
    
    if (routes.length === 0) {
      throw new Error('No routes found for the requested swap');
    }

    return routes;
  }

  /**
   * Execute a cross-chain swap using the best available route
   */
  async executeSwap(
    request: CrossChainSwapRequest,
    signer?: ethers.Signer
  ): Promise<ExecutionResult> {
    try {
      // Get routes
      const routes = await this.getRoutes(request);
      const selectedRoute = routes[0]; // Use best route

      // Check user balance
      const hasBalance = await this.checkUserBalance(
        request.sourceChainId,
        request.sourceToken,
        request.sourceAmount,
        request.recipientAddress
      );

      if (!hasBalance) {
        throw new Error('Insufficient balance for swap');
      }

      // Execute the route
      const result = await this.executionEngine.executeRoute(
        selectedRoute,
        request.recipientAddress,
        signer
      );

      return result;
    } catch (error) {
      console.error('Swap execution error:', error);
      return {
        success: false,
        routeId: '',
        transactions: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
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
   * Check transaction status for an ongoing swap
   */
  async checkSwapStatus(
    routeId: string,
    transactions: TransactionRecord[]
  ): Promise<{
    status: 'pending' | 'completed' | 'failed';
    currentStep: number;
    completedSteps: number;
    error?: string;
  }> {
    let currentStep = 0;
    let completedSteps = 0;
    let hasFailed = false;
    let error: string | undefined;

    for (const tx of transactions) {
      if (tx.status === 'success') {
        completedSteps++;
      } else if (tx.status === 'failed') {
        hasFailed = true;
        error = `Transaction failed at step ${tx.stepIndex}`;
        break;
      } else if (tx.status === 'pending') {
        currentStep = tx.stepIndex;
        
        // Check if this is a bridge transaction
        const isBridgeTx = tx.stepIndex > 0 && tx.stepIndex < transactions.length - 1;
        if (isBridgeTx) {
          // Check bridge status
          // This would need the bridge ID from the route
          // For now, we'll just return pending
        }
      }
    }

    return {
      status: hasFailed ? 'failed' : completedSteps === transactions.length ? 'completed' : 'pending',
      currentStep,
      completedSteps,
      error
    };
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
    return this.tokenService.getPopularTokens(chainId);
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
    let totalGasUnits = 0n;
    let totalGasCostUSD = 0;

    for (let i = 0; i < route.steps.length; i++) {
      const step = route.steps[i];
      const gasPrice = await this.tokenService.getGasPrice(step.chainId);
      const nativeTokenPrice = await this.tokenService.getNativeTokenPrice(step.chainId);
      
      const gasUnits = BigInt(step.gasCost);
      const gasCostNative = gasUnits * BigInt(gasPrice);
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
   * Helper: Check user balance
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
   * Helper: Build transaction for manual execution
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