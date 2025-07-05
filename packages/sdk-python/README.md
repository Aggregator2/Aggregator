# Offchain Protocol Python SDK

Official Python SDK for the Offchain Protocol API with full async/await support.

## Installation

```bash
pip install offchain-protocol
```

## Quick Start

```python
import asyncio
from offchain_protocol import OffchainClient, CreateOrderRequest, OrderSide, OrderType

async def main():
    # Initialize client
    async with OffchainClient('your-api-key', testnet=True) as client:
        # Create a limit order
        order = await client.create_order(CreateOrderRequest(
            pair='BTC/USDT',
            side=OrderSide.BUY,
            type=OrderType.LIMIT,
            quantity='0.1',
            price='45000'
        ))
        
        print(f'Order created: {order.id}')
        
        # Stream real-time trades
        async for trade in client.stream_trades('BTC/USDT'):
            print(f'Trade: {trade.price} @ {trade.quantity}')
            break  # Just show one trade for demo

asyncio.run(main())
```

## Features

- **Complete API Coverage**: Orders, Order Book, Trades, Settlements
- **WebSocket Support**: Real-time streaming of market data and order updates
- **Type Safety**: Full type hints with Pydantic models
- **Automatic Request Signing**: Secure HMAC-SHA256 request signing
- **Rate Limit Handling**: Built-in rate limit tracking and retry logic
- **Async/Await**: Modern Python async patterns for high performance
- **Error Handling**: Comprehensive exception types for different scenarios

## API Reference

### Client Initialization

```python
from offchain_protocol import OffchainClient

client = OffchainClient(
    api_key='your-api-key',
    api_secret='your-api-secret',  # Optional, for request signing
    testnet=True,  # Use testnet environment
    timeout=30  # Request timeout in seconds
)
```

### Context Manager (Recommended)

```python
async with OffchainClient('your-api-key', testnet=True) as client:
    # Use client here
    pass
```

### Orders API

#### Create Order
```python
from offchain_protocol import CreateOrderRequest, OrderSide, OrderType, TimeInForce

order = await client.create_order(CreateOrderRequest(
    pair='BTC/USDT',
    side=OrderSide.BUY,
    type=OrderType.LIMIT,
    quantity='0.1',
    price='45000',
    time_in_force=TimeInForce.GTC
))
```

#### Get Order
```python
order = await client.get_order('order-id')
```

#### List Orders
```python
from offchain_protocol import OrderStatus

response = await client.list_orders(
    pair='BTC/USDT',
    status=[OrderStatus.OPEN, OrderStatus.PARTIALLY_FILLED],
    limit=50
)

for order in response.data:
    print(f'{order.id}: {order.status}')
```

#### Update Order
```python
from offchain_protocol import UpdateOrderRequest

updated = await client.update_order('order-id', UpdateOrderRequest(
    price='46000',
    quantity='0.2'
))
```

#### Cancel Order
```python
cancelled = await client.cancel_order('order-id')
```

#### Cancel All Orders
```python
result = await client.cancel_all_orders('BTC/USDT')  # optional pair filter
print(f'Cancelled {result["cancelled"]} orders')
```

### Order Book API

#### Get Order Book
```python
orderbook = await client.get_orderbook('BTC/USDT', depth=20)

print(f'Best bid: {orderbook.bids[0].price}')
print(f'Best ask: {orderbook.asks[0].price}')
```

### Trades API

#### Get Recent Trades
```python
trades = await client.get_recent_trades('BTC/USDT', limit=100)

for trade in trades:
    print(f'{trade.timestamp}: {trade.price} x {trade.quantity}')
```

#### Get User Trades
```python
response = await client.get_user_trades(
    pair='BTC/USDT',
    limit=50
)

for trade in response.data:
    print(f'Trade {trade.id}: {trade.price} x {trade.quantity}')
```

### Settlements API

#### List Settlements
```python
from offchain_protocol import SettlementStatus

response = await client.list_settlements(
    status=SettlementStatus.COMPLETED,
    currency='USDT'
)

for settlement in response.data:
    print(f'Settlement {settlement.id}: {settlement.amount} {settlement.currency}')
```

#### Get Settlement Proof
```python
proof = await client.get_settlement_proof('settlement-id')

print(f'Merkle proof: {proof.merkle_proof}')
print(f'Merkle root: {proof.merkle_root}')
```

### Market Data API

#### Get Ticker
```python
ticker = await client.get_ticker('BTC/USDT')

print(f'Last price: {ticker.last_price}')
print(f'24h volume: {ticker.base_volume_24h}')
print(f'24h change: {ticker.price_change_percent_24h}%')
```

#### Get Candles
```python
from offchain_protocol import CandleInterval

candles = await client.get_candles(
    'BTC/USDT',
    CandleInterval.ONE_HOUR,
    limit=100
)

for candle in candles:
    print(f'{candle.open_time}: O:{candle.open} H:{candle.high} L:{candle.low} C:{candle.close}')
```

### WebSocket Streaming

#### Stream Trades
```python
async for trade in client.stream_trades('BTC/USDT'):
    print(f'New trade: {trade.price} @ {trade.quantity}')
```

#### Stream Order Book
```python
async for orderbook in client.stream_orderbook('BTC/USDT'):
    print(f'Best bid: {orderbook.bids[0].price}')
    print(f'Best ask: {orderbook.asks[0].price}')
```

#### Stream Order Updates
```python
async for order in client.stream_orders():
    print(f'Order {order.id} updated: {order.status}')
```

### WebSocket Client (Advanced)

For more control over WebSocket connections:

```python
from offchain_protocol.websocket import WebSocketClient

ws = WebSocketClient('wss://ws.offchain.finance', 'your-api-key')
await ws.connect()

# Subscribe to multiple channels
await ws.subscribe_trades(['BTC/USDT', 'ETH/USDT'])
await ws.subscribe_orderbook(['BTC/USDT'])
await ws.subscribe_orders()

# Stream data
async for trade in ws.stream_trades('BTC/USDT'):
    print(f'Trade: {trade}')
```

## Error Handling

The SDK provides specific exception types for different error scenarios:

```python
from offchain_protocol.exceptions import (
    AuthenticationError,
    RateLimitError,
    ValidationError,
    OrderNotFoundError,
    InsufficientBalanceError
)

try:
    order = await client.create_order(order_request)
except RateLimitError as e:
    print(f'Rate limited. Retry after {e.retry_after} seconds')
except ValidationError as e:
    print(f'Invalid order: {e.message}')
except InsufficientBalanceError:
    print('Insufficient balance for order')
except AuthenticationError:
    print('Authentication failed. Check your API key')
```

## Rate Limiting

The SDK automatically tracks rate limit information:

```python
# Check current rate limit status
rate_info = client.rate_limit_info
if rate_info:
    print(f'Remaining requests: {rate_info.remaining}')
    print(f'Reset time: {rate_info.reset}')
```

## Examples

### Market Making Bot

```python
async def market_maker(client: OffchainClient, pair: str, spread: float = 0.001):
    """Simple market making bot"""
    
    while True:
        try:
            # Get current orderbook
            orderbook = await client.get_orderbook(pair, depth=1)
            
            if orderbook.bids and orderbook.asks:
                best_bid = float(orderbook.bids[0].price)
                best_ask = float(orderbook.asks[0].price)
                mid_price = (best_bid + best_ask) / 2
                
                # Calculate our prices
                buy_price = str(round(mid_price * (1 - spread), 2))
                sell_price = str(round(mid_price * (1 + spread), 2))
                
                # Cancel existing orders
                await client.cancel_all_orders(pair)
                
                # Place new orders
                await asyncio.gather(
                    client.create_order(CreateOrderRequest(
                        pair=pair,
                        side=OrderSide.BUY,
                        type=OrderType.LIMIT,
                        quantity='0.1',
                        price=buy_price
                    )),
                    client.create_order(CreateOrderRequest(
                        pair=pair,
                        side=OrderSide.SELL,
                        type=OrderType.LIMIT,
                        quantity='0.1',
                        price=sell_price
                    ))
                )
                
                print(f'Orders placed: Buy @ {buy_price}, Sell @ {sell_price}')
            
            # Wait before next iteration
            await asyncio.sleep(10)
            
        except Exception as e:
            print(f'Error: {e}')
            await asyncio.sleep(60)
```

### DCA (Dollar Cost Averaging) Bot

```python
async def dca_bot(client: OffchainClient, pair: str, amount_usd: str, interval_hours: int):
    """Dollar cost averaging bot"""
    
    while True:
        try:
            # Get current ticker
            ticker = await client.get_ticker(pair)
            
            # Calculate quantity based on current price
            quantity = str(round(float(amount_usd) / float(ticker.ask_price), 8))
            
            # Place market order
            order = await client.create_order(CreateOrderRequest(
                pair=pair,
                side=OrderSide.BUY,
                type=OrderType.MARKET,
                quantity=quantity
            ))
            
            print(f'DCA: Bought {quantity} at market price')
            
            # Wait for next interval
            await asyncio.sleep(interval_hours * 3600)
            
        except Exception as e:
            print(f'DCA error: {e}')
            await asyncio.sleep(300)  # Wait 5 minutes on error
```

### Order Monitoring

```python
async def monitor_orders(client: OffchainClient):
    """Monitor order status changes in real-time"""
    
    print('Monitoring order updates...')
    
    async for order in client.stream_orders():
        print(f'\nOrder Update:')
        print(f'  ID: {order.id}')
        print(f'  Pair: {order.pair}')
        print(f'  Status: {order.status}')
        print(f'  Filled: {order.filled_quantity}/{order.quantity}')
        
        if order.status == OrderStatus.FILLED:
            print(f'  ✓ Order completed!')
```

## Type Safety

The SDK uses Pydantic for type safety and validation:

```python
from offchain_protocol.types import (
    Order,
    Trade,
    OrderBook,
    CreateOrderRequest,
    OrderSide,
    OrderType,
    OrderStatus,
    TimeInForce
)

# All models are fully typed
order: Order = await client.get_order('order-id')
print(order.status)  # IDE knows this is OrderStatus enum
```

## Async Context Manager

Always use the client as an async context manager to ensure proper cleanup:

```python
async def main():
    async with OffchainClient('api-key') as client:
        # Client session is automatically managed
        orders = await client.list_orders()
    # Session is automatically closed

# Or manage manually
client = OffchainClient('api-key')
try:
    # Use client
    pass
finally:
    await client.close()
```

## Configuration

### Environment Variables

```bash
export OFFCHAIN_API_KEY="your-api-key"
export OFFCHAIN_API_SECRET="your-api-secret"
export OFFCHAIN_TESTNET="true"
```

### Custom URLs

```python
client = OffchainClient(
    api_key='your-api-key',
    base_url='https://custom-api.example.com',
    websocket_url='wss://custom-ws.example.com'
)
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Requirements

- Python 3.8+
- aiohttp
- websockets
- pydantic
- python-dateutil

## License

MIT License - see [LICENSE](LICENSE) for details.