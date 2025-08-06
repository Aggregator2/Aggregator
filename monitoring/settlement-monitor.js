const { getMetricsCollector } = require('./metrics-collector');
const { ethers } = require('hardhat');
const EventEmitter = require('events');

class SettlementMonitor extends EventEmitter {
  constructor(settlementContract, web3Provider) {
    super();
    this.contract = settlementContract;
    this.provider = web3Provider;
    this.metrics = getMetricsCollector();
    this.isMonitoring = false;
    
    // Settlement tracking
    this.pendingSettlements = new Map();
    this.settlementHistory = [];
    this.maxHistorySize = 10000;
    
    // Success rate tracking
    this.successRates = {
      hourly: { success: 0, failed: 0 },
      daily: { success: 0, failed: 0 },
      weekly: { success: 0, failed: 0 }
    };
    
    // Gas tracking
    this.gasStats = {
      total: 0,
      count: 0,
      min: Infinity,
      max: 0,
      byType: {}
    };
    
    // Alert thresholds
    this.thresholds = {
      failureRate: 0.05, // 5% failure rate
      gasSpike: 2, // 2x average gas
      settlementDelay: 300000, // 5 minutes
      minSuccessRate: 0.95, // 95% success rate
      minThroughput: 100, // orders per minute
      maxLatency: 60000, // 1 minute max settlement time
      gasEfficiencyTarget: 21000 // gas per order target
    };

    // Throughput tracking
    this.throughputStats = {
      ordersPerSecond: 0,
      ordersPerMinute: 0,
      ordersPerHour: 0,
      recentOrders: [],
      totalVolume: 0,
      avgBatchSize: 0,
      batchFrequency: 0
    };
  }

  async start() {
    if (this.isMonitoring) return;
    
    console.log('💰 Starting settlement monitoring...');
    this.isMonitoring = true;
    
    // Subscribe to contract events
    await this.subscribeToEvents();
    
    // Start monitoring loops
    this.startPeriodicChecks();
    
    // Load historical data
    await this.loadHistoricalData();
    
    console.log('✅ Settlement monitoring started');
  }

  async subscribeToEvents() {
    // Monitor settlement initiation
    this.contract.on('SettlementInitiated', async (batchId, orderCount, totalValue, event) => {
      const timestamp = Date.now();
      const block = await event.getBlock();
      
      const settlement = {
        batchId,
        orderCount: orderCount.toNumber(),
        totalValue: ethers.utils.formatEther(totalValue),
        initiatedAt: timestamp,
        initiatedBlock: block.number,
        txHash: event.transactionHash,
        status: 'pending'
      };
      
      this.pendingSettlements.set(batchId, settlement);
      
      await this.metrics.incrementCounter('settlements.initiated', 1, {
        orderCount: orderCount.toString()
      });
      
      await this.metrics.recordHistogram('settlements.batch_size', orderCount.toNumber());
      await this.metrics.recordHistogram('settlements.batch_value', parseFloat(settlement.totalValue));
      
      // Update throughput tracking
      this.updateThroughputStats(settlement);
      
      this.emit('settlement:initiated', settlement);
    });

    // Monitor settlement completion
    this.contract.on('SettlementCompleted', async (batchId, gasUsed, event) => {
      const timestamp = Date.now();
      const settlement = this.pendingSettlements.get(batchId);
      
      if (!settlement) {
        console.warn(`Settlement completed for unknown batch: ${batchId}`);
        return;
      }
      
      const tx = await event.getTransaction();
      const receipt = await event.getTransactionReceipt();
      
      settlement.completedAt = timestamp;
      settlement.completedBlock = receipt.blockNumber;
      settlement.duration = timestamp - settlement.initiatedAt;
      settlement.gasUsed = gasUsed.toNumber();
      settlement.gasPrice = tx.gasPrice ? ethers.utils.formatUnits(tx.gasPrice, 'gwei') : 'unknown';
      settlement.gasCost = receipt.gasUsed && tx.gasPrice 
        ? ethers.utils.formatEther(receipt.gasUsed.mul(tx.gasPrice))
        : 'unknown';
      settlement.status = 'completed';
      settlement.success = true;
      
      // Update metrics
      await this.recordSettlementMetrics(settlement);
      
      // Move to history
      this.pendingSettlements.delete(batchId);
      this.addToHistory(settlement);
      
      this.emit('settlement:completed', settlement);
    });

    // Monitor settlement failures
    this.contract.on('SettlementFailed', async (batchId, reason, event) => {
      const timestamp = Date.now();
      const settlement = this.pendingSettlements.get(batchId);
      
      if (!settlement) {
        console.warn(`Settlement failed for unknown batch: ${batchId}`);
        return;
      }
      
      settlement.failedAt = timestamp;
      settlement.failureReason = reason;
      settlement.duration = timestamp - settlement.initiatedAt;
      settlement.status = 'failed';
      settlement.success = false;
      
      // Update failure metrics
      await this.metrics.incrementCounter('settlements.failed', 1, {
        reason: reason.substring(0, 50) // Truncate long reasons
      });
      
      this.successRates.hourly.failed++;
      this.successRates.daily.failed++;
      this.successRates.weekly.failed++;
      
      // Alert on failure
      this.emit('alert', {
        type: 'settlement_failed',
        severity: 'high',
        batchId,
        reason,
        orderCount: settlement.orderCount,
        totalValue: settlement.totalValue
      });
      
      // Move to history
      this.pendingSettlements.delete(batchId);
      this.addToHistory(settlement);
      
      this.emit('settlement:failed', settlement);
    });

    // Monitor gas price updates
    this.contract.on('GasPriceUpdated', async (oldPrice, newPrice, event) => {
      const changePercent = oldPrice.gt(0) 
        ? newPrice.sub(oldPrice).mul(100).div(oldPrice).toNumber()
        : 0;
      
      await this.metrics.setGauge('settlements.gas_price', 
        parseFloat(ethers.utils.formatUnits(newPrice, 'gwei'))
      );
      
      if (Math.abs(changePercent) > 50) {
        this.emit('alert', {
          type: 'gas_price_spike',
          severity: 'medium',
          oldPrice: ethers.utils.formatUnits(oldPrice, 'gwei'),
          newPrice: ethers.utils.formatUnits(newPrice, 'gwei'),
          changePercent
        });
      }
    });
  }

