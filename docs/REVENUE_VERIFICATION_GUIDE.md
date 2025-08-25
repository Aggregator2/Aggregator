# Revenue Verification Guide

This guide explains how to verify that funds are being properly transferred to your revenue wallet.

## Overview

The revenue system consists of several components:
1. **Revenue Accumulator** - Collects fees and transfers them when threshold is reached
2. **Wallet Monitor** - Tracks balances and incoming transactions
3. **Event Listener** - Monitors blockchain events for fee collections
4. **Revenue Dashboard** - Web interface for real-time monitoring

## Configuration

### 1. Environment Variables

Set these in your `.env` file:

```bash
# Revenue wallet configuration
REVENUE_PRIVATE_KEY=your_private_key_here  # Private key of fee collection wallet
REVENUE_WALLET=0x...                       # Address where revenue will be sent
ADMIN_API_KEY=your_admin_key              # API key for admin operations

# RPC endpoints
ETHEREUM_RPC=https://eth.llamarpc.com
ARBITRUM_RPC=https://arb1.arbitrum.io/rpc
POLYGON_RPC=https://polygon-rpc.com
```

### 2. Contract Addresses (Optional)

If you have deployed contracts:

```bash
# Ethereum contracts
ETHEREUM_SWAP_CONTRACT=0x...
ETHEREUM_ESCROW_CONTRACT=0x...

# Arbitrum contracts
ARBITRUM_SWAP_CONTRACT=0x...
ARBITRUM_ESCROW_CONTRACT=0x...

# Polygon contracts
POLYGON_SWAP_CONTRACT=0x...
POLYGON_ESCROW_CONTRACT=0x...
```

## Verification Tools

### 1. Revenue Wallet Monitor

Monitors your revenue wallet balances in real-time:

```bash
node scripts/monitor-revenue-wallet.js
```

Features:
- Real-time balance tracking across multiple chains
- Detects incoming/outgoing transfers
- Logs all transactions to `revenue-wallet-monitoring.log`
- Shows USD values for all tokens

### 2. Event Listener

Monitors blockchain events for fee collections:

```bash
node scripts/revenue-event-listener.js
```

Features:
- Listens for swap fees, escrow fees, and revenue events
- Automatically adds fees to revenue accumulator
- Catches up on missed events on startup
- Saves state to resume from last processed block

### 3. Revenue Dashboard

Web interface for monitoring:

1. Start your Next.js server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:3000/revenue-dashboard.html

Features:
- Real-time revenue tracking
- Wallet balance monitoring
- Transaction history
- Manual transfer trigger
- Network status indicators

## How Revenue Transfer Works

1. **Fee Collection**: When users perform swaps or use escrow services, fees are collected in various tokens.

2. **Accumulation**: The RevenueAccumulator service tracks all collected fees and their USD values.

3. **Threshold Check**: When total accumulated value reaches $50 USD (configurable), a transfer is triggered.

4. **Automatic Transfer**: The system automatically:
   - Groups fees by token type
   - Transfers each token to the revenue wallet
   - Logs all transfers with transaction hashes
   - Resets accumulator after successful transfer

## Verification Steps

### Step 1: Check Configuration

```bash
# Verify environment variables are set
grep REVENUE .env
```

### Step 2: Monitor Wallet Balances

```bash
# Start the wallet monitor
node scripts/monitor-revenue-wallet.js
```

You should see:
- Current balances for all tokens
- Real-time updates when transfers occur
- Transaction details with amounts and hashes

### Step 3: Track Fee Events

```bash
# Start the event listener
node scripts/revenue-event-listener.js
```

This will show:
- Fee collection events from your contracts
- Automatic addition to revenue accumulator
- Transfer triggers when threshold is reached

### Step 4: Use the Dashboard

Open the web dashboard to see:
- Total accumulated revenue
- Current wallet balances
- Recent transactions
- Network connection status

### Step 5: Verify Transfers

When a transfer occurs, you can verify it by:

1. **Check Transaction Hash**: Each transfer logs a transaction hash
2. **Verify on Block Explorer**: 
   - Ethereum: https://etherscan.io/tx/{txHash}
   - Arbitrum: https://arbiscan.io/tx/{txHash}
   - Polygon: https://polygonscan.com/tx/{txHash}
3. **Monitor Wallet Balance**: The dashboard and monitor will show increased balances

## Manual Operations

### Force Transfer

If needed, you can manually trigger a transfer:

```bash
# Using the dashboard
Click "Force Transfer" and enter admin key

# Using API
curl -X POST http://localhost:3000/api/revenue/force-transfer \
  -H "X-Admin-Key: your_admin_key" \
  -H "Content-Type: application/json"
```

### Check Revenue State

```bash
# Get current accumulator state
curl http://localhost:3000/api/revenue/state

# Get wallet balances
curl http://localhost:3000/api/revenue/balances
```

## Troubleshooting

### No Transfers Occurring

1. Check if threshold is reached:
   ```bash
   curl http://localhost:3000/api/revenue/state | jq .state.totalRevenueUSD
   ```

2. Verify wallet has gas for transfers:
   ```bash
   # ETH balance should be > 0 for gas fees
   curl http://localhost:3000/api/revenue/balances | jq .balances.ethereum.ETH
   ```

3. Check logs for errors:
   ```bash
   tail -f revenue-wallet-monitoring.log
   tail -f revenue-events.log
   ```

### Missing Events

1. Check event listener state:
   ```bash
   cat .revenue-listener-state.json
   ```

2. Manually catch up events:
   - Restart the event listener
   - It will automatically catch up from last processed block

### Transfer Failed

1. Check error logs for specific failure reason
2. Common issues:
   - Insufficient gas
   - Token approval needed
   - Network congestion
   - Invalid wallet configuration

## Security Best Practices

1. **Never commit private keys** to version control
2. **Use environment variables** for sensitive data
3. **Restrict admin API access** with strong keys
4. **Monitor unusual activity** in wallet transactions
5. **Keep transfer threshold reasonable** to limit exposure
6. **Use hardware wallets** for production revenue wallets

## Integration with Your System

To integrate fee collection in your swap/escrow services:

```javascript
import { getRevenueAccumulator } from "./src/services/revenueAccumulator.js";

// After collecting a fee
const revenueAccumulator = getRevenueAccumulator();
await revenueAccumulator.addFeeCollection({
  feeAmount: "1000000000000000000", // 1 token with 18 decimals
  feeToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC address
  tokenUsdPrice: 1.0, // Current USD price
  timestamp: Date.now(),
  chainId: 1 // Ethereum mainnet
});
```

## Summary

With these tools, you can:
1. **Monitor** wallet balances in real-time
2. **Track** all fee collection events
3. **Verify** automatic transfers to your revenue wallet
4. **Debug** any issues with comprehensive logs
5. **Control** the system with manual operations when needed

The system is designed to be transparent and verifiable at every step, ensuring you can always track where your revenue is and when it will be transferred.