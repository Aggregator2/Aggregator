import { EventEmitter } from 'events';
import { getStatus } from '@lifi/sdk';
import { db } from '../../database/config';
import { logger } from '../../utils/logger';
import { WebSocketServer, WebSocket } from 'ws';

export interface MonitoringConfig {
  checkInterval: number; // milliseconds
  maxRetries: number;
  retryDelay: number; // milliseconds
  staleThreshold: number; // milliseconds - consider stuck after this time
}

export interface BridgeMonitoringEvent {
  settlementId: string;
  transactionHash: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'FAILED' | 'STUCK';
  sourceChainId: number;
  targetChainId: number;
  timestamp: Date;
  details?: any;
}

export interface MonitoringMetrics {
  totalMonitored: number;
  pending: number;
  completed: number;
  failed: number;
  stuck: number;
  avgCompletionTime: number;
  successRate: number;
}

export class BridgeMonitoringService extends EventEmitter {
  private config: MonitoringConfig;
  private monitoringTasks: Map<string, NodeJS.Timeout> = new Map();
  private retryCount: Map<string, number> = new Map();
  private metrics: MonitoringMetrics = {
    totalMonitored: 0,
    pending: 0,
    completed: 0,
    failed: 0,
    stuck: 0,
    avgCompletionTime: 0,
    successRate: 0,
  };
  private wsServer: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  constructor(config?: Partial<MonitoringConfig>) {
    super();
    this.config = {
      checkInterval: 30000, // 30 seconds
      maxRetries: 20, // 10 minutes with 30s intervals
      retryDelay: 5000, // 5 seconds for retry
      staleThreshold: 3600000, // 1 hour
      ...config,
    };
  }

  async initialize(wsPort?: number): Promise<void> {
    // Initialize WebSocket server for real-time updates
    if (wsPort) {
      this.wsServer = new WebSocketServer({ port: wsPort });
      
      this.wsServer.on('connection', (ws) => {
        this.clients.add(ws);
        
        // Send current metrics on connection
        ws.send(JSON.stringify({
          type: 'metrics',
          data: this.metrics,
        }));
        
        ws.on('close', () => {
          this.clients.delete(ws);
        });
      });
      
      logger.info(`Bridge monitoring WebSocket server started on port ${wsPort}`);
    }

    // Load existing monitoring tasks
    await this.loadActiveMonitoringTasks();
    
    // Start metrics update interval
    setInterval(() => this.updateMetrics(), 60000); // Every minute
    
    logger.info('BridgeMonitoringService initialized', this.config);
  }

  async startMonitoring(
    settlementId: string,
    transactionHash: string,
    sourceChainId: number,
    targetChainId: number,
    metadata?: any
  ): Promise<void> {
    // Stop any existing monitoring for this settlement
    this.stopMonitoring(settlementId);
    
    // Initialize retry count
    this.retryCount.set(settlementId, 0);
    
    // Record monitoring start
    await this.recordMonitoringEvent({
      settlementId,
      transactionHash,
      status: 'PENDING',
      sourceChainId,
      targetChainId,
      timestamp: new Date(),
      details: { action: 'monitoring_started', metadata },
    });
    
    // Start monitoring task
    const task = setInterval(async () => {
      await this.checkBridgeStatus(
        settlementId,
        transactionHash,
        sourceChainId,
        targetChainId
      );
    }, this.config.checkInterval);
    
    this.monitoringTasks.set(settlementId, task);
    this.metrics.totalMonitored++;
    this.metrics.pending++;
    
    // Perform immediate check
    await this.checkBridgeStatus(
      settlementId,
      transactionHash,
      sourceChainId,
      targetChainId
    );
    
    logger.info('Started monitoring bridge transaction', {
      settlementId,
      transactionHash,
      sourceChainId,
      targetChainId,
    });
  }

