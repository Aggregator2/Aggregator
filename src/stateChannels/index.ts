export * from './StateManager';
export * from './DisputeManager';
export * from './MultiPartyChannel';
export * from './InstantFinality';

import { ethers } from 'ethers';
import { StateManager } from './StateManager';
import { DisputeManager } from './DisputeManager';
import { MultiPartyChannel, MultiPartyChannelConfig } from './MultiPartyChannel';
import { InstantFinalityEngine, FinalityConfig } from './InstantFinality';

export interface StateChannelSDKConfig {
  provider: ethers.providers.Provider;
  signer: ethers.Signer;
  factoryAddress: string;
  challengePeriodSeconds?: number;
  finalityConfig?: Partial<FinalityConfig>;
}

export class StateChannelSDK {
  private provider: ethers.providers.Provider;
  private signer: ethers.Signer;
  private stateManager: StateManager;
  private disputeManager: DisputeManager;
  private instantFinality: InstantFinalityEngine;
  private factoryAddress: string;

  constructor(config: StateChannelSDKConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.factoryAddress = config.factoryAddress;

    // Initialize core components
    this.stateManager = new StateManager(this.signer);
    this.disputeManager = new DisputeManager(
      this.stateManager,
      this.provider,
      config.challengePeriodSeconds || 3600
    );

    // Initialize instant finality
    const finalityConfig: FinalityConfig = {
      requiredSignatures: config.finalityConfig?.requiredSignatures || 2,
      maxTradeAmount: config.finalityConfig?.maxTradeAmount || ethers.utils.parseEther('100'),
      minConfirmationTime: config.finalityConfig?.minConfirmationTime || 1000,
      maxPendingTrades: config.finalityConfig?.maxPendingTrades || 10
    };
    this.instantFinality = new InstantFinalityEngine(this.stateManager, finalityConfig);
  }

  async createChannel(
    participants: string[],
    token: string,
    challengePeriod: number,
    nonce: number
  ): Promise<string> {
    const factory = new ethers.Contract(
      this.factoryAddress,
      [
        'function createChannel(tuple(address[] participants, address token, uint256 challengePeriod, uint256 nonce) params, bytes[] signatures) returns (address)'
      ],
      this.signer
    );

    const params = {
      participants,
      token,
      challengePeriod,
      nonce
    };

    // Get signatures from all participants
    const messageHash = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'address[]', 'address', 'uint256', 'uint256', 'uint256', 'address'],
        ['StateChannel', participants, token, challengePeriod, nonce, 31337, this.factoryAddress]
      )
    );

    const signature = await this.signer.signMessage(ethers.utils.arrayify(messageHash));
    
    // In production, collect signatures from all participants
    const signatures = [signature]; // Placeholder

    const tx = await factory.createChannel(params, signatures);
    const receipt = await tx.wait();

    // Extract channel address from events
    const event = receipt.events?.find((e: any) => e.event === 'ChannelCreated');
    return event?.args?.channelAddress;
  }

  async joinChannel(
    channelId: string,
    channelAddress: string,
    participants: string[]
  ): Promise<void> {
    const signerAddress = await this.signer.getAddress();
    const participantIndex = participants.indexOf(signerAddress);
    
    if (participantIndex === -1) {
      throw new Error('Signer is not a participant in this channel');
    }

    // Initialize channel state
    const initialBalances = new Map<string, ethers.BigNumber>();
    for (const participant of participants) {
      initialBalances.set(participant, ethers.BigNumber.from(0));
    }

    await this.stateManager.initializeChannel(channelId, participants, initialBalances);
  }

  async deposit(channelAddress: string, amount: ethers.BigNumber): Promise<void> {
    const channel = new ethers.Contract(
      channelAddress,
      ['function deposit(uint256 amount)'],
      this.signer
    );

    const tx = await channel.deposit(amount);
    await tx.wait();
  }

  createMultiPartyChannel(config: MultiPartyChannelConfig): MultiPartyChannel {
    return new MultiPartyChannel(config, this.stateManager);
  }

  getStateManager(): StateManager {
    return this.stateManager;
  }

  getDisputeManager(): DisputeManager {
    return this.disputeManager;
  }

  getInstantFinalityEngine(): InstantFinalityEngine {
    return this.instantFinality;
  }
}