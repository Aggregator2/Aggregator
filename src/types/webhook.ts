import { WebhookEventType } from '../models/webhook';

// Webhook API Types
export interface CreateWebhookRequest {
  url: string;
  events: WebhookEventType[];
  description?: string;
  headers?: Record<string, string>;
  ipWhitelist?: string[];
  retryConfig?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    timeout?: number;
  };
}

export interface UpdateWebhookRequest {
  url?: string;
  events?: WebhookEventType[];
  description?: string;
  headers?: Record<string, string>;
  ipWhitelist?: string[];
  status?: 'active' | 'inactive';
  retryConfig?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    timeout?: number;
  };
}

export interface WebhookResponse {
  id: string;
  url: string;
  events: WebhookEventType[];
  status: string;
  description?: string;
  headers?: Record<string, string>;
  ipWhitelist?: string[];
  retryConfig: {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
    timeout: number;
  };
  stats: {
    lastTriggeredAt?: string;
    failureCount: number;
    successCount: number;
    successRate: number;
  };
  createdAt: string;
  updatedAt: string;
}

// Webhook Event Payload Types
export interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: any;
  signature: string;
  api_version: string;
}

// Event-specific data types
export interface OrderCreatedData {
  orderId: string;
  userId: string;
  pair: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  quantity: string;
  price?: string;
  status: string;
  createdAt: string;
}

export interface OrderFilledData {
  orderId: string;
  userId: string;
  pair: string;
  side: 'BUY' | 'SELL';
  filledQuantity: string;
  remainingQuantity: string;
  averagePrice: string;
  totalValue: string;
  fee: string;
  status: 'PARTIALLY_FILLED' | 'FILLED';
  filledAt: string;
}

export interface OrderCancelledData {
  orderId: string;
  userId: string;
  pair: string;
  side: 'BUY' | 'SELL';
  cancelledQuantity: string;
  reason: string;
  cancelledAt: string;
}

export interface TradeExecutedData {
  tradeId: string;
  orderId: string;
  userId: string;
  counterpartyId: string;
  pair: string;
  side: 'BUY' | 'SELL';
  price: string;
  quantity: string;
  value: string;
  fee: string;
  executedAt: string;
}

export interface SettlementCompletedData {
  settlementId: string;
  epochId: string;
  userCount: number;
  tradeCount: number;
  totalVolume: string;
  status: 'COMPLETED' | 'FAILED';
  completedAt: string;
}

export interface SettlementClaimedData {
  settlementId: string;
  userId: string;
  epochId: string;
  tokens: Array<{
    token: string;
    amount: string;
    direction: 'CREDIT' | 'DEBIT';
  }>;
  transactionHash: string;
  claimedAt: string;
}

// Webhook delivery types
export interface WebhookDeliveryAttempt {
  attemptNumber: number;
  timestamp: string;
  status: 'success' | 'failed';
  statusCode?: number;
  error?: string;
  duration: number;
}

export interface WebhookDeliveryLog {
  eventId: string;
  webhookId: string;
  type: WebhookEventType;
  attempts: WebhookDeliveryAttempt[];
  finalStatus: 'delivered' | 'failed' | 'pending';
  nextRetryAt?: string;
}

// Webhook signature types
export interface WebhookSignatureConfig {
  algorithm: 'sha256';
  encoding: 'hex';
  header: 'X-Webhook-Signature';
  timestampHeader: 'X-Webhook-Timestamp';
  tolerance: number; // seconds
}

// Test webhook types
export interface TestWebhookRequest {
  eventType: WebhookEventType;
  data?: any;
}

export interface TestWebhookResponse {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
  duration: number;
}