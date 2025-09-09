import { ethers } from 'ethers';
import fetch from 'node-fetch';

interface SwapParams {
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  userAddress: string;
  slippagePercentage?: number;
}

export class InstantSwapService {
  private provider: ethers.JsonRpcProvider;
  
  constructor(rpcUrl: string = process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo') {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Execute a swap immediately on-chain using 0x API
   */
  async executeSwap(params: SwapParams, signer: ethers.Signer): Promise<ethers.TransactionResponse> {
    const { sellToken, buyToken, sellAmount, userAddress, slippagePercentage = 0.5 } = params;
    
    console.log('[InstantSwap] Getting quote from 0x API...');
    
    // Get quote from 0x API
    const zeroExApiUrl = `https://api.0x.org/swap/v1/quote`;
    const queryParams = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
      takerAddress: userAddress,
      slippagePercentage: slippagePercentage.toString(),
      skipValidation: 'false'
    });

    const response = await fetch(`${zeroExApiUrl}?${queryParams}`, {
      headers: {
        '0x-api-key': process.env.ZEROX_API_KEY || 'DEMO_KEY' // You'll need a real API key
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`0x API error: ${error}`);
    }

    const quote = await response.json();
    
    console.log('[InstantSwap] Quote received:', {
      sellAmount: quote.sellAmount,
      buyAmount: quote.buyAmount,
      estimatedGas: quote.estimatedGas,
      gasPrice: quote.gasPrice
    });

    // Check if we need approval
    if (quote.allowanceTarget && sellToken !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      await this.ensureTokenApproval(
        sellToken,
        quote.allowanceTarget,
        sellAmount,
        signer
      );
    }

    // Execute the swap
    console.log('[InstantSwap] Executing swap transaction...');
    const tx = await signer.sendTransaction({
      to: quote.to,
      data: quote.data,
      value: quote.value,
      gasLimit: quote.estimatedGas,
      gasPrice: quote.gasPrice,
    });

    console.log('[InstantSwap] Transaction submitted:', tx.hash);
    
    return tx;
  }

  /**
   * Ensure token approval for the swap
   */
  private async ensureTokenApproval(
    tokenAddress: string,
    spender: string,
    amount: string,
    signer: ethers.Signer
  ): Promise<void> {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function approve(address spender, uint256 amount) external returns (bool)',
       'function allowance(address owner, address spender) external view returns (uint256)'],
      signer
    );

    const userAddress = await signer.getAddress();
    const currentAllowance = await tokenContract.allowance(userAddress, spender);
    
    if (BigInt(currentAllowance) < BigInt(amount)) {
      console.log('[InstantSwap] Approving token spend...');
      const approveTx = await tokenContract.approve(spender, ethers.MaxUint256);
      await approveTx.wait();
      console.log('[InstantSwap] Approval confirmed');
    }
  }

  /**
   * Get a price quote without executing
   */
  async getQuote(params: SwapParams) {
    const { sellToken, buyToken, sellAmount, userAddress, slippagePercentage = 0.5 } = params;
    
    const zeroExApiUrl = `https://api.0x.org/swap/v1/price`;
    const queryParams = new URLSearchParams({
      sellToken,
      buyToken,
      sellAmount,
      takerAddress: userAddress,
      slippagePercentage: slippagePercentage.toString()
    });

    const response = await fetch(`${zeroExApiUrl}?${queryParams}`, {
      headers: {
        '0x-api-key': process.env.ZEROX_API_KEY || 'DEMO_KEY'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`0x API error: ${error}`);
    }

    return response.json();
  }
}

export const instantSwapService = new InstantSwapService();