import { OffchainClient, OrderSide, OrderType } from '@offchain-protocol/sdk';

async function main() {
  // Initialize the client
  const client = new OffchainClient('your-api-key', {
    testnet: true
  });

  try {
    // Connect to WebSocket for real-time updates
    await client.connect();
    console.log('Connected to Offchain Protocol');

    // Create a limit order
    const order = await client.orders.create({
      pair: 'BTC/USDT',
      side: OrderSide.BUY,
      type: OrderType.LIMIT,
      quantity: '0.1',
      price: '45000'
    });
    console.log('Order created:', order.id);

    // Get order book
    const orderBook = await client.orderBook.get('BTC/USDT');
    console.log('Best bid:', orderBook.bids[0]?.price);
    console.log('Best ask:', orderBook.asks[0]?.price);

    // Subscribe to order updates
    client.websocket.subscribeOrders();
    client.websocket.on('order:update', (updatedOrder) => {
      console.log('Order updated:', updatedOrder.id, updatedOrder.status);
    });

    // Stream trades
    client.websocket.subscribeTrades(['BTC/USDT']);
    client.websocket.on('trade', (trade) => {
      console.log(`Trade: ${trade.price} x ${trade.quantity}`);
    });

    // Keep the connection alive
    process.on('SIGINT', async () => {
      console.log('\nClosing connection...');
      await client.disconnect();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error:', error);
    await client.disconnect();
  }
}

main().catch(console.error);