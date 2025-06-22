import { NextApiRequest, NextApiResponse } from "next";

// Chain ID mappings
const CHAIN_MAPPINGS = {
  1: "ethereum",
  56: "bsc",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
};

// API endpoint configurations
const TOKEN_ENDPOINTS = {
  "0x": {
    ethereum: "https://api.0x.org/swap/v1/tokens",
    bsc: "https://bsc.api.0x.org/swap/v1/tokens",
    polygon: "https://polygon.api.0x.org/swap/v1/tokens",
    arbitrum: "https://arbitrum.api.0x.org/swap/v1/tokens",
    optimism: "https://optimism.api.0x.org/swap/v1/tokens",
  },
  openocean: {
    ethereum: "https://open-api.openocean.finance/v3/eth/tokenList",
    bsc: "https://open-api.openocean.finance/v3/bsc/tokenList",
    polygon: "https://open-api.openocean.finance/v3/polygon/tokenList",
    arbitrum: "https://open-api.openocean.finance/v3/arbitrum/tokenList",
    optimism: "https://open-api.openocean.finance/v3/optimism/tokenList",
  },
  jupiter: "https://token.jup.ag/all",
};

// Local curated token lists for BSC and other chains
const LOCAL_TOKEN_LISTS = {
  bsc: [
    {
      symbol: "BNB",
      name: "BNB",
      address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      decimals: 18,
      chainId: 56,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c/logo.png",
    },
    {
      symbol: "USDT",
      name: "Tether USD",
      address: "0x55d398326f99059fF775485246999027B3197955",
      decimals: 18,
      chainId: 56,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x55d398326f99059fF775485246999027B3197955/logo.png",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      decimals: 18,
      chainId: 56,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d/logo.png",
    },
    {
      symbol: "BUSD",
      name: "Binance USD",
      address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
      decimals: 18,
      chainId: 56,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56/logo.png",
    },
    {
      symbol: "CAKE",
      name: "PancakeSwap Token",
      address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      decimals: 18,
      chainId: 56,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png",
    },
  ],
  ethereum: [
    {
      symbol: "ETH",
      name: "Ethereum",
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      decimals: 18,
      chainId: 1,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png",
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      address: "0xA0b86a33E6441c8c1a8F806d4ec663E1D60B09c7",
      decimals: 6,
      chainId: 1,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86a33E6441c8c1a8F806d4ec663E1D60B09c7/logo.png",
    },
  ],
  arbitrum: [
    {
      symbol: "WETH",
      name: "Wrapped Ethereum",
      address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
      decimals: 18,
      chainId: 42161,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png",
    },
    {
      symbol: "DAI",
      name: "Dai Stablecoin",
      address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1",
      decimals: 18,
      chainId: 42161,
      type: "ERC-20",
      logoURI:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png",
    },
  ],
};

// Fetch tokens from 0x API
async function fetch0xTokens(chainId: number) {
  try {
    const chain = CHAIN_MAPPINGS[chainId as keyof typeof CHAIN_MAPPINGS];
    if (!chain) return [];

    const endpoint =
      TOKEN_ENDPOINTS["0x"][chain as keyof (typeof TOKEN_ENDPOINTS)["0x"]];
    if (!endpoint) return [];

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${process.env.ZEROX_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return data.records || [];
  } catch (error) {
    return [];
  }
}

// Fetch tokens from OpenOcean API
async function fetchOpenOceanTokens(chainId: number) {
  try {
    const chain = CHAIN_MAPPINGS[chainId as keyof typeof CHAIN_MAPPINGS];
    if (!chain) return [];

    const endpoint =
      TOKEN_ENDPOINTS["openocean"][
        chain as keyof (typeof TOKEN_ENDPOINTS)["openocean"]
      ];
    if (!endpoint) return [];

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${process.env.OPENOCEAN_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    return [];
  }
}

// Define token interface
interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  chainId: number | string;
  type: "ERC-20" | "SPL";
  logoURI?: string;
}

interface RawToken {
  symbol: string;
  name: string;
  address: string;
  decimals?: number;
  logoURI?: string;
  icon_url?: string;
}

// Fetch Jupiter tokens for Solana
async function fetchJupiterTokens() {
  try {
    const response = await fetch(TOKEN_ENDPOINTS.jupiter);

    if (!response.ok) return [];

    const tokens = await response.json();
    return tokens.map((token: RawToken) => ({
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      decimals: token.decimals || 9,
      chainId: "solana",
      type: "SPL" as const,
      logoURI: token.logoURI,
    }));
  } catch (error) {
    return [];
  }
}

// Normalize token format
function normalizeToken(token: RawToken, chainId: number | string): Token {
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals: token.decimals || 18,
    chainId,
    type: chainId === "solana" ? "SPL" : "ERC-20",
    logoURI: token.logoURI || token.icon_url || "",
  };
}

// Get supported tokens for a chain
async function getSupportedTokens(chainId: number | string) {
  if (chainId === "solana") {
    const jupiterTokens = await fetchJupiterTokens();
    return jupiterTokens.slice(0, 100); // Limit to top 100 tokens
  }

  const chainIdNum = Number(chainId);
  const chain = CHAIN_MAPPINGS[chainIdNum as keyof typeof CHAIN_MAPPINGS];

  // For BSC (chain 56), use local curated list to bypass CoinGecko
  if (chainIdNum === 56) {
    return LOCAL_TOKEN_LISTS.bsc;
  }

  // Try to fetch from APIs
  const [zeroXTokens, openOceanTokens] = await Promise.all([
    fetch0xTokens(chainIdNum),
    fetchOpenOceanTokens(chainIdNum),
  ]);

  // Combine and deduplicate tokens
  const allTokens = [...zeroXTokens, ...openOceanTokens];
  const uniqueTokens = new Map();

  allTokens.forEach((token) => {
    const normalized = normalizeToken(token, chainIdNum);
    const key = `${normalized.address.toLowerCase()}-${normalized.symbol}`;
    if (!uniqueTokens.has(key)) {
      uniqueTokens.set(key, normalized);
    }
  });

  let result = Array.from(uniqueTokens.values());

  // If no tokens found, use local curated list
  if (
    result.length === 0 &&
    LOCAL_TOKEN_LISTS[chain as keyof typeof LOCAL_TOKEN_LISTS]
  ) {
    result = LOCAL_TOKEN_LISTS[chain as keyof typeof LOCAL_TOKEN_LISTS];
  }

  // Limit to top 50 tokens for performance
  return result.slice(0, 50);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { chainId = 42161 } = req.query;

  try {
    // Ensure chainId is a string or number
    const normalizedChainId = Array.isArray(chainId) ? chainId[0] : chainId;
    const tokens = await getSupportedTokens(normalizedChainId);

    return res.status(200).json({
      chainId: normalizedChainId,
      tokens,
      count: tokens.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const err = error as Error;
    return res.status(500).json({
      error: err.message || "Failed to fetch supported tokens",
    });
  }
}
