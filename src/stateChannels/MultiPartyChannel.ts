import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { StateManager, ChannelState, Trade } from './StateManager';

export interface LiquidityProvider {
  address: string;
  role: 'maker' | 'taker' | 'both';
  minBalance: bigint;
  maxBalance: bigint;
  feeRate: number; // basis points
}

export interface MultiPartyTrade extends Trade {
  route: string[]; // addresses in the routing path
  fees: Map<string, bigint>;
  liquidityProviders: string[];
}

export interface MultiPartyChannelConfig {
  channelId: string;
  participants: string[];
  liquidityProviders: LiquidityProvider[];
  minParticipants: number;
  consensusThreshold: number; // percentage required for state updates
}

export class MultiPartyChannel extends EventEmitter {
  private config: MultiPartyChannelConfig;
  private stateManager: StateManager;
  private pendingApprovals: Map<string, Map<string, boolean>>; // stateHash -> participant -> approved
  private liquidityRoutes: Map<string, string[]>; // tokenPair -> provider addresses

  constructor(config: MultiPartyChannelConfig, stateManager: StateManager) {
    super();
    this.config = config;
    this.stateManager = stateManager;
    this.pendingApprovals = new Map();
    this.liquidityRoutes = new Map();
    this.initializeLiquidityRoutes();
  }

  private initializeLiquidityRoutes(): void {
    for (const provider of this.config.liquidityProviders) {
      if (provider.role === 'maker' || provider.role === 'both') {
        // Simple routing initialization - can be made more sophisticated
        const routes = this.liquidityRoutes.get('default') || [];
        routes.push(provider.address);
        this.liquidityRoutes.set('default', routes);
      }
    }
  }

  async proposeMultiPartyTrade(trade: MultiPartyTrade): Promise<string> {
    // Validate trade involves valid participants
    const allParticipants = new Set([
      ...this.config.participants,
      ...this.config.liquidityProviders.map(lp => lp.address)
    ]);

    for (const address of trade.route) {
      if (!allParticipants.has(address)) {
        throw new Error(`Invalid participant in route: ${address}`);
      }
    }

    // Calculate fees for liquidity providers
    const fees = this.calculateFees(trade);
    trade.fees = fees;

    // Propose the trade through state manager
    await this.stateManager.proposeTrade(this.config.channelId, trade);

    // Initialize approval tracking
    const tradeHash = this.hashTrade(trade);
    this.pendingApprovals.set(tradeHash, new Map());

    this.emit('multiPartyTradeProposed', trade, tradeHash);
    return tradeHash;
  }

  async approveTrade(tradeHash: string, participant: string): Promise<boolean> {
    const approvals = this.pendingApprovals.get(tradeHash);
    if (!approvals) {
      throw new Error('Trade not found');
    }

    if (!this.isValidParticipant(participant)) {
      throw new Error('Invalid participant');
    }

    approvals.set(participant, true);

    // Check if we have enough approvals
    const approvalCount = Array.from(approvals.values()).filter(v => v).length;
    const requiredApprovals = Math.ceil(
      this.config.participants.length * (this.config.consensusThreshold / 100)
    );

    if (approvalCount >= requiredApprovals) {
      await this.executeTrade(tradeHash);
      return true;
    }

    this.emit('tradeApproved', tradeHash, participant, approvalCount, requiredApprovals);
    return false;
  }

  private async executeTrade(tradeHash: string): Promise<void> {
    const trades = this.stateManager.getPendingTrades(this.config.channelId);
    
    // Apply all pending trades
    const newState = await this.stateManager.applyTrades(this.config.channelId);
    
    // Clean up approvals
    this.pendingApprovals.delete(tradeHash);

    this.emit('tradeExecuted', tradeHash, newState);
  }

  async proposeStateUpdate(
    nonce: number,
    balances: Map<string, bigint>
  ): Promise<string> {
    // Validate all participants have balances
    for (const participant of this.config.participants) {
      if (!balances.has(participant)) {
        throw new Error(`Missing balance for participant: ${participant}`);
      }
    }

    // Create state update
    const state: ChannelState = {
      channelId: this.config.channelId,
      nonce,
      balances,
      stateRoot: this.calculateStateRoot(balances),
      timestamp: Date.now(),
      signatures: new Map()
    };

    const stateHash = this.hashState(state);
    this.pendingApprovals.set(stateHash, new Map());

    this.emit('stateUpdateProposed', state, stateHash);
    return stateHash;
  }

  async signStateUpdate(stateHash: string, signer: ethers.Signer): Promise<string> {
    const participant = await signer.getAddress();
    if (!this.isValidParticipant(participant)) {
      throw new Error('Signer is not a valid participant');
    }

    const signature = await this.stateManager.signState(this.config.channelId);
    
    const approvals = this.pendingApprovals.get(stateHash);
    if (approvals) {
      approvals.set(participant, true);
    }

    return signature;
  }

  findLiquidityRoute(
    from: string,
    to: string,
    amount: bigint
  ): string[] | null {
    // Simple pathfinding - can be replaced with more sophisticated algorithms
    const providers = this.config.liquidityProviders;
    
    // Direct path
    for (const provider of providers) {
      const providerBalance = this.stateManager.getState(this.config.channelId)
        ?.balances.get(provider.address);
        
      if (providerBalance && providerBalance.gte(amount)) {
        return [from, provider.address, to];
      }
    }

    // Multi-hop path (simplified)
    const route: string[] = [from];
    let currentAmount = amount;

    for (const provider of providers) {
      if (provider.role === 'maker' || provider.role === 'both') {
        route.push(provider.address);
        
        // Add fees
        const fee = currentAmount.mul(provider.feeRate).div(10000);
        currentAmount = currentAmount.add(fee);
      }
    }

    route.push(to);
    return route.length > 2 ? route : null;
  }

  private calculateFees(trade: MultiPartyTrade): Map<string, bigint> {
    const fees = new Map<string, bigint>();
    
    for (const lpAddress of trade.liquidityProviders) {
      const provider = this.config.liquidityProviders.find(
        lp => lp.address === lpAddress
      );
      
      if (provider) {
        const fee = trade.amount.mul(provider.feeRate).div(10000);
        fees.set(lpAddress, fee);
      }
    }

    return fees;
  }

  private isValidParticipant(address: string): boolean {
    return this.config.participants.includes(address) ||
           this.config.liquidityProviders.some(lp => lp.address === address);
  }

  private hashTrade(trade: Trade): string {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'address', 'address', 'uint256', 'uint256'],
        [trade.id, trade.from, trade.to, trade.amount.toString(), trade.timestamp]
      )
    );
  }

  private hashState(state: ChannelState): string {
    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'uint256', 'bytes32', 'uint256'],
        [state.channelId, state.nonce, state.stateRoot, state.timestamp]
      )
    );
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

  getConfig(): MultiPartyChannelConfig {
    return this.config;
  }

  getLiquidityProviders(): LiquidityProvider[] {
    return this.config.liquidityProviders;
  }

  getPendingApprovals(hash: string): Map<string, boolean> | undefined {
    return this.pendingApprovals.get(hash);
  }
}