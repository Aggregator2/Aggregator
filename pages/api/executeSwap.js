import { ethers } from 'ethers';

// ERC20 ABI for token approvals
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
];

// Simple DEX Router ABI (Uniswap V2 style)
const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
  'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)',
  'function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)'
];

// Known router addresses for different chains
const ROUTERS = {
  1: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Ethereum - Uniswap V2
  56: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // BSC - PancakeSwap
  137: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff', // Polygon - QuickSwap
  42161: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // Arbitrum - SushiSwap
  10: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506', // Optimism - SushiSwap
  43114: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4', // Avalanche - TraderJoe
};

// WETH addresses for different chains
const WETH = {
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  10: '0x4200000000000000000000000000000000000006',
  43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', // WAVAX
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      sellToken,
      buyToken,
      sellAmount,
      takerAddress,
      slippagePercentage = '0.5',
      chainId = '1'
    } = req.body;

    // Validate required parameters
    if (!sellToken || !buyToken || !sellAmount || !takerAddress) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['sellToken', 'buyToken', 'sellAmount', 'takerAddress']
      });
    }

    // Get router address for the chain
    const routerAddress = ROUTERS[chainId];
    if (!routerAddress) {
      return res.status(400).json({ 
        error: `Chain ${chainId} not supported. Supported chains: ${Object.keys(ROUTERS).join(', ')}`
      });
    }

    // Create provider
    const rpcUrl = process.env.RPC_URL || process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // For real execution, we need the user to sign the transaction on frontend
    // This endpoint will prepare the transaction data
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);
    
    // Check if we need to wrap ETH
    const isSellingETH = sellToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const isBuyingETH = buyToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    
    const wethAddress = WETH[chainId] || WETH[1];
    const actualSellToken = isSellingETH ? wethAddress : sellToken;
    const actualBuyToken = isBuyingETH ? wethAddress : buyToken;

    // Get path for swap - for better rates, we might need to route through WETH
    let path = [actualSellToken, actualBuyToken];
    
    // If not ETH involved and tokens are different, try routing through WETH for better liquidity
    if (!isSellingETH && !isBuyingETH && actualSellToken !== actualBuyToken) {
      // Check if direct path exists by trying to get amounts
      try {
        await router.getAmountsOut(sellAmount, path);
      } catch (e) {
        // No direct path, route through WETH
        path = [actualSellToken, wethAddress, actualBuyToken];
        console.log('Using WETH routing for better liquidity');
      }
    }

    // Calculate minimum amount out with slippage
    const amounts = await router.getAmountsOut(sellAmount, path);
    const expectedOut = amounts[amounts.length - 1];
    const slippage = BigInt(Math.floor(parseFloat(slippagePercentage) * 100));
    const minAmountOut = (expectedOut * (10000n - slippage)) / 10000n;

    // Set deadline to 20 minutes from now
    const deadline = Math.floor(Date.now() / 1000) + 1200;

    // Prepare transaction data based on swap type
    let txData;
    let value = '0x0';

    if (isSellingETH) {
      // ETH -> Token
      txData = await router.swapExactETHForTokens.populateTransaction(
        minAmountOut,
        path,
        takerAddress,
        deadline
      );
      value = ethers.toHex(sellAmount);
    } else if (isBuyingETH) {
      // Token -> ETH
      txData = await router.swapExactTokensForETH.populateTransaction(
        sellAmount,
        minAmountOut,
        path,
        takerAddress,
        deadline
      );
    } else {
      // Token -> Token
      txData = await router.swapExactTokensForTokens.populateTransaction(
        sellAmount,
        minAmountOut,
        path,
        takerAddress,
        deadline
      );
    }

    // Return transaction data for frontend to sign and send
    return res.status(200).json({
      success: true,
      message: 'Transaction prepared successfully',
      transaction: {
        to: routerAddress,
        data: txData.data,
        value: value,
        chainId: chainId,
        from: takerAddress
      },
      details: {
        router: routerAddress,
        path: path,
        expectedOut: expectedOut.toString(),
        minAmountOut: minAmountOut.toString(),
        deadline: deadline,
        slippagePercentage: slippagePercentage
      },
      requiresApproval: !isSellingETH,
      approvalTarget: routerAddress,
      note: 'Sign and send this transaction in your wallet to execute the swap'
    });
  } catch (error) {
    console.error('Execute swap error:', error);
    return res.status(500).json({ 
      error: 'Failed to prepare swap transaction',
      message: error.message 
    });
  }
}