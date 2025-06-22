import { ethers } from 'ethers';
import { multiChainQuoteService } from './multiChainQuoteService';
import { getRevenueAccumulator } from './revenueAccumulator';

// Configuration for profit mechanisms
export const PROFIT_CONFIG = {
  // Hidden spread markup in basis points (20-50 bps)
  spreadMarkupBps: 30, // 0.3%
  
  // Rebate configuration by DEX
  rebateConfig: {
    '0x': { rebateBps: 2, eligible: true },
    '1inch': { rebateBps: 1.5, eligible: true },
    'openocean': { rebateBps: 1, eligible: true },
    'paraswap': { rebateBps: 0.5, eligible: true },
    'jupiter': { rebateBps: 3, eligible: true }, // Higher for Solana
    'kyberswap': { rebateBps: 1, eligible: true },
  },
  
  // Arbitrage thresholds
  arbitrage: {
    minProfitBps: 10, // Only log arb if profit > 0.1%
    simulationEnabled: true,
  }
};

export interface ProfitableQuote {
  // User-facing data (with hidden markup applied)
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string; // This is the reduced amount after hidden fee
  
  // Original market data (internal only)
  originalQuote: {
    buyAmount: string;
    source: string;
    price: number;
  };
  
  // Hidden fee data (internal only)
  feeAmount: string;
  feeBps: number;
  expectedProfit: string;
  
  // Rebate data
  rebateSource: string;
  rebateBps: number;
  rebateEarned: string;
  
  // Arbitrage data
  arbitrageOpportunity: boolean;
  arbitrageProfit: string;
  arbitrageDetails?: {
    sourceMarket: string;
    destinationMarket: string;
    executionPrice: number;
    marketPrice: number;
    timestamp: number;
  };
  
  // Standard quote fields
  price: number;
  guaranteedPrice: number;
  to?: string;
  data?: string;
  value?: string;
  gas?: string;
  gasPrice?: string;
  source: string;
  sources: Array<{ name: string; proportion: string }>;
  validTo: number;
  
  // Internal logging data
  _internal: {
    totalRevenue: string; // fee + rebate + arbitrage
    profitBreakdown: {
      spreadMarkup: string;
      rebate: string;
      arbitrage: string;
    };
    timestamp: number;
    userAddress?: string;
  };
}

export class ProfitableQuoteService {
  private profitLogger: ProfitLogger;
  private fallbackAttempts: Map<string, number>;
  
  constructor() {
    this.profitLogger = new ProfitLogger();
    this.fallbackAttempts = new Map();
  }
  
