import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { WebhookService } from '../src/services/webhook/WebhookService';
import { WebhookSecurity } from '../src/services/webhook/WebhookSecurity';
import { Webhook, WebhookEvent, WebhookEventType } from '../src/models/webhook';
import { sequelize } from '../src/models';

// Mock express app
const app = require('../src/app');

describe('Webhook System', () => {
  let webhookService: WebhookService;
  let authToken: string;
  let userId: string;

  beforeAll(async () => {
    // Initialize database
    await sequelize.sync({ force: true });
    
    // Initialize webhook service
    webhookService = WebhookService.getInstance();
    
    // Create test user and get auth token
    const authResponse = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'webhook.test@example.com',
        password: 'Test123!',
        name: 'Webhook Test'
      });
    
    authToken = authResponse.body.token;
    userId = authResponse.body.user.id;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up webhooks and events
    await WebhookEvent.destroy({ where: {} });
    await Webhook.destroy({ where: {} });
  });

  describe('Webhook Management', () => {
    it('should create a new webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          url: 'https://example.com/webhook',
          events: [WebhookEventType.ORDER_CREATED, WebhookEventType.ORDER_FILLED],
          description: 'Test webhook',
          headers: {
            'X-Custom-Header': 'test-value'
          }
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.webhook).toMatchObject({
        url: 'https://example.com/webhook',
        events: expect.arrayContaining([WebhookEventType.ORDER_CREATED, WebhookEventType.ORDER_FILLED]),
        status: 'active',
        description: 'Test webhook'
      });
    });

    it('should list webhooks', async () => {
      // Create multiple webhooks
      await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook1',
        events: [WebhookEventType.ORDER_CREATED]
      });
      
      await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook2',
        events: [WebhookEventType.TRADE_EXECUTED]
      });

      const response = await request(app)
        .get('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.webhooks).toHaveLength(2);
      expect(response.body.pagination.total).toBe(2);
    });

    it('should update a webhook', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      const response = await request(app)
        .put(`/api/webhooks/${webhook.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          url: 'https://example.com/updated-webhook',
          events: [WebhookEventType.ORDER_CREATED, WebhookEventType.ORDER_FILLED],
          status: 'inactive'
        });

      expect(response.status).toBe(200);
      expect(response.body.webhook).toMatchObject({
        url: 'https://example.com/updated-webhook',
        events: expect.arrayContaining([WebhookEventType.ORDER_CREATED, WebhookEventType.ORDER_FILLED]),
        status: 'inactive'
      });
    });

    it('should delete a webhook', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      const response = await request(app)
        .delete(`/api/webhooks/${webhook.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      
      const deletedWebhook = await webhookService.getWebhook(webhook.id, userId);
      expect(deletedWebhook).toBeNull();
    });

    it('should regenerate webhook secret', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      const originalSecret = webhook.secret;

      const response = await request(app)
        .post(`/api/webhooks/${webhook.id}/regenerate-secret`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.secret).not.toBe(originalSecret);
      expect(response.body.secret).toHaveLength(64); // 32 bytes hex = 64 chars
    });
  });

  describe('Webhook Security', () => {
    it('should generate valid HMAC signature', () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Math.floor(Date.now() / 1000);

      const signature = WebhookSecurity.generateSignature(secret, payload, timestamp);
      
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should verify valid signature', () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Math.floor(Date.now() / 1000);

      const signature = WebhookSecurity.generateSignature(secret, payload, timestamp);
      const isValid = WebhookSecurity.verifySignature(secret, payload, signature, timestamp);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const timestamp = Math.floor(Date.now() / 1000);

      const isValid = WebhookSecurity.verifySignature(secret, payload, 'invalid-signature', timestamp);
      
      expect(isValid).toBe(false);
    });

    it('should validate IP whitelist', () => {
      const whitelist = ['192.168.1.0/24', '10.0.0.1'];
      
      expect(WebhookSecurity.validateIpWhitelist('192.168.1.100', whitelist)).toBe(true);
      expect(WebhookSecurity.validateIpWhitelist('10.0.0.1', whitelist)).toBe(true);
      expect(WebhookSecurity.validateIpWhitelist('172.16.0.1', whitelist)).toBe(false);
    });
  });

  describe('Webhook Events', () => {
    it('should emit webhook event on order creation', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      const eventEmitter = webhookService.getEventEmitter();
      
      // Listen for event creation
      let eventCreated = false;
      eventEmitter.once('webhook:event-created', () => {
        eventCreated = true;
      });

      // Emit order created event
      await eventEmitter.emit('order:created', {
        id: 'order-123',
        userId,
        pair: 'ETH/USDC',
        side: 'BUY',
        type: 'LIMIT',
        quantity: 1.5,
        price: 2000,
        status: 'OPEN',
        createdAt: new Date()
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(eventCreated).toBe(true);
      
      // Check webhook event was created
      const events = await WebhookEvent.findAll({ where: { webhookId: webhook.id } });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(WebhookEventType.ORDER_CREATED);
    });

    it('should test webhook delivery', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://httpbin.org/post', // Use httpbin for testing
        events: [WebhookEventType.ORDER_CREATED]
      });

      const response = await request(app)
        .post(`/api/webhooks/${webhook.id}/test`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          eventType: WebhookEventType.ORDER_CREATED
        });

      expect(response.status).toBe(200);
      expect(response.body.test).toMatchObject({
        success: expect.any(Boolean),
        duration: expect.any(Number)
      });
    });
  });

  describe('Webhook Monitoring', () => {
    it('should get webhook statistics', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      // Create some test events
      await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_test_1',
        type: WebhookEventType.ORDER_CREATED,
        payload: { test: true },
        signature: 'test',
        attempts: 1,
        status: 'delivered',
        deliveredAt: new Date()
      });

      await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_test_2',
        type: WebhookEventType.ORDER_CREATED,
        payload: { test: true },
        signature: 'test',
        attempts: 3,
        status: 'failed',
        error: 'Connection timeout'
      });

      const stats = await webhookService.getWebhookStatistics(webhook.id);
      
      expect(stats).toMatchObject({
        totalEvents: 2,
        deliveredEvents: 1,
        failedEvents: 1,
        pendingEvents: 0,
        successRate: 50
      });
    });

    it('should get webhook events with filtering', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      // Create test events with different statuses
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_1',
        type: WebhookEventType.ORDER_CREATED,
        payload: {},
        signature: 'test',
        status: 'delivered',
        createdAt: yesterday
      });

      await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_2',
        type: WebhookEventType.ORDER_CREATED,
        payload: {},
        signature: 'test',
        status: 'failed',
        createdAt: now
      });

      const response = await request(app)
        .get(`/api/webhooks/${webhook.id}/events`)
        .query({ status: 'failed' })
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.events).toHaveLength(1);
      expect(response.body.events[0].status).toBe('failed');
    });
  });

  describe('Webhook Retry Logic', () => {
    it('should retry failed webhooks with exponential backoff', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED],
        retryConfig: {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          timeout: 5000
        }
      });

      // Create a failed event
      const event = await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_retry_test',
        type: WebhookEventType.ORDER_CREATED,
        payload: { test: true },
        signature: 'test',
        attempts: 1,
        status: 'failed',
        error: 'Connection refused'
      });

      // Retry failed webhooks
      const retriedCount = await webhookService.getEventEmitter().retryFailedWebhooks({
        webhookId: webhook.id
      });

      expect(retriedCount).toBe(1);
      
      // Check event was updated
      await event.reload();
      expect(event.status).toBe('pending');
      expect(event.nextRetryAt).not.toBeNull();
    });
  });

  describe('Webhook Cleanup', () => {
    it('should cleanup old webhook events', async () => {
      const webhook = await webhookService.createWebhook(userId, {
        url: 'https://example.com/webhook',
        events: [WebhookEventType.ORDER_CREATED]
      });

      // Create old events
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 40);

      await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_old',
        type: WebhookEventType.ORDER_CREATED,
        payload: {},
        signature: 'test',
        status: 'delivered',
        createdAt: oldDate,
        updatedAt: oldDate
      });

      await WebhookEvent.create({
        webhookId: webhook.id,
        eventId: 'evt_recent',
        type: WebhookEventType.ORDER_CREATED,
        payload: {},
        signature: 'test',
        status: 'delivered'
      });

      const deletedCount = await webhookService.cleanupOldEvents(30);
      
      expect(deletedCount).toBe(1);
      
      const remainingEvents = await WebhookEvent.count({ where: { webhookId: webhook.id } });
      expect(remainingEvents).toBe(1);
    });
  });
});