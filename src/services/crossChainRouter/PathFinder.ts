import { CrossChainSwapRequest, SwapRoute, SwapStep, TokenInfo, BridgeQuote, DEXQuote, PathFinderConfig } from './types';
import { BridgeAggregator } from './BridgeAggregator';
import { DEXAggregator } from './DEXAggregator';
import { TokenService } from './TokenService';
import { calculatePriceImpact, estimateGasCost } from './utils';

export class PathFinder {
  private bridgeAggregator: BridgeAggregator;
  private dexAggregator: DEXAggregator;
  private tokenService: TokenService;
  private config: PathFinderConfig;

  constructor(
    bridgeAggregator: BridgeAggregator,
    dexAggregator: DEXAggregator,
    tokenService: TokenService,
    config?: Partial<PathFinderConfig>
  ) {
    this.bridgeAggregator = bridgeAggregator;
    this.dexAggregator = dexAggregator;
    this.tokenService = tokenService;
    
    this.config = {
      maxRoutes: 5,
      maxSteps: 4,
      minLiquidity: 100, // $100 USD
      bridgeReliabilityWeight: 0.3,
      gasCostWeight: 0.3,
      executionTimeWeight: 0.2,
      priceImpactWeight: 0.2,
      ...config
    };
  }

  async findOptimalRoute(request: CrossChainSwapRequest): Promise<SwapRoute[]> {
    const routes: SwapRoute[] = [];
    
    // Get token information
    const sourceTokenInfo = await this.tokenService.getTokenInfo(request.sourceChainId, request.sourceToken);
    const destTokenInfo = await this.tokenService.getTokenInfo(request.destinationChainId, request.destinationToken);
    
    // Strategy 1: Direct bridge if available
    const directRoute = await this.findDirectBridgeRoute(request, sourceTokenInfo, destTokenInfo);
    if (directRoute) routes.push(directRoute);
    
    // Strategy 2: Swap to bridgeable token → Bridge → Swap to destination
    const commonBridgeTokens = await this.getCommonBridgeTokens(request.sourceChainId, request.destinationChainId);
    
    for (const bridgeToken of commonBridgeTokens) {
      const route = await this.findRouteViaBridgeToken(request, sourceTokenInfo, destTokenInfo, bridgeToken);
      if (route) routes.push(route);
    }
    
    // Strategy 3: Multi-hop routes (for better rates)
    const multiHopRoutes = await this.findMultiHopRoutes(request, sourceTokenInfo, destTokenInfo);
    routes.push(...multiHopRoutes);
    
    // Score and sort routes
    const scoredRoutes = routes.map(route => ({
      route,
      score: this.scoreRoute(route)
    }));
    
    scoredRoutes.sort((a, b) => b.score - a.score);
    
    return scoredRoutes.slice(0, this.config.maxRoutes).map(sr => sr.route);
  }

  private async findDirectBridgeRoute(
    request: CrossChainSwapRequest,
    sourceToken: TokenInfo,
    destToken: TokenInfo
  ): Promise<SwapRoute | null> {
    try {
      // Check if tokens can be directly bridged
      const bridgeQuotes = await this.bridgeAggregator.getQuotes({
        fromChainId: request.sourceChainId,
        toChainId: request.destinationChainId,
        fromToken: request.sourceToken,
        toToken: request.destinationToken,
        fromAmount: request.sourceAmount,
        fromAddress: request.recipientAddress,
        toAddress: request.recipientAddress
      });
      
      if (bridgeQuotes.length === 0) return null;
      
      // Use best bridge quote
      const bestQuote = bridgeQuotes[0];
      
      const steps: SwapStep[] = [
        {
          type: 'bridge',
          chainId: request.sourceChainId,
          protocol: bestQuote.bridgeName,
          fromToken: sourceToken,
          toToken: destToken,
          fromAmount: request.sourceAmount,
          estimatedToAmount: bestQuote.toAmount,
          gasCost: await estimateGasCost('bridge', request.sourceChainId)
        }
      ];
      
      return {
        id: `direct-${Date.now()}`,
        steps,
        estimatedOutput: bestQuote.toAmount,
        totalFeeUSD: bestQuote.bridgeFeeUSD,
        totalGasCostUSD: await this.calculateTotalGasCostUSD(steps),
        estimatedTime: bestQuote.estimatedTime,
        priceImpact: 0,
        reliability: bestQuote.reliability
      };
    } catch (error) {
      console.error('Error finding direct bridge route:', error);
      return null;
    }
  }