  async recordSettlementMetrics(settlement) {
    // Success metrics
    await this.metrics.incrementCounter('settlements.completed', 1);
    this.successRates.hourly.success++;
    this.successRates.daily.success++;
    this.successRates.weekly.success++;
    
    // Timing metrics
    await this.metrics.recordHistogram('settlements.duration', settlement.duration);
    await this.metrics.recordHistogram('settlements.blocks_to_confirm', 
      settlement.completedBlock - settlement.initiatedBlock
    );
    
    // Gas metrics
    if (settlement.gasUsed) {
      await this.metrics.recordHistogram('settlements.gas_used', settlement.gasUsed);
      this.updateGasStats(settlement);
    }
    
    // Value metrics
    await this.metrics.incrementCounter('settlements.total_value', 
      parseFloat(settlement.totalValue)
    );
    
    // Calculate and record efficiency metrics
    const efficiency = settlement.orderCount > 0 
      ? settlement.gasUsed / settlement.orderCount 
      : 0;
    await this.metrics.recordHistogram('settlements.gas_per_order', efficiency);
    
    // Record throughput metrics
    await this.metrics.setGauge('settlements.throughput.orders_per_second', this.throughputStats.ordersPerSecond);
    await this.metrics.setGauge('settlements.throughput.orders_per_minute', this.throughputStats.ordersPerMinute);
    await this.metrics.setGauge('settlements.throughput.orders_per_hour', this.throughputStats.ordersPerHour);
    await this.metrics.setGauge('settlements.throughput.avg_batch_size', this.throughputStats.avgBatchSize);
    await this.metrics.setGauge('settlements.throughput.batch_frequency', this.throughputStats.batchFrequency);
    
    // Check for anomalies and throughput issues
    this.checkSettlementAnomalies(settlement);
    this.checkThroughputThresholds();
  }

  updateGasStats(settlement) {
    this.gasStats.total += settlement.gasUsed;
    this.gasStats.count++;
    this.gasStats.min = Math.min(this.gasStats.min, settlement.gasUsed);
    this.gasStats.max = Math.max(this.gasStats.max, settlement.gasUsed);
    
    const type = this.categorizeSettlement(settlement);
    if (!this.gasStats.byType[type]) {
      this.gasStats.byType[type] = { total: 0, count: 0 };
    }
    this.gasStats.byType[type].total += settlement.gasUsed;
    this.gasStats.byType[type].count++;
  }

