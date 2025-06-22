import { DEXQuote } from './types';

interface DEXQuoteParams {
  chainId: number;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  userAddress: string;
  slippage?: number;
}

export class MockDEXAggregator {
  private mockPrices: Map<string, number> = new Map();

  constructor() {
    this.initializeMockPrices();
  }

  private initializeMockPrices() {
    // Mock token prices for quote calculations
    const prices = [
      // Ethereum
      { chainId: 1, address: '0x0000000000000000000000000000000000000000', price: 2000 }, // ETH
      { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', price: 1 }, // USDC
      { chainId: 1, address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', price: 1 }, // USDT
      { chainId: 1, address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', price: 2000 }, // WETH
      { chainId: 1, address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', price: 45000 }, // WBTC
      { chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', price: 1 }, // DAI

      // BSC
      { chainId: 56, address: '0x0000000000000000000000000000000000000000', price: 300 }, // BNB
      { chainId: 56, address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', price: 1 }, // USDC
      { chainId: 56, address: '0x55d398326f99059fF775485246999027B3197955', price: 1 }, // USDT
      { chainId: 56, address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', price: 2000 }, // WETH
      { chainId: 56, address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', price: 45000 }, // WBTC

      // Polygon
      { chainId: 137, address: '0x0000000000000000000000000000000000000000', price: 0.8 }, // MATIC
      { chainId: 137, address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', price: 1 }, // USDC
      { chainId: 137, address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', price: 1 }, // USDT
      { chainId: 137, address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', price: 2000 }, // WETH

      // Arbitrum
      { chainId: 42161, address: '0x0000000000000000000000000000000000000000', price: 2000 }, // ETH
      { chainId: 42161, address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', price: 1 }, // USDC
      { chainId: 42161, address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', price: 1 }, // USDT

      // Optimism
      { chainId: 10, address: '0x0000000000000000000000000000000000000000', price: 2000 }, // ETH
      { chainId: 10, address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', price: 1 }, // USDC
      { chainId: 10, address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', price: 1 }, // USDT

      // Avalanche
      { chainId: 43114, address: '0x0000000000000000000000000000000000000000', price: 25 }, // AVAX
      { chainId: 43114, address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', price: 1 }, // USDC
      { chainId: 43114, address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', price: 1 }  // USDT
    ];

    prices.forEach(p => {
      const key = `${p.chainId}-${p.address.toLowerCase()}`;
      this.mockPrices.set(key, p.price);
    });
  }

  async getQuote(params: DEXQuoteParams): Promise<DEXQuote | null> {
    try {
      // Get token prices
      const fromKey = `${params.chainId}-${params.fromToken.toLowerCase()}`;
      const toKey = `${params.chainId}-${params.toToken.toLowerCase()}`;
      
      const fromPrice = this.mockPrices.get(fromKey) || 1;
      const toPrice = this.mockPrices.get(toKey) || 1;
      
      // Calculate exchange rate
      const rate = fromPrice / toPrice;
      
      // Apply slippage (simulate market conditions)
      const slippageMultiplier = 1 - (params.slippage || 0.003); // 0.3% default slippage
      const finalRate = rate * slippageMultiplier;
      
      // Calculate output amount
      const fromAmountFloat = parseFloat(params.fromAmount);
      const toAmountFloat = fromAmountFloat * finalRate;
      
      // Convert to string (assuming 18 decimals for simplicity)
      const toAmount = Math.floor(toAmountFloat).toString();
      
      // Calculate price impact (mock)
      const priceImpact = Math.min(Math.max(fromAmountFloat / 1000000, 0.1), 5) * 100; // 0.1% to 5%
      
      // Select random DEX for simulation
      const dexes = ['1inch', 'uniswap', 'sushiswap', 'pancakeswap', 'quickswap'];
      const selectedDex = dexes[params.chainId % dexes.length];
      
      return {
        dexId: selectedDex,
        dexName: selectedDex.charAt(0).toUpperCase() + selectedDex.slice(1),
        chainId: params.chainId,
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        toAmount,
        priceImpact,
        gasCost: this.getGasCostForChain(params.chainId),
        gasPrice: this.getGasPriceForChain(params.chainId),
        path: [params.fromToken, params.toToken],
        data: {
          mockQuote: true,
          rate: finalRate,
          slippage: params.slippage || 0.003
        }
      };
    } catch (error) {
      console.error('Mock DEX quote error:', error);
      return null;
    }
  }

  private getGasCostForChain(chainId: number): string {
    const gasCosts: Record<number, string> = {
      1: '200000',      // Ethereum - higher gas
      56: '150000',     // BSC
      137: '180000',    // Polygon
      42161: '100000',  // Arbitrum - lower gas
      10: '120000',     // Optimism - lower gas
      43114: '160000',  // Avalanche
      250: '140000'     // Fantom
    };
    
    return gasCosts[chainId] || '150000';
  }

  private getGasPriceForChain(chainId: number): string {
    const gasPrices: Record<number, string> = {
      1: '30000000000',      // 30 gwei
      56: '5000000000',      // 5 gwei
      137: '50000000000',    // 50 gwei
      42161: '100000000',    // 0.1 gwei
      10: '1000000000',      // 1 gwei
      43114: '25000000000',  // 25 gwei
      250: '30000000000'     // 30 gwei
    };
    
    return gasPrices[chainId] || '20000000000';
  }

  async getBuildTx(quote: DEXQuote, userAddress: string): Promise<any> {
    // Return mock transaction data
    const routerAddresses: Record<number, string> = {
      1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',      // Uniswap V2 Router
      56: '0x10ED43C718714eb63d5aA57B78B54704E256024E',     // PancakeSwap Router
      137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',    // QuickSwap Router
      42161: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',  // SushiSwap Router
      10: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',     // Uniswap V2 Router
      43114: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4'   // Trader Joe Router
    };

    return {
      to: routerAddresses[quote.chainId] || routerAddresses[1],
      data: '0x38ed173900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000080000000000000000000000000' + userAddress.slice(2) + '000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000' + quote.fromToken.slice(2) + '000000000000000000000000' + quote.toToken.slice(2),
      value: quote.fromToken === '0x0000000000000000000000000000000000000000' ? quote.fromAmount : '0',
      gas: quote.gasCost,
      gasPrice: quote.gasPrice
    };
  }

  getSupportedChains(): number[] {
    return [1, 56, 137, 42161, 10, 43114, 250];
  }

  getSupportedDEXs(): Array<{ id: string; name: string; chains: number[] }> {
    return [
      {
        id: '1inch',
        name: '1inch',
        chains: [1, 56, 137, 42161, 10, 43114]
      },
      {
        id: 'uniswap',
        name: 'Uniswap',
        chains: [1, 137, 42161, 10]
      },
      {
        id: 'pancakeswap',
        name: 'PancakeSwap',
        chains: [56]
      },
      {
        id: 'quickswap',
        name: 'QuickSwap',
        chains: [137]
      },
      {
        id: 'sushiswap',
        name: 'SushiSwap',
        chains: [1, 56, 137, 42161, 43114, 250]
      }
    ];
  }
}