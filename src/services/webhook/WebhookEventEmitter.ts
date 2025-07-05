import { EventEmitter } from 'events';
import { Webhook, WebhookEvent, WebhookEventType } from '../../models/webhook';
import { WebhookDelivery } from './WebhookDelivery';
import { WebhookSecurity } from './WebhookSecurity';
import {
  OrderCreatedData,
  OrderFilledData,
  OrderCancelledData,
  TradeExecutedData,
  SettlementCompletedData,
  SettlementClaimedData
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

interface EventPayloadMap {
  [WebhookEventType.ORDER_CREATED]: OrderCreatedData;
  [WebhookEventType.ORDER_FILLED]: OrderFilledData;
  [WebhookEventType.ORDER_CANCELLED]: OrderCancelledData;
  [WebhookEventType.TRADE_EXECUTED]: TradeExecutedData;
  [WebhookEventType.SETTLEMENT_COMPLETED]: SettlementCompletedData;
  [WebhookEventType.SETTLEMENT_CLAIMED]: SettlementClaimedData;
}

export class WebhookEventEmitter extends EventEmitter {
  private webhookDelivery: WebhookDelivery;
  private logger: Logger;
  private eventQueue: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_TIME = 100; // ms

  constructor(webhookDelivery: WebhookDelivery) {
    super();
    this.webhookDelivery = webhookDelivery;
    this.logger = new Logger('WebhookEventEmitter');
    this.setupEventListeners();
  }

  /**
   * Emit webhook event
   */
  async emitWebhookEvent<T extends WebhookEventType>(
    eventType: T,
    data: EventPayloadMap[T],
    options?: {
      userId?: string;
      debounce?: boolean;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const eventKey = `${eventType}:${JSON.stringify(data)}`;
      
      // Debounce rapid events
      if (options?.debounce) {
        if (this.eventQueue.has(eventKey)) {
          clearTimeout(this.eventQueue.get(eventKey)!);
        }

        const timeout = setTimeout(() => {
          this.eventQueue.delete(eventKey);
          this.processWebhookEvent(eventType, data, options).catch(err => {
            this.logger.error('Failed to process debounced webhook event', err);
          });
        }, this.DEBOUNCE_TIME);

        this.eventQueue.set(eventKey, timeout);
      } else {
        await this.processWebhookEvent(eventType, data, options);
      }
    } catch (error) {
      this.logger.error(`Failed to emit webhook event ${eventType}`, error);
      this.emit('webhook:emission-error', { eventType, error });
    }
  }

  /**
   * Process webhook event
   */
  private async processWebhookEvent<T extends WebhookEventType>(
    eventType: T,
    data: EventPayloadMap[T],
    options?: {
      userId?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    // Find all active webhooks that are subscribed to this event
    const whereClause: any = {
      status: 'active',
      events: { [Op.contains]: [eventType] }
    };

    if (options?.userId) {
      whereClause.userId = options.userId;
    }

    const webhooks = await Webhook.findAll({ where: whereClause });

    if (webhooks.length === 0) {
      this.logger.debug(`No active webhooks found for event ${eventType}`);
      return;
    }

    this.logger.info(`Found ${webhooks.length} webhooks for event ${eventType}`);

    // Create webhook events for each webhook
    const webhookEvents = await Promise.all(
      webhooks.map(async (webhook) => {
        try {
          // Generate unique event ID
          const eventId = WebhookSecurity.generateEventId(
            eventType,
            this.extractEntityId(eventType, data),
            Date.now()
          );

          // Create webhook event
          const webhookEvent = await WebhookEvent.create({
            webhookId: webhook.id,
            eventId,
            type: eventType,
            payload: data,
            signature: '', // Will be set during delivery
            attempts: 0,
            status: 'pending'
          });

          this.emit('webhook:event-created', {
            webhookId: webhook.id,
            eventId,
            eventType
          });

          return webhookEvent;
        } catch (error) {
          this.logger.error(`Failed to create webhook event for webhook ${webhook.id}`, error);
          return null;
        }
      })
    );

    // Filter out failed webhook event creations
    const validWebhookEvents = webhookEvents.filter(event => event !== null) as WebhookEvent[];

    // Queue webhook events for delivery
    if (validWebhookEvents.length > 0) {
      await this.webhookDelivery.bulkSendWebhooks(validWebhookEvents);
      
      this.emit('webhook:events-queued', {
        eventType,
        count: validWebhookEvents.length
      });
    }
  }

  /**
   * Extract entity ID from event data
   */
  private extractEntityId(eventType: WebhookEventType, data: any): string {
    switch (eventType) {
      case WebhookEventType.ORDER_CREATED:
      case WebhookEventType.ORDER_FILLED:
      case WebhookEventType.ORDER_CANCELLED:
        return data.orderId;
      case WebhookEventType.TRADE_EXECUTED:
        return data.tradeId;
      case WebhookEventType.SETTLEMENT_COMPLETED:
      case WebhookEventType.SETTLEMENT_CLAIMED:
        return data.settlementId;
      default:
        return 'unknown';
    }
  }

  /**
   * Setup event listeners for application events
   */
  private setupEventListeners(): void {
    // Order events
    this.on('order:created', async (order: any) => {
      const data: OrderCreatedData = {
        orderId: order.id,
        userId: order.userId,
        pair: order.pair,
        side: order.side,
        type: order.type,
        quantity: order.quantity.toString(),
        price: order.price?.toString(),
        status: order.status,
        createdAt: order.createdAt.toISOString()
      };

      await this.emitWebhookEvent(WebhookEventType.ORDER_CREATED, data, {
        userId: order.userId
      });
    });

    this.on('order:filled', async (order: any, fillData: any) => {
      const data: OrderFilledData = {
        orderId: order.id,
        userId: order.userId,
        pair: order.pair,
        side: order.side,
        filledQuantity: fillData.filledQuantity.toString(),
        remainingQuantity: fillData.remainingQuantity.toString(),
        averagePrice: fillData.averagePrice.toString(),
        totalValue: fillData.totalValue.toString(),
        fee: fillData.fee.toString(),
        status: fillData.status,
        filledAt: new Date().toISOString()
      };

      await this.emitWebhookEvent(WebhookEventType.ORDER_FILLED, data, {
        userId: order.userId
      });
    });

    this.on('order:cancelled', async (order: any, cancelData: any) => {
      const data: OrderCancelledData = {
        orderId: order.id,
        userId: order.userId,
        pair: order.pair,
        side: order.side,
        cancelledQuantity: cancelData.cancelledQuantity.toString(),
        reason: cancelData.reason,
        cancelledAt: new Date().toISOString()
      };

      await this.emitWebhookEvent(WebhookEventType.ORDER_CANCELLED, data, {
        userId: order.userId
      });
    });

    // Trade events
    this.on('trade:executed', async (trade: any) => {
      const data: TradeExecutedData = {
        tradeId: trade.id,
        orderId: trade.orderId,
        userId: trade.userId,
        counterpartyId: trade.counterpartyId,
        pair: trade.pair,
        side: trade.side,
        price: trade.price.toString(),
        quantity: trade.quantity.toString(),
        value: trade.value.toString(),
        fee: trade.fee.toString(),
        executedAt: trade.executedAt.toISOString()
      };

      // Emit for both parties
      await Promise.all([
        this.emitWebhookEvent(WebhookEventType.TRADE_EXECUTED, data, {
          userId: trade.userId
        }),
        this.emitWebhookEvent(WebhookEventType.TRADE_EXECUTED, {
          ...data,
          side: trade.side === 'BUY' ? 'SELL' : 'BUY'
        }, {
          userId: trade.counterpartyId
        })
      ]);
    });

    // Settlement events
    this.on('settlement:completed', async (settlement: any) => {
      const data: SettlementCompletedData = {
        settlementId: settlement.id,
        epochId: settlement.epochId,
        userCount: settlement.userCount,
        tradeCount: settlement.tradeCount,
        totalVolume: settlement.totalVolume.toString(),
        status: settlement.status,
        completedAt: settlement.completedAt.toISOString()
      };

      // Emit to all users who participated in the settlement
      const userIds = await this.getSettlementUserIds(settlement.id);
      await Promise.all(
        userIds.map(userId => 
          this.emitWebhookEvent(WebhookEventType.SETTLEMENT_COMPLETED, data, { userId })
        )
      );
    });

    this.on('settlement:claimed', async (claim: any) => {
      const data: SettlementClaimedData = {
        settlementId: claim.settlementId,
        userId: claim.userId,
        epochId: claim.epochId,
        tokens: claim.tokens.map((token: any) => ({
          token: token.token,
          amount: token.amount.toString(),
          direction: token.direction
        })),
        transactionHash: claim.transactionHash,
        claimedAt: claim.claimedAt.toISOString()
      };

      await this.emitWebhookEvent(WebhookEventType.SETTLEMENT_CLAIMED, data, {
        userId: claim.userId
      });
    });
  }

  /**
   * Get user IDs for a settlement
   */
  private async getSettlementUserIds(settlementId: string): Promise<string[]> {
    // This would query your settlement participants table
    // For now, returning empty array as placeholder
    return [];
  }

  /**
   * Retry failed webhook events
   */
  async retryFailedWebhooks(
    options?: {
      webhookId?: string;
      eventType?: WebhookEventType;
      since?: Date;
      limit?: number;
    }
  ): Promise<number> {
    const whereClause: any = {
      status: 'failed',
      attempts: { [Op.lt]: 5 } // Don't retry if already tried 5 times
    };

    if (options?.webhookId) {
      whereClause.webhookId = options.webhookId;
    }

    if (options?.eventType) {
      whereClause.type = options.eventType;
    }

    if (options?.since) {
      whereClause.createdAt = { [Op.gte]: options.since };
    }

    const failedEvents = await WebhookEvent.findAll({
      where: whereClause,
      limit: options?.limit || 100,
      include: [{
        model: Webhook,
        as: 'webhook',
        where: { status: 'active' }
      }]
    });

    // Reset status and queue for delivery
    for (const event of failedEvents) {
      await event.update({ status: 'pending', nextRetryAt: new Date() });
      await this.webhookDelivery.queueWebhookDelivery(event);
    }

    this.emit('webhook:retry-batch', {
      count: failedEvents.length,
      options
    });

    return failedEvents.length;
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(
    userId?: string,
    period?: { from: Date; to: Date }
  ): Promise<{
    totalWebhooks: number;
    activeWebhooks: number;
    totalEvents: number;
    deliveredEvents: number;
    failedEvents: number;
    pendingEvents: number;
    eventsByType: Record<WebhookEventType, number>;
    deliveryRate: number;
  }> {
    const webhookWhere: any = {};
    const eventWhere: any = {};

    if (userId) {
      webhookWhere.userId = userId;
    }

    if (period) {
      eventWhere.createdAt = {
        [Op.between]: [period.from, period.to]
      };
    }

    const [
      totalWebhooks,
      activeWebhooks,
      totalEvents,
      deliveredEvents,
      failedEvents,
      pendingEvents,
      eventsByType
    ] = await Promise.all([
      Webhook.count({ where: webhookWhere }),
      Webhook.count({ where: { ...webhookWhere, status: 'active' } }),
      WebhookEvent.count({ where: eventWhere }),
      WebhookEvent.count({ where: { ...eventWhere, status: 'delivered' } }),
      WebhookEvent.count({ where: { ...eventWhere, status: 'failed' } }),
      WebhookEvent.count({ where: { ...eventWhere, status: 'pending' } }),
      this.getEventCountByType(eventWhere)
    ]);

    const deliveryRate = totalEvents > 0 
      ? (deliveredEvents / totalEvents) * 100 
      : 0;

    return {
      totalWebhooks,
      activeWebhooks,
      totalEvents,
      deliveredEvents,
      failedEvents,
      pendingEvents,
      eventsByType,
      deliveryRate: Math.round(deliveryRate * 100) / 100
    };
  }

  /**
   * Get event count by type
   */
  private async getEventCountByType(
    where: any
  ): Promise<Record<WebhookEventType, number>> {
    const counts = await WebhookEvent.findAll({
      where,
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
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Clear any pending debounced events
    for (const timeout of this.eventQueue.values()) {
      clearTimeout(timeout);
    }
    this.eventQueue.clear();

    // Remove all listeners
    this.removeAllListeners();
  }
}