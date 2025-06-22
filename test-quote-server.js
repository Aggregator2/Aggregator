// Simple test server for the unified quote API
const http = require("http");
const url = require("url");

// Import the quote logic from our simplified API
const { BigNumber } = require("bignumber.js");

// Simplified quote logic (copied from unified-quote-simple.ts)
const PRICE_ESTIMATES = {
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": {
    // ETH
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 2800, // ETH -> USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 2800, // ETH -> USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f": 2800, // ETH -> DAI
  },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7": 1, // USDC -> USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f": 1, // USDC -> DAI
  },
};

const TOKEN_DECIMALS = {
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": 18, // ETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 6, // USDT
  "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI
};

function getBasicQuote(sellToken, buyToken, sellAmount) {
  try {
    const sellTokenLower = sellToken.toLowerCase();
    const buyTokenLower = buyToken.toLowerCase();

    const sellDecimals = TOKEN_DECIMALS[sellTokenLower] || 18;
    const buyDecimals = TOKEN_DECIMALS[buyTokenLower] || 18;

    let rate = 1;
    if (
      PRICE_ESTIMATES[sellTokenLower] &&
      PRICE_ESTIMATES[sellTokenLower][buyTokenLower]
    ) {
      rate = PRICE_ESTIMATES[sellTokenLower][buyTokenLower];
    } else if (
      PRICE_ESTIMATES[buyTokenLower] &&
      PRICE_ESTIMATES[buyTokenLower][sellTokenLower]
    ) {
      rate = 1 / PRICE_ESTIMATES[buyTokenLower][sellTokenLower];
    }

    const sellAmountNum = parseFloat(sellAmount);
    const decimalAdjustment = Math.pow(10, buyDecimals - sellDecimals);
    const buyAmountNum = sellAmountNum * rate * decimalAdjustment;
    const buyAmount = Math.floor(buyAmountNum).toString();

    const slippageAmount = buyAmountNum * 0.005;
    const minReceived = Math.floor(buyAmountNum - slippageAmount).toString();

    return {
      source: "Test Fallback Quote",
      buyAmount,
      sellAmount,
      price: rate,
      minReceived,
      lpFee: "0.003",
      slippage: "0.005",
      priceImpact: "0.001",
      networkFeeUsd: "$1.50",
    };
  } catch (error) {
    console.error("Quote error:", error);
    return null;
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  if (
    parsedUrl.pathname === "/api/unified-quote-simple" &&
    req.method === "POST"
  ) {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const {
          sellToken,
          buyToken,
          sellAmount,
          chainId = 1,
        } = JSON.parse(body);

        if (!sellToken || !buyToken || !sellAmount) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Missing required parameters" }));
          return;
        }

        console.log(
          `💰 Quote request: ${sellAmount} ${sellToken} → ${buyToken} (chain: ${chainId})`
        );

        const quote = getBasicQuote(sellToken, buyToken, sellAmount);

        if (!quote) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "No quotes available" }));
          return;
        }

        console.log(
          `✅ Quote result: ${quote.buyAmount} (source: ${quote.source})`
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(quote));
      } catch (error) {
        console.error("Server error:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🚀 Test quote server running on http://localhost:${PORT}`);
  console.log(
    `📡 API endpoint: POST http://localhost:${PORT}/api/unified-quote-simple`
  );
  console.log("");
  console.log("Test with:");
  console.log("curl -X POST http://localhost:3001/api/unified-quote-simple \\");
  console.log('  -H "Content-Type: application/json" \\');
  console.log(
    '  -d \'{"sellToken":"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","buyToken":"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48","sellAmount":"1000000000000000000","chainId":1}\''
  );
});
