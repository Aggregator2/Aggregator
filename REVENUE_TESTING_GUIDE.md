# Revenue System Testing Guide

## Quick Start

The dashboard is now accessible at: **http://localhost:3000/revenue-dashboard.html**

## Testing Options

### Option 1: Simulated Testing (Recommended - No Real Money)

This is the safest way to test the revenue system without spending real money:

```bash
# 1. Generate test wallets
node scripts/setup-test-wallet.js

# 2. Use the test configuration
cp .env.test .env

# 3. Run the revenue simulation
node scripts/test-revenue-system.js

# 4. Monitor the results
node scripts/monitor-revenue-wallet.js
```

**What this does:**
- Creates test wallets (no real funds)
- Simulates fee collections
- Shows how the accumulator works
- Demonstrates the $50 threshold trigger
- NO ACTUAL TRANSFERS (since wallets have no funds)

### Option 2: Testnet Testing (Recommended for Integration)

Use test networks with free tokens:

1. **Get Testnet Tokens:**
   - Goerli ETH: https://goerlifaucet.com
   - Mumbai MATIC: https://faucet.polygon.technology
   - Arbitrum Goerli: https://faucet.arbitrum.io

2. **Update .env for Testnet:**
   ```bash
   ETHEREUM_RPC=https://eth-goerli.public.blastapi.io
   POLYGON_RPC=https://rpc-mumbai.maticvigil.com
   ARBITRUM_RPC=https://goerli-rollup.arbitrum.io/rpc
   ```

3. **Deploy Test Contracts** on testnet and update addresses

### Option 3: Mainnet Testing (Real Money - Use Caution)

If you want to test with real money:

1. **Start Small:** Use minimal amounts (e.g., $0.01 worth)
2. **Test Transfer:** Lower the threshold temporarily:
   ```javascript
   // In revenueAccumulator.ts, change:
   private transferThresholdUSD: number = 0.1; // $0.10 for testing
   ```

## Why Faucet Money Won't Work for Revenue

You're correct that faucet tokens won't trigger revenue transfers because:

1. **Different Networks:** Faucets give testnet tokens, revenue system expects mainnet
2. **No USD Value:** Testnet tokens have $0 value, won't accumulate toward threshold
3. **Different Addresses:** Testnet contracts differ from mainnet contracts

## Testing Without Real Transactions

The simulation script (`test-revenue-system.js`) lets you:
- Test the accumulation logic
- See how fees are tracked
- Understand the threshold system
- Verify your configuration

## Monitoring Your Tests

1. **Open Dashboard:** http://localhost:3000/revenue-dashboard.html
2. **Run Wallet Monitor:** `node scripts/monitor-revenue-wallet.js`
3. **Check Event Listener:** `node scripts/revenue-event-listener.js`

## Common Testing Scenarios

### Test 1: Configuration Check
```bash
# Verify your setup
node scripts/test-revenue-system.js
```

### Test 2: Force Transfer
```bash
# Use the dashboard
# Click "Force Transfer" 
# Enter admin key: (check your .env)
```

### Test 3: Monitor Events
```bash
# In one terminal
node scripts/revenue-event-listener.js

# In another terminal  
node scripts/test-revenue-system.js
```

## Important Notes

1. **Simulation vs Reality:**
   - Simulation: Shows the logic, no actual transfers
   - Testnet: Real transfers, fake money
   - Mainnet: Real transfers, real money

2. **Gas Fees:**
   - Even testnet needs gas for transfers
   - Mainnet transfers cost real ETH for gas

3. **Security:**
   - Never share private keys
   - Use separate wallets for testing
   - Start with tiny amounts on mainnet

## Next Steps

For production deployment:
1. Set up secure wallets (consider hardware wallets)
2. Fund fee collection wallet with gas
3. Set appropriate transfer threshold
4. Monitor regularly
5. Keep private keys secure

The system is designed to be transparent - you'll see every fee collection and transfer in the monitoring tools!