  categorizeSettlement(settlement) {
    if (settlement.orderCount <= 10) return 'small';
    if (settlement.orderCount <= 50) return 'medium';
    if (settlement.orderCount <= 100) return 'large';
    return 'xlarge';
  }

  checkSettlementAnomalies(settlement) {
    const avgGas = this.gasStats.count > 0 
      ? this.gasStats.total / this.gasStats.count 
      : settlement.gasUsed;
    
    // Check for gas spike
    if (settlement.gasUsed > avgGas * this.thresholds.gasSpike) {
      this.emit('alert', {
        type: 'settlement_gas_spike',
        severity: 'medium',
        batchId: settlement.batchId,
        gasUsed: settlement.gasUsed,
        avgGas,
        spikeRatio: settlement.gasUsed / avgGas
      });
    }
    
    // Check for slow settlement
    if (settlement.duration > this.thresholds.settlementDelay) {
      this.emit('alert', {
        type: 'slow_settlement',
        severity: 'medium',
        batchId: settlement.batchId,
        duration: settlement.duration,
        threshold: this.thresholds.settlementDelay
      });
    }
  }

  startPeriodicChecks() {
    // Check for stuck settlements every minute
    this.stuckCheckInterval = setInterval(() => {
      this.checkStuckSettlements();
    }, 60000);
    
    // Update success rates every hour
    this.rateUpdateInterval = setInterval(() => {
      this.updateSuccessRates();
    }, 3600000);
    
    // Calculate gas statistics every 5 minutes
    this.gasStatsInterval = setInterval(() => {
      this.publishGasStatistics();
    }, 300000);
    
    // Update throughput calculations every 10 seconds
    this.throughputInterval = setInterval(() => {
      this.calculateThroughputMetrics();
    }, 10000);
  }

  async checkStuckSettlements() {
    const now = Date.now();
    const stuckThreshold = 600000; // 10 minutes
    
    for (const [batchId, settlement] of this.pendingSettlements) {
      const age = now - settlement.initiatedAt;
      
      if (age > stuckThreshold) {
        await this.metrics.incrementCounter('settlements.stuck', 1);
        
        this.emit('alert', {
          type: 'settlement_stuck',
          severity: 'high',
          batchId,
          age,
          orderCount: settlement.orderCount,
          totalValue: settlement.totalValue,
          txHash: settlement.txHash
        });
        
        // Mark as stuck
        settlement.status = 'stuck';
        settlement.stuckAt = now;
      }
    }
  }

  async updateSuccessRates() {
    // Calculate success rates
    const hourlyRate = this.calculateSuccessRate(this.successRates.hourly);
    const dailyRate = this.calculateSuccessRate(this.successRates.daily);
    const weeklyRate = this.calculateSuccessRate(this.successRates.weekly);
    
    // Update metrics
    await this.metrics.setGauge('settlements.success_rate.hourly', hourlyRate);
    await this.metrics.setGauge('settlements.success_rate.daily', dailyRate);
    await this.metrics.setGauge('settlements.success_rate.weekly', weeklyRate);
    
    // Check thresholds
    if (hourlyRate < this.thresholds.minSuccessRate) {
      this.emit('alert', {
        type: 'low_success_rate',
        severity: 'high',
        period: 'hourly',
        rate: hourlyRate,
        threshold: this.thresholds.minSuccessRate
      });
    }
    
    // Reset hourly counter
    this.successRates.hourly = { success: 0, failed: 0 };
    
    // Reset daily counter every 24 hours
    if (new Date().getHours() === 0) {
      this.successRates.daily = { success: 0, failed: 0 };
    }
    
    // Reset weekly counter every Monday
    if (new Date().getDay() === 1 && new Date().getHours() === 0) {
      this.successRates.weekly = { success: 0, failed: 0 };
    }
  }

  calculateSuccessRate(rates) {
    const total = rates.success + rates.failed;
    return total > 0 ? rates.success / total : 1;
  }

