# Liquidity Aggregation System

A comprehensive liquidity aggregation system that connects to multiple DEXs and centralized market makers to find the best execution paths for token swaps.

## Features

- **Multi-DEX Support**: Connects to Uniswap V2, SushiSwap, Curve, and Balancer
- **Market Maker Integration**: WebSocket connections to centralized market makers
- **Smart Order Routing**: Finds optimal paths including multi-hop routes
- **Real-time Updates**: Live price and liquidity monitoring
- **Unified Interface**: Simple API for accessing all liquidity sources
- **Extensible Architecture**: Easy to add new liquidity sources

## Architecture

```
src/liquidity-aggregator/
├── interfaces/
│   ├── types.ts          # Core type definitions
│   ├── connectors.ts     # Connector interfaces
│   └── aggregator.ts     # Main aggregator interface
├── connectors/
│   ├── BaseConnector.ts  # Base implementation
│   ├── dex/
│   │   ├── UniswapConnector.ts
│   │   ├── SushiSwapConnector.ts
│   │   ├── CurveConnector.ts
│   │   └── BalancerConnector.ts
│   └── mm/
│       └── MarketMakerConnector.ts
├── core/
│   ├── SmartOrderRouter.ts    # Routing logic
│   └── LiquidityAggregator.ts # Main aggregator
├── index.ts              # Package exports
└── example.ts            # Usage examples
```

## Installation

```bash
npm install ethers ws
```

## Usage

### Basic Setup

```typescript
import { ethers } from 'ethers';
import { 
  LiquidityAggregator, 
  UniswapV2Connector,
  MarketMakerConnector 
} from './liquidity-aggregator';

// Initialize
const provider = new ethers.JsonRpcProvider('YOUR_RPC_URL');
const aggregator = new LiquidityAggregator();

// Add DEX connectors
aggregator.addConnector(new UniswapV2Connector(provider));

// Add market maker connectors
aggregator.addConnector(new MarketMakerConnector(
  'MM1',
  'wss://mm.example.com/ws',
  'api-key'
));
```

### Finding Best Route

```typescript
const route = await aggregator.findBestRoute({
  tokenIn: WETH,
  tokenOut: USDC,
  amountIn: ethers.parseEther('1'),
  slippageTolerance: 50 // 0.5%
});

console.log('Best route:', route.path.map(t => t.symbol).join(' -> '));
console.log('Output amount:', route.totalAmountOut);
```

### Real-time Price Updates

```typescript
const unsubscribe = aggregator.subscribeToPriceUpdates(
  { tokenA: WETH, tokenB: USDC },
  (price) => console.log('Best price:', price)
);
```

## Adding New Connectors

To add a new liquidity source:

1. Create a new connector class extending `BaseConnector`
2. Implement required methods:
   - `doConnect()`: Establish connection
   - `doDisconnect()`: Clean up connection
   - `getQuote()`: Get price quote
   - `getLiquidityPools()`: Get available liquidity

3. Add the connector to the aggregator:

```typescript
aggregator.addConnector(new YourCustomConnector());
```

## API Reference

### LiquidityAggregator

- `addConnector(connector)`: Add a liquidity source
- `removeConnector(name)`: Remove a liquidity source
- `findBestRoute(request)`: Find optimal swap route
- `getQuotes(request)`: Get quotes from all sources
- `getAllLiquidity(pair)`: Get all liquidity pools
- `subscribeToLiquidityUpdates(pair, callback)`: Monitor liquidity changes
- `subscribeToPriceUpdates(pair, callback)`: Monitor price changes
- `stop()`: Clean up all connections

### SmartOrderRouter

- `findBestRoute(request)`: Find optimal route (direct or multi-hop)
- `splitOrder(request, maxSplits)`: Split large orders
- `calculateOptimalSplit(quotes, amount)`: Calculate optimal distribution

## Security Considerations

- Always validate token addresses
- Use appropriate slippage tolerance
- Set reasonable deadlines
- Monitor for sandwich attacks
- Implement rate limiting for API calls

## Performance Tips

- Batch quote requests when possible
- Use WebSocket connections for real-time data
- Cache frequently accessed data
- Implement circuit breakers for failing connectors
- Monitor gas costs for multi-hop routes