  /**
   * Get a profitable quote with hidden spread markup, rebates, and arbitrage detection
   */
  async getProfitableQuote(params: {
    sellToken: string;
    buyToken: string;
    sellAmount: string;
    chainId: number;
    toChainId?: number; // For cross-chain swaps
    userAddress?: string;
    slippagePercentage?: number;
  }): Promise<ProfitableQuote> {
    try {
      // Log only in debug mode
      if (process.env.DEBUG) {
        console.log('ProfitableQuoteService received params:', {
          ...params,
          sellAmount: params.sellAmount,
          sellAmountLength: params.sellAmount?.length
        });
      }
      
      // Validate sell amount
      try {
        if (!params.sellAmount) {
          throw new Error('Sell amount is required');
        }
        const amount = BigInt(params.sellAmount);
        // Check if amount is reasonable (less than 10^30)
        const maxAmount = BigInt(10) ** BigInt(30);
        if (amount > maxAmount) {
          throw new Error('Sell amount is too large');
        }
      } catch (error: any) {
        throw new Error('Invalid sell amount: ' + (error.message || error.toString()));
      }
      // Step 1: Get the best market quote from multiple sources
      const marketQuotes = await this.getMarketQuotes(params);
      const bestQuote = this.selectBestQuote(marketQuotes);
      
      // Step 2: Apply hidden spread markup
      const markedUpQuote = this.applyHiddenSpreadMarkup(bestQuote, params.sellAmount);
      
      // Step 3: Calculate rebates based on routing source
      const rebateData = this.calculateRebate(bestQuote.source, params.sellAmount);
      
      // Step 4: Simulate arbitrage opportunities
      const arbitrageData = await this.simulateArbitrage(
        params,
        bestQuote,
        markedUpQuote.userBuyAmount
      );
      
      // Step 5: Build the profitable quote response
      const profitableQuote: ProfitableQuote = {
        // User-facing data (with markup applied)
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: params.sellAmount,
        buyAmount: markedUpQuote.userBuyAmount, // Reduced amount
        
        // Original quote data (internal)
        originalQuote: {
          buyAmount: bestQuote.buyAmount,
          source: bestQuote.source,
          price: bestQuote.price,
        },
        
        // Hidden fee data
        feeAmount: markedUpQuote.feeAmount,
        feeBps: markedUpQuote.feeBps,
        expectedProfit: markedUpQuote.feeAmount,
        
        // Rebate data
        rebateSource: rebateData.source,
        rebateBps: rebateData.rebateBps,
        rebateEarned: rebateData.rebateEarned,
        
        // Arbitrage data
        arbitrageOpportunity: arbitrageData.profitable,
        arbitrageProfit: arbitrageData.profit || '0',
        arbitrageDetails: arbitrageData.details,
        
        // Standard fields
        price: parseFloat(markedUpQuote.userBuyAmount) / parseFloat(params.sellAmount),
        guaranteedPrice: parseFloat(markedUpQuote.userBuyAmount) / parseFloat(params.sellAmount) * 0.995,
        to: bestQuote.to,
        data: bestQuote.data,
        value: bestQuote.value,
        gas: bestQuote.gas,
        gasPrice: bestQuote.gasPrice,
        source: bestQuote.source,
        sources: bestQuote.sources || [{ name: bestQuote.source, proportion: '1' }],
        validTo: Math.floor(Date.now() / 1000) + 180, // 3 minutes
        
        // Internal tracking
        _internal: {
          totalRevenue: this.calculateTotalRevenue(
            markedUpQuote.feeAmount,
            rebateData.rebateEarned,
            arbitrageData.profit || '0'
          ),
          profitBreakdown: {
            spreadMarkup: markedUpQuote.feeAmount,
            rebate: rebateData.rebateEarned,
            arbitrage: arbitrageData.profit || '0',
          },
          timestamp: Date.now(),
          userAddress: params.userAddress,
        },
      };
      
      // Log profit opportunity
      await this.profitLogger.logQuote(profitableQuote);
      
      // Track revenue for accumulation
      await this.trackRevenueForAccumulation(profitableQuote, params);
      
      return profitableQuote;
      
    } catch (error) {
      console.error('Error generating profitable quote:', error);
      throw error;
    }
  }
  
  /**
   * Get quotes from multiple market sources with retry logic
   */
  private async getMarketQuotes(params: any): Promise<any[]> {
    const maxRetries = 3;
    let attempts = 0;
    
    while (attempts < maxRetries) {
      const quotes = [];
      
      // Try LiFi first (through multiChainQuoteService)
      try {
        const lifiQuote = await this.getQuoteFromMultiChain(params);
        if (lifiQuote) {
          console.log('[ProfitableQuoteService] Got LiFi quote:', {
            source: lifiQuote.source,
            buyAmount: lifiQuote.buyAmount
          });
          return [lifiQuote]; // Return LiFi quote immediately if successful
        }
      } catch (error) {
        console.log('[ProfitableQuoteService] LiFi quote failed:', error);
      }
      
      // If no quotes, wait before retrying (exponential backoff)
      attempts++;
      if (attempts < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempts - 1), 5000); // Max 5 seconds
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // After all retries, try fallback
    const pairKey = `${params.sellToken}-${params.buyToken}`;
    const fallbackAttempts = this.fallbackAttempts.get(pairKey) || 0;
    
    // Only try fallback twice per token pair
    if (fallbackAttempts < 2) {
      this.fallbackAttempts.set(pairKey, fallbackAttempts + 1);
      
      // Clear old attempts after 5 minutes
      setTimeout(() => {
        this.fallbackAttempts.delete(pairKey);
      }, 5 * 60 * 1000);
      
      const fallbackQuote = this.createBasicFallbackQuote(params);
      if (fallbackQuote) {
        return [fallbackQuote];
      }
    }
    
    throw new Error('Quote services unavailable. Please try again later.');
  }
  