  async publishGasStatistics() {
    if (this.gasStats.count === 0) return;
    
    const avgGas = this.gasStats.total / this.gasStats.count;
    
    await this.metrics.setGauge('settlements.gas.average', avgGas);
    await this.metrics.setGauge('settlements.gas.min', this.gasStats.min);
    await this.metrics.setGauge('settlements.gas.max', this.gasStats.max);
    
    // Publish by type
    for (const [type, stats] of Object.entries(this.gasStats.byType)) {
      const avgByType = stats.count > 0 ? stats.total / stats.count : 0;
      await this.metrics.setGauge(`settlements.gas.by_type.${type}`, avgByType);
    }
  }

  addToHistory(settlement) {
    this.settlementHistory.push(settlement);
    
    // Maintain size limit
    if (this.settlementHistory.length > this.maxHistorySize) {
      this.settlementHistory.shift();
    }
    
    // Store in metrics for historical analysis
    this.metrics.recordHistogram('settlements.history', 1, {
      status: settlement.status,
      success: settlement.success.toString()
    });
  }

  async loadHistoricalData() {
    try {
      // Load recent settlement events from blockchain
      const filter = this.contract.filters.SettlementCompleted();
      const events = await this.contract.queryFilter(filter, -10000); // Last 10k blocks
      
      console.log(`Loading ${events.length} historical settlements...`);
      
      for (const event of events) {
        const block = await event.getBlock();
        const tx = await event.getTransaction();
        
        const historicalSettlement = {
          batchId: event.args.batchId,
          gasUsed: event.args.gasUsed.toNumber(),
          completedBlock: block.number,
          completedAt: block.timestamp * 1000,
          txHash: tx.hash,
          gasPrice: ethers.utils.formatUnits(tx.gasPrice || 0, 'gwei'),
          status: 'completed',
          success: true
        };
        
        this.addToHistory(historicalSettlement);
      }
      
      console.log('✅ Historical data loaded');
    } catch (error) {
      console.error('Failed to load historical data:', error);
    }
  }

  getRealtimeStats() {
    const now = Date.now();
    const hour = 3600000;
    const day = 86400000;
    
    // Get recent settlements
    const recentSettlements = this.settlementHistory.filter(s => 
      (s.completedAt || s.failedAt) > now - hour
    );
    
    // Calculate statistics
    const stats = {
      pending: this.pendingSettlements.size,
      completedLastHour: recentSettlements.filter(s => s.success).length,
      failedLastHour: recentSettlements.filter(s => !s.success).length,
      avgDuration: this.calculateAvgDuration(recentSettlements),
      avgGasUsed: this.gasStats.count > 0 ? this.gasStats.total / this.gasStats.count : 0,
      successRates: {
        hourly: this.calculateSuccessRate(this.successRates.hourly),
        daily: this.calculateSuccessRate(this.successRates.daily),
        weekly: this.calculateSuccessRate(this.successRates.weekly)
      },
      gasStats: {
        ...this.gasStats,
        average: this.gasStats.count > 0 ? this.gasStats.total / this.gasStats.count : 0
      }
    };
    
    return stats;
  }

  calculateAvgDuration(settlements) {
    const durations = settlements
      .filter(s => s.duration)
      .map(s => s.duration);
    
    return durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
  }

  getSettlementHistory(limit = 100) {
    return this.settlementHistory
      .slice(-limit)
      .reverse()
      .map(s => ({
        batchId: s.batchId,
        status: s.status,
        orderCount: s.orderCount,
        totalValue: s.totalValue,
        duration: s.duration,
        gasUsed: s.gasUsed,
        timestamp: s.completedAt || s.failedAt || s.initiatedAt,
        failureReason: s.failureReason
      }));
  }

  updateThroughputStats(settlement) {
    const now = Date.now();
    
    // Add to recent orders tracking
    this.throughputStats.recentOrders.push({
      timestamp: now,
      orderCount: settlement.orderCount,
      totalValue: parseFloat(settlement.totalValue)
    });
    
    // Keep only last hour of data
    const oneHour = 3600000;
    this.throughputStats.recentOrders = this.throughputStats.recentOrders
      .filter(order => now - order.timestamp < oneHour);
  }

