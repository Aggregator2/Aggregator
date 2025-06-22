# Cross-Chain Swap Router Architecture

## Overview
The Cross-Chain Swap Router enables seamless token swaps across multiple blockchains through optimal path finding and execution.

## Core Components

### 1. **CrossChainRouter** (Main Orchestrator)
- Accepts swap requests with source/destination chains and tokens
- Coordinates pathfinding and execution
- Handles retries and fallback strategies

### 2. **PathFinder**
- Discovers all possible swap routes
- Calculates optimal paths based on:
  - Total fees (swap + bridge + gas)
  - Slippage
  - Execution time
  - Bridge reliability scores

### 3. **BridgeAggregator**
- Integrates multiple bridge providers (LI.FI, Synapse, Wormhole, Celer)
- Fetches bridge quotes and availability
- Monitors bridge health and reliability

### 4. **DEXAggregator**
- Extends existing multiChainQuoteService
- Adds support for more DEX aggregators
- Provides unified interface for all chains

### 5. **ExecutionEngine**
- Executes the optimal swap path
- Handles transaction signing and monitoring
- Implements safety checks and slippage protection

## Swap Flow

1. **Input Validation**
   - Validate chains, tokens, amounts
   - Check user balances and allowances

2. **Path Discovery**
   ```
   Source Token (Chain A) → Bridge Token (Chain A) → Bridge → Bridge Token (Chain B) → Destination Token (Chain B)
   ```

3. **Route Optimization**
   - Calculate all possible paths
   - Score each path by cost, speed, and reliability
   - Select optimal route

4. **Execution**
   - Execute source chain swap (if needed)
   - Execute bridge transaction
   - Monitor bridge completion
   - Execute destination chain swap (if needed)

5. **Monitoring & Recovery**
   - Track transaction status
   - Handle failures with retry logic
   - Provide status updates

## Supported Integrations

### Bridge Providers
- LI.FI (recommended - supports 20+ chains)
- Synapse Protocol
- Wormhole
- Celer cBridge
- Connext
- Hop Protocol

### DEX Aggregators
- 1inch (EVM chains)
- OpenOcean (EVM + Solana + Tron)
- Paraswap (EVM chains)
- Jupiter (Solana)
- SunSwap (Tron)
- 0x API (EVM chains)

### Chains
- EVM: Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Fantom
- Non-EVM: Solana, Tron, Cosmos, Near
- L2s: Arbitrum, Optimism, zkSync, Polygon zkEVM