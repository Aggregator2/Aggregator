import { EventEmitter } from 'events';
import { PrometheusMetricsExporter } from '../prometheus/PrometheusMetricsExporter';

export interface SLAConfig {
  // WebSocket SLAs
  websocket: {
    maxConnectionTime: number; // ms
    maxMessageLatency: number; // ms
    minConnectionUptime: number; // percentage
    maxErrorRate: number; // percentage
    maxReconnectTime: number; // ms
  };
  
  // Order Processing SLAs
  orders: {
    maxProcessingTime: number; // ms
    maxRejectionRate: number; // percentage
    minFillRate: number; // percentage
    maxCancellationTime: number; // ms
  };
  
  // System Performance SLAs
  system: {
    maxCpuUsage: number; // percentage
    maxMemoryUsage: number; // MB
    maxEventLoopLag: number; // ms
    minUptime: number; // percentage
  };
  
  // Trading SLAs
  trading: {
    maxSpread: Map<string, number>; // pair -> max spread percentage
    minLiquidity: Map<string, number>; // pair -> min order book depth
    maxSlippage: number; // percentage
    maxTradeLatency: number; // ms
  };
}

export interface SLAViolation {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metric: string;
  threshold: number;
  actual: number;
  timestamp: number;
  duration?: number;
  message: string;
  context?: any;
}

export interface SLAReport {
  period: { start: Date; end: Date };
  compliance: number; // overall percentage
  violations: SLAViolation[];
  metrics: {
    [key: string]: {
      average: number;
      p95: number;
      p99: number;
      max: number;
      violations: number;
      compliance: number;
    };
  };
}

export class SLAMonitor extends EventEmitter {
  private config: SLAConfig;
  private metricsExporter: PrometheusMetricsExporter;
  private violations: SLAViolation[] = [];
  private metricsHistory: Map<string, number[]> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private reportingInterval?: NodeJS.Timeout;
  private startTime: number;
  private activeViolations: Map<string, SLAViolation> = new Map();

  constructor(config: SLAConfig, metricsExporter: PrometheusMetricsExporter) {
    super();
    this.config = config;
    this.metricsExporter = metricsExporter;
    this.startTime = Date.now();
  }

