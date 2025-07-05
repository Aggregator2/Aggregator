import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { Webhook, WebhookEvent, WebhookEventType, WebhookStatus } from '../models/webhook';
import { WebhookService } from '../services/webhook/WebhookService';
import { authenticate } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { 
  CreateWebhookRequest, 
  UpdateWebhookRequest, 
  TestWebhookRequest,
  WebhookResponse 
} from '../types/webhook';

const router = Router();
const webhookService = new WebhookService();

// Validation middleware
const validateWebhookCreate = [
  body('url').isURL({ protocols: ['https', 'http'], require_protocol: true })
    .withMessage('Valid URL is required'),
  body('events').isArray({ min: 1 })
    .withMessage('At least one event type is required'),
  body('events.*').isIn(Object.values(WebhookEventType))
    .withMessage('Invalid event type'),
  body('description').optional().isString().isLength({ max: 255 }),
  body('headers').optional().isObject(),
  body('ipWhitelist').optional().isArray(),
  body('ipWhitelist.*').optional().isIP(),
  body('retryConfig.maxRetries').optional().isInt({ min: 0, max: 10 }),
  body('retryConfig.initialDelay').optional().isInt({ min: 100, max: 60000 }),
  body('retryConfig.maxDelay').optional().isInt({ min: 1000, max: 86400000 }),
  body('retryConfig.timeout').optional().isInt({ min: 1000, max: 300000 })
];

const validateWebhookUpdate = [
  param('id').isUUID(),
  body('url').optional().isURL({ protocols: ['https', 'http'], require_protocol: true }),
  body('events').optional().isArray({ min: 1 }),
  body('events.*').optional().isIn(Object.values(WebhookEventType)),
  body('description').optional().isString().isLength({ max: 255 }),
  body('headers').optional().isObject(),
  body('ipWhitelist').optional().isArray(),
  body('ipWhitelist.*').optional().isIP(),
  body('status').optional().isIn(['active', 'inactive']),
  body('retryConfig.maxRetries').optional().isInt({ min: 0, max: 10 }),
  body('retryConfig.initialDelay').optional().isInt({ min: 100, max: 60000 }),
  body('retryConfig.maxDelay').optional().isInt({ min: 1000, max: 86400000 }),
  body('retryConfig.timeout').optional().isInt({ min: 1000, max: 300000 })
];

const validateTestWebhook = [
  param('id').isUUID(),
  body('eventType').isIn(Object.values(WebhookEventType))
    .withMessage('Valid event type is required'),
  body('data').optional().isObject()
];

// Helper function to format webhook response
function formatWebhookResponse(webhook: Webhook): WebhookResponse {
  const totalAttempts = webhook.successCount + webhook.failureCount;
  const successRate = totalAttempts > 0 
    ? (webhook.successCount / totalAttempts) * 100 
    : 0;

  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    status: webhook.status,
    description: webhook.description,
    headers: webhook.headers,
    ipWhitelist: webhook.ipWhitelist,
    retryConfig: webhook.retryConfig || {
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 3600000,
      timeout: 30000
    },
    stats: {
      lastTriggeredAt: webhook.lastTriggeredAt?.toISOString(),
      failureCount: webhook.failureCount,
      successCount: webhook.successCount,
      successRate: Math.round(successRate * 100) / 100
    },
    createdAt: webhook.createdAt.toISOString(),
    updatedAt: webhook.updatedAt.toISOString()
  };
}

// Create webhook
router.post('/webhooks',
  authenticate,
  rateLimiter({ windowMs: 60000, max: 10 }), // 10 webhooks per minute
  validateWebhookCreate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookData: CreateWebhookRequest = req.body;

      // Check webhook limit per user
      const existingCount = await Webhook.count({
        where: { userId, status: WebhookStatus.ACTIVE }
      });

      if (existingCount >= 10) {
        return res.status(400).json({
          error: 'Webhook limit reached. Maximum 10 active webhooks allowed per user.'
        });
      }

      // Create webhook
      const webhook = await webhookService.createWebhook(userId, webhookData);

      res.status(201).json({
        success: true,
        webhook: formatWebhookResponse(webhook)
      });

    } catch (error) {
      next(error);
    }
  }
);

