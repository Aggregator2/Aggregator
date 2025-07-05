import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { LifiRoute } from '../lifiService';

export interface ExternalQuote {
  provider: string;
  price: number;
  quantity: number;
  minQuantity?: number;
  maxQuantity?: number;
  estimatedGas?: string;
  estimatedGasUSD?: string;
  executionTime?: number; // seconds
  route?: any; // Provider-specific route data
  validUntil?: number; // timestamp
  confidence: number; // 0-1 score
}

// For test compatibility
export interface LiquidityQuote {
  provider: string;
  price: number;
  quantity: number;
  confidence: number;
  fee?: number;
  slippage?: number;
}

export interface QuoteWithRoute {
  quote: LiquidityQuote;
  route?: any;
  estimatedGas?: bigint;
}

export interface ExternalExecutionParams {
  provider: string;
  quote: ExternalQuote;
  userAddress: string;
  slippage?: number;
}

export interface ExternalExecutionResult {
  provider: string;
  txHash?: string;
  status: 'pending' | 'completed' | 'failed';
  executedQuantity?: number;
  executedPrice?: number;
  gasUsed?: string;
  error?: string;
}

export abstract class ExternalLiquidityProvider extends EventEmitter {
  protected name: string;
  protected chainId: number;
  protected supportedPairs: Set<string>;
  protected rateLimit: {
    requests: number;
    interval: number; // milliseconds
    current: number;
    lastReset: number;
  };

  constructor(name: string, chainId: number, supportedPairs: string[]) {
    super();
    this.name = name;
    this.chainId = chainId;
    this.supportedPairs = new Set(supportedPairs);
    this.rateLimit = {
      requests: 10,
      interval: 60000, // 1 minute
      current: 0,
      lastReset: Date.now()
    };
  }

  getName(): string {
    return this.name;
  }

  getChainId(): number {
    return this.chainId;
  }

  supportsPair(pair: string): boolean {
    return this.supportedPairs.has(pair) || this.supportedPairs.has('*');
  }

  protected checkRateLimit(): boolean {
    const now = Date.now();
    if (now - this.rateLimit.lastReset > this.rateLimit.interval) {
      this.rateLimit.current = 0;
      this.rateLimit.lastReset = now;
    }

    if (this.rateLimit.current >= this.rateLimit.requests) {
      return false;
    }

    this.rateLimit.current++;
    return true;
  }

  async getQuote(
    pair: string,
    side: 'buy' | 'sell',
    quantity: number,
    userAddress?: string
  ): Promise<ExternalQuote | null> {
    if (!this.supportsPair(pair)) {
      return null;
    }

    if (!this.checkRateLimit()) {
      throw new Error(`Rate limit exceeded for ${this.name}`);
    }

    try {
      return await this.fetchQuote(pair, side, quantity, userAddress);
    } catch (error) {
      this.emit('quote-error', { provider: this.name, pair, error });
      throw error;
    }
  }

  async execute(params: ExternalExecutionParams): Promise<ExternalExecutionResult> {
    try {
      this.emit('execution-started', { 
        provider: this.name, 
        quote: params.quote 
      });

      const result = await this.executeSwap(params);

      this.emit('execution-completed', { 
        provider: this.name, 
        result 
      });

      return result;
    } catch (error) {
      const errorResult: ExternalExecutionResult = {
        provider: this.name,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.emit('execution-failed', { 
        provider: this.name, 
        error: errorResult.error 
      });

      return errorResult;
    }
  }

  abstract fetchQuote(
    pair: string,
    side: 'buy' | 'sell',
    quantity: number,
    userAddress?: string
  ): Promise<ExternalQuote | null>;

  abstract executeSwap(
    params: ExternalExecutionParams
  ): Promise<ExternalExecutionResult>;

  abstract estimateGas(
    quote: ExternalQuote,
    userAddress: string
  ): Promise<bigint>;
}

// LiFi Provider Implementation
export class LiFiProvider extends ExternalLiquidityProvider {
  private lifiService: any;
  private tokenRegistry: Map<string, { address: string; decimals: number; chainId: number }>;

  constructor(lifiService: any, tokenRegistry: Map<string, any>) {
    super('LiFi', 1, ['*']); // Supports all pairs
    this.lifiService = lifiService;
    this.tokenRegistry = tokenRegistry;
  }