  start(): void {
    console.log('🎯 Starting SLA monitoring...');
    
    // Start monitoring at 1-second intervals
    this.monitoringInterval = setInterval(() => {
      this.checkSLAs();
    }, 1000);
    
    // Generate reports every hour
    this.reportingInterval = setInterval(() => {
      const report = this.generateReport();
      this.emit('report', report);
    }, 3600000); // 1 hour
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
    }
  }

  // WebSocket SLA Checks
  checkWebSocketLatency(latency: number): void {
    this.recordMetric('websocket.latency', latency);
    
    if (latency > this.config.websocket.maxMessageLatency) {
      this.createViolation({
        type: 'websocket_latency',
        severity: latency > this.config.websocket.maxMessageLatency * 2 ? 'high' : 'medium',
        metric: 'WebSocket Message Latency',
        threshold: this.config.websocket.maxMessageLatency,
        actual: latency,
        message: `WebSocket latency ${latency}ms exceeds threshold of ${this.config.websocket.maxMessageLatency}ms`,
      });
    } else {
      this.resolveViolation('websocket_latency');
    }
  }

  checkWebSocketErrorRate(errorRate: number): void {
    this.recordMetric('websocket.errorRate', errorRate);
    
    if (errorRate > this.config.websocket.maxErrorRate) {
      this.createViolation({
        type: 'websocket_error_rate',
        severity: errorRate > this.config.websocket.maxErrorRate * 2 ? 'critical' : 'high',
        metric: 'WebSocket Error Rate',
        threshold: this.config.websocket.maxErrorRate,
        actual: errorRate,
        message: `WebSocket error rate ${errorRate.toFixed(2)}% exceeds threshold of ${this.config.websocket.maxErrorRate}%`,
      });
    } else {
      this.resolveViolation('websocket_error_rate');
    }
  }

  checkConnectionUptime(uptime: number): void {
    this.recordMetric('websocket.uptime', uptime);
    
    if (uptime < this.config.websocket.minConnectionUptime) {
      this.createViolation({
        type: 'connection_uptime',
        severity: uptime < this.config.websocket.minConnectionUptime * 0.9 ? 'high' : 'medium',
        metric: 'Connection Uptime',
        threshold: this.config.websocket.minConnectionUptime,
        actual: uptime,
        message: `Connection uptime ${uptime.toFixed(2)}% below threshold of ${this.config.websocket.minConnectionUptime}%`,
      });
    } else {
      this.resolveViolation('connection_uptime');
    }
  }

  // Order Processing SLA Checks
  checkOrderProcessingTime(processingTime: number, orderId: string): void {
    this.recordMetric('order.processingTime', processingTime);
    
    if (processingTime > this.config.orders.maxProcessingTime) {
      this.createViolation({
        type: 'order_processing_time',
        severity: processingTime > this.config.orders.maxProcessingTime * 2 ? 'high' : 'medium',
        metric: 'Order Processing Time',
        threshold: this.config.orders.maxProcessingTime,
        actual: processingTime,
        message: `Order ${orderId} processing time ${processingTime}ms exceeds threshold`,
        context: { orderId },
      });
    }
  }

  checkOrderRejectionRate(rejectionRate: number): void {
    this.recordMetric('order.rejectionRate', rejectionRate);
    
    if (rejectionRate > this.config.orders.maxRejectionRate) {
      this.createViolation({
        type: 'order_rejection_rate',
        severity: 'high',
        metric: 'Order Rejection Rate',
        threshold: this.config.orders.maxRejectionRate,
        actual: rejectionRate,
        message: `Order rejection rate ${rejectionRate.toFixed(2)}% exceeds threshold`,
      });
    } else {
      this.resolveViolation('order_rejection_rate');
    }
  }

  // System Performance SLA Checks
  checkSystemMetrics(metrics: {
    cpuUsage: number;
    memoryUsage: number;
    eventLoopLag: number;
  }): void {
    // CPU Usage
    this.recordMetric('system.cpuUsage', metrics.cpuUsage);
    if (metrics.cpuUsage > this.config.system.maxCpuUsage) {
      this.createViolation({
        type: 'cpu_usage',
        severity: metrics.cpuUsage > 90 ? 'critical' : 'high',
        metric: 'CPU Usage',
        threshold: this.config.system.maxCpuUsage,
        actual: metrics.cpuUsage,
        message: `CPU usage ${metrics.cpuUsage.toFixed(1)}% exceeds threshold`,
      });
    } else {
      this.resolveViolation('cpu_usage');
    }
    
    // Memory Usage
    this.recordMetric('system.memoryUsage', metrics.memoryUsage);
    if (metrics.memoryUsage > this.config.system.maxMemoryUsage) {
      this.createViolation({
        type: 'memory_usage',
        severity: metrics.memoryUsage > this.config.system.maxMemoryUsage * 1.5 ? 'critical' : 'high',
        metric: 'Memory Usage',
        threshold: this.config.system.maxMemoryUsage,
        actual: metrics.memoryUsage,
        message: `Memory usage ${metrics.memoryUsage.toFixed(0)}MB exceeds threshold`,
      });
    } else {
      this.resolveViolation('memory_usage');
    }
    
    // Event Loop Lag
    this.recordMetric('system.eventLoopLag', metrics.eventLoopLag);
    if (metrics.eventLoopLag > this.config.system.maxEventLoopLag) {
      this.createViolation({
        type: 'event_loop_lag',
        severity: 'critical',
        metric: 'Event Loop Lag',
        threshold: this.config.system.maxEventLoopLag,
        actual: metrics.eventLoopLag,
        message: `Event loop lag ${metrics.eventLoopLag}ms exceeds threshold`,
      });
    } else {
      this.resolveViolation('event_loop_lag');
    }
  }

  // Trading SLA Checks
  checkSpread(pair: string, spread: number): void {
    const maxSpread = this.config.trading.maxSpread.get(pair);
    if (!maxSpread) return;
    
    this.recordMetric(`trading.spread.${pair}`, spread);
    
    if (spread > maxSpread) {
      this.createViolation({
        type: `spread_${pair}`,
        severity: spread > maxSpread * 2 ? 'high' : 'medium',
        metric: `${pair} Spread`,
        threshold: maxSpread,
        actual: spread,
        message: `${pair} spread ${spread.toFixed(4)}% exceeds threshold`,
        context: { pair },
      });
    } else {
      this.resolveViolation(`spread_${pair}`);
    }
  }

  checkLiquidity(pair: string, bidDepth: number, askDepth: number): void {
    const minLiquidity = this.config.trading.minLiquidity.get(pair);
    if (!minLiquidity) return;
    
    const totalDepth = bidDepth + askDepth;
    this.recordMetric(`trading.liquidity.${pair}`, totalDepth);
    
    if (totalDepth < minLiquidity) {
      this.createViolation({
        type: `liquidity_${pair}`,
        severity: totalDepth < minLiquidity * 0.5 ? 'critical' : 'high',
        metric: `${pair} Liquidity`,
        threshold: minLiquidity,
        actual: totalDepth,
        message: `${pair} liquidity ${totalDepth} orders below minimum`,
        context: { pair, bidDepth, askDepth },
      });
    } else {
      this.resolveViolation(`liquidity_${pair}`);
    }
  }

  checkTradeLatency(latency: number, tradeId: string): void {
    this.recordMetric('trading.latency', latency);
    
    if (latency > this.config.trading.maxTradeLatency) {
      this.createViolation({
        type: 'trade_latency',
        severity: latency > this.config.trading.maxTradeLatency * 2 ? 'critical' : 'high',
        metric: 'Trade Execution Latency',
        threshold: this.config.trading.maxTradeLatency,
        actual: latency,
        message: `Trade ${tradeId} latency ${latency}ms exceeds threshold`,
        context: { tradeId },
      });
    }
  }

  // Helper methods
  private createViolation(violation: Omit<SLAViolation, 'id' | 'timestamp'>): void {
    const id = `${violation.type}_${Date.now()}`;
    const fullViolation: SLAViolation = {
      ...violation,
      id,
      timestamp: Date.now(),
    };
    
    // Check if this is a new violation or ongoing
    const existing = this.activeViolations.get(violation.type);
    if (!existing) {
      this.violations.push(fullViolation);
      this.activeViolations.set(violation.type, fullViolation);
      
      // Record in Prometheus
      this.metricsExporter.recordSLAViolation(violation.type, violation.severity);
      
      // Emit event for alerting
      this.emit('violation', fullViolation);
      
      console.warn(`⚠️  SLA Violation: ${violation.message}`);
    } else {
      // Update duration of ongoing violation
      existing.duration = Date.now() - existing.timestamp;
    }
  }

  private resolveViolation(type: string): void {
    const violation = this.activeViolations.get(type);
    if (violation) {
      violation.duration = Date.now() - violation.timestamp;
      this.activeViolations.delete(type);
      
      this.emit('violation-resolved', violation);
      console.log(`✅ SLA Violation Resolved: ${type} (duration: ${violation.duration}ms)`);
    }
  }

  private recordMetric(name: string, value: number): void {
    if (!this.metricsHistory.has(name)) {
      this.metricsHistory.set(name, []);
    }
    
    const history = this.metricsHistory.get(name)!;
    history.push(value);
    
    // Keep only last hour of data (3600 seconds)
    if (history.length > 3600) {
      history.shift();
    }
  }

  private checkSLAs(): void {
    // This would be called with actual metrics from the system
    // For now, it's a placeholder for the monitoring loop
    this.emit('check-slas');
  }

  generateReport(period?: { start: Date; end: Date }): SLAReport {
    const now = new Date();
    const reportPeriod = period || {
      start: new Date(now.getTime() - 3600000), // Last hour
      end: now,
    };
    
    // Filter violations within period
    const periodViolations = this.violations.filter(
      v => v.timestamp >= reportPeriod.start.getTime() && 
           v.timestamp <= reportPeriod.end.getTime()
    );
    
    // Calculate metrics statistics
    const metrics: SLAReport['metrics'] = {};
    
    for (const [name, history] of this.metricsHistory) {
      if (history.length === 0) continue;
      
      const sorted = [...history].sort((a, b) => a - b);
      const violations = periodViolations.filter(v => 
        v.metric.toLowerCase().includes(name.split('.').pop()!)
      ).length;
      
      metrics[name] = {
        average: history.reduce((a, b) => a + b, 0) / history.length,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
        max: Math.max(...history),
        violations,
        compliance: ((history.length - violations) / history.length) * 100,
      };
    }
    
    // Calculate overall compliance
    const totalChecks = Object.values(metrics).reduce((sum, m) => sum + (m.average > 0 ? 1 : 0), 0);
    const totalViolations = periodViolations.length;
    const compliance = totalChecks > 0 ? ((totalChecks - totalViolations) / totalChecks) * 100 : 100;
    
    return {
      period: reportPeriod,
      compliance,
      violations: periodViolations,
      metrics,
    };
  }

  getActiveViolations(): SLAViolation[] {
    return Array.from(this.activeViolations.values());
  }

  getViolationHistory(limit: number = 100): SLAViolation[] {
    return this.violations.slice(-limit);
  }

  // Real-time streaming support
  streamMetrics(callback: (metrics: any) => void, interval: number = 1000): NodeJS.Timeout {
    return setInterval(() => {
      const snapshot = {
        timestamp: Date.now(),
        activeViolations: this.getActiveViolations(),
        metrics: {},
      };
      
      // Add current values for all tracked metrics
      for (const [name, history] of this.metricsHistory) {
        if (history.length > 0) {
          snapshot.metrics[name] = history[history.length - 1];
        }
      }
      
      callback(snapshot);
    }, interval);
  }
}