  private async getQuoteFromMultiChain(params: any) {
    try {
      console.log('[ProfitableQuoteService] Requesting quote from MultiChainQuoteService');
      const quote = await multiChainQuoteService.getQuote({
        ...params,
        chainId: params.chainId,
        toChainId: params.toChainId || params.chainId, // Support cross-chain
      });
      console.log('[ProfitableQuoteService] Got quote from source:', quote.source);
      return quote;
    } catch (error) {
      console.warn('[ProfitableQuoteService] MultiChain quote failed:', error);
      throw error; // Re-throw to see the actual error
    }
  }
  
  private async getQuoteFromFreeService(params: any) {
    try {
      // Use fallback mechanism with hardcoded rates for common pairs
      const fallbackRates: Record<string, number> = {
        'ETH_USDC': 3500,
        'ETH_USDT': 3500,
        'ETH_DAI': 3500,
        'ETH_BUSD': 3500,
        'WETH_USDC': 3500,
        'WETH_USDT': 3500,
        'WETH_DAI': 3500,
        'BNB_USDT': 600,
        'BNB_BUSD': 600,
        'BNB_USDC': 600,
        'MATIC_USDC': 1.2,
        'MATIC_USDT': 1.2,
        'SOL_USDC': 180,
        'SOL_USDT': 180,
        'USDC_USDT': 1,
        'USDT_USDC': 1,
        'USDC_BUSD': 1,
        'BUSD_USDC': 1,
        'USDT_BUSD': 1,
        'BUSD_USDT': 1,
      };

      // Try to find a fallback rate
      const sellSymbol = this.getTokenSymbol(params.sellToken, params.chainId);
      const buySymbol = this.getTokenSymbol(params.buyToken, params.chainId);
      const pairKey = `${sellSymbol}_${buySymbol}`;
      const reversePairKey = `${buySymbol}_${sellSymbol}`;
      
      let rate = fallbackRates[pairKey];
      let isReverse = false;
      
      if (!rate && fallbackRates[reversePairKey]) {
        rate = 1 / fallbackRates[reversePairKey];
        isReverse = true;
      }
      
      if (rate) {
        const sellAmountBN = BigInt(params.sellAmount);
        const buyAmount = (sellAmountBN * BigInt(Math.floor(rate * 1000))) / BigInt(1000);
        
        return {
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.sellAmount,
          buyAmount: buyAmount.toString(),
          price: rate,
          source: 'fallback',
          sources: [{ name: 'fallback', proportion: '1' }],
        };
      }
      
      return null;
    } catch (error) {
      console.warn('Free service quote failed:', error);
      return null;
    }
  }
  
  private getTokenSymbol(address: string, chainId?: number): string {
    // Common token mappings (case-insensitive)
    const normalizedAddress = address.toLowerCase();
    const tokenMap: Record<string, string> = {
      // Ethereum Mainnet
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH', // Mainnet WETH
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH', // Arbitrum WETH
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
      '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI', // Arbitrum DAI
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 'ETH',
      '0x0000000000000000000000000000000000000000': 'ETH', // Zero address as ETH
      // BSC
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'BNB',
      '0xe9e7cea3dedca5984780bafc599bd69add087d56': 'BUSD',
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8': 'ETH', // BSC ETH
      '0x55d398326f99059ff775485246999027b3197955': 'USDT', // BSC USDT
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC', // BSC USDC
      // Polygon
      '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'MATIC',
      '0x0000000000000000000000000000000000001010': 'MATIC', // Polygon native
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC', // Polygon USDC  
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT', // Polygon USDT
      // Arbitrum
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT', // Arbitrum USDT
      // Solana (using common mint addresses)
      'so11111111111111111111111111111111111111112': 'SOL',
      '2b1kv6dkpanxd5ixfnxcpjxmkwqjjaymmczfhsfux24gxo': 'PYTH',
      // More common tokens
      '0x4fabb145d64652a948d72533023f6e7a623c7c53': 'BUSD',
      '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'MATIC', // Mainnet MATIC
      '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
    };
    
    // Special handling for the 0xEeee address which represents native tokens
    if (normalizedAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      // Map to the correct native token based on chain ID
      if (chainId === 56) return 'BNB';      // BSC
      if (chainId === 137) return 'MATIC';   // Polygon
      if (chainId === 43114) return 'AVAX';  // Avalanche
      if (chainId === 250) return 'FTM';     // Fantom
      return 'ETH'; // Default to ETH for Ethereum, Arbitrum, Optimism
    }
    
    return tokenMap[normalizedAddress] || 'UNKNOWN';
  }
  
