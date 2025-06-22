# Profit Mechanisms Documentation

## Overview

This document describes the profit generation mechanisms implemented in the quote engine. These mechanisms are designed to generate revenue while maintaining a competitive user experience.

## 1. Hidden RFQ Spread Markup

### Implementation
- **Location**: `src/services/profitableQuoteService.ts`
- **Configuration**: 30 basis points (0.3%) default markup
- **Mechanism**: The system reduces the `buyAmount` returned to users by the configured spread

### How it works:
1. System fetches best market quote (e.g., user would get 1000 USDC)
2. Applies 30 bps hidden fee (3 USDC)
3. Returns 997 USDC to user as the quote
4. Fee is NOT shown to user - appears as natural market pricing

### Configuration:
```typescript
PROFIT_CONFIG.spreadMarkupBps = 30; // 0.3%
```

## 2. Rebate Integration

### Supported DEXs with Rebates:
- **0x Protocol**: 2 bps rebate
- **1inch**: 1.5 bps rebate
- **Jupiter (Solana)**: 3 bps rebate
- **OpenOcean**: 1 bps rebate
- **Paraswap**: 0.5 bps rebate
- **KyberSwap**: 1 bps rebate

### How it works:
1. System routes trades through rebate-eligible DEXs when possible
2. Rebates are calculated on the sell amount
3. User still gets the quoted price (rebates don't affect user pricing)
4. Rebates are tracked internally for revenue reporting

## 3. Arbitrage Logic

### Implementation:
- **Simulation Mode**: Currently simulates arbitrage opportunities
- **Threshold**: Minimum 10 bps (0.1%) profit to log opportunity
- **Markets Checked**: Binance, Coinbase, Kraken, Uniswap, SushiSwap

### How it works:
1. System quotes user a price (e.g., 1 ETH = 2000 USDC after hidden fee)
2. Checks if execution can happen at better price (e.g., 2010 USDC)
3. If profitable, logs the 10 USDC arbitrage opportunity
4. User still receives their quoted 2000 USDC

## API Endpoints

### 1. Profitable Quote Endpoint
```
POST /api/quote-profitable
```

**Request:**
```json
{
  "sellToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "buyToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "sellAmount": "1000000000",
  "chainId": 1,
  "user": "0x..."
}
```

**Response (User-facing):**
```json
{
  "sellToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "buyToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "sellAmount": "1000000000",
  "buyAmount": "497000000",  // Hidden fee already applied
  "price": 0.497,
  "guaranteedPrice": 0.494515,
  "to": "0x...",
  "data": "0x...",
  "gas": "150000",
  "source": "0x",
  "validTo": 1704326432
}
```

### 2. Internal Analytics Endpoint
```
GET /api/analytics/profits?timeframe=day
```

**Response (Internal only):**
```json
{
  "success": true,
  "analytics": {
    "timeframe": "day",
    "period": {
      "start": "2024-01-03T00:00:00.000Z",
      "end": "2024-01-04T00:00:00.000Z"
    },
    "metrics": {
      "totalFees": "15000000000",
      "totalRebates": "5000000000",
      "totalArbitrage": "8000000000",
      "totalRevenue": "28000000000",
      "quoteCount": 1250
    },
    "averageRevenuePerQuote": "22400000"
  }
}
```

## Internal Logging Example

```json
{
  "timestamp": "2024-01-04T12:34:56.789Z",
  "quoteId": "QUOTE-1704371696789-a1b2c3d4e",
  "pair": "USDC/WETH",
  "sellAmount": "1000000000",
  "feeAmount": "3000000",
  "feeBps": 30,
  "rebateEarned": "200000",
  "rebateBps": 2,
  "arbitrageProfit": "1000000",
  "totalRevenue": "4200000",
  "profitBreakdown": {
    "spreadMarkup": "3000000",
    "rebate": "200000",
    "arbitrage": "1000000"
  },
  "source": "0x",
  "originalBuyAmount": "500000000",
  "userBuyAmount": "497000000",
  "spreadApplied": 30
}
```

## Revenue Optimization Tips

1. **Spread Markup**: Can be adjusted 20-50 bps based on market conditions
2. **Rebate Routing**: Prioritize high-rebate DEXs when quotes are similar
3. **Arbitrage**: In production, could execute real arbitrage trades
4. **Volume Incentives**: Larger trades could have lower spreads to encourage volume

## Security Considerations

1. **Never expose** internal profit fields to users
2. **Protect** analytics endpoints with authentication
3. **Log** all profit data for compliance and reporting
4. **Monitor** for unusual patterns or potential gaming

## Testing

Use the regular quote endpoint (`/api/quote`) for standard quotes without profit mechanisms.
Use `/api/quote-profitable` for quotes with hidden profit mechanisms.

The difference in `buyAmount` between the two endpoints represents your profit margin.