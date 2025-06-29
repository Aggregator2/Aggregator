import { ethers } from 'ethers';
import { BaseConnector } from '../BaseConnector';
import { IDEXConnector } from '../../interfaces/connectors';
import { Token, TokenPair, PriceQuote, LiquidityPool, OrderRequest } from '../../interfaces/types';

const SUSHISWAP_ROUTER = '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F';
const SUSHISWAP_FACTORY = '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac';

export class SushiSwapConnector extends BaseConnector implements IDEXConnector {
  private provider?: ethers.Provider;
  private factoryContract?: ethers.Contract;
  private routerContract?: ethers.Contract;
  
  constructor(provider: ethers.Provider, chainId: number = 1) {
    super({
      name: 'SushiSwap',
      type: 'DEX',
      chainId
    });
    this.provider = provider;
  }
  
  getRouterAddress(): string {
    return SUSHISWAP_ROUTER;
  }
  
  getFactoryAddress(): string {
    return SUSHISWAP_FACTORY;
  }
  
  protected async doConnect(): Promise<void> {
    const factoryAbi = [
      'function getPair(address tokenA, address tokenB) view returns (address)',
      'function allPairs(uint) view returns (address)',
      'function allPairsLength() view returns (uint)'
    ];
    
    const routerAbi = [
      'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
      'function getAmountsIn(uint amountOut, address[] path) view returns (uint[] amounts)'
    ];
    
    this.factoryContract = new ethers.Contract(SUSHISWAP_FACTORY, factoryAbi, this.provider);
    this.routerContract = new ethers.Contract(SUSHISWAP_ROUTER, routerAbi, this.provider);
  }
  
  protected async doDisconnect(): Promise<void> {
    this.factoryContract = undefined;
    this.routerContract = undefined;
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    if (!this.routerContract) {
      throw new Error('SushiSwap connector not connected');
    }
    
    try {
      const path = [request.tokenIn.address, request.tokenOut.address];
      const amounts = await this.routerContract.getAmountsOut(request.amountIn, path);
      const amountOut = BigInt(amounts[1].toString());
      
      const priceIn = Number(request.amountIn) / (10 ** request.tokenIn.decimals);
      const priceOut = Number(amountOut) / (10 ** request.tokenOut.decimals);
      const price = priceOut / priceIn;
      
      return {
        source: this.source,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        amountOut,
        price,
        priceImpact: 0, // Placeholder
        gasEstimate: BigInt(150000),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error getting SushiSwap quote:', error);
      return null;
    }
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    if (!this.factoryContract) {
      throw new Error('SushiSwap connector not connected');
    }
    
    try {
      const pairAddress = await this.factoryContract.getPair(
        pair.tokenA.address,
        pair.tokenB.address
      );
      
      if (pairAddress === ethers.ZeroAddress) {
        return [];
      }
      
      const pairAbi = [
        'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
        'function token0() view returns (address)',
        'function token1() view returns (address)'
      ];
      
      const pairContract = new ethers.Contract(pairAddress, pairAbi, this.provider);
      const [reserve0, reserve1] = await pairContract.getReserves();
      const token0Address = await pairContract.token0();
      
      const [tokenA, tokenB] = token0Address.toLowerCase() === pair.tokenA.address.toLowerCase()
        ? [pair.tokenA, pair.tokenB]
        : [pair.tokenB, pair.tokenA];
      
      const [reserveA, reserveB] = token0Address.toLowerCase() === pair.tokenA.address.toLowerCase()
        ? [reserve0, reserve1]
        : [reserve1, reserve0];
      
      return [{
        source: this.source,
        pair,
        reserves: {
          tokenA: BigInt(reserveA.toString()),
          tokenB: BigInt(reserveB.toString())
        },
        fee: 30, // 0.3% fee
        lastUpdate: Date.now()
      }];
    } catch (error) {
      console.error('Error getting SushiSwap liquidity pools:', error);
      return [];
    }
  }
}