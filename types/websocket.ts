/**
 * WebSocket message type definitions
 */

// ==================== BASE WEBSOCKET TYPES ====================

export interface WebSocketMessage<T = any> {
  id: string;
  type: MessageType;
  channel?: string;
  data: T;
  timestamp: Date;
}

export enum MessageType {
  // Connection messages
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  PING = 'ping',
  PONG = 'pong',
  ERROR = 'error',
  
  // Subscription messages
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  SUBSCRIPTION_SUCCESS = 'subscription_success',
  SUBSCRIPTION_ERROR = 'subscription_error',
  
  // Data messages
  SNAPSHOT = 'snapshot',
  UPDATE = 'update',
  
  // Order messages
  ORDER_CREATED = 'order_created',
  ORDER_UPDATED = 'order_updated',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_FILLED = 'order_filled',
  ORDER_PARTIALLY_FILLED = 'order_partially_filled',
  ORDER_FAILED = 'order_failed',
  
  // Trade messages
  TRADE_EXECUTED = 'trade_executed',
  
  // Market data messages
  TICKER = 'ticker',
  ORDERBOOK = 'orderbook',
  CANDLE = 'candle',
  
  // System messages
  MAINTENANCE = 'maintenance',
  ANNOUNCEMENT = 'announcement'
}

// ==================== CONNECTION MESSAGES ====================

export interface ConnectMessage {
  type: MessageType.CONNECT;
  data: {
    clientId?: string;
    version: string;
    auth?: AuthData;
  };
}

export interface AuthData {
  token?: string;
  apiKey?: string;
  signature?: string;
  timestamp?: number;
}

export interface DisconnectMessage {
  type: MessageType.DISCONNECT;
  data: {
    reason: string;
    code: number;
    reconnect?: boolean;
  };
}

export interface PingMessage {
  type: MessageType.PING;
  data: {
    timestamp: number;
  };
}

export interface PongMessage {
  type: MessageType.PONG;
  data: {
    timestamp: number;
  };
}

export interface ErrorMessage {
  type: MessageType.ERROR;
  data: {
    code: string;
    message: string;
    details?: any;
    channel?: string;
    requestId?: string;
  };
}

// ==================== SUBSCRIPTION MESSAGES ====================

export interface SubscribeMessage {
  type: MessageType.SUBSCRIBE;
  data: {
    channels: ChannelSubscription[];
  };
}

export interface UnsubscribeMessage {
  type: MessageType.UNSUBSCRIBE;
  data: {
    channels: string[];
  };
}

export interface ChannelSubscription {
  channel: string;
  params?: any;
}

export interface SubscriptionSuccessMessage {
  type: MessageType.SUBSCRIPTION_SUCCESS;
  data: {
    channel: string;
    subscriptionId: string;
  };
}

export interface SubscriptionErrorMessage {
  type: MessageType.SUBSCRIPTION_ERROR;
  data: {
    channel: string;
    error: string;
    code: string;
  };
}

// ==================== CHANNEL TYPES ====================

export enum Channel {
  TICKER = 'ticker',
  ORDERBOOK = 'orderbook',
  TRADES = 'trades',
  CANDLES = 'candles',
  ORDERS = 'orders',
  USER_TRADES = 'user_trades',
  BALANCES = 'balances',
  NOTIFICATIONS = 'notifications'
}

export interface TickerChannel {
  channel: Channel.TICKER;
  params: {
    symbols: string[]; // e.g., ['ETH-USDT', 'BTC-USDT']
  };
}

export interface OrderBookChannel {
  channel: Channel.ORDERBOOK;
  params: {
    symbol: string;
    depth?: number;
    aggregation?: number;
    updateSpeed?: 'realtime' | 'fast' | 'normal';
  };
}

export interface TradesChannel {
  channel: Channel.TRADES;
  params: {
    symbol: string;
    limit?: number;
  };
}

export interface CandlesChannel {
  channel: Channel.CANDLES;
  params: {
    symbol: string;
    interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
  };
}

export interface OrdersChannel {
  channel: Channel.ORDERS;
  params: {
    userId: string;
    symbols?: string[];
  };
}

// ==================== DATA MESSAGES ====================

export interface TickerMessage {
  type: MessageType.TICKER;
  channel: Channel.TICKER;
  data: {
    symbol: string;
    lastPrice: number;
    bidPrice: number;
    askPrice: number;
    volume24h: string;
    high24h: number;
    low24h: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    timestamp: Date;
  };
}