  private createBasicFallbackQuote(params: any): any {
    try {
      // Basic exchange rates (rough estimates as of 2024)
      const baseRates: Record<string, Record<string, number>> = {
        'ETH': { 'USDC': 3500, 'USDT': 3500, 'DAI': 3500, 'WETH': 1, 'BUSD': 3500 },
        'WETH': { 'USDC': 3500, 'USDT': 3500, 'DAI': 3500, 'ETH': 1, 'BUSD': 3500 },
        'BNB': { 'USDT': 600, 'BUSD': 600, 'USDC': 600, 'DAI': 600 },
        'MATIC': { 'USDC': 1.2, 'USDT': 1.2, 'DAI': 1.2, 'BUSD': 1.2 },
        'SOL': { 'USDC': 180, 'USDT': 180, 'DAI': 180, 'BUSD': 180 },
        'USDC': { 'USDT': 1, 'DAI': 1, 'BUSD': 1 },
        'USDT': { 'USDC': 1, 'DAI': 1, 'BUSD': 1 },
        'DAI': { 'USDC': 1, 'USDT': 1, 'BUSD': 1 },
        'BUSD': { 'USDC': 1, 'USDT': 1, 'DAI': 1 },
        'PYTH': { 'USDC': 0.4, 'USDT': 0.4, 'DAI': 0.4 },
      };
      
      const sellSymbol = this.getTokenSymbol(params.sellToken);
      const buySymbol = this.getTokenSymbol(params.buyToken);
      
      console.log('[ProfitableQuoteService] Creating fallback quote for:', {
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellSymbol,
        buySymbol,
        sellAmount: params.sellAmount
      });
      
      let rate = baseRates[sellSymbol]?.[buySymbol];
      
      // Try reverse rate
      if (!rate && baseRates[buySymbol]?.[sellSymbol]) {
        rate = 1 / baseRates[buySymbol][sellSymbol];
      }
      
      // Default rate for unknown pairs
      if (!rate) {
        console.log('No rate found for pair, using 1:1 fallback');
        rate = 1; // 1:1 fallback
      }
      
      console.log('Using rate:', rate);
      
      const sellAmountBN = BigInt(params.sellAmount);
      const buyAmount = (sellAmountBN * BigInt(Math.floor(rate * 10000))) / BigInt(10000);
      
      return {
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: params.sellAmount,
        buyAmount: buyAmount.toString(),
        price: rate,
        source: 'fallback',
        sources: [{ name: 'fallback', proportion: '1' }],
        to: '0x0000000000000000000000000000000000000000',
        data: '0x',
        gas: '150000',
        gasPrice: '5000000000',
      };
    } catch (error) {
      console.error('Failed to create fallback quote:', error);
      return null;
    }
  }
  
  /**
   * Select the best quote from multiple sources
   */
  private selectBestQuote(quotes: any[]): any {
    console.log('[ProfitableQuoteService] Selecting best quote from:', quotes.map(q => ({
      source: q.source,
      buyAmount: q.buyAmount
    })));
    
    const best = quotes.reduce((best, current) => {
      const bestAmount = BigInt(best.buyAmount || '0');
      const currentAmount = BigInt(current.buyAmount || '0');
      return currentAmount > bestAmount ? current : best;
    });
    
    console.log('[ProfitableQuoteService] Selected best quote:', {
      source: best.source,
      buyAmount: best.buyAmount
    });
    
    return best;
  }
  
  /**
   * Apply hidden spread markup to the quote
   */
  private applyHiddenSpreadMarkup(quote: any, sellAmount: string): {
    userBuyAmount: string;
    feeAmount: string;
    feeBps: number;
  } {
    const originalBuyAmount = BigInt(quote.buyAmount);
    const bps = PROFIT_CONFIG.spreadMarkupBps;
    
    // Calculate fee amount (in buy token units)
    const feeAmount = (originalBuyAmount * BigInt(bps)) / BigInt(10000);
    
    // User receives less tokens
    const userBuyAmount = originalBuyAmount - feeAmount;
    
    return {
      userBuyAmount: userBuyAmount.toString(),
      feeAmount: feeAmount.toString(),
      feeBps: bps,
    };
  }
  
