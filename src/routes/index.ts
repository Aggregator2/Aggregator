import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth';
import orderRoutes from './orders';
import settlementRoutes from './settlements';
import webhookRoutes from './webhooks';
import webhookMonitoringRoutes from './webhookMonitoring';

const router = Router();

// Health check routes (no auth required)
router.use('/health', healthRoutes);

// Auth routes
router.use('/auth', authRoutes);

// Protected routes
router.use('/orders', orderRoutes);
router.use('/settlements', settlementRoutes);
router.use('/', webhookRoutes); // Webhook routes at /webhooks
router.use('/', webhookMonitoringRoutes); // Monitoring routes at /webhook-monitoring

export default router;