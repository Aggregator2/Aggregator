import { ethers } from 'ethers';
import { BaseConnector } from '../BaseConnector';
import { IDEXConnector } from '../../interfaces/connectors';
import { Token, TokenPair, PriceQuote, LiquidityPool, OrderRequest } from '../../interfaces/types';

// Curve uses a registry system
const CURVE_REGISTRY = '0x90E00ACe148ca3b23Ac1bC8C240C2a7Dd9c2d7f5';
const CURVE_POOL_INFO = '0xe64608E223433E8a03a1DaaeFD8Cb638C14B552C';

export class CurveConnector extends BaseConnector implements IDEXConnector {
  private provider?: ethers.Provider;
  private registryContract?: ethers.Contract;
  private poolInfoContract?: ethers.Contract;
  
  constructor(provider: ethers.Provider, chainId: number = 1) {
    super({
      name: 'Curve',
      type: 'DEX',
      chainId
    });
    this.provider = provider;
  }
  
  getRouterAddress(): string {
    return CURVE_REGISTRY; // Curve uses registry instead of router
  }
  
  getFactoryAddress(): string {
    return CURVE_REGISTRY;
  }
  
  protected async doConnect(): Promise<void> {
    const registryAbi = [
      'function find_pool_for_coins(address from, address to) view returns (address)',
      'function get_pool_coins(address pool) view returns (address[8])',
      'function get_balances(address pool) view returns (uint256[8])',
      'function get_coin_indices(address pool, address from, address to) view returns (int128, int128, bool)'
    ];
    
    const poolInfoAbi = [
      'function get_pool_info(address pool) view returns (uint256[8] balances, uint256[8] rates, uint256 A, uint256 fee)'
    ];
    
    this.registryContract = new ethers.Contract(CURVE_REGISTRY, registryAbi, this.provider);
    this.poolInfoContract = new ethers.Contract(CURVE_POOL_INFO, poolInfoAbi, this.provider);
  }
  
  protected async doDisconnect(): Promise<void> {
    this.registryContract = undefined;
    this.poolInfoContract = undefined;
  }
  
  async getQuote(request: OrderRequest): Promise<PriceQuote | null> {
    if (!this.registryContract) {
      throw new Error('Curve connector not connected');
    }
    
    try {
      const poolAddress = await this.registryContract.find_pool_for_coins(
        request.tokenIn.address,
        request.tokenOut.address
      );
      
      if (poolAddress === ethers.ZeroAddress) {
        return null;
      }
      
      // Get coin indices
      const [i, j] = await this.registryContract.get_coin_indices(
        poolAddress,
        request.tokenIn.address,
        request.tokenOut.address
      );
      
      // Create pool contract for dy calculation
      const poolAbi = [
        'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)'
      ];
      
      const poolContract = new ethers.Contract(poolAddress, poolAbi, this.provider);
      const amountOut = await poolContract.get_dy(i, j, request.amountIn);
      
      const priceIn = Number(request.amountIn) / (10 ** request.tokenIn.decimals);
      const priceOut = Number(amountOut) / (10 ** request.tokenOut.decimals);
      const price = priceOut / priceIn;
      
      return {
        source: this.source,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn,
        amountOut: BigInt(amountOut.toString()),
        price,
        priceImpact: 0, // Would need to calculate based on pool parameters
        gasEstimate: BigInt(200000), // Curve swaps typically use more gas
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Error getting Curve quote:', error);
      return null;
    }
  }
  
  async getLiquidityPools(pair: TokenPair): Promise<LiquidityPool[]> {
    if (!this.registryContract || !this.poolInfoContract) {
      throw new Error('Curve connector not connected');
    }
    
    try {
      const poolAddress = await this.registryContract.find_pool_for_coins(
        pair.tokenA.address,
        pair.tokenB.address
      );
      
      if (poolAddress === ethers.ZeroAddress) {
        return [];
      }
      
      const poolInfo = await this.poolInfoContract.get_pool_info(poolAddress);
      const [i, j] = await this.registryContract.get_coin_indices(
        poolAddress,
        pair.tokenA.address,
        pair.tokenB.address
      );
      
      return [{
        source: this.source,
        pair,
        reserves: {
          tokenA: BigInt(poolInfo.balances[i].toString()),
          tokenB: BigInt(poolInfo.balances[j].toString())
        },
        fee: Number(poolInfo.fee) / 1e8, // Convert to basis points
        lastUpdate: Date.now()
      }];
    } catch (error) {
      console.error('Error getting Curve liquidity pools:', error);
      return [];
    }
  }
}