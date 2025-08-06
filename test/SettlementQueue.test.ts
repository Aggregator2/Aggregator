import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("Settlement Queue System", function () {
  // Test roles
  const OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
  const EXECUTOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXECUTOR_ROLE"));
  const SIGNER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SIGNER_ROLE"));

  async function deployQueueFixture() {
    const [owner, operator, executor, signer1, signer2, signer3, user1, user2] = await ethers.getSigners();
    
    // Deploy mock token
    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockToken = await MockToken.deploy("Mock USDC", "USDC", 6);
    
    // Deploy settlement queue with 1000 USDC threshold for large settlements
    const largeSettlementThreshold = ethers.utils.parseUnits("1000", 6);
    const SettlementQueue = await ethers.getContractFactory("SettlementQueue");
    const settlementQueue = await SettlementQueue.deploy(largeSettlementThreshold);
    
    // Deploy settlement processor
    const SettlementProcessor = await ethers.getContractFactory("SettlementProcessor");
    const processor = await SettlementProcessor.deploy(settlementQueue.address, ethers.constants.AddressZero);
    
    // Setup roles
    await settlementQueue.grantRole(OPERATOR_ROLE, operator.address);
    await settlementQueue.grantRole(EXECUTOR_ROLE, executor.address);
    await settlementQueue.grantRole(EXECUTOR_ROLE, processor.address);
    await settlementQueue.grantRole(SIGNER_ROLE, signer1.address);
    await settlementQueue.grantRole(SIGNER_ROLE, signer2.address);
    await settlementQueue.grantRole(SIGNER_ROLE, signer3.address);
    
    // Fund settlement queue
    const fundAmount = ethers.utils.parseUnits("100000", 6);
    await mockToken.mint(settlementQueue.address, fundAmount);
    
    return {
      settlementQueue,
      processor,
      mockToken,
      owner,
      operator,
      executor,
      signer1,
      signer2,
      signer3,
      user1,
      user2,
      largeSettlementThreshold
    };
  }

  describe("Priority Queue Management", function () {
    it("Should queue settlements with different priorities", async function () {
      const { settlementQueue, operator, user1, user2, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Queue settlements with different priorities
      await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        100, // Low priority
        gasParams
      );

      await settlementQueue.connect(operator).queueSettlement(
        user2.address,
        mockToken.address,
        amount,
        500, // Medium priority
        gasParams
      );

      await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        900, // High priority
        gasParams
      );

      expect(await settlementQueue.getQueuedCount()).to.equal(3);
    });

    it("Should process settlements in priority order", async function () {
      const { settlementQueue, operator, executor, user1, user2, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Queue settlements
      const tx1 = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        100, // Low priority
        gasParams
      );
      const receipt1 = await tx1.wait();
      const lowPriorityId = receipt1.events[0].args.settlementId;

      const tx2 = await settlementQueue.connect(operator).queueSettlement(
        user2.address,
        mockToken.address,
        amount,
        900, // High priority
        gasParams
      );
      const receipt2 = await tx2.wait();
      const highPriorityId = receipt2.events[0].args.settlementId;

      // Process next should take high priority first
      await expect(settlementQueue.connect(executor).processNextSettlement())
        .to.emit(settlementQueue, "SettlementProcessed")
        .withArgs(highPriorityId, executor.address, 0, true);

      // Next should be low priority
      await expect(settlementQueue.connect(executor).processNextSettlement())
        .to.emit(settlementQueue, "SettlementProcessed")
        .withArgs(lowPriorityId, executor.address, 0, true);
    });

    it("Should reject invalid priorities", async function () {
      const { settlementQueue, operator, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Priority too low
      await expect(
        settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          0,
          gasParams
        )
      ).to.be.revertedWithCustomError(settlementQueue, "InvalidPriority");

      // Priority too high
      await expect(
        settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          1001,
          gasParams
        )
      ).to.be.revertedWithCustomError(settlementQueue, "InvalidPriority");
    });
  });

  describe("Retry Mechanism", function () {
    it("Should retry failed settlements with exponential backoff", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      // Queue settlement with more than available balance
      const amount = ethers.utils.parseUnits("200000", 6); // More than funded
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Process should fail due to insufficient balance
      await expect(settlementQueue.connect(executor).processNextSettlement())
        .to.emit(settlementQueue, "SettlementFailed");

      // Check settlement status
      const settlement = await settlementQueue.getSettlement(settlementId);
      expect(settlement.status).to.equal(3); // Failed
      expect(settlement.retryCount).to.equal(1);
      expect(settlement.nextRetryTime).to.be.gt(0);

      // Try to retry immediately - should fail
      await expect(
        settlementQueue.connect(executor).retrySettlement(settlementId)
      ).to.be.revertedWithCustomError(settlementQueue, "InvalidSettlement");

      // Fast forward past retry time
      await time.increase(31); // Past initial 30 second backoff

      // Now retry should work
      await settlementQueue.connect(executor).retrySettlement(settlementId);
      
      const updatedSettlement = await settlementQueue.getSettlement(settlementId);
      expect(updatedSettlement.status).to.equal(0); // Queued again
    });

    it("Should increase backoff time exponentially", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("200000", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      let previousBackoff = 0;
      
      // Test multiple retries
      for (let i = 0; i < 4; i++) {
        // Process and fail
        await settlementQueue.connect(executor).processNextSettlement();
        
        const settlement = await settlementQueue.getSettlement(settlementId);
        const currentBackoff = settlement.nextRetryTime.sub(await time.latest());
        
        if (i > 0) {
          // Backoff should approximately double each time
          expect(currentBackoff).to.be.gte(previousBackoff.mul(2).sub(10)); // Allow small variance
        }
        
        previousBackoff = currentBackoff;
        
        // Fast forward and retry
        await time.increase(currentBackoff.add(1));
        
        if (i < 3) { // Don't retry on last iteration
          await settlementQueue.connect(executor).retrySettlement(settlementId);
        }
      }
    });

    it("Should stop retrying after max retries", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("200000", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Exhaust all retries
      for (let i = 0; i < 5; i++) {
        await settlementQueue.connect(executor).processNextSettlement();
        
        if (i < 4) {
          const settlement = await settlementQueue.getSettlement(settlementId);
          await time.increase(settlement.nextRetryTime.sub(await time.latest()).add(1));
          await settlementQueue.connect(executor).retrySettlement(settlementId);
        }
      }

      // Should have reached max retries
      const finalSettlement = await settlementQueue.getSettlement(settlementId);
      expect(finalSettlement.retryCount).to.equal(5);
      
      // Further retry should fail
      await expect(
        settlementQueue.connect(executor).retrySettlement(settlementId)
      ).to.be.revertedWithCustomError(settlementQueue, "MaxRetriesExceeded");
    });
  });

  describe("Gas Optimization", function () {
    it("Should update gas parameters", async function () {
      const { settlementQueue, operator, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const initialGasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        initialGasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Update gas parameters
      const newGasParams = {
        maxFeePerGas: ethers.utils.parseUnits("150", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("5", "gwei"),
        gasLimit: 150000,
        useEIP1559: true
      };

      await expect(
        settlementQueue.connect(operator).updateGasParams(settlementId, newGasParams)
      ).to.emit(settlementQueue, "GasParamsUpdated")
        .withArgs(settlementId, newGasParams.maxFeePerGas, newGasParams.maxPriorityFeePerGas);

      const settlement = await settlementQueue.getSettlement(settlementId);
      expect(settlement.gasParams.maxFeePerGas).to.equal(newGasParams.maxFeePerGas);
    });

    it("Should process with EIP-1559 parameters", async function () {
      const { processor, operator, executor, settlementQueue, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );

      // Process through processor
      await processor.connect(executor).processSettlements(1);

      const stats = await processor.getStats();
      expect(stats.totalProcessed).to.equal(1);
      expect(stats.successCount).to.equal(1);
    });

    it("Should track gas price history", async function () {
      const { processor, operator, executor, settlementQueue, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Queue and process multiple settlements
      for (let i = 0; i < 5; i++) {
        await settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        );
      }

      await processor.connect(executor).processSettlements(5);

      const history = await processor.getGasPriceHistory();
      const nonZeroEntries = history.filter(price => price.gt(0));
      expect(nonZeroEntries.length).to.be.gte(5);
    });
  });

  describe("Nonce Management", function () {
    it("Should assign unique nonces to settlements", async function () {
      const { settlementQueue, operator, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const nonces = [];
      
      // Queue multiple settlements
      for (let i = 0; i < 5; i++) {
        const tx = await settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        );
        const receipt = await tx.wait();
        const settlementId = receipt.events[0].args.settlementId;
        const settlement = await settlementQueue.getSettlement(settlementId);
        nonces.push(settlement.nonce);
      }

      // All nonces should be unique
      const uniqueNonces = [...new Set(nonces)];
      expect(uniqueNonces.length).to.equal(nonces.length);
    });

    it("Should mark nonces as used after processing", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;
      const settlement = await settlementQueue.getSettlement(settlementId);

      // Process settlement
      await settlementQueue.connect(executor).processNextSettlement();

      // Nonce should be marked as used
      expect(await settlementQueue.usedNonces(settlement.nonce)).to.be.true;
    });
  });

  describe("Multi-Signature Support", function () {
    it("Should require multiple signatures for large settlements", async function () {
      const { settlementQueue, operator, executor, signer1, signer2, signer3, user1, mockToken, largeSettlementThreshold } = await loadFixture(deployQueueFixture);
      
      const amount = largeSettlementThreshold.add(1); // Just over threshold
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Settlement should be marked as large
      const settlement = await settlementQueue.getSettlement(settlementId);
      expect(settlement.isLargeSettlement).to.be.true;
      expect(settlement.requiredSignatures).to.equal(3);

      // Try to process without signatures - should not process
      await settlementQueue.connect(executor).processNextSettlement();
      const afterAttempt = await settlementQueue.getSettlement(settlementId);
      expect(afterAttempt.status).to.equal(0); // Still queued
    });

    it("Should process large settlement after collecting signatures", async function () {
      const { settlementQueue, operator, executor, signer1, signer2, signer3, user1, mockToken, largeSettlementThreshold } = await loadFixture(deployQueueFixture);
      
      const amount = largeSettlementThreshold.add(1);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Collect signatures
      await expect(settlementQueue.connect(signer1).signLargeSettlement(settlementId))
        .to.emit(settlementQueue, "LargeSettlementSigned")
        .withArgs(settlementId, signer1.address, 1, 3);

      await expect(settlementQueue.connect(signer2).signLargeSettlement(settlementId))
        .to.emit(settlementQueue, "LargeSettlementSigned")
        .withArgs(settlementId, signer2.address, 2, 3);

      await expect(settlementQueue.connect(signer3).signLargeSettlement(settlementId))
        .to.emit(settlementQueue, "LargeSettlementSigned")
        .withArgs(settlementId, signer3.address, 3, 3);

      // Now should process successfully
      const balanceBefore = await mockToken.balanceOf(user1.address);
      await expect(settlementQueue.connect(executor).processNextSettlement())
        .to.emit(settlementQueue, "SettlementProcessed");
      
      const balanceAfter = await mockToken.balanceOf(user1.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(amount);
    });

    it("Should prevent duplicate signatures", async function () {
      const { settlementQueue, operator, signer1, user1, mockToken, largeSettlementThreshold } = await loadFixture(deployQueueFixture);
      
      const amount = largeSettlementThreshold.add(1);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // First signature
      await settlementQueue.connect(signer1).signLargeSettlement(settlementId);

      // Duplicate signature should fail
      await expect(
        settlementQueue.connect(signer1).signLargeSettlement(settlementId)
      ).to.be.revertedWithCustomError(settlementQueue, "DuplicateSignature");
    });
  });

  describe("Failed Settlement Recovery", function () {
    it("Should handle expired settlements", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Fast forward past expiry
      await time.increase(8 * 24 * 60 * 60); // 8 days

      // Should not process expired settlement
      await settlementQueue.connect(executor).processNextSettlement();
      
      const settlement = await settlementQueue.getSettlement(settlementId);
      expect(settlement.status).to.equal(0); // Still queued (not processed)
    });

    it("Should allow cancellation of queued settlements", async function () {
      const { settlementQueue, operator, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Cancel settlement
      await settlementQueue.connect(operator).cancelSettlement(settlementId);

      const settlement = await settlementQueue.getSettlement(settlementId);
      expect(settlement.status).to.equal(5); // Cancelled
    });

    it("Should not allow cancellation of processed settlements", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      const tx = await settlementQueue.connect(operator).queueSettlement(
        user1.address,
        mockToken.address,
        amount,
        500,
        gasParams
      );
      const receipt = await tx.wait();
      const settlementId = receipt.events[0].args.settlementId;

      // Process settlement
      await settlementQueue.connect(executor).processNextSettlement();

      // Try to cancel - should fail
      await expect(
        settlementQueue.connect(operator).cancelSettlement(settlementId)
      ).to.be.revertedWithCustomError(settlementQueue, "SettlementAlreadyProcessed");
    });
  });

  describe("Batch Processing", function () {
    it("Should process multiple settlements in batch", async function () {
      const { settlementQueue, operator, executor, user1, user2, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Queue multiple settlements
      for (let i = 0; i < 5; i++) {
        await settlementQueue.connect(operator).queueSettlement(
          i % 2 === 0 ? user1.address : user2.address,
          mockToken.address,
          amount,
          500,
          gasParams
        );
      }

      expect(await settlementQueue.getQueuedCount()).to.equal(5);

      // Process batch
      await settlementQueue.connect(executor).processBatch(3);

      expect(await settlementQueue.getQueuedCount()).to.equal(2);
      expect(await settlementQueue.getProcessingCount()).to.equal(0);
    });

    it("Should respect batch size limits", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("10", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Queue many settlements
      for (let i = 0; i < 150; i++) {
        await settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        );
      }

      // Try to process more than max batch size
      await settlementQueue.connect(executor).processBatch(200);

      // Should only process MAX_BATCH_SIZE (100)
      expect(await settlementQueue.getQueuedCount()).to.equal(50);
    });
  });

  describe("Access Control", function () {
    it("Should enforce role requirements", async function () {
      const { settlementQueue, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // User without OPERATOR_ROLE cannot queue
      await expect(
        settlementQueue.connect(user1).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        )
      ).to.be.reverted;

      // User without EXECUTOR_ROLE cannot process
      await expect(
        settlementQueue.connect(user1).processNextSettlement()
      ).to.be.reverted;

      // User without SIGNER_ROLE cannot sign
      await expect(
        settlementQueue.connect(user1).signLargeSettlement(1)
      ).to.be.reverted;
    });

    it("Should allow admin to pause/unpause", async function () {
      const { settlementQueue, owner, operator, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      // Pause
      await settlementQueue.connect(owner).pause();

      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Operations should fail when paused
      await expect(
        settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        )
      ).to.be.revertedWith("Pausable: paused");

      // Unpause
      await settlementQueue.connect(owner).unpause();

      // Operations should work again
      await expect(
        settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        )
      ).to.not.be.reverted;
    });
  });

  describe("View Functions", function () {
    it("Should retrieve settlements by status", async function () {
      const { settlementQueue, operator, executor, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Create settlements with different statuses
      const settlementIds = [];
      
      // Queue 3 settlements
      for (let i = 0; i < 3; i++) {
        const tx = await settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        );
        const receipt = await tx.wait();
        settlementIds.push(receipt.events[0].args.settlementId);
      }

      // Process one
      await settlementQueue.connect(executor).processNextSettlement();

      // Cancel one
      await settlementQueue.connect(operator).cancelSettlement(settlementIds[2]);

      // Get queued settlements
      const queued = await settlementQueue.getSettlementsByStatus(0, 0, 10);
      expect(queued.length).to.equal(1);
      expect(queued[0]).to.equal(settlementIds[1]);

      // Get completed settlements
      const completed = await settlementQueue.getSettlementsByStatus(2, 0, 10);
      expect(completed.length).to.equal(1);
      expect(completed[0]).to.equal(settlementIds[0]);

      // Get cancelled settlements
      const cancelled = await settlementQueue.getSettlementsByStatus(5, 0, 10);
      expect(cancelled.length).to.equal(1);
      expect(cancelled[0]).to.equal(settlementIds[2]);
    });

    it("Should paginate results correctly", async function () {
      const { settlementQueue, operator, user1, mockToken } = await loadFixture(deployQueueFixture);
      
      const amount = ethers.utils.parseUnits("100", 6);
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      // Queue 10 settlements
      for (let i = 0; i < 10; i++) {
        await settlementQueue.connect(operator).queueSettlement(
          user1.address,
          mockToken.address,
          amount,
          500,
          gasParams
        );
      }

      // Get first page
      const page1 = await settlementQueue.getSettlementsByStatus(0, 0, 5);
      expect(page1.length).to.equal(5);

      // Get second page
      const page2 = await settlementQueue.getSettlementsByStatus(0, 5, 5);
      expect(page2.length).to.equal(5);

      // Pages should not overlap
      for (const id of page1) {
        expect(page2).to.not.include(id);
      }
    });
  });
});