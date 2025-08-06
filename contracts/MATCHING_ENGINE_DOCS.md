# Advanced Matching Engine Documentation

## Overview

The AdvancedMatchingEngine contract implements a sophisticated decentralized order matching system with support for multiple order types, anti-gaming measures, and cross-chain order preparation.

## Key Features

### 1. **Order Types**
- **Limit Orders**: Traditional buy/sell orders at a specific price
- **Market Orders**: Immediate execution at best available price
- **Stop-Loss Orders**: Triggered when market price reaches stop price
- **Iceberg Orders**: Large orders with only partial visibility to reduce market impact

### 2. **Price-Time Priority**
- Orders at the same price level are matched in FIFO order
- Earlier orders have priority over later orders at the same price
- Ensures fairness and prevents queue jumping

### 3. **Partial Fill Support**
- Orders can be partially filled across multiple trades
- Remaining amounts are tracked and can continue matching
- Iceberg orders automatically refill visible amount after partial fills

### 4. **Anti-Gaming Measures**

#### Wash Trading Detection
- Tracks trading activity between users
- Implements cooldown period (5 minutes) between self-trades
- Emits events when wash trading is detected
- Configurable per token pair

#### Order Limits
- Maximum 100 orders per user to prevent spam
- Minimum order lifetime to prevent rapid cancellation abuse
- Min/max order sizes configurable per pair

#### Price Deviation Protection
- Market orders have maximum slippage protection
- Configurable max price deviation per pair
- Prevents manipulation through extreme price movements

### 5. **Cross-Chain Order Preparation**
- Orders can be prepared for cross-chain execution
- Generates unique cross-chain identifiers
- Prevents duplicate processing across chains

### 6. **Configurable Matching Rules**

Each token pair can have custom configuration:
```solidity
struct PairConfig {
    bool active;              // Is pair tradeable
    uint256 minOrderSize;     // Minimum order amount
    uint256 maxOrderSize;     // Maximum order amount
    uint256 tickSize;         // Price increment
    uint256 makerFee;         // Fee for limit orders (basis points)
    uint256 takerFee;         // Fee for market orders (basis points)
    bool washTradingCheckEnabled;
    uint256 maxPriceDeviation; // Max slippage for market orders
}
```

### 7. **Fair Ordering Implementation**

#### No Favoritism
- Strict FIFO processing within price levels
- No preferential treatment for any user
- Transparent matching algorithm

#### MEV Resistance
- Orders processed in submission order
- No ability to reorder transactions within a block
- Protected against sandwich attacks through slippage limits

## Contract Architecture

### State Management
- Uses EnumerableSet for efficient order book management
- Separate buy/sell order books per token pair
- Orders indexed by price level for O(1) access

### Access Control
- `OPERATOR_ROLE`: Can pause/unpause and update configurations
- `RELAYER_ROLE`: Can trigger order matching and stop-loss orders
- `DEFAULT_ADMIN_ROLE`: Emergency functions and role management

### Security Features
- ReentrancyGuard on all state-changing functions
- Pausable for emergency situations
- Comprehensive input validation
- Safe token transfers using SafeERC20

## Usage Examples

### Placing a Limit Order
```solidity
matching.placeOrder(
    weth,        // baseToken
    usdc,        // quoteToken
    Side.BUY,    // side
    OrderType.LIMIT,
    1800e18,     // price: $1800 per ETH
    1e18,        // amount: 1 ETH
    0,           // stopPrice (not used for limit orders)
    0,           // visibleAmount (not used for regular limit orders)
    block.timestamp + 1 days  // expiration
);
```

### Placing an Iceberg Order
```solidity
matching.placeOrder(
    weth,        // baseToken
    usdc,        // quoteToken
    Side.SELL,   // side
    OrderType.ICEBERG,
    2000e18,     // price: $2000 per ETH
    100e18,      // amount: 100 ETH total
    0,           // stopPrice (not used)
    10e18,       // visibleAmount: Only show 10 ETH at a time
    0            // no expiration
);
```

### Placing a Stop-Loss Order
```solidity
matching.placeOrder(
    weth,        // baseToken
    usdc,        // quoteToken
    Side.SELL,   // side
    OrderType.STOP_LOSS,
    0,           // price (market order when triggered)
    5e18,        // amount: 5 ETH
    1700e18,     // stopPrice: Trigger at $1700
    0,           // visibleAmount (not used)
    0            // no expiration
);
```

## Matching Algorithm

### Order Book Structure
```
BUY Orders              SELL Orders
Price | Amount          Price | Amount
------|-------          ------|-------
1850  | 10              1851  | 5
1849  | 25              1852  | 15
1848  | 50              1853  | 30
```

### Matching Process
1. Sort buy orders descending, sell orders ascending
2. Match when buy price >= sell price
3. Use sell price as execution price (price-time priority)
4. Process orders at each price level in FIFO order
5. Continue until no more matches possible

## Fee Structure

- **Maker Fee**: Applied to limit orders that add liquidity
- **Taker Fee**: Applied to market orders that remove liquidity
- Fees collected in base token
- Configurable per token pair

## Events

### Order Lifecycle
- `OrderPlaced`: New order created
- `OrderMatched`: Orders matched and trade executed
- `OrderCancelled`: Order cancelled by user
- `StopLossTriggered`: Stop-loss order activated

### Monitoring
- `WashTradeDetected`: Potential wash trading identified
- `PairConfigUpdated`: Trading pair configuration changed
- `CrossChainOrderPrepared`: Order ready for cross-chain execution

## Gas Optimizations

1. **Storage Packing**: Efficient struct packing
2. **EnumerableSet**: O(1) insertion/removal
3. **Batch Processing**: Multiple orders matched in single transaction
4. **Custom Errors**: Cheaper than require strings

## Security Considerations

1. **Reentrancy**: All external calls protected
2. **Access Control**: Role-based permissions
3. **Input Validation**: Comprehensive parameter checking
4. **Overflow Protection**: Using Solidity 0.8+ built-in checks
5. **Pausable**: Emergency stop mechanism

## Testing Recommendations

1. **Unit Tests**: Each function tested independently
2. **Integration Tests**: Full order lifecycle testing
3. **Stress Tests**: High volume order matching
4. **Edge Cases**: Minimum amounts, maximum orders, etc.
5. **Security Tests**: Attempt common attack vectors

## Future Enhancements

1. **Advanced Order Types**: OCO, trailing stop, etc.
2. **Order Routing**: Multi-hop trades through multiple pairs
3. **Liquidity Aggregation**: Connect to external DEXs
4. **L2 Integration**: Native cross-rollup support
5. **Oracle Integration**: Real-time price feeds for stop orders