# Enhanced Escrow Event Listener

A robust, production-ready event listener for the Meta Aggregator 2.0 escrow system that monitors blockchain events, handles disconnections, and integrates with the order management database.

## Features

### 🎯 Core Functionality
- **Event Subscription**: Monitors `EscrowReleased`, `EscrowRefunded`, and `EscrowDeposited` events
- **Transaction Parsing**: Extracts order IDs, transaction details, and relevant data from events
- **Database Integration**: Updates order status via `OrderService.updateStatusFromTx()`
- **Comprehensive Logging**: Structured logs to console and files

### 🔌 Connection Management
- **Disconnect Detection**: Automatic detection of provider disconnections
- **Auto-Reconnection**: Configurable reconnection attempts with exponential backoff
- **Heartbeat Monitoring**: Regular connection health checks
- **Graceful Shutdown**: Clean resource cleanup on exit

### 🧪 Testing & Simulation
- **Event Simulation**: Generate mock events for testing
- **Hardhat/Ganache Support**: Local blockchain testing
- **Historical Event Queries**: Replay past events
- **Demo Mode**: Comprehensive testing scenarios

## Quick Start

### 1. Setup Environment

```bash
# Copy environment template
cp .env.template .env.local

# Update configuration
# Set PROVIDER_URL, ESCROW_CONTRACT_ADDRESS, etc.
```

### 2. Basic Usage

```bash
# Start real-time event monitoring
npm run event-listen

# Run event simulation for testing
npm run event-simulate

# Query historical events and start monitoring
npm run event-history

# Run comprehensive demo
npm run event-demo
```

### 3. PowerShell Testing Script (Windows)

```powershell
# Interactive testing menu
npm run test-event-listener
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROVIDER_URL` | Blockchain RPC endpoint | `http://127.0.0.1:8545` |
| `ESCROW_CONTRACT_ADDRESS` | Deployed escrow contract address | Required |
| `SUPABASE_URL` | Supabase project URL | Optional |
| `SUPABASE_KEY` | Supabase API key | Optional |
| `MAX_RECONNECT_ATTEMPTS` | Max reconnection tries | `10` |
| `RECONNECT_DELAY` | Delay between reconnection attempts (ms) | `5000` |
| `HEARTBEAT_INTERVAL` | Connection health check interval (ms) | `30000` |

### Contract Events Monitored

```solidity
event Deposited(address indexed depositor, uint256 amount);
event FundsReleased(address indexed to, uint256 amount);
event Refunded(address indexed depositor, uint256 amount);
event Confirmed(address indexed sender);
event TradeExecuted(address indexed sender, uint256 amountOutMin, address[] path, uint256 deadline);
```

## Order Service Integration

The event listener integrates with the `OrderService` class to maintain database consistency:

```javascript
// Automatic order status updates
const updateData = {
    orderId: extractedOrderId,
    eventType: 'EscrowReleased',
    transactionHash: tx.hash,
    blockNumber: tx.blockNumber,
    amount: eventArgs.amount
};

const result = await orderService.updateStatusFromTx(updateData);
orderService.assertDatabaseUpdate(result, expectedState);
```

### State Mapping

| Event Type | Database State |
|------------|----------------|
| `EscrowDeposited` | `DEPOSITED` |
| `EscrowReleased` | `SETTLED` |
| `EscrowRefunded` | `REFUNDED` |
| `EscrowConfirmed` | `CONFIRMED` |
| `TradeExecuted` | `TRADED` |

## Architecture

### Class Structure

```
EscrowEventListener
├── Connection Management
│   ├── initializeProvider()
│   ├── handleDisconnection()
│   ├── attemptReconnection()
│   └── startHeartbeat()
├── Event Processing
│   ├── subscribeToEvents()
│   ├── logEvent()
│   └── parseTxForOrderData()
├── Database Integration
│   └── OrderService.updateStatusFromTx()
└── Testing & Simulation
    ├── simulateEvents()
    └── queryHistoricalEvents()
```

### File Structure

