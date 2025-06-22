# Order Flow Test Suite

Comprehensive test suite for the entire order execution pipeline, including EIP-712 signatures, solver network, and settlement verification.

## Test Coverage

The test suite covers all requested functionality:

1. **EIP-712 Signature Creation & Verification** ✓
   - Creates orders with proper EIP-712 typed data structure
   - Signs orders using wallet's private key
   - Verifies signatures match the signing address

2. **Solver Network Submission** ✓
   - Submits signed orders to `/api/submitOrder` endpoint
   - Handles acceptance/rejection responses
   - Tracks order IDs for monitoring

3. **Real-time Order Status Monitoring** ✓
   - WebSocket connection for live updates
   - Polling fallback for status checks
   - Tracks order lifecycle from submission to completion

4. **Solver Execution Verification** ✓
   - Monitors for successful order execution
   - Verifies transaction receipts
   - Checks token transfer events

5. **Failed Order & Escrow Fallback** ✓
   - Tests orders that should fail (unrealistic amounts)
   - Monitors for escrow contract events
   - Verifies escrow deposits for failed orders

6. **Settlement Verification** ✓
   - Parses on-chain transaction logs
   - Verifies sell token was transferred from user
   - Verifies buy token was received (with 0.1% slippage tolerance)
   - Flags any settlement mismatches

7. **Order Cancellation** ✓
   - Tests cancellation before execution
   - Verifies cancelled orders don't execute
   - Uses signed cancellation messages

8. **Order Expiry Enforcement** ✓
   - Tests orders with expired `validTo` timestamps
   - Verifies expired orders are rejected by the API
   - Ensures old orders cannot be replayed

9. **Batch Testing (20+ orders)** ✓
   - Runs 20 orders with different token pairs
   - Tracks success rate and execution times
   - Tests concurrent order submission

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install --save ethers@^6.9.0 axios@^1.6.2 ws@^8.14.2 chalk@^4.1.2 dotenv@^16.3.1
   ```

2. **Configure Environment**
   Create a `.env` file:
   ```env
   # Network Configuration
   RPC_URL=http://localhost:8545
   API_BASE_URL=http://localhost:3000/api
   WS_URL=ws://localhost:3001
   
   # Test Wallet (use a test private key)
   PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

3. **Start Required Services**
   - Local blockchain node (e.g., Hardhat, Ganache)
   - API server with order endpoints
   - WebSocket server for real-time updates

4. **Run Tests**
   ```bash
   node test-order-flow-complete.js
   ```

## Test Execution Flow

1. **WebSocket Connection** - Establishes real-time update channel
2. **Expiry Test** - Verifies expired orders are rejected
3. **Normal Orders (10)** - Tests various token pairs
4. **Cancellation Tests (3)** - Tests order cancellation flow
5. **Escrow Fallback** - Tests failed order handling
6. **High-Frequency (7)** - Concurrent order submission

## Output

The test provides detailed output including:
- Real-time status updates for each order
- Color-coded success/failure indicators
- Comprehensive summary statistics
- Detailed breakdown by order status
- Average execution times
- Success rate calculation

## Token Pairs Tested

- WETH → DAI
- DAI → USDC  
- USDC → WETH
- WETH → WBTC
- WBTC → DAI

## Key Metrics Tracked

- **Total Orders**: All orders submitted
- **Successful Orders**: Orders that completed settlement
- **Failed Orders**: Orders that failed execution
- **Cancelled Orders**: Orders cancelled before execution
- **Expired Orders**: Orders rejected due to expiry
- **Escrow Fallbacks**: Failed orders that triggered escrow
- **Settlement Mismatches**: Orders where amounts don't match
- **Success Rate**: Percentage of successful orders
- **Average Execution Time**: Mean time from submission to completion

## Error Handling

The test suite handles various error scenarios:
- Network connectivity issues
- Invalid signatures
- API errors
- Settlement mismatches
- Timeout conditions
- WebSocket disconnections

## Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed