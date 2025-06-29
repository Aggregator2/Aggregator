import { Token, PriceQuote, Route, OrderRequest } from '../interfaces/types';
import { ILiquidityConnector } from '../interfaces/connectors';

interface RouteNode {
  token: Token;
  quotes: PriceQuote[];
  amountOut: bigint;
  visited: boolean;
}

export class SmartOrderRouter {
  private connectors: ILiquidityConnector[] = [];
  
  addConnector(connector: ILiquidityConnector): void {
    this.connectors.push(connector);
  }
  
  removeConnector(name: string): void {
    this.connectors = this.connectors.filter(c => c.source.name !== name);
  }
  
  async findBestRoute(request: OrderRequest): Promise<Route | null> {
    // Get all possible quotes from all sources
    const allQuotes = await this.getAllQuotes(request);
    
    if (allQuotes.length === 0) {
      return null;
    }
    
    // Try direct routes first
    const directRoute = this.findBestDirectRoute(allQuotes, request);
    
    // Try multi-hop routes (up to 3 hops)
    const multiHopRoute = await this.findBestMultiHopRoute(request, 3);
    
    // Compare and return the best route
    if (!multiHopRoute) {
      return directRoute;
    }
    
    if (!directRoute) {
      return multiHopRoute;
    }
    
    return directRoute.totalAmountOut >= multiHopRoute.totalAmountOut
      ? directRoute
      : multiHopRoute;
  }
  
  private async getAllQuotes(request: OrderRequest): Promise<PriceQuote[]> {
    const quotePromises = this.connectors.map(connector =>
      connector.getQuote(request).catch(err => {
        console.error(`Error getting quote from ${connector.source.name}:`, err);
        return null;
      })
    );
    
    const quotes = await Promise.all(quotePromises);
    return quotes.filter((q): q is PriceQuote => q !== null);
  }
  
  private findBestDirectRoute(quotes: PriceQuote[], request: OrderRequest): Route | null {
    if (quotes.length === 0) {
      return null;
    }
    
    // Sort by amount out (descending)
    const sortedQuotes = quotes.sort((a, b) => 
      Number(b.amountOut - a.amountOut)
    );
    
    const bestQuote = sortedQuotes[0];
    
    return {
      path: [request.tokenIn, request.tokenOut],
      quotes: [bestQuote],
      totalAmountOut: bestQuote.amountOut,
      totalGasEstimate: bestQuote.gasEstimate || BigInt(150000),
      priceImpact: bestQuote.priceImpact
    };
  }
  
  private async findBestMultiHopRoute(
    request: OrderRequest,
    maxHops: number
  ): Promise<Route | null> {
    // Common intermediate tokens (WETH, USDC, USDT, DAI)
    const intermediateTokens: Token[] = [
      {
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        decimals: 18,
        chainId: request.tokenIn.chainId
      },
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        chainId: request.tokenIn.chainId
      },
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        decimals: 6,
        chainId: request.tokenIn.chainId
      },
      {
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        symbol: 'DAI',
        decimals: 18,
        chainId: request.tokenIn.chainId
      }
    ];
    
    let bestRoute: Route | null = null;
    
    // Try each intermediate token
    for (const intermediate of intermediateTokens) {
      // Skip if intermediate is same as input or output
      if (
        intermediate.address === request.tokenIn.address ||
        intermediate.address === request.tokenOut.address
      ) {
        continue;
      }
      
      // Get quotes for first hop
      const firstHopQuotes = await this.getAllQuotes({
        ...request,
        tokenOut: intermediate
      });
      
      if (firstHopQuotes.length === 0) {
        continue;
      }
      
      // Get best quote for first hop
      const bestFirstHop = firstHopQuotes.sort((a, b) =>
        Number(b.amountOut - a.amountOut)
      )[0];
      
      // Get quotes for second hop
      const secondHopQuotes = await this.getAllQuotes({
        tokenIn: intermediate,
        tokenOut: request.tokenOut,
        amountIn: bestFirstHop.amountOut,
        slippageTolerance: request.slippageTolerance,
        deadline: request.deadline
      });
      
      if (secondHopQuotes.length === 0) {
        continue;
      }
      
      // Get best quote for second hop
      const bestSecondHop = secondHopQuotes.sort((a, b) =>
        Number(b.amountOut - a.amountOut)
      )[0];
      
      // Create route
      const route: Route = {
        path: [request.tokenIn, intermediate, request.tokenOut],
        quotes: [bestFirstHop, bestSecondHop],
        totalAmountOut: bestSecondHop.amountOut,
        totalGasEstimate: (bestFirstHop.gasEstimate || BigInt(150000)) +
                         (bestSecondHop.gasEstimate || BigInt(150000)),
        priceImpact: Math.max(bestFirstHop.priceImpact, bestSecondHop.priceImpact)
      };
      
      // Update best route if this is better
      if (!bestRoute || route.totalAmountOut > bestRoute.totalAmountOut) {
        bestRoute = route;
      }
    }
    
    return bestRoute;
  }
  
  async splitOrder(
    request: OrderRequest,
    maxSplits: number = 5
  ): Promise<Route[]> {
    // Split the order into smaller chunks to minimize price impact
    const routes: Route[] = [];
    const splitSize = request.amountIn / BigInt(maxSplits);
    
    for (let i = 0; i < maxSplits; i++) {
      const splitRequest: OrderRequest = {
        ...request,
        amountIn: splitSize
      };
      
      const route = await this.findBestRoute(splitRequest);
      if (route) {
        routes.push(route);
      }
    }
    
    return routes;
  }
  
  calculateOptimalSplit(
    quotes: PriceQuote[],
    totalAmount: bigint
  ): Map<string, bigint> {
    // Calculate optimal split across multiple sources
    const splits = new Map<string, bigint>();
    
    // Sort by price (best first)
    const sortedQuotes = quotes.sort((a, b) => b.price - a.price);
    
    let remainingAmount = totalAmount;
    
    for (const quote of sortedQuotes) {
      if (remainingAmount === BigInt(0)) {
        break;
      }
      
      // Simple allocation strategy - could be improved with more sophisticated algorithms
      const allocation = remainingAmount / BigInt(2);
      splits.set(quote.source.name, allocation);
      remainingAmount -= allocation;
    }
    
    // Allocate remaining to best source
    if (remainingAmount > BigInt(0) && sortedQuotes.length > 0) {
      const bestSource = sortedQuotes[0].source.name;
      splits.set(
        bestSource,
        (splits.get(bestSource) || BigInt(0)) + remainingAmount
      );
    }
    
    return splits;
  }
}