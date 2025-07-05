import { RequestClient } from './utils/request';
import { OrdersAPI } from './api/orders';
import { OrderBookAPI } from './api/orderbook';
import { TradesAPI } from './api/trades';
import { SettlementsAPI } from './api/settlements';
import { WebSocketClient } from './websocket/client';
import { ClientOptions } from './types';

/**
 * Offchain Protocol SDK Client
 * 
 * @example
 * ```typescript
 * import { OffchainClient } from '@offchain-protocol/sdk';
 * 
 * const client = new OffchainClient('your-api-key', {
 *   testnet: true,
 *   websocketUrl: 'wss://ws.testnet.offchain.finance'
 * });
 * 
 * // Create an order
 * const order = await client.orders.create({
 *   pair: 'BTC/USDT',
 *   side: OrderSide.BUY,
 *   type: OrderType.LIMIT,
 *   quantity: '0.1',
 *   price: '45000'
 * });
 * 
 * // Subscribe to order updates
 * client.websocket.on(WebSocketEvent.ORDER_UPDATE, (order) => {
 *   console.log('Order updated:', order);
 * });
 * ```
 */
export class OffchainClient {
  public readonly orders: OrdersAPI;
  public readonly orderBook: OrderBookAPI;
  public readonly trades: TradesAPI;
  public readonly settlements: SettlementsAPI;
  public readonly websocket: WebSocketClient;

  private readonly requestClient: RequestClient;

  constructor(apiKey: string, options: ClientOptions = {}) {
    this.requestClient = new RequestClient(apiKey, options);
    
    // Initialize API modules
    this.orders = new OrdersAPI(this.requestClient);
    this.orderBook = new OrderBookAPI(this.requestClient);
    this.trades = new TradesAPI(this.requestClient);
    this.settlements = new SettlementsAPI(this.requestClient);
    
    // Initialize WebSocket client
    const wsUrl = options.websocketUrl || (
      options.testnet 
        ? 'wss://ws.testnet.offchain.finance'
        : 'wss://ws.offchain.finance'
    );
    
    this.websocket = new WebSocketClient(wsUrl, apiKey, {
      autoReconnect: true,
      reconnectInterval: 5000,
      heartbeatInterval: 30000,
      maxReconnectAttempts: 10
    });
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return this.websocket.connect();
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.websocket.disconnect();
  }

  /**
   * Get current rate limit info
   */
  getRateLimitInfo() {
    return this.requestClient.getRateLimitInfo();
  }
}

// Export all types
export * from './types';
export { WebSocketClient } from './websocket/client';

// Export default client
export default OffchainClient;