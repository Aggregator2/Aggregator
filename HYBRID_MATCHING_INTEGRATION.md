# Hybrid Matching Integration

The order matching engine has been connected to external liquidity sources via LiFi. When the internal order book lacks liquidity, orders are automatically routed to DEX aggregators for execution.

## Overview

The hybrid matching system combines:
1. **Internal Order Book**: Fast, low-cost matching for available liquidity
2. **External DEX Aggregation**: Access to deep liquidity across multiple chains via LiFi
3. **Smart Routing**: Automatically selects the best execution venue or splits orders

## Architecture

```
User Order
    |
    v
Hybrid Matching Service
    |
    ├─> Internal Matching Engine
    |     └─> Order Book (ETH/USDC, etc.)
    |
    └─> External DEX Router
          └─> LiFi API → Uniswap, SushiSwap, etc.
```

## API Endpoints

### Submit Order with Hybrid Matching
- **POST** `/api/submitOrder`
- Body: `{ order, signature, useHybrid: true }`
- Automatically routes to best execution venue

### Get Hybrid Quote
- **GET** `/api/quote/hybrid`
- Query: `?pair=ETH/USDC&side=BUY&quantity=1.5`
- Returns quotes from both internal and external sources

### Check External Execution Status
- **GET** `/api/orders/external/[orderId]`
- Returns status of pending external executions

### List Pending External Orders
- **GET** `/api/orders/external/pending`
- Shows all orders awaiting external execution

### Update External Order Status (Webhook)
- **POST** `/api/orders/external/[orderId]`
- Body: `{ status: "completed", txHash: "0x..." }`

## Execution Flow

1. **Quote Phase**:
   - Check internal order book liquidity
   - Get external DEX quotes via LiFi
   - Compare prices including fees
   - Recommend best execution strategy

2. **Execution Phase**:
   - Execute available internal liquidity first
   - Route remaining quantity to external DEXs
   - Return combined execution report

3. **Settlement Phase**:
   - Internal trades settle immediately
   - External trades pending blockchain confirmation
   - Status updates via webhook or polling

## Example Usage

### 1. Get a Hybrid Quote
```bash
curl http://localhost:3000/api/quote/hybrid?pair=ETH/USDC&side=BUY&quantity=5
```

Response:
```json
{
  "pair": "ETH/USDC",
  "side": "BUY",
  "quantity": 5,
  "quotes": {
    "internal": {
      "available": true,
      "price": 2010.50,
      "availableQuantity": 2.5,
      "fees": 10.05
    },
    "external": {
      "available": true,
      "price": 2008.75,
      "availableQuantity": 5,
      "fees": 15.50
    }
  },
  "recommendation": {
    "source": "split",
    "reason": "Insufficient internal liquidity, splitting between internal and external",
    "splitRatio": {
      "internal": 0.5,
      "external": 0.5
    }
  }
}
```

### 2. Submit Hybrid Order
```bash
curl -X POST http://localhost:3000/api/submitOrder \
  -H "Content-Type: application/json" \
  -d '{
    "order": { ... },
    "signature": "0x...",
    "useHybrid": true
  }'
```

Response:
```json
{
  "status": "pending_external",
  "message": "Order partially filled internally (2.5), pending external execution for 2.5",
  "orderId": "ORD-1234567890-abc123",
  "hybridResult": {
    "totalFilled": 2.5,
    "averagePrice": 2010.50,
    "breakdown": {
      "internal": {
        "quantity": 2.5,
        "value": 5026.25,
        "averagePrice": 2010.50
      },
      "external": {
        "quantity": 2.5,
        "value": 5021.88,
        "averagePrice": 2008.75
      }
    }
  }
}
```

## Testing

### Simulate Low Liquidity
```bash
# Drain internal order books
curl -X POST http://localhost:3000/api/test/simulateExternalLiquidity \
  -H "Content-Type: application/json" \
  -d '{"action": "drain"}'

# Restore liquidity
curl -X POST http://localhost:3000/api/test/simulateExternalLiquidity \
  -H "Content-Type: application/json" \
  -d '{"action": "restore"}'
```

## Configuration

The system supports the following tokens and pairs:
- Base currencies: ETH, WBTC
- Quote currencies: USDC, USDT
- Supported pairs: ETH/USDC, ETH/USDT, WBTC/USDC, WBTC/USDT

External routing is handled by LiFi across multiple chains:
- Ethereum mainnet
- Arbitrum
- Optimism
- Polygon
- And more...

## Benefits

1. **Best Execution**: Always finds the best price across all venues
2. **Deep Liquidity**: Access to aggregated DEX liquidity
3. **Failover**: Automatic fallback when internal liquidity is insufficient
4. **Cost Optimization**: Uses internal matching when cheaper
5. **Cross-chain**: Can source liquidity from multiple chains

## Monitoring

The hybrid matcher emits events for tracking:
- `hybrid-execution-complete`: Full execution details
- `external-execution-pending`: External route initiated
- `external-execution-update`: Status changes for external orders

## Future Enhancements

1. **Smart Order Routing**: ML-based routing decisions
2. **MEV Protection**: Private mempools for external execution
3. **Gas Optimization**: Batch external executions
4. **Cross-chain Settlement**: Native multi-chain support
5. **Liquidity Incentives**: Rewards for internal market makers