  private async findRouteViaBridgeToken(
    request: CrossChainSwapRequest,
    sourceToken: TokenInfo,
    destToken: TokenInfo,
    bridgeToken: { sourceChain: TokenInfo; destChain: TokenInfo }
  ): Promise<SwapRoute | null> {
    try {
      const steps: SwapStep[] = [];
      let currentAmount = request.sourceAmount;
      let totalFeeUSD = 0;
      let totalTime = 0;
      let totalPriceImpact = 0;
      let minReliability = 100;
      
      // Step 1: Swap source token to bridge token on source chain (if needed)
      if (sourceToken.address.toLowerCase() !== bridgeToken.sourceChain.address.toLowerCase()) {
        const swapQuote = await this.dexAggregator.getQuote({
          chainId: request.sourceChainId,
          fromToken: request.sourceToken,
          toToken: bridgeToken.sourceChain.address,
          fromAmount: currentAmount,
          userAddress: request.recipientAddress
        });
        
        if (!swapQuote) return null;
        
        steps.push({
          type: 'swap',
          chainId: request.sourceChainId,
          protocol: swapQuote.dexName,
          fromToken: sourceToken,
          toToken: bridgeToken.sourceChain,
          fromAmount: currentAmount,
          estimatedToAmount: swapQuote.toAmount,
          gasCost: swapQuote.gasCost,
          gasPrice: swapQuote.gasPrice,
          data: swapQuote.data
        });
        
        currentAmount = swapQuote.toAmount;
        totalPriceImpact += swapQuote.priceImpact;
        totalTime += 30; // estimated swap time
      }
      
      // Step 2: Bridge the token
      const bridgeQuotes = await this.bridgeAggregator.getQuotes({
        fromChainId: request.sourceChainId,
        toChainId: request.destinationChainId,
        fromToken: bridgeToken.sourceChain.address,
        toToken: bridgeToken.destChain.address,
        fromAmount: currentAmount,
        fromAddress: request.recipientAddress,
        toAddress: request.recipientAddress
      });
      const bridgeQuote = bridgeQuotes[0];
      
      if (!bridgeQuote) return null;
      
      steps.push({
        type: 'bridge',
        chainId: request.sourceChainId,
        protocol: bridgeQuote.bridgeName,
        fromToken: bridgeToken.sourceChain,
        toToken: bridgeToken.destChain,
        fromAmount: currentAmount,
        estimatedToAmount: bridgeQuote.toAmount,
        gasCost: await estimateGasCost('bridge', request.sourceChainId)
      });
      
      currentAmount = bridgeQuote.toAmount;
      totalFeeUSD += bridgeQuote.bridgeFeeUSD;
      totalTime += bridgeQuote.estimatedTime;
      minReliability = Math.min(minReliability, bridgeQuote.reliability);
      
      // Step 3: Swap bridge token to destination token on destination chain (if needed)
      if (bridgeToken.destChain.address.toLowerCase() !== destToken.address.toLowerCase()) {
        const swapQuote = await this.dexAggregator.getQuote({
          chainId: request.destinationChainId,
          fromToken: bridgeToken.destChain.address,
          toToken: request.destinationToken,
          fromAmount: currentAmount,
          userAddress: request.recipientAddress
        });
        
        if (!swapQuote) return null;
        
        steps.push({
          type: 'swap',
          chainId: request.destinationChainId,
          protocol: swapQuote.dexName,
          fromToken: bridgeToken.destChain,
          toToken: destToken,
          fromAmount: currentAmount,
          estimatedToAmount: swapQuote.toAmount,
          gasCost: swapQuote.gasCost,
          gasPrice: swapQuote.gasPrice,
          data: swapQuote.data
        });
        
        currentAmount = swapQuote.toAmount;
        totalPriceImpact += swapQuote.priceImpact;
        totalTime += 30; // estimated swap time
      }
      
      return {
        id: `bridge-token-${bridgeToken.sourceChain.symbol}-${Date.now()}`,
        steps,
        estimatedOutput: currentAmount,
        totalFeeUSD,
        totalGasCostUSD: await this.calculateTotalGasCostUSD(steps),
        estimatedTime: totalTime,
        priceImpact: totalPriceImpact,
        reliability: minReliability
      };
    } catch (error) {
      console.error('Error finding route via bridge token:', error);
      return null;
    }
  }