  /**
   * Calculate rebate based on routing source
   */
  private calculateRebate(source: string, sellAmount: string): {
    source: string;
    rebateBps: number;
    rebateEarned: string;
  } {
    const sourceLower = source.toLowerCase();
    const rebateConfig = PROFIT_CONFIG.rebateConfig[sourceLower];
    
    if (!rebateConfig || !rebateConfig.eligible) {
      return {
        source,
        rebateBps: 0,
        rebateEarned: '0',
      };
    }
    
    const sellAmountBN = BigInt(sellAmount);
    const rebateAmount = (sellAmountBN * BigInt(Math.floor(rebateConfig.rebateBps * 100))) / BigInt(1000000);
    
    return {
      source,
      rebateBps: rebateConfig.rebateBps,
      rebateEarned: rebateAmount.toString(),
    };
  }
  
  /**
   * Simulate arbitrage opportunities
   */
  private async simulateArbitrage(
    params: any,
    bestQuote: any,
    userBuyAmount: string
  ): Promise<{
    profitable: boolean;
    profit?: string;
    details?: any;
  }> {
    if (!PROFIT_CONFIG.arbitrage.simulationEnabled) {
      return { profitable: false };
    }
    
    try {
      // Simulate checking multiple markets for better execution
      const markets = ['binance', 'coinbase', 'kraken', 'uniswap', 'sushiswap'];
      const marketPrices = await this.simulateMarketPrices(params, markets);
      
      // Find the best execution price
      const bestMarketPrice = Math.max(...marketPrices.map(m => m.price));
      const ourExecutionPrice = parseFloat(bestQuote.buyAmount) / parseFloat(params.sellAmount);
      
      // Check if we can execute better than what we're giving the user
      const userPrice = parseFloat(userBuyAmount) / parseFloat(params.sellAmount);
      
      // Validate prices to avoid division errors
      if (!isFinite(userPrice) || userPrice <= 0 || !isFinite(bestMarketPrice) || bestMarketPrice <= 0) {
        return { profitable: false };
      }
      
      if (bestMarketPrice > userPrice) {
        const profitBps = ((bestMarketPrice - userPrice) / userPrice) * 10000;
        
        // Ensure profitBps is a valid number
        if (!isFinite(profitBps) || profitBps < 0) {
          return { profitable: false };
        }
        
        if (profitBps >= PROFIT_CONFIG.arbitrage.minProfitBps) {
          const profitAmount = (BigInt(params.sellAmount) * BigInt(Math.floor(profitBps))) / BigInt(10000);
          
          return {
            profitable: true,
            profit: profitAmount.toString(),
            details: {
              sourceMarket: bestQuote.source,
              destinationMarket: marketPrices.find(m => m.price === bestMarketPrice)?.market,
              executionPrice: bestMarketPrice,
              marketPrice: userPrice,
              timestamp: Date.now(),
            },
          };
        }
      }
      
      return { profitable: false };
      
    } catch (error) {
      console.warn('Arbitrage simulation failed:', error);
      return { profitable: false };
    }
  }
  
  /**
   * Simulate market prices (in production, this would check real markets)
   */
  private async simulateMarketPrices(params: any, markets: string[]): Promise<any[]> {
    // Simulate price variations across markets
    const basePrice = 1; // Simplified for simulation
    
    return markets.map(market => ({
      market,
      price: basePrice * (1 + (Math.random() - 0.5) * 0.01), // ±0.5% variation
    }));
  }
  
  /**
   * Calculate total revenue from all profit sources
   */
  private calculateTotalRevenue(fee: string, rebate: string, arbitrage: string): string {
    const total = BigInt(fee) + BigInt(rebate) + BigInt(arbitrage);
    
    return total.toString();
  }

  /**
   * Track revenue for accumulation and automatic transfer
   */
  private async trackRevenueForAccumulation(quote: ProfitableQuote, params: any): Promise<void> {
    try {
      // Skip revenue tracking if environment variables are not set
      if (!process.env.REVENUE_PRIVATE_KEY || !process.env.REVENUE_WALLET) {
        // Silently skip revenue tracking if not configured
        return;
      }
      
      // Only track if we have actual profit
      if (!quote.feeAmount || quote.feeAmount === '0') {
        return;
      }

      // Get token price in USD
      const tokenUsdPrice = await this.getTokenUsdPrice(params.buyToken, params.chainId);
      
      // Add fee to revenue accumulator
      const revenueAccumulator = getRevenueAccumulator();
      await revenueAccumulator.addFeeCollection({
        feeAmount: quote.feeAmount,
        feeToken: params.buyToken,
        tokenUsdPrice,
        timestamp: Date.now(),
        chainId: params.chainId,
      });

    } catch (error) {
      // Don't fail the quote if revenue tracking fails
      console.error('[ProfitableQuoteService] Failed to track revenue:', error);
    }
  }

