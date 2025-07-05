import asyncio
from offchain_protocol import OffchainClient, CreateOrderRequest, OrderSide, OrderType

async def main():
    # Initialize the client
    async with OffchainClient('your-api-key', testnet=True) as client:
        print('Connected to Offchain Protocol')
        
        try:
            # Create a limit order
            order = await client.create_order(CreateOrderRequest(
                pair='BTC/USDT',
                side=OrderSide.BUY,
                type=OrderType.LIMIT,
                quantity='0.1',
                price='45000'
            ))
            print(f'Order created: {order.id}')
            
            # Get order book
            orderbook = await client.get_orderbook('BTC/USDT')
            if orderbook.bids:
                print(f'Best bid: {orderbook.bids[0].price}')
            if orderbook.asks:
                print(f'Best ask: {orderbook.asks[0].price}')
            
            # Get recent trades
            trades = await client.get_recent_trades('BTC/USDT', limit=10)
            for trade in trades[:5]:  # Show first 5
                print(f'Trade: {trade.price} x {trade.quantity} at {trade.timestamp}')
            
            # Stream real-time trades
            print('\nStreaming trades (press Ctrl+C to stop)...')
            async for trade in client.stream_trades('BTC/USDT'):
                print(f'New trade: {trade.price} x {trade.quantity}')
                
        except KeyboardInterrupt:
            print('\nStopping...')
        except Exception as e:
            print(f'Error: {e}')

if __name__ == '__main__':
    asyncio.run(main())