// List webhooks
router.get('/webhooks',
  authenticate,
  [
    query('status').optional().isIn(Object.values(WebhookStatus)),
    query('event').optional().isIn(Object.values(WebhookEventType)),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const { status, event, page = 1, limit = 20 } = req.query;

      const { webhooks, total } = await webhookService.listWebhooks(userId, {
        status: status as WebhookStatus,
        event: event as WebhookEventType,
        page: Number(page),
        limit: Number(limit)
      });

      res.json({
        success: true,
        webhooks: webhooks.map(formatWebhookResponse),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get webhook by ID
router.get('/webhooks/:id',
  authenticate,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;

      const webhook = await webhookService.getWebhook(webhookId, userId);
      
      if (!webhook) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      res.json({
        success: true,
        webhook: formatWebhookResponse(webhook)
      });

    } catch (error) {
      next(error);
    }
  }
);

// Update webhook
router.put('/webhooks/:id',
  authenticate,
  validateWebhookUpdate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;
      const updateData: UpdateWebhookRequest = req.body;

      const webhook = await webhookService.updateWebhook(webhookId, userId, updateData);
      
      if (!webhook) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      res.json({
        success: true,
        webhook: formatWebhookResponse(webhook)
      });

    } catch (error) {
      next(error);
    }
  }
);

// Delete webhook
router.delete('/webhooks/:id',
  authenticate,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;

      const deleted = await webhookService.deleteWebhook(webhookId, userId);
      
      if (!deleted) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      res.json({
        success: true,
        message: 'Webhook deleted successfully'
      });

    } catch (error) {
      next(error);
    }
  }
);

// Test webhook
router.post('/webhooks/:id/test',
  authenticate,
  rateLimiter({ windowMs: 60000, max: 5 }), // 5 tests per minute
  validateTestWebhook,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;
      const { eventType, data }: TestWebhookRequest = req.body;

      const result = await webhookService.testWebhook(webhookId, userId, eventType, data);
      
      if (!result) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      res.json({
        success: true,
        test: result
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get webhook events/deliveries
router.get('/webhooks/:id/events',
  authenticate,
  [
    param('id').isUUID(),
    query('status').optional().isIn(['pending', 'delivered', 'failed']),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;
      const { status, from, to, page = 1, limit = 20 } = req.query;

      // Verify webhook ownership
      const webhook = await webhookService.getWebhook(webhookId, userId);
      if (!webhook) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      const { events, total } = await webhookService.getWebhookEvents(webhookId, {
        status: status as 'pending' | 'delivered' | 'failed',
        from: from ? new Date(from as string) : undefined,
        to: to ? new Date(to as string) : undefined,
        page: Number(page),
        limit: Number(limit)
      });

      res.json({
        success: true,
        events: events.map(event => ({
          id: event.id,
          eventId: event.eventId,
          type: event.type,
          status: event.status,
          attempts: event.attempts,
          lastAttemptAt: event.lastAttemptAt?.toISOString(),
          deliveredAt: event.deliveredAt?.toISOString(),
          nextRetryAt: event.nextRetryAt?.toISOString(),
          responseStatus: event.responseStatus,
          error: event.error,
          createdAt: event.createdAt.toISOString()
        })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// Get webhook secret (for signature verification)
router.get('/webhooks/:id/secret',
  authenticate,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;

      const webhook = await webhookService.getWebhook(webhookId, userId);
      
      if (!webhook) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      res.json({
        success: true,
        secret: webhook.secret,
        signatureHeader: 'X-Webhook-Signature',
        timestampHeader: 'X-Webhook-Timestamp',
        algorithm: 'sha256'
      });

    } catch (error) {
      next(error);
    }
  }
);

// Regenerate webhook secret
router.post('/webhooks/:id/regenerate-secret',
  authenticate,
  param('id').isUUID(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user!.id;
      const webhookId = req.params.id;

      const newSecret = await webhookService.regenerateSecret(webhookId, userId);
      
      if (!newSecret) {
        return res.status(404).json({
          error: 'Webhook not found'
        });
      }

      res.json({
        success: true,
        secret: newSecret,
        message: 'Webhook secret regenerated successfully'
      });

    } catch (error) {
      next(error);
    }
  }
);

export default router;