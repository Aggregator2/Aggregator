// Notification types and interfaces

export enum NotificationChannel {
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  WEBSOCKET = 'websocket',
  SMS = 'sms'
}

export enum NotificationType {
  ORDER = 'order',
  TRADE = 'trade',
  SETTLEMENT = 'settlement',
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  SYSTEM = 'system',
  PRICE_ALERT = 'price_alert',
  ORDER_FILLED = 'order_filled',
  ORDER_PARTIALLY_FILLED = 'order_partially_filled',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_FAILED = 'order_failed',
  TRADE_EXECUTED = 'trade_executed',
  SETTLEMENT_INITIATED = 'settlement_initiated',
  SETTLEMENT_COMPLETED = 'settlement_completed',
  SETTLEMENT_FAILED = 'settlement_failed',
  SYSTEM_MAINTENANCE = 'system_maintenance'
}

export enum NotificationEvent {
  // Order events
  ORDER_CREATED = 'order_created',
  ORDER_FILLED = 'order_filled',
  ORDER_PARTIALLY_FILLED = 'order_partially_filled',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_REJECTED = 'order_rejected',
  ORDER_FAILED = 'order_failed',
  
  // Trade events
  TRADE_EXECUTED = 'trade_executed',
  
  // Settlement events
  SETTLEMENT_INITIATED = 'settlement_initiated',
  SETTLEMENT_COMPLETED = 'settlement_completed',
  SETTLEMENT_FAILED = 'settlement_failed',
  
  // Price alerts
  PRICE_ALERT = 'price_alert',
  
  // Financial events
  DEPOSIT_RECEIVED = 'deposit_received',
  WITHDRAWAL_COMPLETED = 'withdrawal_completed',
  
  // System events
  SYSTEM_MAINTENANCE = 'system_maintenance',
  SYSTEM_UPDATE = 'system_update'
}

export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum NotificationStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

export enum DeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  RETRYING = 'retrying'
}

export interface NotificationPreferences {
  id: string;
  userId: string;
  channel: NotificationChannel;
  enabled: boolean;
  
  // Email preferences
  emailAddress?: string;
  emailVerified?: boolean;
  
  // Webhook preferences
  webhookUrl?: string;
  webhookSecret?: string;
  webhookActive?: boolean;
  
  // SMS preferences
  phoneNumber?: string;
  phoneVerified?: boolean;
  
  // Event subscriptions
  orderCreated: boolean;
  orderFilled: boolean;
  orderPartiallyFilled: boolean;
  orderCancelled: boolean;
  orderRejected: boolean;
  tradeExecuted: boolean;
  settlementCompleted: boolean;
  depositReceived: boolean;
  withdrawalCompleted: boolean;
  
  // Delivery preferences
  batchNotifications: boolean;
  batchIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  event: NotificationEvent;
  title: string;
  message: string;
  data?: any;
  
  // Status
  read: boolean;
  readAt?: Date;
  archived: boolean;
  
  // Delivery
  channels: NotificationChannel[];
  deliveryStatus: Record<NotificationChannel, DeliveryStatus>;
  
  // Metadata
  priority: NotificationPriority;
  groupId?: string;
  createdAt: Date;
  expiresAt?: Date;
}

export interface NotificationData {
  // Order notification data
  orderId?: string;
  orderType?: 'market' | 'limit' | 'stop';
  side?: 'buy' | 'sell';
  symbol?: string;
  quantity?: string;
  price?: string;
  filledQuantity?: string;
  status?: string;
  
  // Trade notification data
  tradeId?: string;
  executionPrice?: string;
  fees?: string;
  
  // Settlement notification data
  epochId?: string;
  settlementAmount?: string;
  currency?: string;
  
  // Financial notification data
  transactionId?: string;
  amount?: string;
  txHash?: string;
  confirmations?: number;
  
  // Custom data
  [key: string]: any;
}

export interface WebhookDelivery {
  id: string;
  notificationId: string;
  userId: string;
  webhookUrl: string;
  attemptNumber: number;
  status: 'pending' | 'success' | 'failed' | 'abandoned';
  statusCode?: number;
  responseBody?: string;
  errorMessage?: string;
  scheduledAt: Date;
  attemptedAt?: Date;
  nextRetryAt?: Date;
  createdAt: Date;
}

export interface NotificationTemplate {
  id: string;
  type: NotificationType;
  event: NotificationEvent;
  channel: NotificationChannel;
  titleTemplate: string;
  messageTemplate: string;
  dataSchema?: any;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  event: NotificationEvent;
  title: string;
  message: string;
  data?: NotificationData;
  priority?: NotificationPriority;
  groupId?: string;
  expiresAt?: Date;
}

export interface UpdateNotificationInput {
  read?: boolean;
  archived?: boolean;
}

export interface NotificationFilter {
  userId?: string;
  type?: NotificationType;
  event?: NotificationEvent;
  read?: boolean;
  archived?: boolean;
  priority?: NotificationPriority;
  groupId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface WebhookPayload {
  id: string;
  timestamp: Date;
  type: NotificationType;
  event: NotificationEvent;
  data: NotificationData;
  signature?: string;
}

export interface NotificationStats {
  totalCount: number;
  unreadCount: number;
  byType: Record<NotificationType, number>;
  byPriority: Record<NotificationPriority, number>;
}

// WebSocket event types
export interface NotificationWebSocketEvent {
  type: 'notification:new' | 'notification:update' | 'notification:delete';
  notification: Notification;
  timestamp: Date;
}

export interface NotificationBatch {
  userId: string;
  notifications: Notification[];
  createdAt: Date;
  scheduledFor: Date;
}

// Additional interfaces for webhook handling
export interface WebhookConfig {
  id: string;
  userId: string;
  url: string;
  secret?: string;
  active: boolean;
  events: NotificationEvent[];
  headers?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationPayload {
  notification: Notification;
  timestamp: string;
}

export interface NotificationDelivery {
  id: string;
  notificationId: string;
  channel: NotificationChannel;
  status: DeliveryStatus;
  attempts?: number;
  lastAttemptAt?: Date;
  nextRetryAt?: Date;
  deliveredAt?: Date;
  error?: string;
}