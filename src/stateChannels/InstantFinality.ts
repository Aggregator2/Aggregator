import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { StateManager, ChannelState, Trade } from './StateManager';

export interface InstantTrade {
  id: string;
  channelId: string;
  from: string;
  to: string;
  amount: bigint;
  timestamp: number;
  finalityProof: FinalityProof;
  executed: boolean;
}

export interface FinalityProof {
  tradeHash: string;
  signatures: Map<string, string>;
  timestamp: number;
  blockNumber: number;
}

export interface FinalityConfig {
  requiredSignatures: number;
  maxTradeAmount: bigint;
  minConfirmationTime: number; // milliseconds
  maxPendingTrades: number;
}

export class InstantFinalityEngine extends EventEmitter {
  private stateManager: StateManager;
  private config: FinalityConfig;
  private pendingTrades: Map<string, InstantTrade>;
  private executedTrades: Map<string, InstantTrade>;
  private tradeNonces: Map<string, number>; // channelId -> nonce

  constructor(stateManager: StateManager, config: FinalityConfig) {
    super();
    this.stateManager = stateManager;
    this.config = config;
    this.pendingTrades = new Map();
    this.executedTrades = new Map();
    this.tradeNonces = new Map();
  }

  async initiateInstantTrade(
    channelId: string,
    from: string,
    to: string,
    amount: bigint,
    signer: ethers.Signer
  ): Promise<InstantTrade> {
    // Validate trade parameters
    if (amount.gt(this.config.maxTradeAmount)) {
      throw new Error('Trade amount exceeds maximum allowed for instant finality');
    }

    const pendingCount = Array.from(this.pendingTrades.values())
      .filter(t => t.channelId === channelId).length;
    
    if (pendingCount >= this.config.maxPendingTrades) {
      throw new Error('Too many pending trades for this channel');
    }

    // Check balance
    const state = this.stateManager.getState(channelId);
    if (!state) {
      throw new Error('Channel state not found');
    }

    const fromBalance = state.balances.get(from);
    if (!fromBalance || fromBalance.lt(amount)) {
      throw new Error('Insufficient balance for instant trade');
    }

    // Generate trade ID
    const nonce = (this.tradeNonces.get(channelId) || 0) + 1;
    this.tradeNonces.set(channelId, nonce);
    
    const tradeId = this.generateTradeId(channelId, from, to, nonce);
    const tradeHash = this.hashTrade(tradeId, channelId, from, to, amount, Date.now());

    // Create instant trade
    const trade: InstantTrade = {
      id: tradeId,
      channelId,
      from,
      to,
      amount,
      timestamp: Date.now(),
      finalityProof: {
        tradeHash,
        signatures: new Map(),
        timestamp: Date.now(),
        blockNumber: await this.getCurrentBlockNumber()
      },
      executed: false
    };

    // Sign the trade
    const signature = await this.signTrade(trade, signer);
    trade.finalityProof.signatures.set(await signer.getAddress(), signature);

    this.pendingTrades.set(tradeId, trade);
    this.emit('instantTradeInitiated', trade);

    return trade;
  }

  async confirmInstantTrade(
    tradeId: string,
    signer: ethers.Signer
  ): Promise<boolean> {
    const trade = this.pendingTrades.get(tradeId);
    if (!trade) {
      throw new Error('Trade not found');
    }

    if (trade.executed) {
      throw new Error('Trade already executed');
    }

    const signerAddress = await signer.getAddress();
    if (trade.finalityProof.signatures.has(signerAddress)) {
      throw new Error('Already signed by this address');
    }

    // Add signature
    const signature = await this.signTrade(trade, signer);
    trade.finalityProof.signatures.set(signerAddress, signature);

    // Check if we have enough signatures
    if (trade.finalityProof.signatures.size >= this.config.requiredSignatures) {
      await this.executeTrade(trade);
      return true;
    }

    this.emit('instantTradeConfirmed', trade, signerAddress);
    return false;
  }