  private async checkBridgeStatus(
    settlementId: string,
    transactionHash: string,
    sourceChainId: number,
    targetChainId: number
  ): Promise<void> {
    try {
      const retries = this.retryCount.get(settlementId) || 0;
      
      // Check if max retries exceeded
      if (retries >= this.config.maxRetries) {
        await this.handleStuckTransaction(settlementId, transactionHash);
        return;
      }
      
      // Get status from LiFi
      const status = await getStatus({
        transactionHash,
        fromChain: sourceChainId,
        toChain: targetChainId,
        bridge: 'lifi',
      });
      
      // Record status check
      await this.recordStatusCheck(settlementId, status);
      
      // Process status
      switch (status.status) {
        case 'DONE':
          await this.handleCompletedBridge(settlementId, status);
          break;
          
        case 'FAILED':
          await this.handleFailedBridge(settlementId, status);
          break;
          
        case 'PENDING':
        case 'NOT_FOUND':
          // Continue monitoring
          this.retryCount.set(settlementId, retries + 1);
          
          // Check if transaction is stale
          const settlement = await this.getSettlement(settlementId);
          if (settlement && settlement.execution_started) {
            const elapsed = Date.now() - new Date(settlement.execution_started).getTime();
            if (elapsed > this.config.staleThreshold) {
              await this.handleStuckTransaction(settlementId, transactionHash);
            }
          }
          break;
          
        default:
          logger.warn('Unknown bridge status', { settlementId, status: status.status });
      }
      
      // Broadcast status update
      this.broadcastUpdate({
        settlementId,
        transactionHash,
        status: status.status as any,
        sourceChainId,
        targetChainId,
        timestamp: new Date(),
        details: status,
      });
      
    } catch (error) {
      logger.error('Error checking bridge status', {
        settlementId,
        transactionHash,
        error,
      });
      
      // Increment retry count
      const retries = this.retryCount.get(settlementId) || 0;
      this.retryCount.set(settlementId, retries + 1);
      
      // Record error
      await this.recordMonitoringEvent({
        settlementId,
        transactionHash,
        status: 'PENDING',
        sourceChainId,
        targetChainId,
        timestamp: new Date(),
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }

  private async handleCompletedBridge(settlementId: string, status: any): Promise<void> {
    this.stopMonitoring(settlementId);
    
    // Update metrics
    this.metrics.pending--;
    this.metrics.completed++;
    
    // Record completion
    await this.recordMonitoringEvent({
      settlementId,
      transactionHash: status.sending?.txHash || '',
      status: 'COMPLETED',
      sourceChainId: parseInt(status.fromChain),
      targetChainId: parseInt(status.toChain),
      timestamp: new Date(),
      details: {
        sourceTransactionHash: status.sending?.txHash,
        targetTransactionHash: status.receiving?.txHash,
        tool: status.tool,
        executionTime: status.executionTime,
      },
    });
    
    // Update settlement in database
    await this.updateSettlementStatus(settlementId, 'COMPLETED', {
      targetTransactionHash: status.receiving?.txHash,
      executionCompleted: new Date(),
    });
    
    this.emit('bridgeCompleted', {
      settlementId,
      sourceTransactionHash: status.sending?.txHash,
      targetTransactionHash: status.receiving?.txHash,
    });
    
    logger.info('Bridge transaction completed', { settlementId });
  }

  private async handleFailedBridge(settlementId: string, status: any): Promise<void> {
    this.stopMonitoring(settlementId);
    
    // Update metrics
    this.metrics.pending--;
    this.metrics.failed++;
    
    // Record failure
    await this.recordMonitoringEvent({
      settlementId,
      transactionHash: status.sending?.txHash || '',
      status: 'FAILED',
      sourceChainId: parseInt(status.fromChain),
      targetChainId: parseInt(status.toChain),
      timestamp: new Date(),
      details: {
        error: status.error || status.message || 'Bridge failed',
        substatus: status.substatus,
      },
    });
    
    // Update settlement in database
    await this.updateSettlementStatus(settlementId, 'FAILED', {
      errorMessage: status.error || 'Bridge transaction failed',
    });
    
    this.emit('bridgeFailed', {
      settlementId,
      error: status.error || 'Bridge transaction failed',
    });
    
    logger.error('Bridge transaction failed', { settlementId, error: status.error });
  }

  private async handleStuckTransaction(
    settlementId: string,
    transactionHash: string
  ): Promise<void> {
    this.stopMonitoring(settlementId);
    
    // Update metrics
    this.metrics.pending--;
    this.metrics.stuck++;
    
    // Record stuck status
    await this.recordMonitoringEvent({
      settlementId,
      transactionHash,
      status: 'STUCK',
      sourceChainId: 0, // Will be fetched from settlement
      targetChainId: 0,
      timestamp: new Date(),
      details: {
        reason: 'Max retries exceeded or stale threshold reached',
        retries: this.retryCount.get(settlementId) || 0,
      },
    });
    
    // Update settlement
    await this.updateSettlementStatus(settlementId, 'FAILED', {
      errorMessage: 'Bridge transaction stuck - manual intervention required',
    });
    
    this.emit('bridgeStuck', {
      settlementId,
      transactionHash,
      retries: this.retryCount.get(settlementId) || 0,
    });
    
    logger.warn('Bridge transaction stuck', { settlementId, transactionHash });
  }

  stopMonitoring(settlementId: string): void {
    const task = this.monitoringTasks.get(settlementId);
    if (task) {
      clearInterval(task);
      this.monitoringTasks.delete(settlementId);
      this.retryCount.delete(settlementId);
      
      logger.info('Stopped monitoring', { settlementId });
    }
  }

  private async recordStatusCheck(settlementId: string, status: any): Promise<void> {
    const query = `
      INSERT INTO bridge_transaction_status (
        cross_chain_settlement_id,
        status,
        source_chain_status,
        target_chain_status,
        substatus,
        source_gas_used,
        target_gas_used,
        error_code,
        error_message,
        raw_response
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;
    
    const params = [
      settlementId,
      status.status,
      status.sending?.txStatus || null,
      status.receiving?.txStatus || null,
      status.substatus || null,
      status.sending?.gasUsed || null,
      status.receiving?.gasUsed || null,
      status.errorCode || null,
      status.error || null,
      JSON.stringify(status),
    ];
    
    try {
      await db.query(query, params);
    } catch (error) {
      logger.error('Error recording status check', { settlementId, error });
    }
  }

  private async recordMonitoringEvent(event: BridgeMonitoringEvent): Promise<void> {
    // Store event in database for audit trail
    const query = `
      INSERT INTO bridge_monitoring_events (
        settlement_id, transaction_hash, status, 
        source_chain_id, target_chain_id, timestamp, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    try {
      await db.query(query, [
        event.settlementId,
        event.transactionHash,
        event.status,
        event.sourceChainId,
        event.targetChainId,
        event.timestamp,
        JSON.stringify(event.details || {}),
      ]);
    } catch (error) {
      // Table might not exist, log but don't fail
      logger.warn('Could not record monitoring event', { event, error });
    }
  }

  private async updateSettlementStatus(
    settlementId: string,
    status: string,
    updates: any
  ): Promise<void> {
    const setClauses = [`status = $2`];
    const params = [settlementId, status];
    let paramIndex = 3;
    
    if (updates.targetTransactionHash) {
      setClauses.push(`target_transaction_hash = $${paramIndex++}`);
      params.push(updates.targetTransactionHash);
    }
    
    if (updates.executionCompleted) {
      setClauses.push(`execution_completed = $${paramIndex++}`);
      params.push(updates.executionCompleted);
    }
    
    if (updates.errorMessage) {
      setClauses.push(`error_message = $${paramIndex++}`);
      params.push(updates.errorMessage);
    }
    
    const query = `
      UPDATE cross_chain_settlements
      SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `;
    
    try {
      await db.query(query, params);
    } catch (error) {
      logger.error('Error updating settlement status', { settlementId, error });
    }
  }

  private async getSettlement(settlementId: string): Promise<any> {
    const query = 'SELECT * FROM cross_chain_settlements WHERE id = $1';
    return await db.queryOne(query, [settlementId]);
  }

  private async loadActiveMonitoringTasks(): Promise<void> {
    const query = `
      SELECT * FROM cross_chain_settlements
      WHERE status IN ('EXECUTING', 'MONITORING')
      ORDER BY created_at ASC
    `;
    
    try {
      const results = await db.query<any>(query);
      
      for (const settlement of results) {
        if (settlement.bridge_transaction_hash) {
          await this.startMonitoring(
            settlement.id,
            settlement.bridge_transaction_hash,
            settlement.source_chain_id,
            settlement.target_chain_id,
            settlement.metadata
          );
        }
      }
      
      logger.info(`Loaded ${results.length} active monitoring tasks`);
    } catch (error) {
      logger.error('Error loading active monitoring tasks', error);
    }
  }

  private async updateMetrics(): Promise<void> {
    try {
      const query = `
        SELECT 
          COUNT(*) FILTER (WHERE status = 'MONITORING') as pending,
          COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
          COUNT(*) FILTER (WHERE status = 'FAILED' AND error_message NOT LIKE '%stuck%') as failed,
          COUNT(*) FILTER (WHERE status = 'FAILED' AND error_message LIKE '%stuck%') as stuck,
          AVG(EXTRACT(EPOCH FROM (execution_completed - execution_started))) 
            FILTER (WHERE status = 'COMPLETED' AND execution_completed IS NOT NULL) as avg_time
        FROM cross_chain_settlements
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `;
      
      const result = await db.queryOne<any>(query);
      if (result) {
        this.metrics.pending = parseInt(result.pending) || 0;
        this.metrics.completed = parseInt(result.completed) || 0;
        this.metrics.failed = parseInt(result.failed) || 0;
        this.metrics.stuck = parseInt(result.stuck) || 0;
        this.metrics.avgCompletionTime = parseFloat(result.avg_time) || 0;
        
        const total = this.metrics.completed + this.metrics.failed;
        this.metrics.successRate = total > 0 
          ? (this.metrics.completed / total) * 100 
          : 0;
        
        this.broadcastMetrics();
      }
    } catch (error) {
      logger.error('Error updating metrics', error);
    }
  }

  private broadcastUpdate(event: BridgeMonitoringEvent): void {
    const message = JSON.stringify({
      type: 'status_update',
      data: event,
    });
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  private broadcastMetrics(): void {
    const message = JSON.stringify({
      type: 'metrics',
      data: this.metrics,
    });
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  getMetrics(): MonitoringMetrics {
    return { ...this.metrics };
  }

  getActiveMonitoringCount(): number {
    return this.monitoringTasks.size;
  }

  async shutdown(): Promise<void> {
    // Stop all monitoring tasks
    for (const [settlementId, task] of this.monitoringTasks) {
      clearInterval(task);
    }
    this.monitoringTasks.clear();
    this.retryCount.clear();
    
    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
      this.clients.clear();
    }
    
    this.removeAllListeners();
    logger.info('BridgeMonitoringService shut down');
  }
}