  calculateThroughputMetrics() {
    const now = Date.now();
    const oneSecond = 1000;
    const oneMinute = 60000;
    const oneHour = 3600000;
    
    // Calculate orders per second (last 10 seconds)
    const recentSecond = this.throughputStats.recentOrders
      .filter(order => now - order.timestamp < 10000);
    this.throughputStats.ordersPerSecond = recentSecond.length > 0 
      ? recentSecond.reduce((sum, order) => sum + order.orderCount, 0) / 10
      : 0;
    
    // Calculate orders per minute
    const recentMinute = this.throughputStats.recentOrders
      .filter(order => now - order.timestamp < oneMinute);
    this.throughputStats.ordersPerMinute = recentMinute.length > 0
      ? recentMinute.reduce((sum, order) => sum + order.orderCount, 0)
      : 0;
    
    // Calculate orders per hour
    this.throughputStats.ordersPerHour = this.throughputStats.recentOrders.length > 0
      ? this.throughputStats.recentOrders.reduce((sum, order) => sum + order.orderCount, 0)
      : 0;
    
    // Calculate average batch size
    this.throughputStats.avgBatchSize = this.throughputStats.recentOrders.length > 0
      ? this.throughputStats.recentOrders.reduce((sum, order) => sum + order.orderCount, 0) / this.throughputStats.recentOrders.length
      : 0;
    
    // Calculate batch frequency (batches per minute)
    this.throughputStats.batchFrequency = recentMinute.length;
    
    // Calculate total volume processed
    this.throughputStats.totalVolume = this.throughputStats.recentOrders.length > 0
      ? this.throughputStats.recentOrders.reduce((sum, order) => sum + order.totalValue, 0)
      : 0;
  }

  checkThroughputThresholds() {
    // Check if throughput is below minimum threshold
    if (this.throughputStats.ordersPerMinute < this.thresholds.minThroughput) {
      this.emit('alert', {
        type: 'low_throughput',
        severity: 'medium',
        message: `Settlement throughput below threshold: ${this.throughputStats.ordersPerMinute} orders/min (min: ${this.thresholds.minThroughput})`,
        currentThroughput: this.throughputStats.ordersPerMinute,
        threshold: this.thresholds.minThroughput
      });
    }
    
    // Check gas efficiency
    const avgGasPerOrder = this.gasStats.count > 0 
      ? this.gasStats.total / this.gasStats.count 
      : 0;
    
    if (avgGasPerOrder > this.thresholds.gasEfficiencyTarget * 1.5) {
      this.emit('alert', {
        type: 'poor_gas_efficiency',
        severity: 'medium',
        message: `Gas efficiency poor: ${avgGasPerOrder.toFixed(0)} gas/order (target: ${this.thresholds.gasEfficiencyTarget})`,
        currentEfficiency: avgGasPerOrder,
        target: this.thresholds.gasEfficiencyTarget
      });
    }
  }

  getThroughputMetrics() {
    return {
      realtime: {
        ordersPerSecond: this.throughputStats.ordersPerSecond,
        ordersPerMinute: this.throughputStats.ordersPerMinute,
        ordersPerHour: this.throughputStats.ordersPerHour,
        batchFrequency: this.throughputStats.batchFrequency,
        avgBatchSize: this.throughputStats.avgBatchSize,
        totalVolume: this.throughputStats.totalVolume
      },
      thresholds: {
        minThroughput: this.thresholds.minThroughput,
        gasEfficiencyTarget: this.thresholds.gasEfficiencyTarget,
        maxLatency: this.thresholds.maxLatency
      },
      efficiency: {
        gasPerOrder: this.gasStats.count > 0 ? this.gasStats.total / this.gasStats.count : 0,
        avgSettlementTime: this.calculateAvgDuration(this.settlementHistory.slice(-100))
      }
    };
  }

  stop() {
    if (!this.isMonitoring) return;
    
    console.log('🛑 Stopping settlement monitoring...');
    
    // Remove event listeners
    this.contract.removeAllListeners();
    
    // Clear intervals
    clearInterval(this.stuckCheckInterval);
    clearInterval(this.rateUpdateInterval);
    clearInterval(this.gasStatsInterval);
    clearInterval(this.throughputInterval);
    
    this.isMonitoring = false;
    
    console.log('✅ Settlement monitoring stopped');
  }
}

module.exports = SettlementMonitor;