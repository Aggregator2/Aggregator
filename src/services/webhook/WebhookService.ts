import { Webhook, WebhookEvent, WebhookEventType, WebhookStatus } from '../../models/webhook';
import { WebhookDelivery } from './WebhookDelivery';
import { WebhookEventEmitter } from './WebhookEventEmitter';
import { WebhookSecurity } from './WebhookSecurity';
import {
  CreateWebhookRequest,
  UpdateWebhookRequest,
  TestWebhookResponse
} from '../../types/webhook';
import { Op } from 'sequelize';
import { logger } from '../../utils/logger';

class Logger {
  private context: string;
  constructor(context: string) { this.context = context; }
  error(message: string, error?: any): void {
    logger.error(`[${this.context}] ${message}`, error);
  }
  warn(message: string): void {
    logger.warn(`[${this.context}] ${message}`);
  }
  info(message: string): void {
    logger.info(`[${this.context}] ${message}`);
  }
  debug(message: string): void {
    logger.debug(`[${this.context}] ${message}`);
  }
}

export class WebhookService {
  private static instance: WebhookService;
  private webhookDelivery: WebhookDelivery;
  private webhookEventEmitter: WebhookEventEmitter;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('WebhookService');
    
    // Initialize delivery system
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    this.webhookDelivery = new WebhookDelivery(redisUrl);
    
    // Initialize event emitter
    this.webhookEventEmitter = new WebhookEventEmitter(this.webhookDelivery);
    
