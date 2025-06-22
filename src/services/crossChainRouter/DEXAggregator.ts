import axios from 'axios';
import { DEXQuote } from './types';
import { MultiChainQuoteService } from '../multiChainQuoteService';

interface DEXQuoteParams {
  chainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  userAddress: string;
  slippage?: number;
}

export class DEXAggregator {
  private multiChainQuoteService: MultiChainQuoteService;
  private aggregatorAPIs: Map<string, string>;

  constructor(multiChainQuoteService?: MultiChainQuoteService) {
    this.multiChainQuoteService = multiChainQuoteService || new MultiChainQuoteService();
    
    // Additional aggregator APIs
    this.aggregatorAPIs = new Map([
      ['0x', 'https://api.0x.org']
    ]);
  }

  async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    try {
      // First try existing multiChainQuoteService
      const existingQuote = await this.getExistingServiceQuote(params);
      if (existingQuote) return existingQuote;

      // Try additional aggregators
      const quotes = await Promise.all([
        this.get0xQuote(params)
      ]);

      // Filter valid quotes and return best one
      const validQuotes = quotes.filter(q => q !== null) as DEXQuote[];
      if (validQuotes.length === 0) return null;

      // Sort by output amount (descending)
      validQuotes.sort((a, b) => parseFloat(b.toAmount) - parseFloat(a.toAmount));
      
      return validQuotes[0];
    } catch (error) {
      console.error('DEX aggregator error:', error);
      return null;
    }
  }

  private async getExistingServiceQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    try {
      const quote = await this.multiChainQuoteService.getQuote({
        chainId: params.chainId,
        sellToken: params.fromToken,
        buyToken: params.toToken,
        sellAmount: params.fromAmount,
        slippage: params.slippage
      });

      if (!quote) return null;

      return {
        dexId: quote.source,
        dexName: quote.source,
        chainId: params.chainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        toAmount: quote.buyAmount,
        priceImpact: quote.priceImpact || 0,
        gasCost: quote.estimatedGas || '0',
        gasPrice: '0', // Would need to fetch current gas price
        path: quote.route || [],
        data: quote
      };
    } catch (error) {
      console.error('Existing service quote error:', error);
      return null;
    }
  }

  private async get0xQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    try {
      // 0x API supports Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Fantom
      const chainIdToName: Record<number, string> = {
        1: 'ethereum',
        56: 'bsc',
        137: 'polygon',
        42161: 'arbitrum',
        10: 'optimism',
        43114: 'avalanche',
        250: 'fantom'
      };

      const chainName = chainIdToName[params.chainId];
      if (!chainName) return null;

      const response = await axios.get(
        `${this.aggregatorAPIs.get('0x')}/${chainName}/swap/v1/quote`,
        {
          params: {
            sellToken: params.fromToken,
            buyToken: params.toToken,
            sellAmount: params.fromAmount,
            slippagePercentage: (params.slippage || 0.03).toString(),
            skipValidation: true
          },
          headers: {
            '0x-api-key': process.env.ZEROX_API_KEY || ''
          }
        }
      );

      const quote = response.data;

      return {
        dexId: '0x',
        dexName: '0x Protocol',
        chainId: params.chainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        toAmount: quote.buyAmount,
        priceImpact: parseFloat(quote.estimatedPriceImpact || '0') * 10000, // Convert to basis points
        gasCost: quote.estimatedGas,
        gasPrice: quote.gasPrice,
        path: quote.sources?.map((s: any) => s.name) || [],
        data: quote
      };
    } catch (error) {
      return null;
    }
  }


  async getBuildTx(quote: DEXQuote, userAddress: string): Promise<any> {
    // Different aggregators have different transaction building methods
    switch (quote.dexId) {
      case '0x':
        return this.build0xTx(quote, userAddress);
      case 'kyberswap':
        return this.buildKyberSwapTx(quote, userAddress);
      case 'rango':
        return this.buildRangoTx(quote, userAddress);
      default:
        // For existing service quotes, use the transaction data if available
        if (quote.data?.tx) {
          return quote.data.tx;
        }
        throw new Error(`Unsupported DEX: ${quote.dexId}`);
    }
  }

  private async build0xTx(quote: DEXQuote, userAddress: string): Promise<any> {
    try {
      const chainIdToName: Record<number, string> = {
        1: 'ethereum',
        56: 'bsc',
        137: 'polygon',
        42161: 'arbitrum',
        10: 'optimism',
        43114: 'avalanche',
        250: 'fantom'
      };

      const chainName = chainIdToName[quote.chainId];
      
      const response = await axios.get(
        `${this.aggregatorAPIs.get('0x')}/${chainName}/swap/v1/quote`,
        {
          params: {
            sellToken: quote.fromToken,
            buyToken: quote.toToken,
            sellAmount: quote.fromAmount,
            takerAddress: userAddress,
            slippagePercentage: '0.03'
          },
          headers: {
            '0x-api-key': process.env.ZEROX_API_KEY || ''
          }
        }
      );

      return {
        to: response.data.to,
        data: response.data.data,
        value: response.data.value,
        gasPrice: response.data.gasPrice,
        gas: response.data.gas
      };
    } catch (error) {
      throw new Error(`Failed to build 0x transaction: ${error}`);
    }
  }

  private async buildKyberSwapTx(quote: DEXQuote, userAddress: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.aggregatorAPIs.get('kyberswap')}/api/v1/route/build`,
        {
          routeSummary: quote.data,
          userAddress,
          slippageTolerance: 300 // 3%
        }
      );

      const txData = response.data.data;
      
      return {
        to: txData.routerAddress,
        data: txData.data,
        value: txData.value || '0',
        gasPrice: txData.gasPrice,
        gas: txData.gas
      };
    } catch (error) {
      throw new Error(`Failed to build KyberSwap transaction: ${error}`);
    }
  }

  private async buildRangoTx(quote: DEXQuote, userAddress: string): Promise<any> {
    try {
      const response = await axios.post(
        `${this.aggregatorAPIs.get('rango')}/basic/create-transaction`,
        {
          requestId: quote.data.requestId,
          userAddress,
          step: 0 // First step of the swap
        },
        {
          params: {
            apiKey: process.env.RANGO_API_KEY || ''
          }
        }
      );

      const tx = response.data.result?.transaction;
      if (!tx) throw new Error('No transaction data received');
      
      return {
        to: tx.to,
        data: tx.data,
        value: tx.value || '0',
        gasPrice: tx.gasPrice,
        gas: tx.gasLimit
      };
    } catch (error) {
      throw new Error(`Failed to build Rango transaction: ${error}`);
    }
  }

  getSupportedChains(): number[] {
    // Combine chains from all aggregators
    return [
      1, 56, 137, 42161, 10, 43114, 250, 25, 100, 1284, 1285, 1101, 324, 8453,
      // Solana and Tron from existing service
      101, 195
    ];
  }

  getSupportedDEXs(): Array<{ id: string; name: string; chains: number[] }> {
    return [
      {
        id: '1inch',
        name: '1inch',
        chains: [1, 56, 137, 42161, 10, 43114, 250, 100, 1101]
      },
      {
        id: 'openocean',
        name: 'OpenOcean',
        chains: [1, 56, 137, 42161, 10, 43114, 250, 25, 100, 101, 195]
      },
      {
        id: '0x',
        name: '0x Protocol',
        chains: [1, 56, 137, 42161, 10, 43114, 250]
      },
      {
        id: 'kyberswap',
        name: 'KyberSwap',
        chains: [1, 56, 137, 42161, 10, 43114, 250, 25, 1101, 324, 8453]
      },
      {
        id: 'rango',
        name: 'Rango Exchange',
        chains: [1, 56, 137, 42161, 10, 43114, 250, 25, 100, 1284, 1285]
      }
    ];
  }
}