import { WebhookService } from './WebhookService';
import { WebhookEventType } from '../../models/webhook';

// Initialize webhook service (singleton)
const webhookService = WebhookService.getInstance();
const eventEmitter = webhookService.getEventEmitter();

// Example: Emit order created event
export async function onOrderCreated(order: any) {
  await eventEmitter.emit('order:created', order);
}

// Example: Emit order filled event
export async function onOrderFilled(order: any, fillData: any) {
  await eventEmitter.emit('order:filled', order, fillData);
}

// Example: Emit order cancelled event
export async function onOrderCancelled(order: any, cancelData: any) {
  await eventEmitter.emit('order:cancelled', order, cancelData);
}

// Example: Emit trade executed event
export async function onTradeExecuted(trade: any) {
  await eventEmitter.emit('trade:executed', trade);
}

// Example: Emit settlement completed event
export async function onSettlementCompleted(settlement: any) {
  await eventEmitter.emit('settlement:completed', settlement);
}

// Example: Emit settlement claimed event
export async function onSettlementClaimed(claim: any) {
  await eventEmitter.emit('settlement:claimed', claim);
}

// Example usage in your order service
export class OrderServiceIntegration {
  async createOrder(orderData: any) {
    // ... create order logic ...
    const order = await this.saveOrder(orderData);
    
    // Emit webhook event
    await onOrderCreated(order);
    
    return order;
  }

  async fillOrder(orderId: string, fillData: any) {
    // ... fill order logic ...
    const order = await this.getOrder(orderId);
    const updatedOrder = await this.updateOrderFill(order, fillData);
    
    // Emit webhook event
    await onOrderFilled(updatedOrder, {
      filledQuantity: fillData.filledQuantity,
      remainingQuantity: fillData.remainingQuantity,
      averagePrice: fillData.averagePrice,
      totalValue: fillData.totalValue,
      fee: fillData.fee,
      status: fillData.status
    });
    
    return updatedOrder;
  }

  async cancelOrder(orderId: string, reason: string) {
    // ... cancel order logic ...
    const order = await this.getOrder(orderId);
    const cancelledOrder = await this.updateOrderStatus(order, 'CANCELLED');
    
    // Emit webhook event
    await onOrderCancelled(cancelledOrder, {
      cancelledQuantity: order.remainingQuantity,
      reason
    });
    
    return cancelledOrder;
  }

  // Mock methods for example
  private async saveOrder(data: any) { return data; }
  private async getOrder(id: string) { return { id }; }
  private async updateOrderFill(order: any, data: any) { return { ...order, ...data }; }
  private async updateOrderStatus(order: any, status: string) { return { ...order, status }; }
}

// Example: Manual webhook emission for custom events
export async function emitCustomWebhookEvent(
  eventType: WebhookEventType,
  data: any,
  userId?: string
) {
  await eventEmitter.emitWebhookEvent(eventType, data, { userId });
}

// Example: Direct webhook testing
export async function testWebhook(webhookId: string, userId: string) {
  const result = await webhookService.testWebhook(
    webhookId,
    userId,
    WebhookEventType.ORDER_CREATED,
    {
      orderId: 'test_order_123',
      userId: 'test_user',
      pair: 'ETH/USDC',
      side: 'BUY',
      type: 'LIMIT',
      quantity: '1.5',
      price: '2000',
      status: 'OPEN',
      createdAt: new Date().toISOString()
    }
  );
  
  return result;
}

// Example: Webhook event listener for debugging
eventEmitter.on('webhook:event-created', ({ webhookId, eventId, eventType }) => {
  console.log(`Webhook event created: ${eventType} -> ${eventId} for webhook ${webhookId}`);
});

eventEmitter.on('webhook:events-queued', ({ eventType, count }) => {
  console.log(`Queued ${count} webhook events for ${eventType}`);
});