    this.setupEventHandlers();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): WebhookService {
    if (!WebhookService.instance) {
      WebhookService.instance = new WebhookService();
    }
    return WebhookService.instance;
  }

  /**
   * Get event emitter for application integration
   */
  getEventEmitter(): WebhookEventEmitter {
    return this.webhookEventEmitter;
  }

  /**
   * Create webhook
   */
  async createWebhook(
    userId: string,
    data: CreateWebhookRequest
  ): Promise<Webhook> {
    try {
      // Generate secure secret
      const secret = WebhookSecurity.generateSecret();

      // Create webhook
      const webhook = await Webhook.create({
        userId,
        url: data.url,
        secret,
        events: data.events,
        description: data.description,
        headers: data.headers,
        ipWhitelist: data.ipWhitelist,
        retryConfig: data.retryConfig,
        status: WebhookStatus.ACTIVE,
        failureCount: 0,
        successCount: 0
      });

      this.logger.info(`Created webhook ${webhook.id} for user ${userId}`);

      return webhook;
    } catch (error) {
      this.logger.error('Failed to create webhook', error);
      throw error;
    }
  }

  /**
   * List webhooks
   */
  async listWebhooks(
    userId: string,
    options?: {
      status?: WebhookStatus;
      event?: WebhookEventType;
      page?: number;
      limit?: number;
    }
  ): Promise<{ webhooks: Webhook[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const where: any = { userId };

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.event) {
      where.events = { [Op.contains]: [options.event] };
    }

    const { rows: webhooks, count: total } = await Webhook.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    return { webhooks, total };
  }

  /**
   * Get webhook by ID
   */
  async getWebhook(webhookId: string, userId: string): Promise<Webhook | null> {
    return Webhook.findOne({
      where: { id: webhookId, userId }
    });
  }

  /**
   * Update webhook
   */
  async updateWebhook(
    webhookId: string,
    userId: string,
    data: UpdateWebhookRequest
  ): Promise<Webhook | null> {
    const webhook = await this.getWebhook(webhookId, userId);
    
    if (!webhook) {
      return null;
    }

    // Update webhook
    await webhook.update({
      url: data.url || webhook.url,
      events: data.events || webhook.events,
      description: data.description !== undefined ? data.description : webhook.description,
      headers: data.headers !== undefined ? data.headers : webhook.headers,
      ipWhitelist: data.ipWhitelist !== undefined ? data.ipWhitelist : webhook.ipWhitelist,
      status: data.status || webhook.status,
      retryConfig: data.retryConfig ? { ...webhook.retryConfig, ...data.retryConfig } : webhook.retryConfig
    });

    this.logger.info(`Updated webhook ${webhookId}`);

    return webhook;
  }

  /**
   * Delete webhook
   */
  async deleteWebhook(webhookId: string, userId: string): Promise<boolean> {
    const webhook = await this.getWebhook(webhookId, userId);
    
    if (!webhook) {
      return false;
    }

    // Delete associated events
    await WebhookEvent.destroy({
      where: { webhookId }
    });

    // Delete webhook
    await webhook.destroy();

    this.logger.info(`Deleted webhook ${webhookId}`);

    return true;
  }

  /**
   * Test webhook
   */
  async testWebhook(
    webhookId: string,
    userId: string,
    eventType: WebhookEventType,
    customData?: any
  ): Promise<TestWebhookResponse | null> {
    const webhook = await this.getWebhook(webhookId, userId);
    
    if (!webhook || !webhook.events.includes(eventType)) {
      return null;
    }

    const startTime = Date.now();

    try {
      // Create test payload
      const testData = customData || this.generateTestData(eventType);
      
      // Generate event ID
      const eventId = WebhookSecurity.generateEventId(
        eventType,
        'test',
        Date.now()
      );

      // Create test webhook event
      const webhookEvent = await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: `test_${eventId}`,
        type: eventType,
        payload: testData,
        signature: '',
        attempts: 0,
        status: 'pending'
      });

      // Deliver immediately for testing
      await this.webhookDelivery.queueWebhookDelivery(webhookEvent, 0);

      // Wait for delivery (with timeout)
      const deliveryResult = await this.waitForDelivery(webhookEvent.id, 30000);

      const duration = Date.now() - startTime;

      if (deliveryResult) {
        return {
          success: deliveryResult.status === 'delivered',
          statusCode: deliveryResult.responseStatus,
          headers: {
            'X-Webhook-Event-ID': webhookEvent.eventId,
            'X-Test-Event': 'true'
          },
          body: deliveryResult.responseBody,
          error: deliveryResult.error,
          duration
        };
      } else {
        return {
          success: false,
          error: 'Delivery timeout',
          duration
        };
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to test webhook', error);
      
      return {
        success: false,
        error: error.message,
        duration
      };
    }
  }

  /**
   * Get webhook events
   */
  async getWebhookEvents(
    webhookId: string,
    options?: {
      status?: 'pending' | 'delivered' | 'failed';
      from?: Date;
      to?: Date;
      page?: number;
      limit?: number;
    }
  ): Promise<{ events: WebhookEvent[]; total: number }> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const offset = (page - 1) * limit;

    const where: any = { webhookId };

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.from || options?.to) {
      where.createdAt = {};
      if (options.from) {
        where.createdAt[Op.gte] = options.from;
      }
      if (options.to) {
        where.createdAt[Op.lte] = options.to;
      }
    }

    const { rows: events, count: total } = await WebhookEvent.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    return { events, total };
  }

  /**
   * Regenerate webhook secret
   */
  async regenerateSecret(webhookId: string, userId: string): Promise<string | null> {
    const webhook = await this.getWebhook(webhookId, userId);
    
    if (!webhook) {
      return null;
    }

    const newSecret = WebhookSecurity.generateSecret();
    await webhook.update({ secret: newSecret });

    this.logger.info(`Regenerated secret for webhook ${webhookId}`);

    return newSecret;
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStatistics(webhookId: string): Promise<{
    totalEvents: number;
    deliveredEvents: number;
    failedEvents: number;
    pendingEvents: number;
    averageDeliveryTime: number;
    successRate: number;
    eventsByType: Record<WebhookEventType, number>;
    recentDeliveries: WebhookEvent[];
  }> {
    const [
      totalEvents,
      deliveredEvents,
      failedEvents,
      pendingEvents,
      averageDeliveryTime,
      eventsByType,
      recentDeliveries
    ] = await Promise.all([
      WebhookEvent.count({ where: { webhookId } }),
      WebhookEvent.count({ where: { webhookId, status: 'delivered' } }),
      WebhookEvent.count({ where: { webhookId, status: 'failed' } }),
      WebhookEvent.count({ where: { webhookId, status: 'pending' } }),
      this.getAverageDeliveryTime(webhookId),
      this.getEventsByType(webhookId),
      this.getRecentDeliveries(webhookId, 10)
    ]);

    const successRate = totalEvents > 0 
      ? (deliveredEvents / totalEvents) * 100 
      : 0;

    return {
      totalEvents,
      deliveredEvents,
      failedEvents,
      pendingEvents,
      averageDeliveryTime,
      successRate: Math.round(successRate * 100) / 100,
      eventsByType,
      recentDeliveries
    };
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Handle delivery events
    this.webhookDelivery.on('delivery:completed', async ({ webhookEventId }) => {
      this.logger.debug(`Webhook delivery completed: ${webhookEventId}`);
    });

    this.webhookDelivery.on('delivery:failed', async ({ webhookEventId, error }) => {
      this.logger.error(`Webhook delivery failed: ${webhookEventId}`, error);
    });

    this.webhookDelivery.on('webhook:dead-letter', async ({ eventId, webhookId }) => {
      this.logger.error(`Webhook moved to dead letter queue: ${eventId}`);
      
      // Notify webhook owner
      const webhook = await Webhook.findByPk(webhookId);
      if (webhook) {
        // You could send an email or notification here
        this.logger.info(`Notifying user ${webhook.userId} about failed webhook ${webhookId}`);
      }
    });

    this.webhookDelivery.on('webhook:auto-disabled', async ({ webhookId, reason }) => {
      this.logger.warn(`Webhook auto-disabled: ${webhookId}, reason: ${reason}`);
    });

    // Handle event emitter events
    this.webhookEventEmitter.on('webhook:emission-error', ({ eventType, error }) => {
      this.logger.error(`Failed to emit webhook event ${eventType}`, error);
    });
  }

  /**
   * Generate test data for event type
   */
  private generateTestData(eventType: WebhookEventType): any {
    const timestamp = new Date().toISOString();
    
    switch (eventType) {
      case WebhookEventType.ORDER_CREATED:
        return {
          orderId: 'test_order_' + Date.now(),
          userId: 'test_user',
          pair: 'ETH/USDC',
          side: 'BUY',
          type: 'LIMIT',
          quantity: '1.5',
          price: '2000',
          status: 'OPEN',
          createdAt: timestamp
        };

      case WebhookEventType.ORDER_FILLED:
        return {
          orderId: 'test_order_' + Date.now(),
          userId: 'test_user',
          pair: 'ETH/USDC',
          side: 'BUY',
          filledQuantity: '1.5',
          remainingQuantity: '0',
          averagePrice: '2000',
          totalValue: '3000',
          fee: '3',
          status: 'FILLED',
          filledAt: timestamp
        };

      case WebhookEventType.TRADE_EXECUTED:
        return {
          tradeId: 'test_trade_' + Date.now(),
          orderId: 'test_order_' + Date.now(),
          userId: 'test_user',
          counterpartyId: 'test_counterparty',
          pair: 'ETH/USDC',
          side: 'BUY',
          price: '2000',
          quantity: '1.5',
          value: '3000',
          fee: '3',
          executedAt: timestamp
        };

      case WebhookEventType.SETTLEMENT_COMPLETED:
        return {
          settlementId: 'test_settlement_' + Date.now(),
          epochId: 'test_epoch_' + Date.now(),
          userCount: 100,
          tradeCount: 500,
          totalVolume: '1000000',
          status: 'COMPLETED',
          completedAt: timestamp
        };

      case WebhookEventType.SETTLEMENT_CLAIMED:
        return {
          settlementId: 'test_settlement_' + Date.now(),
          userId: 'test_user',
          epochId: 'test_epoch_' + Date.now(),
          tokens: [
            { token: 'USDC', amount: '1000', direction: 'CREDIT' },
            { token: 'ETH', amount: '0.5', direction: 'DEBIT' }
          ],
          transactionHash: '0x' + '0'.repeat(64),
          claimedAt: timestamp
        };

      default:
        return { test: true, timestamp };
    }
  }

  /**
   * Wait for webhook delivery
   */
  private async waitForDelivery(
    webhookEventId: string,
    timeout: number
  ): Promise<WebhookEvent | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const event = await WebhookEvent.findByPk(webhookEventId);
      
      if (event && (event.status === 'delivered' || event.status === 'failed')) {
        return event;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return null;
  }

  /**
   * Get average delivery time
   */
  private async getAverageDeliveryTime(webhookId: string): Promise<number> {
    const deliveredEvents = await WebhookEvent.findAll({
      where: {
        webhookId,
        status: 'delivered',
        deliveredAt: { [Op.ne]: null }
      },
      attributes: ['createdAt', 'deliveredAt'],
      limit: 100,
      order: [['createdAt', 'DESC']]
    });

    if (deliveredEvents.length === 0) {
      return 0;
    }

    const totalTime = deliveredEvents.reduce((sum, event) => {
      const deliveryTime = event.deliveredAt!.getTime() - event.createdAt.getTime();
      return sum + deliveryTime;
    }, 0);

    return Math.round(totalTime / deliveredEvents.length);
  }

  /**
   * Get events by type
   */
  private async getEventsByType(
    webhookId: string
  ): Promise<Record<WebhookEventType, number>> {
    const counts = await WebhookEvent.findAll({
      where: { webhookId },
      attributes: [
        'type',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
      ],
      group: ['type'],
      raw: true
    }) as any[];

    const result: Record<string, number> = {};
    for (const eventType of Object.values(WebhookEventType)) {
      result[eventType] = 0;
    }

    for (const row of counts) {
      result[row.type] = parseInt(row.count, 10);
    }

    return result as Record<WebhookEventType, number>;
  }

  /**
   * Get recent deliveries
   */
  private async getRecentDeliveries(
    webhookId: string,
    limit: number
  ): Promise<WebhookEvent[]> {
    return WebhookEvent.findAll({
      where: { webhookId },
      limit,
      order: [['createdAt', 'DESC']]
    });
  }

  /**
   * Cleanup old events
   */
  async cleanupOldEvents(daysToKeep: number = 30): Promise<number> {
    return this.webhookDelivery.cleanupOldEvents(daysToKeep);
  }

  /**
   * Get delivery queue statistics
   */
  async getQueueStatistics() {
    return this.webhookDelivery.getQueueStats();
  }

  /**
   * Shutdown service
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down webhook service...');
    
    await Promise.all([
      this.webhookDelivery.close(),
      this.webhookEventEmitter.cleanup()
    ]);
    
    this.logger.info('Webhook service shut down');
  }
}