export interface OrderBookMessage {
  type: MessageType.ORDERBOOK;
  channel: Channel.ORDERBOOK;
  data: {
    symbol: string;
    bids: [number, string][]; // [price, amount]
    asks: [number, string][];
    sequence: number;
    timestamp: Date;
  };
}

export interface OrderBookUpdateMessage {
  type: MessageType.UPDATE;
  channel: Channel.ORDERBOOK;
  data: {
    symbol: string;
    bids: OrderBookDelta[];
    asks: OrderBookDelta[];
    sequence: number;
    timestamp: Date;
  };
}

export interface OrderBookDelta {
  price: number;
  amount: string;
  action: 'add' | 'update' | 'remove';
}

export interface TradeMessage {
  type: MessageType.TRADE_EXECUTED;
  channel: Channel.TRADES;
  data: {
    id: string;
    symbol: string;
    price: number;
    amount: string;
    side: 'buy' | 'sell';
    timestamp: Date;
    maker?: boolean;
  };
}

export interface CandleMessage {
  type: MessageType.CANDLE;
  channel: Channel.CANDLES;
  data: {
    symbol: string;
    interval: string;
    timestamp: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: string;
    trades: number;
    final: boolean;
  };
}

// ==================== ORDER MESSAGES ====================

export interface OrderUpdateMessage {
  type: MessageType.ORDER_CREATED | 
        MessageType.ORDER_UPDATED | 
        MessageType.ORDER_CANCELLED |
        MessageType.ORDER_FILLED |
        MessageType.ORDER_PARTIALLY_FILLED |
        MessageType.ORDER_FAILED;
  channel: Channel.ORDERS;
  data: {
    orderId: string;
    clientOrderId?: string;
    userId: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    status: string;
    price?: number;
    amount: string;
    filled: string;
    remaining: string;
    timestamp: Date;
    reason?: string; // For cancelled/failed orders
  };
}

// ==================== USER MESSAGES ====================

export interface UserTradeMessage {
  type: MessageType.TRADE_EXECUTED;
  channel: Channel.USER_TRADES;
  data: {
    tradeId: string;
    orderId: string;
    userId: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: number;
    amount: string;
    fee: {
      amount: string;
      currency: string;
    };
    timestamp: Date;
    role: 'maker' | 'taker';
  };
}

export interface BalanceUpdateMessage {
  type: MessageType.UPDATE;
  channel: Channel.BALANCES;
  data: {
    userId: string;
    balances: Balance[];
    timestamp: Date;
  };
}

export interface Balance {
  currency: string;
  available: string;
  locked: string;
  total: string;
}

export interface NotificationMessage {
  type: MessageType.UPDATE;
  channel: Channel.NOTIFICATIONS;
  data: {
    id: string;
    userId: string;
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    message: string;
    timestamp: Date;
    data?: any;
  };
}

// ==================== SYSTEM MESSAGES ====================

export interface MaintenanceMessage {
  type: MessageType.MAINTENANCE;
  data: {
    startTime: Date;
    endTime?: Date;
    message: string;
    affectedServices?: string[];
  };
}

export interface AnnouncementMessage {
  type: MessageType.ANNOUNCEMENT;
  data: {
    id: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    link?: string;
    timestamp: Date;
  };
}

// ==================== CONNECTION STATE ====================

export enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  AUTHENTICATED = 'authenticated',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

export interface WebSocketConfig {
  url: string;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  pingInterval?: number;
  pongTimeout?: number;
  auth?: AuthData;
}

// ==================== TYPE GUARDS ====================

export function isTickerMessage(msg: WebSocketMessage): msg is WebSocketMessage<TickerMessage['data']> {
  return msg.type === MessageType.TICKER;
}

export function isOrderBookMessage(msg: WebSocketMessage): msg is WebSocketMessage<OrderBookMessage['data']> {
  return msg.type === MessageType.ORDERBOOK;
}

export function isTradeMessage(msg: WebSocketMessage): msg is WebSocketMessage<TradeMessage['data']> {
  return msg.type === MessageType.TRADE_EXECUTED;
}

export function isOrderUpdateMessage(msg: WebSocketMessage): msg is WebSocketMessage<OrderUpdateMessage['data']> {
  return [
    MessageType.ORDER_CREATED,
    MessageType.ORDER_UPDATED,
    MessageType.ORDER_CANCELLED,
    MessageType.ORDER_FILLED,
    MessageType.ORDER_PARTIALLY_FILLED,
    MessageType.ORDER_FAILED
  ].includes(msg.type);
}

export function isErrorMessage(msg: WebSocketMessage): msg is WebSocketMessage<ErrorMessage['data']> {
  return msg.type === MessageType.ERROR;
}