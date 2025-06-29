export { OrderBookDatabase } from './OrderBookDatabase';
export { RedisOrderBookStore } from './RedisOrderBookStore';
export { PostgresOrderHistoryStore } from './PostgresOrderHistoryStore';
export { OrderBookWebSocketServer as WebSocketServer } from './WebSocketServer';
export { PriceLevelIndex } from './PriceLevelIndex';
export { OrderExpirationManager } from './OrderExpirationManager';
export { ReplicationManager } from './ReplicationManager';
export { BackupManager } from './BackupManager';
export { OrderBookDatabaseConfig, defaultConfig } from './config';

// Re-export types from matching engine
export {
  Order,
  Trade,
  OrderBookSnapshot,
  OrderBookUpdate,
  ExecutionReport,
  OrderType,
  OrderSide,
  OrderStatus,
  TimeInForce,
  MarketData
} from '../matchingEngine/types';