import { EventEmitter } from 'events';
import crypto from 'crypto';
import { AtomicSwap, Settlement, NetPosition } from './types';

export class AtomicSwapEngine extends EventEmitter {
  private swaps: Map<string, AtomicSwap> = new Map();
  private secretStore: Map<string, string> = new Map();
  private timelockDuration: number = 3600000; // 1 hour default
  
  constructor() {
    super();
    this.startTimelockMonitor();
  }
  
  // Create atomic swaps from settlement
  public async createSwapsFromSettlement(settlement: Settlement): Promise<string[]> {
    const swapIds: string[] = [];
    
    // Group net positions by counterparty pairs
    const swapPairs = this.groupNetPositionsIntoSwaps(settlement.netAmounts);
    
    for (const pair of swapPairs) {
      const swap = await this.createAtomicSwap(
        pair.from,
        pair.to,
        pair.fromToken,
        pair.toToken,
        pair.fromAmount,
        pair.toAmount
      );
      swapIds.push(swap.id);
    }
    
    return swapIds;
  }
  
  // Create a single atomic swap
  private async createAtomicSwap(
    fromUserId: string,
    toUserId: string,
    fromToken: string,
    toToken: string,
    fromAmount: bigint,
    toAmount: bigint
  ): Promise<AtomicSwap> {
    // Generate secret and hashlock
    const secret = crypto.randomBytes(32).toString('hex');
    const hashlock = crypto.createHash('sha256').update(secret).digest('hex');
    
    const swap: AtomicSwap = {
      id: `SWAP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      fromUserId,
      toUserId,
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      status: 'PENDING',
      hashlock,
      timelock: Date.now() + this.timelockDuration,
      createdAt: Date.now()
    };
    
    // Store secret securely
    this.secretStore.set(swap.id, secret);
    this.swaps.set(swap.id, swap);
    
    this.emit('swapCreated', swap);
    
    return swap;
  }
  
  // Execute multiple swaps atomically
  public async executeSwaps(swapIds: string[]): Promise<void> {
    // Validate all swap IDs exist
    const invalidSwapIds: string[] = [];
    const validSwaps: AtomicSwap[] = [];
    
    for (const swapId of swapIds) {
      const swap = this.swaps.get(swapId);
      if (!swap) {
        invalidSwapIds.push(swapId);
      } else {
        validSwaps.push(swap);
      }
    }
    
    // Throw error if any swap IDs are invalid
    if (invalidSwapIds.length > 0) {
      throw new Error(`Invalid swap IDs: ${invalidSwapIds.join(', ')}`);
    }
    
    // Throw error if no valid swaps to execute
    if (validSwaps.length === 0) {
      throw new Error('No valid swaps to execute');
    }
    
    try {
      // Phase 1: Lock all swaps
      await this.lockSwaps(validSwaps);
      
      // Phase 2: Execute all swaps
      await this.executeLockedSwaps(validSwaps);
      
      // Phase 3: Complete all swaps
      await this.completeSwaps(validSwaps);
      
    } catch (error) {
      // If any step fails, revert all swaps
      await this.revertSwaps(validSwaps);
      throw error;
    }
  }
  
  // Phase 1: Lock funds for all swaps
  private async lockSwaps(swaps: AtomicSwap[]): Promise<void> {
    for (const swap of swaps) {
      try {
        // Simulate locking funds (in real implementation, would interact with smart contracts)
        await this.lockFunds(swap);
        swap.status = 'LOCKED';
        this.emit('swapLocked', swap);
      } catch (error) {
        throw new Error(`Failed to lock swap ${swap.id}: ${error.message}`);
      }
    }
  }
  
  // Phase 2: Execute locked swaps
  private async executeLockedSwaps(swaps: AtomicSwap[]): Promise<void> {
    for (const swap of swaps) {
      try {
        const secret = this.secretStore.get(swap.id);
        if (!secret) {
          throw new Error(`Secret not found for swap ${swap.id}`);
        }
        
        // Verify hashlock
        const hash = crypto.createHash('sha256').update(secret).digest('hex');
        if (hash !== swap.hashlock) {
          throw new Error(`Invalid hashlock for swap ${swap.id}`);
        }
        
        // Execute the swap
        await this.transferFunds(swap);
        swap.secret = secret;
        swap.executedAt = Date.now();
        
      } catch (error) {
        throw new Error(`Failed to execute swap ${swap.id}: ${error.message}`);
      }
    }
  }
  
  // Phase 3: Complete all swaps
  private async completeSwaps(swaps: AtomicSwap[]): Promise<void> {
    for (const swap of swaps) {
      swap.status = 'EXECUTED';
      this.emit('swapCompleted', swap);
      
      // Clean up secret
      this.secretStore.delete(swap.id);
    }
  }
  
  // Revert swaps in case of failure
  private async revertSwaps(swaps: AtomicSwap[]): Promise<void> {
    for (const swap of swaps) {
      if (swap.status === 'LOCKED' || swap.status === 'EXECUTED') {
        try {
          await this.unlockFunds(swap);
          swap.status = 'REVERTED';
          this.emit('swapReverted', swap);
        } catch (error) {
          console.error(`Failed to revert swap ${swap.id}:`, error);
        }
      }
    }
  }
  
  // Simulate locking funds
  private async lockFunds(swap: AtomicSwap): Promise<void> {
    // In real implementation, this would interact with smart contracts
    // to lock funds in an escrow contract
    await this.simulateBlockchainDelay();
  }
  
  // Simulate transferring funds
  private async transferFunds(swap: AtomicSwap): Promise<void> {
    // In real implementation, this would execute the actual transfer
    // on the blockchain using the revealed secret
    await this.simulateBlockchainDelay();
  }
  
  // Simulate unlocking funds
  private async unlockFunds(swap: AtomicSwap): Promise<void> {
    // In real implementation, this would unlock funds from escrow
    await this.simulateBlockchainDelay();
  }
  
  // Monitor timelocks and auto-revert expired swaps
  private startTimelockMonitor(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [id, swap] of this.swaps) {
        if (swap.status === 'LOCKED' && swap.timelock < now) {
          this.revertExpiredSwap(swap);
        }
      }
    }, 60000); // Check every minute
  }
  
  // Revert expired swap
  private async revertExpiredSwap(swap: AtomicSwap): Promise<void> {
    try {
      await this.unlockFunds(swap);
      swap.status = 'REVERTED';
      this.emit('swapExpired', swap);
    } catch (error) {
      console.error(`Failed to revert expired swap ${swap.id}:`, error);
    }
  }
  
  // Group net positions into swap pairs
  private groupNetPositionsIntoSwaps(netAmounts: NetPosition[]): any[] {
    const swapPairs: any[] = [];
    
    // Simple pairing algorithm - in production, use more sophisticated matching
    const processed = new Set<string>();
    
    for (const position of netAmounts) {
      if (processed.has(position.userId)) continue;
      
      // Find a counterparty with opposite position
      const counterparty = netAmounts.find(p => 
        !processed.has(p.userId) && 
        p.userId !== position.userId &&
        p.token !== position.token &&
        p.netAmount !== BigInt(0) &&
        position.netAmount !== BigInt(0)
      );
      
      if (counterparty) {
        swapPairs.push({
          from: position.netAmount < 0 ? position.userId : counterparty.userId,
          to: position.netAmount < 0 ? counterparty.userId : position.userId,
          fromToken: position.netAmount < 0 ? position.token : counterparty.token,
          toToken: position.netAmount < 0 ? counterparty.token : position.token,
          fromAmount: position.netAmount < 0 ? -position.netAmount : -counterparty.netAmount,
          toAmount: position.netAmount < 0 ? counterparty.netAmount : position.netAmount
        });
        
        processed.add(position.userId);
        processed.add(counterparty.userId);
      }
    }
    
    return swapPairs;
  }
  
  // Simulate blockchain delay
  private async simulateBlockchainDelay(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Get swap by ID
  public getSwap(swapId: string): AtomicSwap | undefined {
    return this.swaps.get(swapId);
  }
  
  // Get all swaps for a user
  public getUserSwaps(userId: string): AtomicSwap[] {
    return Array.from(this.swaps.values()).filter(swap => 
      swap.fromUserId === userId || swap.toUserId === userId
    );
  }
}