  /**
   * Get token price in USD (simplified - in production use price oracles)
   */
  private async getTokenUsdPrice(tokenAddress: string, chainId: number): Promise<number> {
    // Simplified price mapping - in production, use Chainlink oracles or CoinGecko API
    const prices: Record<string, number> = {
      // Ethereum mainnet
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 2000, // WETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 1, // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7': 1, // USDT
      '0x6B175474E89094C44Da98b954EedeAC495271d0F': 1, // DAI
      '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE': 2000, // ETH
      // Arbitrum
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': 2000, // WETH
      '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1': 1, // DAI
      // BSC
      '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 300, // BNB
      // Polygon
      '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270': 0.8, // MATIC
    };

    const price = prices[tokenAddress] || prices[tokenAddress.toLowerCase()];
    if (price) {
      return price;
    }

    // Default prices based on chain native tokens
    if (chainId === 56) return 300; // BSC - BNB
    if (chainId === 137) return 0.8; // Polygon - MATIC
    if (chainId === 43114) return 25; // Avalanche - AVAX
    
    // Default to $1 for stablecoins or unknown tokens
    return 1;
  }
}

/**
 * Internal profit logging system
 */
class ProfitLogger {
  private logs: any[] = [];
  
  async logQuote(quote: ProfitableQuote) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      quoteId: this.generateQuoteId(),
      pair: `${quote.sellToken}/${quote.buyToken}`,
      sellAmount: quote.sellAmount,
      
      // Profit metrics
      feeAmount: quote.feeAmount,
      feeBps: quote.feeBps,
      rebateEarned: quote.rebateEarned,
      rebateBps: quote.rebateBps,
      arbitrageProfit: quote.arbitrageProfit,
      
      // Total revenue
      totalRevenue: quote._internal.totalRevenue,
      profitBreakdown: quote._internal.profitBreakdown,
      
      // Execution details
      source: quote.source,
      userAddress: quote._internal.userAddress,
      
      // Market data
      originalBuyAmount: quote.originalQuote.buyAmount,
      userBuyAmount: quote.buyAmount,
      spreadApplied: quote.feeBps,
    };
    
    // In production, this would write to a database or analytics service
    this.logs.push(logEntry);
    // Only log in debug mode
    if (process.env.DEBUG) {
      console.log('[PROFIT LOG]', JSON.stringify(logEntry, null, 2));
    }
    
    // Keep only last 1000 logs in memory
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }
  
  private generateQuoteId(): string {
    return `QUOTE-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Get profit analytics
  async getAnalytics(timeframe: 'hour' | 'day' | 'week' = 'day'): Promise<any> {
    const now = Date.now();
    const timeframes = {
      hour: 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
    };
    
    const cutoff = now - timeframes[timeframe];
    const relevantLogs = this.logs.filter(log => 
      new Date(log.timestamp).getTime() > cutoff
    );
    
    // Calculate totals
    const totals = relevantLogs.reduce((acc, log) => {
      acc.totalFees = (BigInt(acc.totalFees) + BigInt(log.feeAmount)).toString();
      acc.totalRebates = (BigInt(acc.totalRebates) + BigInt(log.rebateEarned)).toString();
      acc.totalArbitrage = (BigInt(acc.totalArbitrage) + BigInt(log.arbitrageProfit)).toString();
      acc.totalRevenue = (BigInt(acc.totalRevenue) + BigInt(log.totalRevenue)).toString();
      acc.quoteCount++;
      return acc;
    }, {
      totalFees: '0',
      totalRebates: '0',
      totalArbitrage: '0',
      totalRevenue: '0',
      quoteCount: 0,
    });
    
    return {
      timeframe,
      period: {
        start: new Date(cutoff).toISOString(),
        end: new Date(now).toISOString(),
      },
      metrics: totals,
      averageRevenuePerQuote: totals.quoteCount > 0 
        ? (BigInt(totals.totalRevenue) / BigInt(totals.quoteCount)).toString()
        : '0',
    };
  }
}

// Export singleton instance
export const profitableQuoteService = new ProfitableQuoteService();