// Default SLA configuration
export const defaultSLAConfig: SLAConfig = {
  websocket: {
    maxConnectionTime: 5000, // 5 seconds
    maxMessageLatency: 100, // 100ms
    minConnectionUptime: 99, // 99%
    maxErrorRate: 1, // 1%
    maxReconnectTime: 10000, // 10 seconds
  },
  orders: {
    maxProcessingTime: 50, // 50ms
    maxRejectionRate: 5, // 5%
    minFillRate: 95, // 95%
    maxCancellationTime: 100, // 100ms
  },
  system: {
    maxCpuUsage: 80, // 80%
    maxMemoryUsage: 4096, // 4GB
    maxEventLoopLag: 100, // 100ms
    minUptime: 99.9, // 99.9%
  },
  trading: {
    maxSpread: new Map([
      ['ETH/USDT', 0.1], // 0.1%
      ['BTC/USDT', 0.1], // 0.1%
      ['SOL/USDT', 0.2], // 0.2%
    ]),
    minLiquidity: new Map([
      ['ETH/USDT', 100], // 100 orders
      ['BTC/USDT', 100], // 100 orders
      ['SOL/USDT', 50], // 50 orders
    ]),
    maxSlippage: 0.5, // 0.5%
    maxTradeLatency: 10, // 10ms
  },
};