import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import Bull from 'bull';
import { WebhookEvent, Webhook } from '../../models/webhook';
import { WebhookSecurity } from './WebhookSecurity';
import { WebhookPayload } from '../../types/webhook';
import { EventEmitter } from 'events';
import pRetry from 'p-retry';

interface DeliveryJobData {
  webhookEventId: string;
  attemptNumber: number;
}

interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  duration: number;
}

export class WebhookDelivery extends EventEmitter {
  private deliveryQueue: Bull.Queue<DeliveryJobData>;
  private deadLetterQueue: Bull.Queue<DeliveryJobData>;
  private readonly MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_RETRY_DELAY = 24 * 60 * 60 * 1000; // 24 hours

  constructor(redisUrl: string) {
    super();
    
    // Initialize queues
    this.deliveryQueue = new Bull('webhook-delivery', redisUrl, {
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 1 // We handle retries manually
      }
    });

    this.deadLetterQueue = new Bull('webhook-dead-letter', redisUrl, {
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false
      }
    });

    this.setupQueueProcessors();
  }

  /**
   * Queue webhook for delivery
   */
  async queueWebhookDelivery(webhookEvent: WebhookEvent, delay?: number): Promise<void> {
    const jobData: DeliveryJobData = {
      webhookEventId: webhookEvent.id,
      attemptNumber: webhookEvent.attempts + 1
    };

    await this.deliveryQueue.add(jobData, {
      delay,
      jobId: `${webhookEvent.id}-${jobData.attemptNumber}`
    });

    this.emit('webhook:queued', {
      eventId: webhookEvent.id,
      attemptNumber: jobData.attemptNumber,
      delay
    });
  }

  /**
   * Setup queue processors
   */
  private setupQueueProcessors(): void {
    // Main delivery processor
    this.deliveryQueue.process(async (job) => {
      const { webhookEventId, attemptNumber } = job.data;
      
      try {
        const result = await this.deliverWebhook(webhookEventId, attemptNumber);
        
        if (!result.success) {
          throw new Error(result.error || 'Delivery failed');
        }
        
        return result;
      } catch (error) {
        // Re-throw to trigger Bull's error handling
        throw error;
      }
    });

    // Queue event handlers
    this.deliveryQueue.on('completed', (job, result) => {
      this.emit('delivery:completed', {
        webhookEventId: job.data.webhookEventId,
        result
      });
    });

    this.deliveryQueue.on('failed', async (job, err) => {
      const { webhookEventId, attemptNumber } = job.data;
      
      this.emit('delivery:failed', {
        webhookEventId,
        attemptNumber,
        error: err.message
      });

      // Handle retry or move to dead letter queue
      await this.handleDeliveryFailure(webhookEventId);
    });

    // Dead letter queue processor (for manual intervention)
    this.deadLetterQueue.process(async (job) => {
      // Log for manual review
      console.error('Dead letter webhook:', job.data);
      return { processed: true };
    });
  }

  /**
   * Deliver webhook
   */
  private async deliverWebhook(
    webhookEventId: string,
    attemptNumber: number
  ): Promise<DeliveryResult> {
    const startTime = Date.now();
    
    try {
      // Load webhook event with webhook details
      const webhookEvent = await WebhookEvent.findByPk(webhookEventId, {
        include: [{
          model: Webhook,
          as: 'webhook'
        }]
      });

      if (!webhookEvent || !webhookEvent.webhook) {
        throw new Error('Webhook event or webhook not found');
      }

      const webhook = webhookEvent.webhook;
      
      // Check if webhook is active
      if (webhook.status !== 'active') {
        throw new Error('Webhook is not active');
      }

      // Prepare payload
      const payload: WebhookPayload = {
        id: webhookEvent.eventId,
        type: webhookEvent.type,
        timestamp: webhookEvent.createdAt.toISOString(),
        data: webhookEvent.payload,
        signature: '', // Will be set by headers
        api_version: '2024-01-01'
      };

      const payloadString = JSON.stringify(payload);
      
      // Check payload size
      if (Buffer.byteLength(payloadString) > this.MAX_PAYLOAD_SIZE) {
        throw new Error(`Payload too large: ${Buffer.byteLength(payloadString)} bytes`);
      }

      // Generate headers
      const headers = {
        ...WebhookSecurity.generateWebhookHeaders(
          webhook.secret,
          payloadString,
          webhookEvent.eventId
        ),
        ...webhook.headers // Custom headers
      };

      // Prepare request config
      const config: AxiosRequestConfig = {
        method: 'POST',
        url: webhook.url,
        data: payload,
        headers,
        timeout: webhook.retryConfig?.timeout || this.DEFAULT_TIMEOUT,
        maxRedirects: 5,
        validateStatus: () => true // Don't throw on any status
      };

      // Make request with retry
      const response = await pRetry(
        async () => {
          const res = await axios(config);
          
          // Consider 2xx as success
          if (res.status >= 200 && res.status < 300) {
            return res;
          }
          
          // 4xx errors shouldn't be retried (except 429)
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            throw new pRetry.AbortError(`Client error: ${res.status}`);
          }
          
          // Throw to trigger retry for 5xx and 429
          throw new Error(`Server error: ${res.status}`);
        },
        {
          retries: 2, // Quick retries for transient failures
          minTimeout: 1000,
          maxTimeout: 5000
        }
      );

      const duration = Date.now() - startTime;

      // Update webhook event
      await webhookEvent.update({
        attempts: attemptNumber,
        status: 'delivered',
        deliveredAt: new Date(),
        lastAttemptAt: new Date(),
        responseStatus: response.status,
        responseBody: this.truncateResponse(response.data),
        error: null,
        nextRetryAt: null
      });

      // Update webhook stats
      await webhook.increment('successCount');
      await webhook.update({ lastTriggeredAt: new Date() });

      return {
        success: true,
        statusCode: response.status,
        responseBody: this.truncateResponse(response.data),
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = this.extractErrorMessage(error);
      const statusCode = (error as AxiosError)?.response?.status;

      // Update webhook event
      const webhookEvent = await WebhookEvent.findByPk(webhookEventId);
      if (webhookEvent) {
        await webhookEvent.update({
          attempts: attemptNumber,
          lastAttemptAt: new Date(),
          responseStatus: statusCode,
          error: errorMessage
        });
      }

      return {
        success: false,
        statusCode,
        error: errorMessage,
        duration
      };
    }
  }

  /**
   * Handle delivery failure
   */
  private async handleDeliveryFailure(webhookEventId: string): Promise<void> {
    const webhookEvent = await WebhookEvent.findByPk(webhookEventId, {
      include: [{
        model: Webhook,
        as: 'webhook'
      }]
    });

    if (!webhookEvent || !webhookEvent.webhook) {
      return;
    }

    const webhook = webhookEvent.webhook;
    const maxRetries = webhook.retryConfig?.maxRetries || 5;

    // Update failure count
    await webhook.increment('failureCount');

    // Check if we should retry
    if (webhookEvent.attempts >= maxRetries) {
      // Move to dead letter queue
      await webhookEvent.update({
        status: 'failed',
        nextRetryAt: null
      });

      await this.deadLetterQueue.add({
        webhookEventId,
        attemptNumber: webhookEvent.attempts
      });

      this.emit('webhook:dead-letter', {
        eventId: webhookEvent.eventId,
        webhookId: webhook.id,
        attempts: webhookEvent.attempts
      });

      // Disable webhook if too many failures
      if (webhook.failureCount > 100 && 
          webhook.successCount < webhook.failureCount * 0.1) {
        await webhook.update({ status: 'failed' });
        
        this.emit('webhook:auto-disabled', {
          webhookId: webhook.id,
          reason: 'Too many failures'
        });
      }
    } else {
      // Calculate next retry delay with exponential backoff
      const delay = this.calculateRetryDelay(
        webhookEvent.attempts,
        webhook.retryConfig?.initialDelay || 1000,
        webhook.retryConfig?.maxDelay || 3600000
      );

      const nextRetryAt = new Date(Date.now() + delay);
      
      await webhookEvent.update({
        nextRetryAt,
        status: 'pending'
      });

      // Queue for retry
      await this.queueWebhookDelivery(webhookEvent, delay);

      this.emit('webhook:retry-scheduled', {
        eventId: webhookEvent.eventId,
        attemptNumber: webhookEvent.attempts + 1,
        nextRetryAt,
        delay
      });
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(
    attempt: number,
    initialDelay: number,
    maxDelay: number
  ): number {
    // Exponential backoff with jitter
    const exponentialDelay = initialDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    const delay = Math.min(exponentialDelay + jitter, maxDelay);
    
    // Cap at 24 hours
    return Math.min(delay, this.MAX_RETRY_DELAY);
  }

  /**
   * Truncate response for storage
   */
  private truncateResponse(data: any): string {
    try {
      const stringified = typeof data === 'string' ? data : JSON.stringify(data);
      return stringified.length > 1000 
        ? stringified.substring(0, 1000) + '...[truncated]'
        : stringified;
    } catch {
      return '[Unable to serialize response]';
    }
  }

  /**
   * Extract error message
   */
  private extractErrorMessage(error: any): string {
    if (error instanceof pRetry.AbortError) {
      return error.message;
    }
    
    if (error instanceof AxiosError) {
      if (error.response) {
        return `HTTP ${error.response.status}: ${error.response.statusText}`;
      } else if (error.request) {
        return `Network error: ${error.message}`;
      }
    }
    
    return error.message || 'Unknown error';
  }

  /**
   * Bulk send webhooks (for batch events)
   */
  async bulkSendWebhooks(
    webhookEvents: WebhookEvent[],
    options?: {
      batchSize?: number;
      delayBetweenBatches?: number;
    }
  ): Promise<void> {
    const batchSize = options?.batchSize || 10;
    const delayBetweenBatches = options?.delayBetweenBatches || 100;

    for (let i = 0; i < webhookEvents.length; i += batchSize) {
      const batch = webhookEvents.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(event => this.queueWebhookDelivery(event))
      );

      if (i + batchSize < webhookEvents.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    delivery: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    };
    deadLetter: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
    };
  }> {
    const [
      deliveryWaiting,
      deliveryActive,
      deliveryCompleted,
      deliveryFailed,
      deliveryDelayed,
      deadLetterWaiting,
      deadLetterActive,
      deadLetterCompleted,
      deadLetterFailed
    ] = await Promise.all([
      this.deliveryQueue.getWaitingCount(),
      this.deliveryQueue.getActiveCount(),
      this.deliveryQueue.getCompletedCount(),
      this.deliveryQueue.getFailedCount(),
      this.deliveryQueue.getDelayedCount(),
      this.deadLetterQueue.getWaitingCount(),
      this.deadLetterQueue.getActiveCount(),
      this.deadLetterQueue.getCompletedCount(),
      this.deadLetterQueue.getFailedCount()
    ]);

    return {
      delivery: {
        waiting: deliveryWaiting,
        active: deliveryActive,
        completed: deliveryCompleted,
        failed: deliveryFailed,
        delayed: deliveryDelayed
      },
      deadLetter: {
        waiting: deadLetterWaiting,
        active: deadLetterActive,
        completed: deadLetterCompleted,
        failed: deadLetterFailed
      }
    };
  }

  /**
   * Clean up old webhook events
   */
  async cleanupOldEvents(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await WebhookEvent.destroy({
      where: {
        status: ['delivered', 'failed'],
        updatedAt: { $lt: cutoffDate }
      }
    });

    this.emit('cleanup:completed', {
      deletedCount: result,
      cutoffDate
    });

    return result;
  }

  /**
   * Close queues
   */
  async close(): Promise<void> {
    await Promise.all([
      this.deliveryQueue.close(),
      this.deadLetterQueue.close()
    ]);
  }
}