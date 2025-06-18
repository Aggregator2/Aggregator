# Escrow Event Listener System

This system provides comprehensive event monitoring for the Meta Aggregator 2.0 escrow contracts using ethers.js. It subscribes to key escrow events and logs them to both console and structured log files.

## Features

- **Real-time Event Subscription**: Monitors `EscrowDeposited`, `EscrowReleased`, and `EscrowRefunded` events
- **Structured Logging**: Events are logged to both console and JSON log files
- **Historical Event Querying**: Can query and process historical events from specific block ranges
- **Local Testing Support**: Works with Hardhat/Ganache local networks for simulation
- **Comprehensive Event Data**: Captures transaction hashes, block numbers, event arguments, and more

## Quick Start

### 1. Setup and Run Full Demo
```bash
npm run event-demo
```
This will:
- Compile contracts
- Start Hardhat network
- Deploy test contracts
- Simulate various escrow events
- Log all events with detailed information

### 2. Manual Setup (for development)

#### Start Hardhat Network
```bash
npm run event-setup
# Or manually:
npx hardhat node
```

#### Run Event Simulation (in another terminal)
```bash
npm run event-simulate
# Or manually:
npx hardhat run scripts/simulateEscrowEvents.js --network localhost
```

#### Start Event Listener (in another terminal)
```bash
npm run event-listen
# Or manually:
node utils/escrowEventListener.js
```

## Event Types Monitored

### 1. EscrowDeposited
- **Contract Event**: `Deposited(address indexed depositor, uint256 amount)`
- **Triggered**: When a user deposits funds into escrow
- **Data Captured**: Depositor address, deposit amount, transaction details

### 2. EscrowReleased  
- **Contract Event**: `FundsReleased(address indexed to, uint256 amount)`
- **Triggered**: When funds are released to the recipient
- **Data Captured**: Recipient address, release amount, transaction details

### 3. EscrowRefunded
- **Contract Event**: `Refunded(address indexed depositor, uint256 amount)`
- **Triggered**: When funds are refunded to the depositor
- **Data Captured**: Depositor address, refund amount, transaction details

### Additional Events
- **EscrowConfirmed**: `Confirmed(address indexed sender)`
- **TradeExecuted**: `TradeExecuted(address indexed sender, uint256 amountOutMin, address[] path, uint256 deadline)`

## File Structure

```
utils/
├── escrowEventListener.js          # Main event listener class
├── listenEscrowEvents.js          # Legacy event listener (deprecated)

scripts/
├── simulateEscrowEvents.js        # Event simulation script
├── eventListenerDemo.js           # Demo orchestration script

logs/
└── escrow-events.log              # Structured event logs (JSON)
```

## Configuration

### Environment Variables
Create a `.env.local` file with:
```bash
ESCROW_CONTRACT_ADDRESS=0x...      # Your deployed escrow contract address
PROVIDER_URL=http://127.0.0.1:8545 # RPC endpoint (defaults to local Hardhat)
```

### Event Listener Options
```javascript
const listener = new EscrowEventListener({
    contractAddress: "0x...",              // Contract address
    providerUrl: "http://127.0.0.1:8545",  // RPC endpoint
    logDir: "./logs"                       // Log directory
});
```

## Usage Examples

### Basic Event Listening
```javascript
const EscrowEventListener = require('./utils/escrowEventListener');

const listener = new EscrowEventListener({
    contractAddress: "0x1234...",
    providerUrl: "http://127.0.0.1:8545"
});

// Start listening
await listener.subscribeToEvents();

// Query historical events
await listener.queryHistoricalEvents(0, "latest");

// Stop listening
listener.stop();
```

### Event Data Structure
Each logged event contains:
```json
{
    "timestamp": "2025-06-14T12:00:00.000Z",
    "eventName": "EscrowDeposited",
    "contractAddress": "0x1234...",
    "type": "EscrowDeposited",
    "depositor": "0x5678...",
    "amount": "1000000000000000000",
    "transactionHash": "0xabcd...",
    "blockNumber": 123,
    "blockHash": "0xef01...",
    "logIndex": 0,
    "args": {
        "depositor": "0x5678...",
        "amount": "1000000000000000000"
    }
}
```

## Testing and Simulation

The system includes comprehensive testing capabilities:

### 1. Automated Event Simulation
```bash
npm run event-demo
```
This runs a complete simulation that:
- Deploys test escrow contracts
- Simulates deposit, confirmation, release, and refund events
- Verifies event logging functionality
- Provides detailed event summaries

### 2. Manual Testing
```bash
# Terminal 1: Start Hardhat network
npm run node

# Terminal 2: Start event listener  
npm run event-listen

# Terminal 3: Run simulations
npm run simulate-events
```

### 3. Local Hardhat Network
The system is configured to work with Hardhat's local network:
- Network: `http://127.0.0.1:8545`
- Chain ID: 31337
- Pre-funded test accounts available

## Event Log Analysis

### View Event Summary
```javascript
const listener = new EscrowEventListener();
const summary = listener.getEventSummary();
console.log(summary);
```

Output:
```javascript
{
    totalEvents: 15,
    eventTypes: {
        "EscrowDeposited": 5,
        "EscrowReleased": 3,
        "EscrowRefunded": 2,
        "EscrowConfirmed": 5
    },
    latestEvent: { /* latest event data */ },
    events: [ /* last 10 events */ ]
}
```

### Log File Format
Events are stored in `logs/escrow-events.log` as newline-delimited JSON:
```
{"timestamp":"2025-06-14T12:00:00.000Z","eventName":"EscrowDeposited",...}
{"timestamp":"2025-06-14T12:01:00.000Z","eventName":"EscrowReleased",...}
```

## Troubleshooting

### Common Issues

1. **Contract not found**
   - Ensure `ESCROW_CONTRACT_ADDRESS` is set correctly
   - Verify the contract is deployed on the target network

2. **Connection failed**
   - Check that Hardhat network is running (`npm run node`)
   - Verify `PROVIDER_URL` in environment variables

3. **No events detected**
   - Ensure contract interactions are actually happening
   - Check that the listener is connected to the correct network
   - Verify contract ABI is available in artifacts

### Debug Mode
Enable verbose logging by setting:
```bash
DEBUG=escrow:*
```

## Network Compatibility

The event listener supports:
- **Local Networks**: Hardhat, Ganache
- **Test Networks**: Goerli, Sepolia, etc.
- **Mainnet**: Ethereum mainnet
- **Layer 2**: Polygon, Arbitrum, Optimism (with proper RPC URLs)

## Performance Considerations

- **Event Filtering**: The listener subscribes to specific events only
- **Batch Processing**: Historical events are processed in batches
- **Memory Management**: Log rotation and cleanup (implement as needed)
- **Reconnection**: Automatic reconnection on connection loss (future enhancement)

## Security Notes

- Event data includes transaction hashes and addresses - log securely
- Ensure RPC endpoints are trusted when using remote providers
- Consider rate limiting for high-frequency event monitoring
- Validate event signatures when processing critical events

## API Reference

### EscrowEventListener Class

#### Constructor
```javascript
new EscrowEventListener(options)
```

#### Methods
- `subscribeToEvents()` - Start real-time event subscription
- `queryHistoricalEvents(fromBlock, toBlock)` - Query historical events
- `stop()` - Stop event listening
- `getEventSummary()` - Get event statistics and recent events

#### Events Captured
- `Deposited` → `EscrowDeposited`
- `FundsReleased` → `EscrowReleased`  
- `Refunded` → `EscrowRefunded`
- `Confirmed` → `EscrowConfirmed`
- `TradeExecuted` → `TradeExecuted`
