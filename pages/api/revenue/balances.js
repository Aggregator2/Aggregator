import { ethers } from "ethers";

// Token addresses for balance checking
const TOKENS = {
  ethereum: {
    USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
};

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const revenueWallet = process.env.REVENUE_WALLET;
  if (!revenueWallet) {
    return res.status(500).json({
      success: false,
      error: "Revenue wallet not configured",
    });
  }

  try {
    const balances = {};

    // Check Ethereum balances
    if (process.env.ETHEREUM_RPC) {
      const provider = new ethers.JsonRpcProvider(process.env.ETHEREUM_RPC);
      balances.ethereum = {};

      // Native ETH balance
      const ethBalance = await provider.getBalance(revenueWallet);
      balances.ethereum.ETH = ethers.formatEther(ethBalance);

      // ERC-20 token balances
      for (const [symbol, address] of Object.entries(TOKENS.ethereum)) {
        try {
          const contract = new ethers.Contract(address, ERC20_ABI, provider);
          const [balance, decimals] = await Promise.all([
            contract.balanceOf(revenueWallet),
            contract.decimals(),
          ]);
          
          if (balance > 0n) {
            balances.ethereum[symbol] = ethers.formatUnits(balance, decimals);
          }
        } catch (error) {
          console.error(`Error checking ${symbol} balance:`, error.message);
        }
      }
    }

    // Check Arbitrum balances
    if (process.env.ARBITRUM_RPC) {
      const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC);
      balances.arbitrum = {};

      const ethBalance = await provider.getBalance(revenueWallet);
      balances.arbitrum.ETH = ethers.formatEther(ethBalance);
    }

    // Check Polygon balances
    if (process.env.POLYGON_RPC) {
      const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC);
      balances.polygon = {};

      const maticBalance = await provider.getBalance(revenueWallet);
      balances.polygon.MATIC = ethers.formatEther(maticBalance);
    }

    res.status(200).json({
      success: true,
      revenueWallet,
      balances,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching balances:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch balances",
    });
  }
}