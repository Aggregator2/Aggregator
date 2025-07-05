import { ethers } from 'ethers';
import { EventEmitter } from 'events';

export interface ChannelState {
  channelId: string;
  nonce: number;
  balances: Map<string, bigint>;
  stateRoot: string;
  timestamp: number;
  signatures: Map<string, string>;
}

export interface Trade {
  id: string;
  from: string;
  to: string;
  amount: bigint;
  timestamp: number;
  metadata?: any;
}

export interface StateUpdate {
  nonce: number;
  stateRoot: string;
  balances: bigint[];
  participants: string[];
}

export class StateManager extends EventEmitter {
  private states: Map<string, ChannelState>;
  private pendingTrades: Map<string, Trade[]>;
  private stateHistory: Map<string, ChannelState[]>;
  private signer: ethers.Signer;

  constructor(signer: ethers.Signer) {
    super();
    this.signer = signer;
    this.states = new Map();
    this.pendingTrades = new Map();
    this.stateHistory = new Map();
  }

  async initializeChannel(
    channelId: string,
    participants: string[],
    initialBalances: Map<string, bigint>
  ): Promise<ChannelState> {
    const state: ChannelState = {
      channelId,
      nonce: 0,
      balances: new Map(initialBalances),
      stateRoot: this.calculateStateRoot(initialBalances),
      timestamp: Date.now(),
      signatures: new Map()
    };

    this.states.set(channelId, state);
    this.stateHistory.set(channelId, [state]);
    this.pendingTrades.set(channelId, []);

    this.emit('channelInitialized', channelId, state);
    return state;
  }

  async proposeTrade(channelId: string, trade: Trade): Promise<void> {
    const currentState = this.states.get(channelId);
    if (!currentState) {
      throw new Error('Channel not found');
    }

    const fromBalance = currentState.balances.get(trade.from);
    if (!fromBalance || fromBalance.lt(trade.amount)) {
      throw new Error('Insufficient balance');
    }

    const trades = this.pendingTrades.get(channelId) || [];
    trades.push(trade);
    this.pendingTrades.set(channelId, trades);

    this.emit('tradeProposed', channelId, trade);
  }

  async applyTrades(channelId: string): Promise<ChannelState> {
    const currentState = this.states.get(channelId);
    if (!currentState) {
      throw new Error('Channel not found');
    }

    const trades = this.pendingTrades.get(channelId) || [];
    if (trades.length === 0) {
      return currentState;
    }

    const newBalances = new Map(currentState.balances);

    for (const trade of trades) {
      const fromBalance = newBalances.get(trade.from);
      const toBalance = newBalances.get(trade.to) || BigInt(0);

      if (!fromBalance || fromBalance.lt(trade.amount)) {
        throw new Error(`Insufficient balance for trade ${trade.id}`);
      }

      newBalances.set(trade.from, fromBalance.sub(trade.amount));
      newBalances.set(trade.to, toBalance.add(trade.amount));
    }

    const newState: ChannelState = {
      channelId,
      nonce: currentState.nonce + 1,
      balances: newBalances,
      stateRoot: this.calculateStateRoot(newBalances),
      timestamp: Date.now(),
      signatures: new Map()
    };

    this.states.set(channelId, newState);
    
    const history = this.stateHistory.get(channelId) || [];
    history.push(newState);
    this.stateHistory.set(channelId, history);
    
    this.pendingTrades.set(channelId, []);

    this.emit('stateUpdated', channelId, newState, trades);
    return newState;
  }

  async signState(channelId: string, state?: ChannelState): Promise<string> {
    const stateToSign = state || this.states.get(channelId);
    if (!stateToSign) {
      throw new Error('State not found');
    }

    const message = this.encodeStateForSigning(channelId, stateToSign);
    const signature = await this.signer.signMessage(ethers.utils.arrayify(message));
    
    const signerAddress = await this.signer.getAddress();
    stateToSign.signatures.set(signerAddress, signature);

    return signature;
  }

  async verifyStateSignatures(
    channelId: string,
    state: ChannelState,
    participants: string[]
  ): Promise<boolean> {
    const message = this.encodeStateForSigning(channelId, state);
    
    for (const participant of participants) {
      const signature = state.signatures.get(participant);
      if (!signature) {
        return false;
      }

      const recoveredAddress = ethers.utils.verifyMessage(
        ethers.utils.arrayify(message),
        signature
      );

      if (recoveredAddress.toLowerCase() !== participant.toLowerCase()) {
        return false;
      }
    }

    return true;
  }

  getState(channelId: string): ChannelState | undefined {
    return this.states.get(channelId);
  }

  getStateHistory(channelId: string): ChannelState[] {
    return this.stateHistory.get(channelId) || [];
  }

  getPendingTrades(channelId: string): Trade[] {
    return this.pendingTrades.get(channelId) || [];
  }

  async generateStateUpdate(channelId: string, participants: string[]): Promise<StateUpdate> {
    const state = this.states.get(channelId);
    if (!state) {
      throw new Error('State not found');
    }

    const balances: bigint[] = participants.map(
      p => state.balances.get(p) || BigInt(0)
    );

    return {
      nonce: state.nonce,
      stateRoot: state.stateRoot,
      balances,
      participants
    };
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

  private encodeStateForSigning(channelId: string, state: ChannelState): string {
    const sortedBalances = Array.from(state.balances.entries()).sort((a, b) => 
      a[0].toLowerCase().localeCompare(b[0].toLowerCase())
    );

    return ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['bytes32', 'uint256', 'bytes32', 'uint256[]', 'uint256'],
        [
          channelId,
          state.nonce,
          state.stateRoot,
          sortedBalances.map(([_, bal]) => bal.toString()),
          31337 // chainId - should be parameterized
        ]
      )
    );
  }

  async exportState(channelId: string): Promise<string> {
    const state = this.states.get(channelId);
    if (!state) {
      throw new Error('State not found');
    }

    const exportData = {
      channelId,
      nonce: state.nonce,
      balances: Array.from(state.balances.entries()).map(([addr, bal]) => ({
        address: addr,
        balance: bal.toString()
      })),
      stateRoot: state.stateRoot,
      timestamp: state.timestamp,
      signatures: Array.from(state.signatures.entries())
    };

    return JSON.stringify(exportData, null, 2);
  }

  async importState(exportedState: string): Promise<void> {
    const data = JSON.parse(exportedState);
    
    const state: ChannelState = {
      channelId: data.channelId,
      nonce: data.nonce,
      balances: new Map(
        data.balances.map((b: any) => [b.address, BigInt(b.balance)])
      ),
      stateRoot: data.stateRoot,
      timestamp: data.timestamp,
      signatures: new Map(data.signatures)
    };

    this.states.set(data.channelId, state);
    this.emit('stateImported', data.channelId, state);
  }
}