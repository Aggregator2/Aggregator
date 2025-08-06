// Order Matching Engine with Settlement Integration
const { SettlementConnector } = require('./settlement-connector');

class OrderMatchingEngine {
  constructor(config = {}) {
    this.orderBook = { buy: [], sell: [] };
    this.config = config;
    
    // Initialize settlement connector for production
    if (config.enableSettlement) {
      this.settlementConnector = new SettlementConnector(config.settlement);
    }
  }

  /**
   * Adds order to book and attempts to match
   */
  async addOrder(order) {
    const side = order.kind === 'buy' ? 'buy' : 'sell';
    this.orderBook[side].push(order);
    
    // Try to match order
    const matches = this.findMatches(order);
    
    if (matches.length > 0) {
      console.log(`🎯 Found ${matches.length} matches for order ${order.id}`);
      
      for (const match of matches) {
        await this.executeMatch(order, match);
      }
    }
    
    return order;
  }

  /**
   * Finds matching orders
   */
  findMatches(order) {
    const oppositeSide = order.kind === 'buy' ? 'sell' : 'buy';
    const oppositeOrders = this.orderBook[oppositeSide];
    
    return oppositeOrders.filter(oppositeOrder => {
      // Basic matching logic
      if (order.kind === 'buy') {
        return (
          order.buyToken === oppositeOrder.sellToken &&
          order.sellToken === oppositeOrder.buyToken &&
          BigInt(order.buyAmount) >= BigInt(oppositeOrder.sellAmount) &&
          BigInt(oppositeOrder.buyAmount) <= BigInt(order.sellAmount)
        );
      } else {
        return (
          order.sellToken === oppositeOrder.buyToken &&
          order.buyToken === oppositeOrder.sellToken &&
          BigInt(order.sellAmount) <= BigInt(oppositeOrder.buyAmount) &&
          BigInt(order.buyAmount) >= BigInt(oppositeOrder.sellAmount)
        );
      }
    });
  }

  /**
   * Executes a match between two orders
   */
  async executeMatch(order1, order2) {
    console.log(`💱 Executing match between ${order1.id} and ${order2.id}`);
    
    // Update order statuses
    order1.status = 'matched';
    order2.status = 'matched';
    
    // For production: Trigger on-chain settlement
    if (this.settlementConnector && this.config.enableSettlement) {
      try {
        const settlement = await this.settlementConnector.settleMatchedOrders(
          order1.kind === 'buy' ? order1 : order2,
          order1.kind === 'sell' ? order1 : order2
        );
        
        // Update orders with real tx hash
        order1.txHash = settlement.txHash;
        order2.txHash = settlement.txHash;
        order1.status = 'filled';
        order2.status = 'filled';
        
        console.log(`✅ On-chain settlement complete: ${settlement.txHash}`);
        
      } catch (error) {
        console.error('Settlement failed:', error);
        order1.status = 'settlement_failed';
        order2.status = 'settlement_failed';
      }
    } else {
      // Development mode: Simulate settlement
      console.log('🏗️  Development mode: Simulating settlement');
      
      setTimeout(() => {
        const mockTxHash = '0x' + require('crypto').randomBytes(32).toString('hex');
        order1.txHash = mockTxHash;
        order2.txHash = mockTxHash;
        order1.status = 'filled';
        order2.status = 'filled';
        console.log(`✅ Mock settlement complete: ${mockTxHash}`);
      }, 2000);
    }
    
    // Remove matched orders from book
    this.removeFromBook(order1);
    this.removeFromBook(order2);
  }

  /**
   * Removes order from order book
   */
  removeFromBook(order) {
    const side = order.kind === 'buy' ? 'buy' : 'sell';
    const index = this.orderBook[side].findIndex(o => o.id === order.id);
    if (index > -1) {
      this.orderBook[side].splice(index, 1);
    }
  }
}

module.exports = { OrderMatchingEngine };