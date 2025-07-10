// Mock token price API endpoint
export default function handler(req, res) {
  const { tokenAddress } = req.query;
  
  // Mock prices for common tokens
  const mockPrices = {
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': { // WETH
      price: 2345.67,
      change24h: 2.5
    },
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': { // USDC
      price: 1.00,
      change24h: 0.01
    },
    '0xdAC17F958D2ee523a2206206994597C13D831ec7': { // USDT
      price: 0.9999,
      change24h: -0.01
    }
  };
  
  const priceData = mockPrices[tokenAddress] || {
    price: Math.random() * 100,
    change24h: (Math.random() - 0.5) * 10
  };
  
  res.status(200).json({
    tokenAddress,
    ...priceData,
    timestamp: new Date().toISOString()
  });
}