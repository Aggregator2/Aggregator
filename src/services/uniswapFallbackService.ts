import { ethers } from 'ethers';
import { Token, CurrencyAmount, TradeType, Percent } from '@uniswap/sdk-core';
import { Pool, Route, Trade, SwapRouter, computePoolAddress, FeeAmount } from '@uniswap/v3-sdk';
import IUniswapV3PoolABI from '@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json';
import Quoter from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json';

const ETHEREUM_CHAIN_ID = 1;
const POOL_FACTORY_CONTRACT_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const QUOTER_CONTRACT_ADDRESS = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6';
const SWAP_ROUTER_ADDRESS = '0xE592427A0AEce92De3Edee1F18E0157C05861564';

export interface UniswapQuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  recipient: string;
  slippageTolerance?: number;
}

export interface UniswapQuoteResponse {
  amountOut: string;
  priceImpact: string;
  route: string[];
  gasEstimate: string;
}

class UniswapFallbackService {
  private provider: ethers.JsonRpcProvider;
  private quoterContract: ethers.Contract;

  constructor() {
    // Initialize with public RPC endpoint
    this.provider = new ethers.JsonRpcProvider('https://eth-mainnet.g.alchemy.com/v2/demo');
    this.quoterContract = new ethers.Contract(
      QUOTER_CONTRACT_ADDRESS,
      Quoter.abi,
      this.provider
    );
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.provider.getNetwork();
      return true;
    } catch {
      return false;
    }
  }

  private async getTokenMetadata(address: string): Promise<{ symbol: string; decimals: number; name: string }> {
    const tokenContract = new ethers.Contract(
      address,
      ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function name() view returns (string)'],
      this.provider
    );

    const [symbol, decimals, name] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.name()
    ]);

    return { symbol, decimals: Number(decimals), name };
  }

  async getQuote(request: UniswapQuoteRequest): Promise<UniswapQuoteResponse> {
    try {
      // Get token metadata
      const [tokenInMeta, tokenOutMeta] = await Promise.all([
        this.getTokenMetadata(request.tokenIn),
        this.getTokenMetadata(request.tokenOut)
      ]);

      // Validate decimals
      if (!tokenInMeta.decimals || tokenInMeta.decimals < 0 || tokenInMeta.decimals > 18) {
        throw new Error(`Invalid decimals for token ${request.tokenIn}: ${tokenInMeta.decimals}`);
      }
      if (!tokenOutMeta.decimals || tokenOutMeta.decimals < 0 || tokenOutMeta.decimals > 18) {
        throw new Error(`Invalid decimals for token ${request.tokenOut}: ${tokenOutMeta.decimals}`);
      }

      // Create token instances
      const tokenIn = new Token(ETHEREUM_CHAIN_ID, request.tokenIn, tokenInMeta.decimals, tokenInMeta.symbol, tokenInMeta.name);
      const tokenOut = new Token(ETHEREUM_CHAIN_ID, request.tokenOut, tokenOutMeta.decimals, tokenOutMeta.symbol, tokenOutMeta.name);

      // Try to get quote through multiple fee tiers
      const feeAmounts = [FeeAmount.LOW, FeeAmount.MEDIUM, FeeAmount.HIGH];
      let bestQuote = null;
      let bestAmountOut = BigInt(0);

      for (const feeAmount of feeAmounts) {
        try {
          const quotedAmountOut = await this.quoterContract.quoteExactInputSingle.staticCall({
            tokenIn: request.tokenIn,
            tokenOut: request.tokenOut,
            fee: feeAmount,
            amountIn: request.amountIn,
            sqrtPriceLimitX96: 0
          });

          if (BigInt(quotedAmountOut) > bestAmountOut) {
            bestAmountOut = BigInt(quotedAmountOut);
            bestQuote = {
              amountOut: quotedAmountOut.toString(),
              fee: feeAmount
            };
          }
        } catch (error) {
          // Pool might not exist for this fee tier
          continue;
        }
      }

      if (!bestQuote) {
        throw new Error('No valid pools found for this token pair');
      }

      // Calculate price impact (simplified)
      const amountIn = BigInt(request.amountIn);
      const priceImpact = ((amountIn - bestAmountOut) * BigInt(10000)) / amountIn;

      return {
        amountOut: bestQuote.amountOut,
        priceImpact: (Number(priceImpact) / 100).toFixed(2),
        route: [tokenIn.symbol, tokenOut.symbol],
        gasEstimate: '150000' // Estimated gas for a swap
      };
    } catch (error) {
      console.error('Uniswap quote error:', error);
      throw error;
    }
  }

  async buildSwapTransaction(
    request: UniswapQuoteRequest,
    quote: UniswapQuoteResponse
  ): Promise<ethers.TransactionRequest> {
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
    const slippageTolerance = request.slippageTolerance || 0.5;
    const amountOutMinimum = BigInt(quote.amountOut) * BigInt(100 - slippageTolerance * 100) / BigInt(100);

    // Build swap parameters
    const params = {
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      fee: FeeAmount.MEDIUM, // Use the fee from the best quote
      recipient: request.recipient,
      deadline: deadline,
      amountIn: request.amountIn,
      amountOutMinimum: amountOutMinimum.toString(),
      sqrtPriceLimitX96: 0
    };

    // Encode the swap
    const swapRouterInterface = new ethers.Interface([
      'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) calldata params) external payable returns (uint256 amountOut)'
    ]);

    const data = swapRouterInterface.encodeFunctionData('exactInputSingle', [params]);

    return {
      to: SWAP_ROUTER_ADDRESS,
      data: data,
      value: '0',
      gasLimit: '200000'
    };
  }
}

export const uniswapFallbackService = new UniswapFallbackService();