  private async executeTrade(trade: InstantTrade): Promise<void> {
    // Validate timing constraint
    const timeSinceInitiation = Date.now() - trade.timestamp;
    if (timeSinceInitiation < this.config.minConfirmationTime) {
      throw new Error('Minimum confirmation time not met');
    }

    // Update state immediately
    const state = this.stateManager.getState(trade.channelId);
    if (!state) {
      throw new Error('Channel state not found');
    }

    const fromBalance = state.balances.get(trade.from);
    const toBalance = state.balances.get(trade.to) || BigInt(0);

    if (!fromBalance || fromBalance.lt(trade.amount)) {
      throw new Error('Insufficient balance at execution time');
    }

    // Apply the trade
    const newBalances = new Map(state.balances);
    newBalances.set(trade.from, fromBalance.sub(trade.amount));
    newBalances.set(trade.to, toBalance.add(trade.amount));

    // Create new state with instant finality
    const newState: ChannelState = {
      channelId: trade.channelId,
      nonce: state.nonce + 1,
      balances: newBalances,
      stateRoot: this.calculateStateRoot(newBalances),
      timestamp: Date.now(),
      signatures: new Map()
    };

    // Update state manager
    await this.updateStateWithFinality(trade.channelId, newState);

    // Mark trade as executed
    trade.executed = true;
    this.executedTrades.set(trade.id, trade);
    this.pendingTrades.delete(trade.id);

    this.emit('instantTradeExecuted', trade, newState);
  }

  async cancelExpiredTrades(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];

    for (const [tradeId, trade] of this.pendingTrades) {
      // Cancel trades that haven't received enough signatures within a reasonable time
      const expirationTime = trade.timestamp + (this.config.minConfirmationTime * 10);
      
      if (now > expirationTime && !trade.executed) {
        expired.push(tradeId);
      }
    }

    for (const tradeId of expired) {
      const trade = this.pendingTrades.get(tradeId);
      if (trade) {
        this.pendingTrades.delete(tradeId);
        this.emit('instantTradeCancelled', trade, 'Expired');
      }
    }
  }

  async verifyFinalityProof(trade: InstantTrade): Promise<boolean> {
    // Verify all signatures
    const message = this.createTradeMessage(trade);
    
    for (const [signer, signature] of trade.finalityProof.signatures) {
      const recoveredAddress = ethers.utils.verifyMessage(
        ethers.utils.arrayify(message),
        signature
      );

      if (recoveredAddress.toLowerCase() !== signer.toLowerCase()) {
        return false;
      }
    }

    // Verify signature count
    return trade.finalityProof.signatures.size >= this.config.requiredSignatures;
  }

  private async signTrade(trade: InstantTrade, signer: ethers.Signer): Promise<string> {
    const message = this.createTradeMessage(trade);
    return await signer.signMessage(ethers.utils.arrayify(message));
  }

  private createTradeMessage(trade: InstantTrade): string {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'string', 'address', 'address', 'uint256', 'uint256', 'uint256'],
        [
          trade.id,
          trade.channelId,
          trade.from,
          trade.to,
          trade.amount.toString(),
          trade.timestamp,
          trade.finalityProof.blockNumber
        ]
      )
    );
  }

  private hashTrade(
    id: string,
    channelId: string,
    from: string,
    to: string,
    amount: bigint,
    timestamp: number
  ): string {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'string', 'address', 'address', 'uint256', 'uint256'],
        [id, channelId, from, to, amount.toString(), timestamp]
      )
    );
  }

  private generateTradeId(
    channelId: string,
    from: string,
    to: string,
    nonce: number
  ): string {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'address', 'address', 'uint256', 'uint256'],
        [channelId, from, to, nonce, Date.now()]
      )
    ).slice(0, 10); // Use first 10 chars for brevity
  }

  private calculateStateRoot(balances: Map<string, bigint>): string {
    const sortedEntries = Array.from(balances.entries()).sort((a, b) => 
      a[0].toLowerCase().localeCompare(b[0].toLowerCase())
    );
    
    const encoded = ethers.utils.defaultAbiCoder.encode(
      ['tuple(address,uint256)[]'],
      [sortedEntries.map(([addr, bal]) => [addr, bal.toString()])]
    );

    return ethers.utils.keccak256(encoded);
  }

  private async updateStateWithFinality(
    channelId: string,
    newState: ChannelState
  ): Promise<void> {
    // This would integrate with the state manager to ensure atomic updates
    // For now, we'll emit an event that the state manager can listen to
    this.emit('stateUpdateWithFinality', channelId, newState);
  }

  private async getCurrentBlockNumber(): Promise<number> {
    // This would connect to a provider in production
    // For now, return a mock value
    return Math.floor(Date.now() / 1000);
  }

  getPendingTrade(tradeId: string): InstantTrade | undefined {
    return this.pendingTrades.get(tradeId);
  }

  getExecutedTrade(tradeId: string): InstantTrade | undefined {
    return this.executedTrades.get(tradeId);
  }

  getPendingTradesForChannel(channelId: string): InstantTrade[] {
    return Array.from(this.pendingTrades.values())
      .filter(t => t.channelId === channelId);
  }

  getConfig(): FinalityConfig {
    return this.config;
  }
}