import { ethers } from 'ethers';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { providerService } from './blockchain/providerService';
import Redis from 'ioredis';

const prisma = new PrismaClient();

interface EscrowEvent {
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  eventType: 'Deposited' | 'Executed' | 'Withdrawn';
  escrowAddress: string;
  depositor: string;
  counterparty: string;
  arbiter: string;
  token: string;
  amount: string;
  timestamp: number;
}

export class EventListener {
  private redis: Redis;
  private provider: ethers.JsonRpcProvider;
  private escrowAbi: string[];
  private isListening = false;
  private lastProcessedBlock = 0;
  private readonly EVENT_CACHE_PREFIX = 'event:';
  private readonly BLOCK_TRACKER_KEY = 'last_processed_block';
  private readonly REORG_SAFETY_BLOCKS = 12; // Finality buffer
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly RETRY_DELAY_MS = 1000;

  constructor(chainId: number, contractAddress: string) {
    this.provider = providerService.getProviderForChain(chainId);
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '1') // Use different DB for events
    });

    // Simplified ABI for event listening
    this.escrowAbi = [
      "event Deposited(address indexed depositor, address indexed token, uint256 amount)",
      "event Executed(address indexed recipient, address indexed token, uint256 amount)",
      "event Withdrawn(address indexed depositor, address indexed token, uint256 amount)"
    ];

    this.loadLastProcessedBlock();
  }

  async startListening(): Promise<void> {
    if (this.isListening) {
      logger.warn('Event listener is already running');
      return;
    }

    this.isListening = true;
    logger.info('Starting event listener');

    try {
      // Start with historical events if needed
      await this.catchUpWithHistoricalEvents();

      // Listen for new events
      await this.listenForNewEvents();
    } catch (error) {
      logger.error('Error in event listener:', error);
      this.isListening = false;
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    this.isListening = false;
    await this.saveLastProcessedBlock();
    logger.info('Event listener stopped');
  }

  private async catchUpWithHistoricalEvents(): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    const startBlock = Math.max(this.lastProcessedBlock + 1, currentBlock - 1000); // Don't go too far back

    if (startBlock <= currentBlock) {
      logger.info(`Catching up with historical events from block ${startBlock} to ${currentBlock}`);
      await this.processBlockRange(startBlock, currentBlock - this.REORG_SAFETY_BLOCKS);
    }
  }

  private async listenForNewEvents(): Promise<void> {
    // Poll for new blocks instead of using provider.on('block') for better error handling
    const pollInterval = 12000; // 12 seconds, adjust based on chain

    const poll = async (): Promise<void> => {
      if (!this.isListening) return;

      try {
        const currentBlock = await this.provider.getBlockNumber();
        const safeBlock = currentBlock - this.REORG_SAFETY_BLOCKS;

        if (safeBlock > this.lastProcessedBlock) {
          await this.processBlockRange(this.lastProcessedBlock + 1, safeBlock);
        }

        // Schedule next poll
        setTimeout(poll, pollInterval);
      } catch (error) {
        logger.error('Error in polling loop:', error);
        
        // Exponential backoff on error
        const retryDelay = Math.min(pollInterval * 2, 60000);
        setTimeout(poll, retryDelay);
      }
    };

    poll();
  }

  private async processBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    if (fromBlock > toBlock) return;

    logger.info(`Processing blocks ${fromBlock} to ${toBlock}`);

    try {
      // Process in smaller chunks to avoid RPC limits
      const chunkSize = 1000;
      for (let start = fromBlock; start <= toBlock; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, toBlock);
        await this.processChunk(start, end);
      }

      this.lastProcessedBlock = toBlock;
      await this.saveLastProcessedBlock();
    } catch (error) {
      logger.error(`Error processing block range ${fromBlock}-${toBlock}:`, error);
      throw error;
    }
  }

  private async processChunk(fromBlock: number, toBlock: number): Promise<void> {
    const filter = {
      fromBlock,
      toBlock,
      topics: [
        [
          ethers.id("Deposited(address,address,uint256)"),
          ethers.id("Executed(address,address,uint256)"),
          ethers.id("Withdrawn(address,address,uint256)")
        ]
      ]
    };

    let attempt = 0;
    while (attempt < this.MAX_RETRY_ATTEMPTS) {
      try {
        const logs = await this.provider.getLogs(filter);
        await this.processBatchEvents(logs);
        return;
      } catch (error: any) {
        attempt++;
        if (attempt >= this.MAX_RETRY_ATTEMPTS) {
          throw error;
        }

        const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(`Retry attempt ${attempt} for blocks ${fromBlock}-${toBlock}, waiting ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async processBatchEvents(logs: ethers.Log[]): Promise<void> {
    if (logs.length === 0) return;

    // Group events by transaction to detect potential duplicates
    const eventsByTx = new Map<string, ethers.Log[]>();
    
    for (const log of logs) {
      const key = `${log.transactionHash}-${log.index}`;
      if (!eventsByTx.has(log.transactionHash)) {
        eventsByTx.set(log.transactionHash, []);
      }
      eventsByTx.get(log.transactionHash)!.push(log);
    }

    // Process each transaction's events
    for (const [txHash, txLogs] of eventsByTx) {
      await this.processTransactionEvents(txHash, txLogs);
    }
  }

  private async processTransactionEvents(txHash: string, logs: ethers.Log[]): Promise<void> {
    // Sort logs by logIndex to ensure correct order
    logs.sort((a, b) => a.index - b.index);

    for (const log of logs) {
      await this.processEvent(log);
    }
  }

  private async processEvent(log: ethers.Log): Promise<void> {
    try {
      // Create unique event ID to prevent duplicate processing
      const eventId = `${log.transactionHash}-${log.index}`;
      
      // Check if event was already processed
      const processed = await this.redis.get(`${this.EVENT_CACHE_PREFIX}${eventId}`);
      if (processed) {
        logger.debug(`Event ${eventId} already processed, skipping`);
        return;
      }

      const iface = new ethers.Interface(this.escrowAbi);
      const parsedLog = iface.parseLog(log);
      
      if (!parsedLog) {
        logger.warn(`Could not parse log: ${log.transactionHash}-${log.index}`);
        return;
      }

      const event = await this.transformLogToEvent(log, parsedLog);
      
      // Process the event with database transaction
      await this.processEventWithTransaction(event);

      // Mark event as processed
      await this.redis.setex(
        `${this.EVENT_CACHE_PREFIX}${eventId}`,
        86400, // 24 hours cache
        '1'
      );

      logger.info(`Processed event: ${event.eventType} in tx ${event.transactionHash}`);
    } catch (error) {
      logger.error(`Error processing event ${log.transactionHash}-${log.index}:`, error);
      throw error;
    }
  }

  private async transformLogToEvent(log: ethers.Log, parsedLog: ethers.LogDescription): Promise<EscrowEvent> {
    // Get transaction details for additional context
    const tx = await this.provider.getTransaction(log.transactionHash);
    const block = await this.provider.getBlock(log.blockNumber);

    return {
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
      logIndex: log.index,
      eventType: parsedLog.name as any,
      escrowAddress: log.address,
      depositor: parsedLog.args[0],
      counterparty: '', // Would need to fetch from contract state
      arbiter: '', // Would need to fetch from contract state
      token: parsedLog.args[1],
      amount: parsedLog.args[2].toString(),
      timestamp: block!.timestamp
    };
  }

  private async processEventWithTransaction(event: EscrowEvent): Promise<void> {
    // TODO: Implement when EscrowEvent model is added to Prisma schema
    logger.info('Event processed (placeholder):', event.eventType);
    
    /* Uncomment when EscrowEvent model exists in schema:
    await prisma.$transaction(async (tx) => {
      const existingEvent = await tx.escrowEvent.findUnique({
        where: {
          transactionHash_logIndex: {
            transactionHash: event.transactionHash,
            logIndex: event.logIndex
          }
        }
      });

      if (existingEvent) {
        if (existingEvent.blockNumber !== event.blockNumber) {
          logger.warn(`Reorganization detected: event ${event.transactionHash}-${event.logIndex} moved from block ${existingEvent.blockNumber} to ${event.blockNumber}`);
          
          await tx.escrowEvent.update({
            where: { id: existingEvent.id },
            data: {
              blockNumber: event.blockNumber,
              timestamp: new Date(event.timestamp * 1000)
            }
          });
        }
        return;
      }

      // Create new event record
      await tx.escrowEvent.create({
        data: {
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          eventType: event.eventType,
          escrowAddress: event.escrowAddress,
          depositor: event.depositor,
          token: event.token,
          amount: event.amount,
          timestamp: new Date(event.timestamp * 1000)
        }
      });

      // Update related order status if applicable
      await this.updateOrderStatus(event, tx);
    });
    */
  }

  private async updateOrderStatus(event: EscrowEvent, tx: any): Promise<void> {
    // TODO: Implement when proper Prisma models exist
    logger.info(`Would update order status for event: ${event.eventType}`);
    
    /* Uncomment when Order model supports escrow fields:
    const order = await tx.order.findFirst({
      where: {
        OR: [
          { txHash: event.transactionHash },
          { escrowAddress: event.escrowAddress }
        ]
      }
    });

    if (!order) {
      logger.debug(`No order found for event ${event.transactionHash}`);
      return;
    }

    let newStatus;
    switch (event.eventType) {
      case 'Deposited':
        newStatus = 'ESCROW_DEPOSITED';
        break;
      case 'Executed':
        newStatus = 'ESCROW_RELEASED';
        break;
      case 'Withdrawn':
        newStatus = 'REFUNDED';
        break;
      default:
        return;
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: newStatus,
        statusHistory: {
          create: {
            status: newStatus,
            comment: `Blockchain event: ${event.eventType}`,
            changedBy: 'system'
          }
        }
      }
    });

    logger.info(`Updated order ${order.id} status to ${newStatus}`);
    */
  }

  private async loadLastProcessedBlock(): Promise<void> {
    try {
      const block = await this.redis.get(this.BLOCK_TRACKER_KEY);
      this.lastProcessedBlock = block ? parseInt(block) : await this.getDeploymentBlock();
      logger.info(`Loaded last processed block: ${this.lastProcessedBlock}`);
    } catch (error) {
      logger.error('Error loading last processed block:', error);
      this.lastProcessedBlock = await this.getDeploymentBlock();
    }
  }

  private async saveLastProcessedBlock(): Promise<void> {
    await this.redis.set(this.BLOCK_TRACKER_KEY, this.lastProcessedBlock.toString());
  }

  private async getDeploymentBlock(): Promise<number> {
    // In production, this should be the block where the escrow contract was deployed
    const currentBlock = await this.provider.getBlockNumber();
    return Math.max(0, currentBlock - 1000); // Start from 1000 blocks ago as default
  }

  // Health check method
  async getHealthStatus(): Promise<{
    isListening: boolean;
    lastProcessedBlock: number;
    currentBlock: number;
    blocksBehind: number;
    redisConnected: boolean;
  }> {
    const currentBlock = await this.provider.getBlockNumber();
    const redisConnected = this.redis.status === 'ready';

    return {
      isListening: this.isListening,
      lastProcessedBlock: this.lastProcessedBlock,
      currentBlock,
      blocksBehind: currentBlock - this.lastProcessedBlock,
      redisConnected
    };
  }

  // Manual reprocessing for specific block range (admin function)
  async reprocessBlockRange(fromBlock: number, toBlock: number): Promise<void> {
    logger.info(`Manual reprocessing blocks ${fromBlock} to ${toBlock}`);
    
    // Clear event cache for this range
    const eventKeys = await this.redis.keys(`${this.EVENT_CACHE_PREFIX}*`);
    if (eventKeys.length > 0) {
      await this.redis.del(...eventKeys);
    }

    await this.processBlockRange(fromBlock, toBlock);
    logger.info('Manual reprocessing completed');
  }
}

export default EventListener;