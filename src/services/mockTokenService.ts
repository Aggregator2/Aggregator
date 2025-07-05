export const mockTokens = {
  ethereum: [
    {
      chainId: 1,
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      logoURI: 'https://assets.coingecko.com/coins/images/6319/thumb/USD_Coin_icon.png',
    },
    {
      chainId: 1,
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      decimals: 18,
      symbol: 'WETH',
      name: 'Wrapped Ether',
      logoURI: 'https://assets.coingecko.com/coins/images/2518/thumb/weth.png',
    },
    {
      chainId: 1,
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
      symbol: 'USDT',
      name: 'Tether USD',
      logoURI: 'https://assets.coingecko.com/coins/images/325/thumb/Tether.png',
    },
  ],
};

export async function getMockTokens() {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));
  return mockTokens;
}