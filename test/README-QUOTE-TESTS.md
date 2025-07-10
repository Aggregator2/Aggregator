# Quote Generation Tests

This directory contains comprehensive tests for the SwappiQ quote generation API.

## Test Files

1. **`quote-generation.test.js`** - Main test suite covering all 10 scenarios from TEST_QUOTE_GENERATION.md
2. **`performance/quote-performance.test.js`** - Performance and load testing for quote API

## Running Tests

### Prerequisites

1. Make sure the API server is running:
```bash
npm run dev
```

2. The API should be available at `http://localhost:3000`

### Running Quote Generation Tests

To run all quote generation tests:
```bash
npm run test:quote
```

Or run directly:
```bash
node test/quote-generation.test.js
```

To test against a different API URL:
```bash
API_URL=https://your-api.com node test/quote-generation.test.js
```

### Running Performance Tests

To run performance tests:
```bash
npm run test:quote-performance
```

Or run directly:
```bash
node test/performance/quote-performance.test.js
```

## Test Scenarios

The quote generation test suite covers:

1. **Basic WETH to USDC Swap** - Tests standard token swap with expected pricing
2. **Stablecoin to Stablecoin** - Tests 1:1 stablecoin swaps with fees
3. **Small Amount Test** - Tests precision with small amounts (0.001 WETH)
4. **Large Amount Test** - Tests calculations with large amounts (100 WETH)
5. **Custom Slippage Test** - Tests custom slippage tolerance (2%)
6. **Zero/Invalid Amount Test** - Tests error handling for invalid inputs
7. **Reverse Pair Test** - Tests USDC to WETH conversion
8. **Unknown Token Test** - Tests handling of tokens not in the price list
9. **Cross-chain Quote Test** - Tests quotes across different chains
10. **High Slippage Warning Test** - Tests high slippage scenarios (5%)

## Expected Results

Each test validates:
- Correct buy amount calculation
- Proper slippage calculation
- LP fee calculation (0.3%)
- Error handling for invalid inputs
- Consistent pricing for unknown tokens

## API Endpoint

The tests use the `/api/quote-profitable` endpoint which provides:
- Dynamic token pricing
- Decimal handling for different tokens
- Profit margin calculations
- Slippage tolerance
- LP fee calculations

## Token Information

The tests use the following token addresses:
- **WETH**: `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` (18 decimals)
- **USDC**: `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (6 decimals)
- **USDT**: `0xdac17f958d2ee523a2206206994597c13d831ec7` (6 decimals)
- **DAI**: `0x6b175474e89094c44da98b954eedeac495271d0f` (18 decimals)
- **WBTC**: `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` (8 decimals)

## Debugging

Enable console logs by checking the browser console or terminal output for:
- `Quote Request:` - Shows incoming request parameters
- `Quote Calculation:` - Shows intermediate calculation steps

## Performance Requirements

The performance tests validate:
- P95 latency < 500ms
- Support for concurrent users
- Consistent response times under load