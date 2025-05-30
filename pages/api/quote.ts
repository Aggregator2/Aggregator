import { NextApiRequest, NextApiResponse } from "next";
import { JsonRpcProvider, Contract, parseUnits } from "ethers";
import { BigNumber } from "bignumber.js";
import { ethers } from "ethers";

// Uniswap V3 Quoter on Arbitrum
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];
const POOL_FEE = 3000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sellToken, buyToken, sellAmount } = req.body;
  if (!sellToken || !buyToken || !sellAmount) {
    return res.status(400).json({ error: "Missing sellToken, buyToken or sellAmount" });
  }

  try {
    const provider = new JsonRpcProvider(
      process.env.ARBITRUM_RPC || "https://arb1.arbitrum.io/rpc"
    );

    const quoter = new Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);

    // Parse user-entered amount (e.g. "1") into wei
    const amountIn = parseUnits(sellAmount, 18);

    // ethers v6: use staticCall for view/pure functions
    const amountOut = await quoter.quoteExactInputSingle.staticCall(
      sellToken,
      buyToken,
      POOL_FEE,
      amountIn,
      0
    );

    const buyAmount = amountOut?.toString() || "0";
    const buyAmountBN = new BigNumber(buyAmount);

    const slippageRate = 0.005;
    const lpFeeRate = 0.003;
    const priceImpactRate = 0.001;

    const lpFee = buyAmountBN.multipliedBy(lpFeeRate).toFixed(0);
    const priceImpact = buyAmountBN.multipliedBy(priceImpactRate).toFixed(0);
    const slippage = buyAmountBN.multipliedBy(slippageRate).toFixed(0);

    const minReceived = buyAmountBN
      .minus(lpFee)
      .minus(priceImpact)
      .minus(slippage)
      .toFixed(0);

    const networkFeeUsd = "0.52";

    return res.status(200).json({
      buyAmount: buyAmountBN.toFixed(0),
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

const connectWallet = async () => {
  if (!window.ethereum) {
    console.error("MetaMask not installed.");
    return;
  }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const walletAddress = await signer.getAddress();
    console.log('Connected wallet:', walletAddress);
  } catch (error) {
    console.error("Error connecting wallet:", error);
  }
};
