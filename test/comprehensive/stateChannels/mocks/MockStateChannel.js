"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockInstantFinalityEngine = exports.MockDisputeManager = exports.MockStateManager = void 0;
// Mock implementations for state channel testing
const events_1 = require("events");
const ethers_1 = require("ethers");
class MockStateManager extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.channels = new Map();
    }
    async createChannel(channelId, participants) {
        this.channels.set(channelId, {
            id: channelId,
            participants,
            nonce: 0,
            isOpen: true,
            balances: {}
        });
    }
    getChannel(channelId) {
        return this.channels.get(channelId);
    }
    hashState(state) {
        // Convert balances to a serializable format
        const balanceArray = Object.entries(state.balances).map(([address, balance]) => ({
            address,
            amount: balance.toString()
        }));
        const encoded = ethers_1.ethers.AbiCoder.defaultAbiCoder().encode(['string', 'uint256', 'bytes32'], [
            state.channelId,
            state.nonce,
            ethers_1.ethers.keccak256(ethers_1.ethers.toUtf8Bytes(JSON.stringify(balanceArray)))
        ]);
        return ethers_1.ethers.keccak256(encoded);
    }
    async updateState(channelId, state, signatures) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error('Channel not found');
        if (state.nonce <= channel.nonce)
            throw new Error('Invalid nonce');
        channel.nonce = state.nonce;
        channel.balances = state.balances;
    }
    async closeChannel(channelId, finalState, signatures) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error('Channel not found');
        channel.isOpen = false;
        channel.balances = finalState.balances;
    }
    async initiateUnilateralClose(channelId, initiator) {
        const channel = this.channels.get(channelId);
        if (!channel)
            throw new Error('Channel not found');
        channel.closingInitiated = true;
        channel.closingInitiator = initiator;
    }
}
exports.MockStateManager = MockStateManager;
class MockDisputeManager extends events_1.EventEmitter {
    constructor(stateManager, provider, challengePeriod) {
        super();
        this.stateManager = stateManager;
        this.provider = provider;
        this.challengePeriod = challengePeriod;
        this.disputes = new Map();
        this.disputeCounter = 0;
    }
    async initiateDispute(channelId, initiator) {
        const disputeId = `dispute-${++this.disputeCounter}`;
        const dispute = {
            id: disputeId,
            channelId,
            initiator,
            timestamp: Date.now()
        };
        this.disputes.set(disputeId, dispute);
        return dispute;
    }
    async submitEvidence(disputeId, state, signatures) {
        const dispute = this.disputes.get(disputeId);
        if (!dispute)
            throw new Error('Dispute not found');
        // Mock evidence submission
        this.emit('evidenceSubmitted', { disputeId, state });
    }
    async resolveDispute(disputeId) {
        const dispute = this.disputes.get(disputeId);
        if (!dispute)
            throw new Error('Dispute not found');
        // Mock resolution
        this.emit('disputeResolved', { disputeId });
        return { resolved: true };
    }
}
exports.MockDisputeManager = MockDisputeManager;
class MockInstantFinalityEngine extends events_1.EventEmitter {
    constructor(stateManager, config) {
        super();
        this.stateManager = stateManager;
        this.config = config;
    }
}
exports.MockInstantFinalityEngine = MockInstantFinalityEngine;
