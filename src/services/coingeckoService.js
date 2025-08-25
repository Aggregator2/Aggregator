// CoinGecko price service for fallback
const fetch = require('node-fetch');

// Token ID mappings for CoinGecko
const COINGECKO_IDS = {
  // Ethereum addresses
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'weth',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee': 'ethereum',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'usd-coin',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'tether',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'dai',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'wrapped-bitcoin',
  '0x111111111117dc0aa78b770fa6a738034120c302': '1inch',
  '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce': 'shiba-inu',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'chainlink',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'uniswap',
  '0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0': 'matic-network',
  '0xd533a949740bb3306d119cc777fa900ba034cd52': 'curve-dao-token',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'aave',
  '0xc00e94cb662c3520282e6f5717214004a7f26888': 'compound-governance-token',
  '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2': 'maker',
  '0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f': 'havven',
  '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e': 'yearn-finance',
  '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2': 'sushi',
  '0xba100000625a3754423978a60c9317c58a424e3d': 'balancer',
  '0x04fa0d235c4abf4bcf4787af4cf447de572ef828': 'uma',
  '0x408e41876cccdc0f92210600ef50372656052a38': 'republic-protocol',
  '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd': 'loopring',
  '0x3845badade8e6dff049820680d1f14bd3903a5d0': 'the-sandbox',
  '0x0f5d2fb29fb7d3cfee444a200298f468908cc942': 'decentraland',
  '0xf629cbd94d3791c9250152bd8dfbdf380e2a3b9c': 'enjincoin',
  '0x15d4c048f83bd7e37d49ea4c83a07267ec4203da': 'gala',
  '0xbb0e17ef65f82ab018d8edd776e8dd940327b28b': 'axie-infinity',
  '0x4d224452801aced8b2f0aebe155379bb5d594381': 'apecoin',
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': 'pepe',
  '0xb50721bcf8d664c30412cfbc6cf7a15145234ad1': 'arbitrum',
  '0x4200000000000000000000000000000000000042': 'optimism'
};

// Cache prices for 30 seconds
const priceCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

class CoinGeckoService {
  constructor() {
    this.apiKey = process.env.COINGECKO_API_KEY;
    this.baseUrl = 'https://api.coingecko.com/api/v3';
  }

  async getTokenPrice(tokenAddress, vsCurrency = 'usd') {
    const normalizedAddress = tokenAddress.toLowerCase();
    const cacheKey = `${normalizedAddress}-${vsCurrency}`;
    
    // Check cache
    const cached = priceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.price;
    }

    const coinId = COINGECKO_IDS[normalizedAddress];
    if (!coinId) {
      console.warn(`Unknown token address for CoinGecko: ${tokenAddress}`);
      return null;
    }

    try {
      const url = `${this.baseUrl}/simple/price?ids=${coinId}&vs_currencies=${vsCurrency}`;
      const headers = {};
      if (this.apiKey) {
        headers['x-cg-demo-api-key'] = this.apiKey;
      }

      const response = await fetch(url, { headers });
      const data = await response.json();

      if (data[coinId] && data[coinId][vsCurrency]) {
        const price = data[coinId][vsCurrency];
        
        // Cache the price
        priceCache.set(cacheKey, {
          price,
          timestamp: Date.now()
        });

        return price;
      }

      return null;
    } catch (error) {
      console.error('CoinGecko API error:', error.message);
      return null;
    }
  }

  async getQuote(sellToken, buyToken, sellAmount, sellDecimals = 18, buyDecimals = 18) {
    try {
      const [sellPrice, buyPrice] = await Promise.all([
        this.getTokenPrice(sellToken),
        this.getTokenPrice(buyToken)
      ]);

      if (!sellPrice || !buyPrice) {
        throw new Error('Unable to fetch token prices from CoinGecko');
      }

      // Calculate exchange rate
      const rate = sellPrice / buyPrice;

      // Convert sell amount to token units
      const sellAmountBN = BigInt(sellAmount);
      const sellAmountInTokens = Number(sellAmountBN) / Math.pow(10, sellDecimals);
      
      // Calculate buy amount
      const buyAmountInTokens = sellAmountInTokens * rate;
      const buyAmount = BigInt(Math.floor(buyAmountInTokens * Math.pow(10, buyDecimals)));

      return {
        sellToken,
        buyToken,
        sellAmount,
        buyAmount: buyAmount.toString(),
        sellPrice,
        buyPrice,
        rate,
        source: 'coingecko'
      };
    } catch (error) {
      console.error('CoinGecko quote error:', error);
      throw error;
    }
  }
}

module.exports = new CoinGeckoService();