  private async findMultiHopRoutes(
    request: CrossChainSwapRequest,
    sourceToken: TokenInfo,
    destToken: TokenInfo
  ): Promise<SwapRoute[]> {
    // This is a simplified version. In production, you'd want more sophisticated pathfinding
    const routes: SwapRoute[] = [];
    
    // Example: Find routes through hub chains (Ethereum, BSC)
    const hubChains = [1, 56]; // Ethereum, BSC
    
    for (const hubChainId of hubChains) {
      if (hubChainId === request.sourceChainId || hubChainId === request.destinationChainId) {
        continue;
      }
      
      // Try to find a route: Source → Hub → Destination
      // This would involve finding bridge tokens available on all three chains
      // Implementation would be similar to findRouteViaBridgeToken but with an extra hop
    }
    
    return routes;
  }

  private async getCommonBridgeTokens(
    sourceChainId: number,
    destChainId: number
  ): Promise<Array<{ sourceChain: TokenInfo; destChain: TokenInfo }>> {
    // Get commonly bridged tokens (USDC, USDT, ETH, WBTC, etc.)
    const commonTokens = ['USDC', 'USDT', 'WETH', 'WBTC', 'DAI', 'BUSD'];
    const bridgeTokens: Array<{ sourceChain: TokenInfo; destChain: TokenInfo }> = [];
    
    for (const symbol of commonTokens) {
      try {
        const sourceToken = await this.tokenService.getTokenBySymbol(sourceChainId, symbol);
        const destToken = await this.tokenService.getTokenBySymbol(destChainId, symbol);
        
        if (sourceToken && destToken) {
          // Verify these tokens can be bridged
          const canBridge = await this.bridgeAggregator.canBridge(
            sourceChainId,
            destChainId,
            sourceToken.address,
            destToken.address
          );
          
          if (canBridge) {
            bridgeTokens.push({
              sourceChain: sourceToken,
              destChain: destToken
            });
          }
        }
      } catch (error) {
        // Token might not exist on one of the chains
        continue;
      }
    }
    
    return bridgeTokens;
  }

  private scoreRoute(route: SwapRoute): number {
    // Normalize metrics
    const normalizedGasCost = 1 - Math.min(route.totalGasCostUSD / 100, 1); // Lower is better
    const normalizedFees = 1 - Math.min(route.totalFeeUSD / 100, 1); // Lower is better
    const normalizedTime = 1 - Math.min(route.estimatedTime / 3600, 1); // Lower is better
    const normalizedImpact = 1 - Math.min(route.priceImpact / 1000, 1); // Lower is better
    const normalizedReliability = route.reliability / 100; // Higher is better
    
    // Calculate weighted score
    const score = 
      normalizedGasCost * this.config.gasCostWeight +
      normalizedFees * this.config.gasCostWeight + // fees use same weight as gas
      normalizedTime * this.config.executionTimeWeight +
      normalizedImpact * this.config.priceImpactWeight +
      normalizedReliability * this.config.bridgeReliabilityWeight;
    
    return score;
  }

  private async calculateTotalGasCostUSD(steps: SwapStep[]): Promise<number> {
    let totalGasCostUSD = 0;
    
    for (const step of steps) {
      const chainConfig = await this.tokenService.getChainConfig(step.chainId);
      const nativeTokenPriceUSD = await this.tokenService.getNativeTokenPrice(step.chainId);
      
      // Convert gas cost to USD
      const gasCostInNative = parseFloat(step.gasCost) / Math.pow(10, chainConfig.nativeCurrency.decimals);
      totalGasCostUSD += gasCostInNative * nativeTokenPriceUSD;
    }
    
    return totalGasCostUSD;
  }
}