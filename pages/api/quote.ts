import { NextApiRequest, NextApiResponse } from "next";
import { ethers } from "ethers";
import { BigNumber } from "bignumber.js";

// Only need the one function from the V3 Quoter
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
];

// Uniswap V3 Quoter on Arbitrum
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
// Use the 0.3% pool
const POOL_FEE = 3000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sellToken, buyToken, sellAmount } = req.body;
  if (!sellToken || !buyToken || !sellAmount) {
    return res.status(400).json({ error: "Missing sellToken, buyToken or sellAmount" });
  }

  try {
    // Connect to Arbitrum RPC (or override via ARBITRUM_RPC env var)
    const provider = new ethers.providers.JsonRpcProvider(
      process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc"
    );

    const quoter = new ethers.Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);

    // Parse user-entered amount (e.g. "1") into wei
    const amountIn = ethers.utils.parseUnits(sellAmount, 18);

    // Ask Uniswap for the output amount
    const amountOut: ethers.BigNumber = await quoter.callStatic.quoteExactInputSingle(
      sellToken,
      buyToken,
      POOL_FEE,
      amountIn,
      0
    );

    // Convert back to human-readable
    const buyAmount = amountOut?.toString() || "0";

    const buyAmountBN = new BigNumber(buyAmount); // Convert to BigNumber
    const slippageRate = 0.005;
    const lpFeeRate = 0.003;
    const priceImpactRate = 0.001;

    const lpFee = buyAmountBN.multipliedBy(lpFeeRate).toFixed(0); // No decimals
    const priceImpact = buyAmountBN.multipliedBy(priceImpactRate).toFixed(0);
    const slippage = buyAmountBN.multipliedBy(slippageRate).toFixed(0);

    const minReceived = buyAmountBN
      .minus(lpFee)
      .minus(priceImpact)
      .minus(slippage)
      .toFixed(0); // No decimals

    const networkFeeUsd = "0.52"; // Hardcoded mock value

    return res.status(200).json({
      buyAmount: buyAmountBN.toFixed(0), // No decimals
      minReceived,
      lpFee,
      priceImpact,
      slippage,
      networkFeeUsd,
    });
  } catch (err: any) {
    console.error("Uniswap V3 Quoter error:", err);
    return res.status(500).json({ error: err.message || "Quote failed" });
  }
}