```
utils/
├── escrowEventListener.js    # Main event listener class
├── orderService.js          # Database operations
├── eventListenerDemo.js     # Demo script
└── README.md               # This documentation

logs/
├── escrow-events.log       # Event logs
└── escrow-errors.log       # Error logs
```

## Usage Examples

### Programmatic Usage

```javascript
const EscrowEventListener = require('./utils/escrowEventListener');

const listener = new EscrowEventListener({
    contractAddress: '0x123...',
    providerUrl: 'http://localhost:8545'
});

// Start monitoring
await listener.subscribeToEvents();

// Graceful shutdown
process.on('SIGINT', async () => {
    await listener.shutdown();
    process.exit(0);
});
```

### Command Line Options

```bash
# Real-time monitoring with historical query
node utils/escrowEventListener.js --history

# Simulation mode (testing)
node utils/escrowEventListener.js --simulate

# Demo with all features
node utils/eventListenerDemo.js
```

## Error Handling

### Connection Issues
- Automatic reconnection with exponential backoff
- Configurable maximum retry attempts
- Error logging with timestamps and context

### Event Processing Errors
- Individual event failures don't stop the listener
- Comprehensive error logging
- Database transaction rollback on failures

### Database Integration
- Graceful handling of Supabase connection issues
- Assertion checks for database updates
- Audit trail with emergency fix tracking

## Testing

### Local Development

1. **Start Hardhat Network**:
   ```bash
   npx hardhat node
   ```

2. **Deploy Contracts**:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```

3. **Run Event Listener**:
   ```bash
   npm run event-listen
   ```

### Simulation Testing

```bash
# Run simulation mode
npm run event-simulate

# View generated logs
cat logs/escrow-events.log | tail -10
```

### Integration Testing

```bash
# Run comprehensive demo
npm run event-demo

# PowerShell testing menu (Windows)
npm run test-event-listener
```

## Troubleshooting

### Common Issues

**Provider Connection Failed**
```
❌ Failed to connect to network: connect ECONNREFUSED 127.0.0.1:8545
```
- Ensure Hardhat node is running: `npx hardhat node`
- Check PROVIDER_URL in environment

**Contract Not Found**
```
❌ Contract artifact not found at: artifacts/contracts/FixedEscrow.sol/FixedEscrow.json
```
- Compile contracts: `npx hardhat compile`
- Verify contract address in environment

**Database Connection Issues**
```
⚠️ SUPABASE_URL and SUPABASE_KEY environment variables not set
```
- Set up Supabase project and update `.env.local`
- Event listener works without database for monitoring only

### Debug Mode

Enable detailed logging:
```bash
DEBUG=true node utils/escrowEventListener.js
```

## Production Deployment

### Process Management

Use PM2 for production deployment:

```bash
# Install PM2
npm install -g pm2

# Start event listener
pm2 start utils/escrowEventListener.js --name "escrow-listener"

# Monitor
pm2 logs escrow-listener
```

### Monitoring

- Event logs: `logs/escrow-events.log`
- Error logs: `logs/escrow-errors.log`
- Process health: PM2 dashboard or monitoring tools

### Security

- Use environment variables for sensitive data
- Implement proper access controls for log files
- Monitor for suspicious event patterns

## API Reference

### EscrowEventListener Class

#### Constructor
```javascript
new EscrowEventListener(options)
```

**Options:**
- `contractAddress`: Escrow contract address
- `providerUrl`: Blockchain RPC endpoint
- `logDir`: Custom log directory

#### Methods

**`subscribeToEvents()`**
- Starts event monitoring
- Returns: Promise

**`simulateEvents()`**
- Generates test events
- Returns: Promise

**`shutdown()`**
- Graceful cleanup and shutdown
- Returns: Promise

**`getEventSummary()`**
- Returns event statistics
- Returns: Object

### OrderService Class

#### Methods

**`updateStatusFromTx(txData)`**
- Updates order status from transaction
- Returns: Promise<Object>

**`assertDatabaseUpdate(result, expectedState)`**
- Validates database update
- Throws: Error if assertion fails

## Contributing

1. Fork the repository
2. Create a feature branch
3. Test thoroughly with simulation mode
4. Submit a pull request

## License

MIT License - see LICENSE file for details.
