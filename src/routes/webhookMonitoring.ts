import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { WebhookService } from '../services/webhook/WebhookService';
import { WebhookMonitoring } from '../services/webhook/WebhookMonitoring';

const router = Router();
const webhookService = WebhookService.getInstance();
const webhookMonitoring = new WebhookMonitoring(webhookService);

// Start monitoring
webhookMonitoring.start(60000); // Check every minute

// Get monitoring dashboard data
router.get('/webhook-monitoring/dashboard',
  authenticate,
  authorize(['admin', 'support']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dashboardData = await webhookMonitoring.getDashboardData();
      
      res.json({
        success: true,
        data: dashboardData
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get Prometheus metrics
router.get('/webhook-monitoring/metrics',
  authenticate,
  authorize(['admin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const metrics = webhookMonitoring.getPrometheusMetrics();
      
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      next(error);
    }
  }
);

// Get webhook health status
router.get('/webhook-monitoring/health',
  authenticate,
  authorize(['admin', 'support']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { userId } = req.query;
      
      const stats = await webhookService.getEventEmitter().getWebhookStats(
        userId as string | undefined
      );
      
      const queueStats = await webhookService.getQueueStatistics();
      
      const isHealthy = stats.deliveryRate > 90 && 
                       queueStats.delivery.waiting < 1000 &&
                       queueStats.deadLetter.waiting === 0;
      
      res.json({
        success: true,
        healthy: isHealthy,
        stats,
        queueStats
      });
    } catch (error) {
      next(error);
    }
  }
);

// Retry failed webhooks
router.post('/webhook-monitoring/retry-failed',
  authenticate,
  authorize(['admin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { webhookId, eventType, since, limit } = req.body;
      
      const count = await webhookService.getEventEmitter().retryFailedWebhooks({
        webhookId,
        eventType,
        since: since ? new Date(since) : undefined,
        limit
      });
      
      res.json({
        success: true,
        retriedCount: count
      });
    } catch (error) {
      next(error);
    }
  }
);

// Clean up old events
router.post('/webhook-monitoring/cleanup',
  authenticate,
  authorize(['admin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { daysToKeep = 30 } = req.body;
      
      const deletedCount = await webhookService.cleanupOldEvents(daysToKeep);
      
      res.json({
        success: true,
        deletedCount
      });
    } catch (error) {
      next(error);
    }
  }
);

// Set monitoring alert thresholds
router.put('/webhook-monitoring/thresholds',
  authenticate,
  authorize(['admin']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { failureRate, responseTime, queueSize } = req.body;
      
      // This would update the monitoring thresholds
      // For now, just return success
      res.json({
        success: true,
        thresholds: {
          failureRate: failureRate || 0.1,
          responseTime: responseTime || 5000,
          queueSize: queueSize || 1000
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// Subscribe to monitoring alerts
webhookMonitoring.on('webhook:high-failure-rate', (data) => {
  console.error('High webhook failure rate detected:', data);
  // Send alert notification (email, Slack, etc.)
});

webhookMonitoring.on('queue:high-backlog', (data) => {
  console.error('High webhook queue backlog:', data);
  // Send alert notification
});

webhookMonitoring.on('queue:dead-letter-items', (data) => {
  console.error('Items in dead letter queue:', data);
  // Send alert notification
});

webhookMonitoring.on('delivery:slow-performance', (data) => {
  console.warn('Slow webhook delivery performance:', data);
  // Send alert notification
});

export default router;