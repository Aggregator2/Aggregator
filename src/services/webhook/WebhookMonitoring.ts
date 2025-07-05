import { EventEmitter } from 'events';
import { Webhook, WebhookEvent, WebhookEventType } from '../../models/webhook';
import { WebhookService } from './WebhookService';
import { logger } from '../../utils/logger';
import { Op } from 'sequelize';
import * as prometheus from 'prom-client';

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

export class WebhookMonitoring extends EventEmitter {
  private logger: Logger;
  private webhookService: WebhookService;
  private monitoringInterval: NodeJS.Timer | null = null;
  private alertThresholds: {
    failureRate: number;
    responseTime: number;
    queueSize: number;
  };

  // Prometheus metrics
  private metrics = {
    webhookDeliveryTotal: new prometheus.Counter({
      name: 'webhook_delivery_total',
      help: 'Total number of webhook deliveries',
      labelNames: ['event_type', 'status']
    }),
    webhookDeliveryDuration: new prometheus.Histogram({
      name: 'webhook_delivery_duration_seconds',
      help: 'Webhook delivery duration in seconds',
      labelNames: ['event_type'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    }),
    webhookQueueSize: new prometheus.Gauge({
      name: 'webhook_queue_size',
      help: 'Current size of webhook delivery queue',
      labelNames: ['queue_type']
    }),
    webhookActiveCount: new prometheus.Gauge({
      name: 'webhook_active_count',
      help: 'Number of active webhooks',
      labelNames: ['event_type']
    }),
    webhookFailureRate: new prometheus.Gauge({
      name: 'webhook_failure_rate',
      help: 'Current webhook failure rate',
      labelNames: ['webhook_id']
    })
  };

  constructor(webhookService: WebhookService) {
    super();
    this.logger = new Logger('WebhookMonitoring');
    this.webhookService = webhookService;
    this.alertThresholds = {
      failureRate: 0.1, // 10%
      responseTime: 5000, // 5 seconds
      queueSize: 1000 // 1000 queued events
    };

    this.setupMetricsCollection();
  }

  /**
   * Start monitoring
   */
  start(intervalMs: number = 60000): void {
    if (this.monitoringInterval) {
      this.stop();
    }

    this.logger.info(`Starting webhook monitoring with interval ${intervalMs}ms`);

    this.monitoringInterval = setInterval(() => {
      this.performHealthChecks().catch(error => {
        this.logger.error('Health check failed', error);
      });
    }, intervalMs);

    // Perform initial check
    this.performHealthChecks().catch(error => {
      this.logger.error('Initial health check failed', error);
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.logger.info('Stopped webhook monitoring');
    }
  }

  /**
   * Perform health checks
   */
  private async performHealthChecks(): Promise<void> {
    const checks = await Promise.allSettled([
      this.checkWebhookHealth(),
      this.checkQueueHealth(),
      this.checkDeliveryPerformance(),
      this.updateMetrics()
    ]);

    const failedChecks = checks.filter(result => result.status === 'rejected');
    if (failedChecks.length > 0) {
      this.emit('monitoring:health-check-failed', {
        failedCount: failedChecks.length,
        totalCount: checks.length
      });
    }
  }

  /**
   * Check webhook health
   */
  private async checkWebhookHealth(): Promise<void> {
    const unhealthyWebhooks = await Webhook.findAll({
      where: {
        status: 'active',
        [Op.or]: [
          {
            failureCount: {
              [Op.gt]: require('sequelize').literal('success_count * 2')
            }
          },
          {
            lastTriggeredAt: {
              [Op.lt]: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days
            }
          }
        ]
      }
    });

    if (unhealthyWebhooks.length > 0) {
      this.logger.warn(`Found ${unhealthyWebhooks.length} unhealthy webhooks`);
      
      for (const webhook of unhealthyWebhooks) {
        const failureRate = webhook.failureCount / (webhook.failureCount + webhook.successCount);
        
        if (failureRate > this.alertThresholds.failureRate) {
          this.emit('webhook:high-failure-rate', {
            webhookId: webhook.id,
            userId: webhook.userId,
            failureRate,
            failureCount: webhook.failureCount,
            successCount: webhook.successCount
          });
        }
      }
    }
  }

  /**
   * Check queue health
   */
  private async checkQueueHealth(): Promise<void> {
    const queueStats = await this.webhookService.getQueueStatistics();
    
    const totalQueued = queueStats.delivery.waiting + queueStats.delivery.delayed;
    
    if (totalQueued > this.alertThresholds.queueSize) {
      this.emit('queue:high-backlog', {
        queuedCount: totalQueued,
        threshold: this.alertThresholds.queueSize,
        stats: queueStats
      });
    }

    if (queueStats.deadLetter.waiting > 0) {
      this.emit('queue:dead-letter-items', {
        count: queueStats.deadLetter.waiting
      });
    }

    // Update metrics
    this.metrics.webhookQueueSize.set({ queue_type: 'delivery' }, totalQueued);
    this.metrics.webhookQueueSize.set({ queue_type: 'dead_letter' }, queueStats.deadLetter.waiting);
  }

  /**
   * Check delivery performance
   */
  private async checkDeliveryPerformance(): Promise<void> {
    const recentEvents = await WebhookEvent.findAll({
      where: {
        status: 'delivered',
        deliveredAt: {
          [Op.gte]: new Date(Date.now() - 60 * 60 * 1000) // Last hour
        }
      },
      attributes: ['createdAt', 'deliveredAt', 'type'],
      limit: 1000
    });

    const performanceByType: Record<string, { count: number; totalTime: number; maxTime: number }> = {};

    for (const event of recentEvents) {
      const deliveryTime = event.deliveredAt!.getTime() - event.createdAt.getTime();
      
      if (!performanceByType[event.type]) {
        performanceByType[event.type] = { count: 0, totalTime: 0, maxTime: 0 };
      }

      performanceByType[event.type].count++;
      performanceByType[event.type].totalTime += deliveryTime;
      performanceByType[event.type].maxTime = Math.max(performanceByType[event.type].maxTime, deliveryTime);
    }

    for (const [eventType, stats] of Object.entries(performanceByType)) {
      const avgTime = stats.totalTime / stats.count;
      
      if (avgTime > this.alertThresholds.responseTime) {
        this.emit('delivery:slow-performance', {
          eventType,
          averageTime: avgTime,
          maxTime: stats.maxTime,
          count: stats.count,
          threshold: this.alertThresholds.responseTime
        });
      }

      // Update metrics
      this.metrics.webhookDeliveryDuration.observe({ event_type: eventType }, avgTime / 1000);
    }
  }

  /**
   * Update Prometheus metrics
   */
  private async updateMetrics(): Promise<void> {
    // Count deliveries by status and type
    const deliveryStats = await WebhookEvent.findAll({
      where: {
        createdAt: {
          [Op.gte]: new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
        }
      },
      attributes: [
        'type',
        'status',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
      ],
      group: ['type', 'status'],
      raw: true
    }) as any[];

    for (const stat of deliveryStats) {
      this.metrics.webhookDeliveryTotal.inc({
        event_type: stat.type,
        status: stat.status
      }, parseInt(stat.count, 10));
    }

    // Count active webhooks by event type
    const activeWebhooks = await Webhook.findAll({
      where: { status: 'active' },
      attributes: ['events']
    });

    const eventCounts: Record<string, number> = {};
    for (const webhook of activeWebhooks) {
      for (const event of webhook.events) {
        eventCounts[event] = (eventCounts[event] || 0) + 1;
      }
    }

    for (const [eventType, count] of Object.entries(eventCounts)) {
      this.metrics.webhookActiveCount.set({ event_type: eventType }, count);
    }

    // Update failure rates for top webhooks
    const topWebhooks = await Webhook.findAll({
      where: { status: 'active' },
      order: [[require('sequelize').literal('failure_count + success_count'), 'DESC']],
      limit: 20
    });

    for (const webhook of topWebhooks) {
      const total = webhook.failureCount + webhook.successCount;
      const failureRate = total > 0 ? webhook.failureCount / total : 0;
      this.metrics.webhookFailureRate.set({ webhook_id: webhook.id }, failureRate);
    }
  }

  /**
   * Get monitoring dashboard data
   */
  async getDashboardData(): Promise<{
    overview: {
      totalWebhooks: number;
      activeWebhooks: number;
      totalEvents24h: number;
      successRate24h: number;
      avgDeliveryTime: number;
    };
    queueStatus: {
      delivery: any;
      deadLetter: any;
    };
    topWebhooks: Array<{
      id: string;
      url: string;
      eventCount: number;
      successRate: number;
      avgResponseTime: number;
    }>;
    recentFailures: Array<{
      webhookId: string;
      eventType: string;
      error: string;
      timestamp: string;
    }>;
    eventTypeStats: Record<WebhookEventType, {
      count: number;
      successRate: number;
      avgDeliveryTime: number;
    }>;
  }> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Overview stats
    const [
      totalWebhooks,
      activeWebhooks,
      events24h,
      queueStatus
    ] = await Promise.all([
      Webhook.count(),
      Webhook.count({ where: { status: 'active' } }),
      WebhookEvent.findAll({
        where: { createdAt: { [Op.gte]: yesterday } },
        attributes: [
          'status',
          [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']
        ],
        group: ['status'],
        raw: true
      }) as any[],
      this.webhookService.getQueueStatistics()
    ]);

    const totalEvents24h = events24h.reduce((sum, e) => sum + parseInt(e.count, 10), 0);
    const deliveredEvents24h = events24h.find(e => e.status === 'delivered')?.count || 0;
    const successRate24h = totalEvents24h > 0 ? (parseInt(deliveredEvents24h, 10) / totalEvents24h) * 100 : 0;

    // Average delivery time
    const avgDeliveryTime = await this.getAverageDeliveryTime(yesterday);

    // Top webhooks
    const topWebhooks = await this.getTopWebhooks(10);

    // Recent failures
    const recentFailures = await this.getRecentFailures(20);

    // Event type statistics
    const eventTypeStats = await this.getEventTypeStatistics(yesterday);

    return {
      overview: {
        totalWebhooks,
        activeWebhooks,
        totalEvents24h,
        successRate24h: Math.round(successRate24h * 100) / 100,
        avgDeliveryTime
      },
      queueStatus,
      topWebhooks,
      recentFailures,
      eventTypeStats
    };
  }

  /**
   * Get average delivery time
   */
  private async getAverageDeliveryTime(since: Date): Promise<number> {
    const result = await WebhookEvent.findOne({
      where: {
        status: 'delivered',
        createdAt: { [Op.gte]: since },
        deliveredAt: { [Op.ne]: null }
      },
      attributes: [
        [require('sequelize').fn('AVG', 
          require('sequelize').literal('EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) * 1000')
        ), 'avgTime']
      ],
      raw: true
    }) as any;

    return result?.avgTime ? Math.round(result.avgTime) : 0;
  }

  /**
   * Get top webhooks
   */
  private async getTopWebhooks(limit: number): Promise<Array<{
    id: string;
    url: string;
    eventCount: number;
    successRate: number;
    avgResponseTime: number;
  }>> {
    const webhooks = await Webhook.findAll({
      where: { status: 'active' },
      include: [{
        model: WebhookEvent,
        as: 'events',
        attributes: [],
        where: {
          createdAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        },
        required: false
      }],
      attributes: [
        'id',
        'url',
        [require('sequelize').fn('COUNT', require('sequelize').col('events.id')), 'eventCount']
      ],
      group: ['Webhook.id'],
      order: [[require('sequelize').literal('eventCount'), 'DESC']],
      limit,
      raw: true
    }) as any[];

    const results = [];
    for (const webhook of webhooks) {
      const stats = await this.webhookService.getWebhookStatistics(webhook.id);
      results.push({
        id: webhook.id,
        url: webhook.url,
        eventCount: parseInt(webhook.eventCount, 10),
        successRate: stats.successRate,
        avgResponseTime: stats.averageDeliveryTime
      });
    }

    return results;
  }

  /**
   * Get recent failures
   */
  private async getRecentFailures(limit: number): Promise<Array<{
    webhookId: string;
    eventType: string;
    error: string;
    timestamp: string;
  }>> {
    const failures = await WebhookEvent.findAll({
      where: {
        status: 'failed',
        error: { [Op.ne]: null }
      },
      attributes: ['webhookId', 'type', 'error', 'updatedAt'],
      order: [['updatedAt', 'DESC']],
      limit
    });

    return failures.map(f => ({
      webhookId: f.webhookId,
      eventType: f.type,
      error: f.error!,
      timestamp: f.updatedAt.toISOString()
    }));
  }

  /**
   * Get event type statistics
   */
  private async getEventTypeStatistics(
    since: Date
  ): Promise<Record<WebhookEventType, {
    count: number;
    successRate: number;
    avgDeliveryTime: number;
  }>> {
    const stats = await WebhookEvent.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: [
        'type',
        'status',
        [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count'],
        [require('sequelize').fn('AVG', 
          require('sequelize').literal('CASE WHEN "deliveredAt" IS NOT NULL THEN EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) * 1000 END')
        ), 'avgDeliveryTime']
      ],
      group: ['type', 'status'],
      raw: true
    }) as any[];

    const result: Record<string, any> = {};
    
    for (const eventType of Object.values(WebhookEventType)) {
      const typeStats = stats.filter(s => s.type === eventType);
      const total = typeStats.reduce((sum, s) => sum + parseInt(s.count, 10), 0);
      const delivered = typeStats.find(s => s.status === 'delivered');
      
      result[eventType] = {
        count: total,
        successRate: total > 0 ? (parseInt(delivered?.count || '0', 10) / total) * 100 : 0,
        avgDeliveryTime: delivered?.avgDeliveryTime ? Math.round(delivered.avgDeliveryTime) : 0
      };
    }

    return result as Record<WebhookEventType, any>;
  }

  /**
   * Export Prometheus metrics
   */
  getPrometheusMetrics(): string {
    return prometheus.register.metrics();
  }

  /**
   * Setup metrics collection
   */
  private setupMetricsCollection(): void {
    // Clear default metrics if needed
    prometheus.register.clear();

    // Register our custom metrics
    Object.values(this.metrics).forEach(metric => {
      prometheus.register.registerMetric(metric);
    });

    // Also collect default Node.js metrics
    prometheus.collectDefaultMetrics({ prefix: 'webhook_' });
  }
}