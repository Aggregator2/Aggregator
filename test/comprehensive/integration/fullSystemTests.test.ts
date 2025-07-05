import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { StateManager } from "../../../src/stateChannels/StateManager";
import { DisputeManager } from "../../../src/stateChannels/DisputeManager";
import { InstantFinalityEngine } from "../../../src/stateChannels/InstantFinality";
import { HFTOptimizedInstantFinality } from "../../../src/stateChannels/HFTOptimizedInstantFinality";
import { MultiPartyChannel } from "../../../src/stateChannels/MultiPartyChannel";
import { domain, types } from "../../../lib/eip712";
import { signatureService } from "../../../src/services/signatureService";

describe("Full System Integration Tests", function () {
  let stateManager: StateManager;
  let disputeManager: DisputeManager;
  let instantFinality: InstantFinalityEngine;
  let hftFinality: HFTOptimizedInstantFinality;
  
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;
  let dave: SignerWithAddress;
  
  let provider: ethers.providers.Provider;
  
  const TEST_CHAIN_ID = 31337;

  beforeEach(async function () {
    [alice, bob, carol, dave] = await ethers.getSigners();
    provider = ethers.provider;
    
    stateManager = new StateManager();
    disputeManager = new DisputeManager(stateManager, provider, 3600);
    
    instantFinality = new InstantFinalityEngine(stateManager, {
      requiredSignatures: 2,
      challengePeriod: 3600,
      maxTradeValue: ethers.utils.parseEther("10000"),
      requireInstantFinality: true
    });
    
    hftFinality = new HFTOptimizedInstantFinality(stateManager, {
      requiredSignatures: 2,
      challengePeriod: 3600,
      maxTradeValue: ethers.utils.parseEther("10000"),
      requireInstantFinality: true,
      enableParallelExecution: true,
      batchProcessingInterval: 100,
      maxBatchSize: 50,
      enableOptimisticExecution: true,
      memoryPoolSize: 1000,
      signatureCacheSize: 10000,
      enableZeroConfirmation: true
    });
  });

  describe("State Channel + Matching Engine Integration", function () {
    it("Should integrate state channels with order matching", async function () {
      const channelId = "channel-matching-001";
      
      // Create state channel
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.utils.parseEther("1000")],
          [bob.address, ethers.utils.parseEther("1000")]
        ])
      );
      
      // Create EIP-712 signed orders
      const aliceOrder = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("100"),
        buyAmount: ethers.utils.parseEther("95"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const bobOrder = {
        sellToken: "0x0000000000000000000000000000000000000002",
        buyToken: "0x0000000000000000000000000000000000000001",
        sellAmount: ethers.utils.parseEther("95"),
        buyAmount: ethers.utils.parseEther("100"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: bob.address,
        receiver: bob.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("0.5"),
        partiallyFillable: true,
        kind: "buy",
        signingScheme: "eip712"
      };
      
      // Sign orders
      const aliceSignature = await alice._signTypedData(domain, types, aliceOrder);
      const bobSignature = await bob._signTypedData(domain, types, bobOrder);
      
      // Match orders in state channel
      const matchedTrade = await instantFinality.matchAndExecuteOrders(
        channelId,
        {
          order: aliceOrder,
          signature: aliceSignature,
          signer: alice
        },
        {
          order: bobOrder,
          signature: bobSignature,
          signer: bob
        }
      );
      
      expect(matchedTrade).to.exist;
      expect(matchedTrade.executed).to.be.true;
      
      // Verify state channel balances updated
      const state = stateManager.getState(channelId);
      
      // Alice sold 100 of token1, received 95 of token2
      // Bob sold 95 of token2, received 100 of token1
      // Fees deducted
      expect(state.balances.get(alice.address)).to.be.closeTo(
        ethers.utils.parseEther("999"), // 1000 - 1 fee
        ethers.utils.parseEther("0.1")
      );
    });

    it("Should handle partial fills in state channels", async function () {
      const channelId = "channel-partial-001";
      
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address, carol.address],
        new Map([
          [alice.address, ethers.utils.parseEther("500")],
          [bob.address, ethers.utils.parseEther("300")],
          [carol.address, ethers.utils.parseEther("200")]
        ])
      );
      
      // Alice wants to sell 200, but Bob only wants to buy 150
      const aliceOrder = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("200"),
        buyAmount: ethers.utils.parseEther("190"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("2"),
        partiallyFillable: true,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const bobOrder = {
        sellToken: "0x0000000000000000000000000000000000000002",
        buyToken: "0x0000000000000000000000000000000000000001",
        sellAmount: ethers.utils.parseEther("142.5"), // 75% of Alice's order
        buyAmount: ethers.utils.parseEther("150"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: bob.address,
        receiver: bob.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("1"),
        partiallyFillable: false, // Bob's order must fill completely
        kind: "buy",
        signingScheme: "eip712"
      };
      
      const aliceSignature = await alice._signTypedData(domain, types, aliceOrder);
      const bobSignature = await bob._signTypedData(domain, types, bobOrder);
      
      // Execute partial fill
      const partialTrade = await instantFinality.matchAndExecuteOrders(
        channelId,
        {
          order: aliceOrder,
          signature: aliceSignature,
          signer: alice
        },
        {
          order: bobOrder,
          signature: bobSignature,
          signer: bob
        },
        { allowPartialFill: true }
      );
      
      expect(partialTrade.filledAmount).to.equal(ethers.utils.parseEther("150"));
      expect(partialTrade.remainingAmount).to.equal(ethers.utils.parseEther("50"));
      
      // Carol can fill the remaining
      const carolOrder = {
        sellToken: "0x0000000000000000000000000000000000000002",
        buyToken: "0x0000000000000000000000000000000000000001",
        sellAmount: ethers.utils.parseEther("47.5"),
        buyAmount: ethers.utils.parseEther("50"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: carol.address,
        receiver: carol.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("0.5"),
        partiallyFillable: true,
        kind: "buy",
        signingScheme: "eip712"
      };
      
      const carolSignature = await carol._signTypedData(domain, types, carolOrder);
      
      const finalTrade = await instantFinality.matchAndExecuteOrders(
        channelId,
        {
          order: aliceOrder,
          signature: aliceSignature,
          signer: alice,
          filledAmount: ethers.utils.parseEther("150") // Already filled
        },
        {
          order: carolOrder,
          signature: carolSignature,
          signer: carol
        },
        { allowPartialFill: true }
      );
      
      expect(finalTrade.filledAmount).to.equal(ethers.utils.parseEther("50"));
      expect(finalTrade.remainingAmount).to.equal(ethers.utils.parseEther("0"));
    });
  });

  describe("EIP-712 Signatures in Order Submission", function () {
    it("Should validate EIP-712 signatures in order flow", async function () {
      const orderData = {
        orderNumber: "ORD-INT-001",
        userId: alice.address,
        totalAmount: "250.75",
        currency: "USDC",
        items: [
          {
            productId: "TOKEN-A",
            quantity: 100,
            price: "2.5075"
          }
        ],
        nonce: "nonce-" + Date.now(),
        deadline: Math.floor(Date.now() / 1000) + 3600,
        chainId: TEST_CHAIN_ID
      };
      
      // Create order hash
      const orderHash = await signatureService.createOrderHash(orderData);
      
      // Sign order
      const serviceDomain = signatureService.getDomain(TEST_CHAIN_ID);
      const serviceTypes = signatureService.getOrderTypes();
      
      const orderValue = {
        ...orderData,
        totalAmount: ethers.utils.parseEther(orderData.totalAmount).toString(),
        items: orderData.items.map(item => ({
          ...item,
          price: ethers.utils.parseEther(item.price).toString()
        }))
      };
      
      const signature = await alice._signTypedData(serviceDomain, serviceTypes, orderValue);
      
      // Submit to state channel
      const channelId = "channel-order-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.utils.parseEther("500")],
          [bob.address, ethers.utils.parseEther("500")]
        ])
      );
      
      // Process order in channel
      const processedOrder = await stateManager.processSignedOrder(
        channelId,
        orderData,
        signature,
        alice.address
      );
      
      expect(processedOrder).to.exist;
      expect(processedOrder.verified).to.be.true;
      expect(processedOrder.orderHash).to.equal(orderHash);
    });

    it("Should handle batch order submissions", async function () {
      const channelId = "channel-batch-001";
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address, carol.address, dave.address],
        new Map([
          [alice.address, ethers.utils.parseEther("1000")],
          [bob.address, ethers.utils.parseEther("1000")],
          [carol.address, ethers.utils.parseEther("1000")],
          [dave.address, ethers.utils.parseEther("1000")]
        ])
      );
      
      // Create batch of orders
      const orders = [];
      const signatures = [];
      const participants = [alice, bob, carol, dave];
      
      for (let i = 0; i < participants.length; i++) {
        const participant = participants[i];
        const order = {
          sellToken: "0x0000000000000000000000000000000000000001",
          buyToken: "0x0000000000000000000000000000000000000002",
          sellAmount: ethers.utils.parseEther((100 + i * 10).toString()),
          buyAmount: ethers.utils.parseEther((95 + i * 10).toString()),
          validTo: Math.floor(Date.now() / 1000) + 3600,
          user: participant.address,
          receiver: participant.address,
          appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
          feeAmount: ethers.utils.parseEther("1"),
          partiallyFillable: true,
          kind: "sell",
          signingScheme: "eip712"
        };
        
        const signature = await participant._signTypedData(domain, types, order);
        
        orders.push(order);
        signatures.push(signature);
      }
      
      // Submit batch
      const batchResult = await stateManager.processBatchOrders(
        channelId,
        orders.map((order, i) => ({
          order,
          signature: signatures[i],
          signer: participants[i].address
        }))
      );
      
      expect(batchResult.processed).to.equal(orders.length);
      expect(batchResult.failed).to.equal(0);
      
      // Verify all orders were processed
      batchResult.results.forEach((result, i) => {
        expect(result.success).to.be.true;
        expect(result.orderHash).to.be.a('string');
        expect(result.signer).to.equal(participants[i].address);
      });
    });
  });

  describe("Settlement Proof Generation", function () {
    it("Should generate merkle proofs for settlements", async function () {
      const channelId = "channel-settlement-001";
      
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.utils.parseEther("500")],
          [bob.address, ethers.utils.parseEther("500")]
        ])
      );
      
      // Execute multiple trades
      const trades = [];
      for (let i = 0; i < 20; i++) {
        const from = i % 2 === 0 ? alice : bob;
        const to = i % 2 === 0 ? bob : alice;
        
        const trade = await instantFinality.initiateInstantTrade(
          channelId,
          from.address,
          to.address,
          ethers.utils.parseEther("10"),
          from
        );
        
        await instantFinality.confirmTrade(trade.id, to);
        trades.push(trade);
      }
      
      // Finalize channel
      const finalState = stateManager.getState(channelId);
      const message = stateManager.encodeState(finalState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      await stateManager.finalizeChannel(channelId, [aliceSignature, bobSignature]);
      
      // Generate settlement proof
      const settlementProof = await stateManager.generateSettlementProof(channelId);
      
      expect(settlementProof.merkleRoot).to.be.a('string');
      expect(settlementProof.trades.length).to.equal(trades.length);
      
      // Verify individual trade proofs
      for (let i = 0; i < trades.length; i++) {
        const tradeProof = settlementProof.getTradeProof(i);
        const isValid = settlementProof.verifyTradeProof(
          trades[i],
          tradeProof,
          settlementProof.merkleRoot
        );
        
        expect(isValid).to.be.true;
      }
      
      // Generate compact proof for on-chain submission
      const compactProof = settlementProof.generateCompactProof();
      expect(compactProof.root).to.equal(settlementProof.merkleRoot);
      expect(compactProof.participants).to.deep.equal([alice.address, bob.address]);
      expect(compactProof.finalBalances).to.deep.equal([
        finalState.balances.get(alice.address),
        finalState.balances.get(bob.address)
      ]);
    });

    it("Should integrate settlement proofs with on-chain contracts", async function () {
      const channelId = "channel-onchain-001";
      
      await stateManager.createChannel(
        channelId,
        [alice.address, bob.address],
        new Map([
          [alice.address, ethers.utils.parseEther("100")],
          [bob.address, ethers.utils.parseEther("100")]
        ])
      );
      
      // Execute trades
      for (let i = 0; i < 5; i++) {
        const trade = await instantFinality.initiateInstantTrade(
          channelId,
          alice.address,
          bob.address,
          ethers.utils.parseEther("10"),
          alice
        );
        await instantFinality.confirmTrade(trade.id, bob);
      }
      
      // Finalize and generate proof
      const finalState = stateManager.getState(channelId);
      const message = stateManager.encodeState(finalState);
      const aliceSignature = await alice.signMessage(message);
      const bobSignature = await bob.signMessage(message);
      
      await stateManager.finalizeChannel(channelId, [aliceSignature, bobSignature]);
      
      const settlementProof = await stateManager.generateSettlementProof(channelId);
      
      // Prepare for on-chain submission
      const onChainData = {
        channelId,
        merkleRoot: settlementProof.merkleRoot,
        finalBalances: [
          finalState.balances.get(alice.address),
          finalState.balances.get(bob.address)
        ],
        participants: [alice.address, bob.address],
        signatures: [aliceSignature, bobSignature],
        nonce: finalState.nonce
      };
      
      // Encode for contract call
      const encodedData = ethers.utils.defaultAbiCoder.encode(
        ["bytes32", "bytes32", "uint256[]", "address[]", "bytes[]", "uint256"],
        [
          onChainData.channelId,
          onChainData.merkleRoot,
          onChainData.finalBalances,
          onChainData.participants,
          onChainData.signatures,
          onChainData.nonce
        ]
      );
      
      expect(encodedData).to.be.a('string');
      expect(encodedData.length).to.be.greaterThan(0);
    });
  });

  describe("Merkle Tree Construction", function () {
    it("Should construct merkle tree for trade history", async function () {
      const trades = [];
      
      // Generate trade data
      for (let i = 0; i < 100; i++) {
        trades.push({
          id: `trade-${i}`,
          from: i % 2 === 0 ? alice.address : bob.address,
          to: i % 2 === 0 ? bob.address : alice.address,
          amount: ethers.utils.parseEther((10 + i * 0.1).toString()),
          timestamp: Date.now() + i * 1000,
          nonce: i
        });
      }
      
      // Build merkle tree
      const leaves = trades.map(trade => 
        ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["string", "address", "address", "uint256", "uint256", "uint256"],
            [trade.id, trade.from, trade.to, trade.amount, trade.timestamp, trade.nonce]
          )
        )
      );
      
      const merkleTree = stateManager.buildMerkleTree(leaves);
      const root = merkleTree.getRoot();
      
      expect(root).to.be.a('string');
      expect(root).to.have.lengthOf(66);
      
      // Verify random trade proofs
      for (let i = 0; i < 10; i++) {
        const randomIndex = Math.floor(Math.random() * trades.length);
        const proof = merkleTree.getProof(randomIndex);
        const leaf = leaves[randomIndex];
        
        const isValid = merkleTree.verifyProof(leaf, proof, root);
        expect(isValid).to.be.true;
      }
      
      // Test proof compactness
      const proofSize = merkleTree.getProof(50).length;
      const expectedSize = Math.ceil(Math.log2(trades.length));
      expect(proofSize).to.be.closeTo(expectedSize, 1);
    });

    it("Should handle sparse merkle trees", async function () {
      // Create sparse tree for account balances
      const accounts = [alice.address, bob.address, carol.address, dave.address];
      const balances = new Map([
        [alice.address, ethers.utils.parseEther("100")],
        [bob.address, ethers.utils.parseEther("200")],
        [carol.address, ethers.utils.parseEther("150")],
        [dave.address, ethers.utils.parseEther("50")]
      ]);
      
      // Build sparse merkle tree
      const sparseMerkleTree = stateManager.buildSparseMerkleTree(balances);
      const root = sparseMerkleTree.getRoot();
      
      // Update balance and get new root
      const updatedBalances = new Map(balances);
      updatedBalances.set(alice.address, ethers.utils.parseEther("80"));
      updatedBalances.set(bob.address, ethers.utils.parseEther("220"));
      
      const updatedTree = stateManager.buildSparseMerkleTree(updatedBalances);
      const newRoot = updatedTree.getRoot();
      
      expect(newRoot).to.not.equal(root);
      
      // Generate proof of balance update
      const updateProof = sparseMerkleTree.generateUpdateProof(
        alice.address,
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("80")
      );
      
      expect(updateProof.oldRoot).to.equal(root);
      expect(updateProof.newRoot).to.equal(newRoot);
      expect(updateProof.siblings).to.be.an('array');
    });
  });

  describe("End-to-End Scenarios", function () {
    it("Should handle complete trading lifecycle", async function () {
      // 1. Create multi-party channel
      const channelId = "channel-e2e-001";
      const participants = [alice.address, bob.address, carol.address];
      
      await stateManager.createChannel(
        channelId,
        participants,
        new Map([
          [alice.address, ethers.utils.parseEther("1000")],
          [bob.address, ethers.utils.parseEther("1000")],
          [carol.address, ethers.utils.parseEther("1000")]
        ])
      );
      
      // 2. Create and sign orders
      const orders = [
        {
          user: alice,
          order: {
            sellToken: "0x0000000000000000000000000000000000000001",
            buyToken: "0x0000000000000000000000000000000000000002",
            sellAmount: ethers.utils.parseEther("100"),
            buyAmount: ethers.utils.parseEther("98"),
            validTo: Math.floor(Date.now() / 1000) + 3600,
            user: alice.address,
            receiver: alice.address,
            appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            feeAmount: ethers.utils.parseEther("0.5"),
            partiallyFillable: true,
            kind: "sell",
            signingScheme: "eip712"
          }
        },
        {
          user: bob,
          order: {
            sellToken: "0x0000000000000000000000000000000000000002",
            buyToken: "0x0000000000000000000000000000000000000001",
            sellAmount: ethers.utils.parseEther("98"),
            buyAmount: ethers.utils.parseEther("100"),
            validTo: Math.floor(Date.now() / 1000) + 3600,
            user: bob.address,
            receiver: bob.address,
            appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
            feeAmount: ethers.utils.parseEther("0.5"),
            partiallyFillable: true,
            kind: "buy",
            signingScheme: "eip712"
          }
        }
      ];
      
      const signedOrders = await Promise.all(
        orders.map(async ({ user, order }) => ({
          order,
          signature: await user._signTypedData(domain, types, order),
          signer: user
        }))
      );
      
      // 3. Match and execute orders
      const matchedTrade = await instantFinality.matchAndExecuteOrders(
        channelId,
        signedOrders[0],
        signedOrders[1]
      );
      
      expect(matchedTrade.executed).to.be.true;
      
      // 4. Carol trades with updated prices
      const carolOrder = {
        sellToken: "0x0000000000000000000000000000000000000001",
        buyToken: "0x0000000000000000000000000000000000000002",
        sellAmount: ethers.utils.parseEther("50"),
        buyAmount: ethers.utils.parseEther("48"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: carol.address,
        receiver: carol.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("0.25"),
        partiallyFillable: false,
        kind: "sell",
        signingScheme: "eip712"
      };
      
      const carolSignature = await carol._signTypedData(domain, types, carolOrder);
      
      // Alice takes Carol's order
      const aliceCounterOrder = {
        sellToken: "0x0000000000000000000000000000000000000002",
        buyToken: "0x0000000000000000000000000000000000000001",
        sellAmount: ethers.utils.parseEther("48"),
        buyAmount: ethers.utils.parseEther("50"),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        user: alice.address,
        receiver: alice.address,
        appData: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
        feeAmount: ethers.utils.parseEther("0.25"),
        partiallyFillable: false,
        kind: "buy",
        signingScheme: "eip712"
      };
      
      const aliceCounterSignature = await alice._signTypedData(domain, types, aliceCounterOrder);
      
      await instantFinality.matchAndExecuteOrders(
        channelId,
        {
          order: carolOrder,
          signature: carolSignature,
          signer: carol
        },
        {
          order: aliceCounterOrder,
          signature: aliceCounterSignature,
          signer: alice
        }
      );
      
      // 5. Dispute scenario
      const currentState = stateManager.getState(channelId);
      
      // Bob claims incorrect state
      const disputedState = {
        ...currentState,
        balances: new Map([
          [alice.address, ethers.utils.parseEther("900")],
          [bob.address, ethers.utils.parseEther("1100")],
          [carol.address, ethers.utils.parseEther("1000")]
        ]),
        nonce: currentState.nonce + 1
      };
      
      const disputeMessage = stateManager.encodeState(disputedState);
      const bobDisputeSig = await bob.signMessage(disputeMessage);
      
      // Bob needs another signature (collusion attempt)
      const aliceCollusionSig = await alice.signMessage(disputeMessage);
      
      disputedState.signatures.set(bob.address, bobDisputeSig);
      disputedState.signatures.set(alice.address, aliceCollusionSig);
      
      await disputeManager.initiateDispute(
        channelId,
        bob.address,
        {
          state: disputedState,
          signatures: [bobDisputeSig, aliceCollusionSig]
        }
      );
      
      // Carol responds with correct higher nonce state
      const correctState = stateManager.getState(channelId);
      correctState.nonce = disputedState.nonce + 1;
      
      const correctMessage = stateManager.encodeState(correctState);
      const signatures = await Promise.all([
        alice.signMessage(correctMessage),
        bob.signMessage(correctMessage),
        carol.signMessage(correctMessage)
      ]);
      
      correctState.signatures.set(alice.address, signatures[0]);
      correctState.signatures.set(bob.address, signatures[1]);
      correctState.signatures.set(carol.address, signatures[2]);
      
      await disputeManager.respondToDispute(
        channelId,
        carol.address,
        {
          state: correctState,
          signatures
        }
      );
      
      // 6. Cooperative channel closure
      const finalState = stateManager.getState(channelId);
      const finalMessage = stateManager.encodeState(finalState);
      const finalSignatures = await Promise.all([
        alice.signMessage(finalMessage),
        bob.signMessage(finalMessage),
        carol.signMessage(finalMessage)
      ]);
      
      await stateManager.finalizeChannel(channelId, finalSignatures);
      
      // 7. Generate settlement proof
      const settlementProof = await stateManager.generateSettlementProof(channelId);
      
      expect(settlementProof.channelId).to.equal(channelId);
      expect(settlementProof.merkleRoot).to.be.a('string');
      expect(settlementProof.finalBalances.size).to.equal(3);
      
      // Verify final balances
      const aliceFinal = settlementProof.finalBalances.get(alice.address);
      const bobFinal = settlementProof.finalBalances.get(bob.address);
      const carolFinal = settlementProof.finalBalances.get(carol.address);
      
      // Total should still equal initial deposits minus fees
      const totalFinal = aliceFinal.add(bobFinal).add(carolFinal);
      const totalInitial = ethers.utils.parseEther("3000");
      const totalFees = ethers.utils.parseEther("1.5"); // Sum of all fees
      
      expect(totalFinal).to.be.closeTo(
        totalInitial.sub(totalFees),
        ethers.utils.parseEther("0.1")
      );
    });

    it("Should handle high-frequency trading scenario", async function () {
      this.timeout(60000); // Extended timeout
      
      const channelId = "channel-hft-001";
      const traders = [alice, bob, carol, dave];
      const traderAddresses = traders.map(t => t.address);
      
      // Create channel with larger deposits
      const deposits = new Map();
      for (const trader of traderAddresses) {
        deposits.set(trader, ethers.utils.parseEther("10000"));
      }
      
      await stateManager.createChannel(channelId, traderAddresses, deposits);
      
      // Simulate market making with rapid trades
      const startTime = Date.now();
      const duration = 10000; // 10 seconds
      const trades = [];
      let tradeCount = 0;
      
      // Generate continuous stream of trades
      while (Date.now() - startTime < duration) {
        const fromIndex = Math.floor(Math.random() * traders.length);
        const toIndex = (fromIndex + 1 + Math.floor(Math.random() * (traders.length - 1))) % traders.length;
        
        const from = traders[fromIndex];
        const to = traders[toIndex];
        const amount = ethers.utils.parseEther((Math.random() * 10).toFixed(4));
        
        try {
          const trade = await hftFinality.initiateInstantTradeHFT(
            channelId,
            from.address,
            to.address,
            amount,
            from,
            true // Zero-conf for speed
          );
          
          trades.push(trade);
          tradeCount++;
          
          // Simulate market dynamics - occasional larger trades
          if (Math.random() < 0.1) {
            const largeTrade = await hftFinality.initiateInstantTradeHFT(
              channelId,
              to.address,
              from.address,
              amount.mul(5),
              to,
              true
            );
            trades.push(largeTrade);
            tradeCount++;
          }
        } catch (error) {
          // Insufficient balance, skip
        }
        
        // Small delay to prevent overwhelming
        if (tradeCount % 100 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      const endTime = Date.now();
      const actualDuration = endTime - startTime;
      const throughput = (tradeCount / actualDuration) * 1000;
      
      console.log(`
        HFT Simulation Results:
        - Total trades: ${tradeCount}
        - Duration: ${actualDuration}ms
        - Throughput: ${throughput.toFixed(2)} TPS
        - Avg trade size: ${
          trades.reduce((sum, t) => sum.add(t.amount), ethers.BigNumber.from(0))
            .div(tradeCount)
            .div(ethers.utils.parseEther("1"))
        } ETH
      `);
      
      expect(tradeCount).to.be.greaterThan(500);
      expect(throughput).to.be.greaterThan(50);
      
      // Verify state consistency
      const finalState = stateManager.getState(channelId);
      const totalBalance = traderAddresses
        .reduce((sum, addr) => sum.add(finalState.balances.get(addr)), ethers.BigNumber.from(0));
      
      expect(totalBalance).to.equal(ethers.utils.parseEther("40000"));
      
      // Generate metrics
      const metrics = hftFinality.getMetrics();
      console.log(`
        HFT Engine Metrics:
        - Avg latency: ${metrics.avgLatency.toFixed(2)}ms
        - P99 latency: ${metrics.p99Latency.toFixed(2)}ms
        - Signature verification time: ${metrics.signatureVerificationTime.toFixed(2)}ms
      `);
      
      expect(metrics.avgLatency).to.be.lessThan(5);
      expect(metrics.p99Latency).to.be.lessThan(20);
    });
  });

  afterEach(async function () {
    // Cleanup
    await hftFinality.cleanup();
    stateManager.removeAllListeners();
    instantFinality.removeAllListeners();
    disputeManager.removeAllListeners();
  });
});