  async fetchQuote(
    pair: string,
    side: 'buy' | 'sell',
    quantity: number,
    userAddress?: string
  ): Promise<ExternalQuote | null> {
    const [baseSymbol, quoteSymbol] = pair.split('/');
    const baseToken = this.tokenRegistry.get(baseSymbol);
    const quoteToken = this.tokenRegistry.get(quoteSymbol);

    if (!baseToken || !quoteToken) {
      return null;
    }

    let fromToken, toToken, fromAmount;

    if (side === 'buy') {
      fromToken = quoteToken;
      toToken = baseToken;
      // For buy orders, we need to calculate how much quote currency to spend
      // This is an approximation, actual amount will be determined by the quote
      fromAmount = ethers.parseUnits(
        (quantity * 2000).toFixed(fromToken.decimals), // Assuming price around 2000
        fromToken.decimals
      ).toString();
    } else {
      fromToken = baseToken;
      toToken = quoteToken;
      fromAmount = ethers.parseUnits(
        quantity.toFixed(fromToken.decimals),
        fromToken.decimals
      ).toString();
    }

    const lifiRequest = {
      fromChain: fromToken.chainId,
      toChain: toToken.chainId,
      fromToken: fromToken.address,
      toToken: toToken.address,
      fromAmount: fromAmount,
      fromAddress: userAddress || '0x0000000000000000000000000000000000000000',
      slippage: 1
    };

    const routes = await this.lifiService.getQuote(lifiRequest);
    
    if (!routes || routes.length === 0) {
      return null;
    }

    const bestRoute = routes[0] as LifiRoute;
    
    // Calculate the effective price and quantity
    const toAmount = parseFloat(
      ethers.formatUnits(bestRoute.toAmount, toToken.decimals)
    );
    const fromAmountParsed = parseFloat(
      ethers.formatUnits(bestRoute.fromAmount, fromToken.decimals)
    );

    let effectivePrice, effectiveQuantity;
    
    if (side === 'buy') {
      effectiveQuantity = toAmount;
      effectivePrice = fromAmountParsed / toAmount;
    } else {
      effectiveQuantity = fromAmountParsed;
      effectivePrice = toAmount / fromAmountParsed;
    }

    return {
      provider: this.name,
      price: effectivePrice,
      quantity: effectiveQuantity,
      estimatedGas: bestRoute.gasCostUSD,
      estimatedGasUSD: bestRoute.gasCostUSD,
      executionTime: bestRoute.steps.length * 30, // Estimate 30s per step
      route: bestRoute,
      validUntil: Date.now() + 60000, // Valid for 1 minute
      confidence: 0.95 // LiFi is generally reliable
    };
  }

  async executeSwap(
    params: ExternalExecutionParams
  ): Promise<ExternalExecutionResult> {
    if (!params.quote.route) {
      throw new Error('No route data in quote');
    }

    try {
      const executionData = await this.lifiService.executeSwap(
        params.quote.route,
        params.userAddress
      );

      return {
        provider: this.name,
        txHash: executionData.txHash,
        status: 'pending',
        executedQuantity: params.quote.quantity,
        executedPrice: params.quote.price
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Execution failed'
      };
    }
  }

  async estimateGas(
    quote: ExternalQuote,
    userAddress: string
  ): Promise<bigint> {
    // LiFi provides gas estimates in the quote
    if (quote.estimatedGas) {
      return BigInt(quote.estimatedGas);
    }
    
    // Default estimate for cross-chain swaps
    return BigInt(500000);
  }
}

// Mock Uniswap Provider (for demonstration)
export class UniswapProvider extends ExternalLiquidityProvider {
  constructor() {
    super('Uniswap', 1, ['ETH/USDC', 'ETH/USDT', 'WBTC/USDC']);
    this.rateLimit = {
      requests: 20,
      interval: 60000,
      current: 0,
      lastReset: Date.now()
    };
  }

  async fetchQuote(
    pair: string,
    side: 'buy' | 'sell',
    quantity: number,
    userAddress?: string
  ): Promise<ExternalQuote | null> {
    // Mock implementation
    // In production, this would call Uniswap SDK or API
    
    const mockPrices: Record<string, number> = {
      'ETH/USDC': 2000,
      'ETH/USDT': 2000,
      'WBTC/USDC': 40000
    };

    const basePrice = mockPrices[pair] || 1000;
    const slippage = 0.003; // 0.3% slippage
    
    const price = side === 'buy' 
      ? basePrice * (1 + slippage)
      : basePrice * (1 - slippage);

    return {
      provider: this.name,
      price: price,
      quantity: quantity,
      minQuantity: quantity * 0.99,
      maxQuantity: quantity * 1.01,
      estimatedGas: '150000',
      estimatedGasUSD: '10',
      executionTime: 15,
      validUntil: Date.now() + 30000,
      confidence: 0.98
    };
  }


