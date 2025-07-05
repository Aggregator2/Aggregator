// Mock implementations for state channel testing
import { EventEmitter } from 'events';
import { ethers } from 'ethers';

export interface Channel {
  id: string;
  participants: string[];
  nonce: number;
  isOpen: boolean;
  balances: { [address: string]: bigint };
  closingInitiated?: boolean;
  closingInitiator?: string;
}

export interface State {
  channelId: string;
  nonce: number;
  balances: { [address: string]: bigint };
  isFinal?: boolean;
}

export interface Dispute {
  id: string;
  channelId: string;
  initiator: string;
  timestamp: number;
}

export class MockStateManager extends EventEmitter {
  private channels: Map<string, Channel> = new Map();
  
  async createChannel(channelId: string, participants: string[]): Promise<void> {
    this.channels.set(channelId, {
      id: channelId,
      participants,
      nonce: 0,
      isOpen: true,
      balances: {}
    });
  }
  
  getChannel(channelId: string): Channel | undefined {
    return this.channels.get(channelId);
  }
  
  hashState(state: State): string {
    // Convert balances to a serializable format
    const balanceArray = Object.entries(state.balances).map(([address, balance]) => ({
      address,
      amount: balance.toString()
    }));
    
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'bytes32'],
      [
        state.channelId,
        state.nonce,
        ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(balanceArray)))
      ]
    );
    return ethers.keccak256(encoded);
  }
  
  async updateState(channelId: string, state: State, signatures: string[]): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    if (state.nonce <= channel.nonce) throw new Error('Invalid nonce');
    
    channel.nonce = state.nonce;
    channel.balances = state.balances;
  }
  
  async closeChannel(channelId: string, finalState: State, signatures: string[]): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    
    channel.isOpen = false;
    channel.balances = finalState.balances;
  }
  
  async initiateUnilateralClose(channelId: string, initiator: string): Promise<void> {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error('Channel not found');
    
    channel.closingInitiated = true;
    channel.closingInitiator = initiator;
  }
}

export class MockDisputeManager extends EventEmitter {
  private disputes: Map<string, Dispute> = new Map();
  private disputeCounter = 0;
  
  constructor(
    private stateManager: MockStateManager,
    private provider: ethers.Provider,
    private challengePeriod: number
  ) {
    super();
  }
  
  async initiateDispute(channelId: string, initiator: string): Promise<Dispute> {
    const disputeId = `dispute-${++this.disputeCounter}`;
    const dispute: Dispute = {
      id: disputeId,
      channelId,
      initiator,
      timestamp: Date.now()
    };
    
    this.disputes.set(disputeId, dispute);
    return dispute;
  }
  
  async submitEvidence(disputeId: string, state: State, signatures: string[]): Promise<void> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new Error('Dispute not found');
    
    // Mock evidence submission
    this.emit('evidenceSubmitted', { disputeId, state });
  }
  
  async resolveDispute(disputeId: string): Promise<{ resolved: boolean }> {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw new Error('Dispute not found');
    
    // Mock resolution
    this.emit('disputeResolved', { disputeId });
    return { resolved: true };
  }
}

export class MockInstantFinalityEngine extends EventEmitter {
  constructor(
    private stateManager: MockStateManager,
    private config: any
  ) {
    super();
  }
}