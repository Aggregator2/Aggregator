import { ethers } from 'ethers';
import { EventEmitter } from 'events';
import { ChannelState, StateManager } from './StateManager';

export enum DisputeStatus {
  None = 'None',
  Initiated = 'Initiated',
  Responded = 'Responded',
  TimedOut = 'TimedOut',
  Resolved = 'Resolved'
}

export interface Dispute {
  channelId: string;
  initiator: string;
  challengedState: ChannelState;
  responseState?: ChannelState;
  status: DisputeStatus;
  initiatedAt: number;
  challengePeriodEnd: number;
  resolved: boolean;
}

export interface DisputeEvidence {
  state: ChannelState;
  signatures: string[];
  proof?: any;
}

export class DisputeManager extends EventEmitter {
  private disputes: Map<string, Dispute>;
  private stateManager: StateManager;
  private provider: ethers.providers.Provider;
  private challengePeriod: number;

  constructor(
    stateManager: StateManager,
    provider: ethers.providers.Provider,
    challengePeriodSeconds: number = 3600
  ) {
    super();
    this.stateManager = stateManager;
    this.provider = provider;
    this.challengePeriod = challengePeriodSeconds * 1000;
    this.disputes = new Map();
  }

  async initiateDispute(
    channelId: string,
    initiator: string,
    evidence: DisputeEvidence
  ): Promise<Dispute> {
    const existingDispute = this.disputes.get(channelId);
    if (existingDispute && existingDispute.status === DisputeStatus.Initiated) {
      throw new Error('Dispute already active for this channel');
    }

    const currentState = this.stateManager.getState(channelId);
    if (!currentState) {
      throw new Error('Channel state not found');
    }

    if (evidence.state.nonce <= currentState.nonce) {
      throw new Error('Challenged state nonce must be higher than current state');
    }

    const dispute: Dispute = {
      channelId,
      initiator,
      challengedState: evidence.state,
      status: DisputeStatus.Initiated,
      initiatedAt: Date.now(),
      challengePeriodEnd: Date.now() + this.challengePeriod,
      resolved: false
    };

    this.disputes.set(channelId, dispute);
    this.emit('disputeInitiated', dispute);

    this.scheduleTimeout(channelId);

    return dispute;
  }

  async respondToDispute(
    channelId: string,
    responder: string,
    evidence: DisputeEvidence
  ): Promise<void> {
    const dispute = this.disputes.get(channelId);
    if (!dispute) {
      throw new Error('No active dispute found');
    }

    if (dispute.status !== DisputeStatus.Initiated) {
      throw new Error('Dispute is not in a state that can be responded to');
    }

    if (Date.now() >= dispute.challengePeriodEnd) {
      throw new Error('Challenge period has ended');
    }

    if (evidence.state.nonce <= dispute.challengedState.nonce) {
      throw new Error('Response state nonce must be higher than challenged state');
    }

    dispute.responseState = evidence.state;
    dispute.status = DisputeStatus.Responded;
    
    this.emit('disputeResponded', dispute, responder);

    await this.resolveDispute(channelId, dispute.responseState);
  }

  async checkTimeouts(): Promise<void> {
    const now = Date.now();
    
    for (const [channelId, dispute] of this.disputes) {
      if (
        dispute.status === DisputeStatus.Initiated &&
        now >= dispute.challengePeriodEnd &&
        !dispute.resolved
      ) {
        await this.handleTimeout(channelId);
      }
    }
  }

  private async handleTimeout(channelId: string): Promise<void> {
    const dispute = this.disputes.get(channelId);
    if (!dispute) return;

    dispute.status = DisputeStatus.TimedOut;
    dispute.resolved = true;

    this.emit('disputeTimedOut', dispute);

    await this.resolveDispute(channelId, dispute.challengedState);
  }

  private async resolveDispute(
    channelId: string,
    finalState: ChannelState
  ): Promise<void> {
    const dispute = this.disputes.get(channelId);
    if (!dispute) return;

    dispute.status = DisputeStatus.Resolved;
    dispute.resolved = true;

    this.emit('disputeResolved', channelId, finalState);
  }

  private scheduleTimeout(channelId: string): void {
    const dispute = this.disputes.get(channelId);
    if (!dispute) return;

    const timeUntilTimeout = dispute.challengePeriodEnd - Date.now();
    if (timeUntilTimeout > 0) {
      setTimeout(() => {
        this.handleTimeout(channelId).catch(err => {
          this.emit('error', err);
        });
      }, timeUntilTimeout);
    }
  }

  getDispute(channelId: string): Dispute | undefined {
    return this.disputes.get(channelId);
  }

  getAllDisputes(): Dispute[] {
    return Array.from(this.disputes.values());
  }

  getActiveDisputes(): Dispute[] {
    return Array.from(this.disputes.values()).filter(
      d => d.status === DisputeStatus.Initiated
    );
  }

  async generateDisputeEvidence(
    channelId: string,
    participants: string[]
  ): Promise<DisputeEvidence> {
    const state = this.stateManager.getState(channelId);
    if (!state) {
      throw new Error('State not found');
    }

    const signatures: string[] = [];
    for (const participant of participants) {
      const sig = state.signatures.get(participant);
      if (!sig) {
        throw new Error(`Missing signature from ${participant}`);
      }
      signatures.push(sig);
    }

    return {
      state,
      signatures
    };
  }

  async validateEvidence(
    evidence: DisputeEvidence,
    participants: string[]
  ): Promise<boolean> {
    if (evidence.signatures.length !== participants.length) {
      return false;
    }

    return await this.stateManager.verifyStateSignatures(
      evidence.state.channelId,
      evidence.state,
      participants
    );
  }

  clearResolvedDisputes(): void {
    const resolved = Array.from(this.disputes.entries())
      .filter(([_, dispute]) => dispute.resolved);

    for (const [channelId] of resolved) {
      this.disputes.delete(channelId);
    }
  }
}