  async executeSwap(
    params: ExternalExecutionParams
  ): Promise<ExternalExecutionResult> {
    // Mock implementation
    return {
      provider: this.name,
      txHash: `0x${Math.random().toString(16).substr(2, 64)}`,
      status: 'pending',
      executedQuantity: params.quote.quantity,
      executedPrice: params.quote.price
    };
  }

  async estimateGas(
    quote: ExternalQuote,
    userAddress: string
  ): Promise<bigint> {
    return BigInt(150000);
  }
}

// Aggregator that manages multiple providers
export class LiquidityAggregator extends EventEmitter {
  private providers: Map<string, ExternalLiquidityProvider> = new Map();

  addProvider(provider: ExternalLiquidityProvider): void {
    // Generate unique key to support multiple instances of same provider type
    let providerKey = provider.getName();
    let counter = 1;
    
    // If provider name already exists, append a counter
    while (this.providers.has(providerKey)) {
      providerKey = `${provider.getName()}_${counter}`;
      counter++;
    }
    
    this.providers.set(providerKey, provider);
    
    // Forward provider events
    provider.on('quote-error', (data) => this.emit('provider-quote-error', data));
    provider.on('execution-started', (data) => this.emit('provider-execution-started', data));
    provider.on('execution-completed', (data) => this.emit('provider-execution-completed', data));
    provider.on('execution-failed', (data) => this.emit('provider-execution-failed', data));
  }

  removeProvider(name: string): void {
    const provider = this.providers.get(name);
    if (provider) {
      provider.removeAllListeners();
      this.providers.delete(name);
    }
  }

  // Clear all providers - for testing
  clearProviders(): void {
    for (const provider of this.providers.values()) {
      provider.removeAllListeners();
    }
    this.providers.clear();
    this.removeAllListeners();
  }

  async getBestQuote(
    pair: string,
    side: 'buy' | 'sell',
    quantity: number,
    userAddress?: string
  ): Promise<{
    quote: ExternalQuote;
    provider: ExternalLiquidityProvider;
  } | null> {
    const quotes = await this.getAllQuotes(pair, side, quantity, userAddress);
    
    if (quotes.length === 0) {
      return null;
    }

    // Sort by best price (lowest for buy, highest for sell)
    quotes.sort((a, b) => {
      if (side === 'buy') {
        return a.quote.price - b.quote.price;
      } else {
        return b.quote.price - a.quote.price;
      }
    });

    // Filter out quotes that can't fill the requested quantity
    const viableQuotes = quotes.filter(q => 
      q.quote.quantity >= quantity * 0.95 // Allow 5% partial fill
    );

    if (viableQuotes.length === 0) {
      return quotes[0]; // Return best price even if quantity is insufficient
    }

    return viableQuotes[0];
  }

  async getAllQuotes(
    pair: string,
    side: 'buy' | 'sell',
    quantity: number,
    userAddress?: string
  ): Promise<Array<{
    quote: ExternalQuote;
    provider: ExternalLiquidityProvider;
  }>> {
    try {
      const providers = Array.from(this.providers.values()).filter(p => p.supportsPair(pair));
      
      if (providers.length === 0) {
        return [];
      }
      
      const quotePromises = providers.map(async (provider) => {
        try {
          const quote = await provider.getQuote(pair, side, quantity, userAddress);
          return quote ? { quote, provider } : null;
        } catch (error) {
          console.error(`Failed to get quote from ${provider.getName()}:`, error);
          return null;
        }
      });

      const results = await Promise.all(quotePromises);
      const validResults = results.filter((r): r is { quote: ExternalQuote; provider: ExternalLiquidityProvider } => r !== null);
      
      return validResults;
    } catch (error) {
      console.error('Error in getAllQuotes:', error);
      return []; // Return empty array instead of undefined on error
    }
  }

  async executeWithProvider(
    providerName: string,
    params: ExternalExecutionParams
  ): Promise<ExternalExecutionResult> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }

    return provider.execute(params);
  }
}