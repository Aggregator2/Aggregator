import { NextApiRequest, NextApiResponse } from "next";
import { JsonRpcProvider, Contract, parseUnits, Wallet, TypedDataDomain } from "ethers";
import { BigNumber } from "bignumber.js";
import { signQuote } from "../../utils/signOrder";
import { Quote } from "../../types/Quote";

// Uniswap V3 Quoter on Arbitrum
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external view returns (uint256 amountOut)"
];
const POOL_FEE = 3000;

// EIP-712 domain for Quote signing
const QUOTE_DOMAIN: TypedDataDomain = {
  name: "MetaAggregator",
  version: "1",
  chainId: 42161, // Arbitrum One
  verifyingContract: "0x0000000000000000000000000000000000000000", // Replace with your contract if needed
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { sellToken, buyToken, sellAmount, user } = req.body;
  console.log("Incoming quote body:", req.body);

  // Defensive: check all required fields
  if (!sellToken || !buyToken || !sellAmount || !user) {
    return res.status(400).json({ error: "Missing sellToken, buyToken, sellAmount, or user" });
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

    // Prepare Quote object
    const validTo = Math.floor(Date.now() / 1000) + 60 * 5; // number, not string
    const nonce = Date.now(); // Use a better nonce in production
    const maker = process.env.BACKEND_WALLET_ADDRESS as string;

    const quote: Quote = {
      userAddress: user, // string, valid address
      quoteId: nonce, // number or string, will be encoded as uint256
      content: "Swap quote", // string
      sellToken, // string, valid address
      buyToken, // string, valid address
      sellAmount: amountIn.toString(), // string or number, uint256
      buyAmount: buyAmountBN.toFixed(0), // string or number, uint256
      validTo, // number, uint32
      maker, // string, valid address
    };

    for (const [key, value] of Object.entries(quote)) {
      if (value === undefined || value === null) {
        throw new Error(`❌ Field ${key} is missing in quote`);
      }
    }

    console.log("Quote to sign:", quote);

    // Sign the quote with backend wallet
    const backendWallet = new Wallet(process.env.BACKEND_PRIVATE_KEY as string, provider);
    const makerSignature = await signQuote(backendWallet, QUOTE_DOMAIN, quote);

    return res.status(200).json({
      buyAmount: buyAmountBN.toFixed(0),
      minReceived,
      lpFee,
      priceImpact,
      slippage,
      networkFeeUsd,
      quote,
      makerSignature,
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

export const quoteTypes = {
  Quote: [
    { name: "userAddress", type: "address" },
    { name: "quoteId", type: "uint256" },
    { name: "content", type: "string" },
    { name: "sellToken", type: "address" },
    { name: "buyToken", type: "address" },
    { name: "sellAmount", type: "uint256" },
    { name: "buyAmount", type: "uint256" },
    { name: "validTo", type: "uint32" },
    { name: "maker", type: "address" }
  ]
};
