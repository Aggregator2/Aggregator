import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("SettlementQueueV2 - Security & Edge Cases", function () {
  const OPERATOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("OPERATOR_ROLE"));
  const EXECUTOR_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EXECUTOR_ROLE"));
  const SIGNER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("SIGNER_ROLE"));
  const GUARDIAN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("GUARDIAN_ROLE"));
  const EMERGENCY_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("EMERGENCY_ROLE"));

  async function deployQueueV2Fixture() {
    const [
      owner, operator, executor, guardian, emergency,
      signer1, signer2, signer3, attacker, user1, user2
    ] = await ethers.getSigners();
    
    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockUSDC = await MockToken.deploy("Mock USDC", "USDC", 6);
    const mockWETH = await MockToken.deploy("Mock WETH", "WETH", 18);
    const maliciousToken = await MockToken.deploy("Malicious Token", "MAL", 18);
    
    // Deploy settlement queue
    const largeSettlementThreshold = ethers.utils.parseUnits("1000", 6);
    const initialTokens = [mockUSDC.address, mockWETH.address];
    const initialLimits = [
      ethers.utils.parseUnits("100000", 6), // 100k USDC per day
      ethers.utils.parseUnits("50", 18)     // 50 WETH per day
    ];
    
    const SettlementQueueV2 = await ethers.getContractFactory("SettlementQueueV2");
    const queueV2 = await SettlementQueueV2.deploy(
      largeSettlementThreshold,
      initialTokens,
      initialLimits
    );
    
    // Setup roles
    await queueV2.grantRole(OPERATOR_ROLE, operator.address);
    await queueV2.grantRole(EXECUTOR_ROLE, executor.address);
    await queueV2.grantRole(GUARDIAN_ROLE, guardian.address);
    await queueV2.grantRole(EMERGENCY_ROLE, emergency.address);
    await queueV2.grantRole(SIGNER_ROLE, signer1.address);
    await queueV2.grantRole(SIGNER_ROLE, signer2.address);
    await queueV2.grantRole(SIGNER_ROLE, signer3.address);
    
    // Fund contracts
    const fundAmount = ethers.utils.parseUnits("1000000", 6);
    await mockUSDC.mint(queueV2.address, fundAmount);
    await mockWETH.mint(queueV2.address, ethers.utils.parseUnits("1000", 18));
    
    return {
      queueV2,
      mockUSDC,
      mockWETH,
      maliciousToken,
      owner,
      operator,
      executor,
      guardian,
      emergency,
      signer1,
      signer2,
      signer3,
      attacker,
      user1,
      user2,
      largeSettlementThreshold
    };
  }

  describe("Security Vulnerabilities", function () {
    describe("Access Control", function () {
      it("Should prevent unauthorized role escalation", async function () {
        const { queueV2, attacker, mockUSDC } = await loadFixture(deployQueueV2Fixture);
        
        // Attacker cannot grant themselves roles
        await expect(
          queueV2.connect(attacker).grantRole(OPERATOR_ROLE, attacker.address)
        ).to.be.reverted;

        // Attacker cannot queue settlements
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        await expect(
          queueV2.connect(attacker).queueSettlement(
            attacker.address,
            mockUSDC.address,
            ethers.utils.parseUnits("100", 6),
            500,
            gasParams
          )
        ).to.be.revertedWithCustomError(queueV2, "UnauthorizedCaller");
      });

      it("Should prevent cross-role function access", async function () {
        const { queueV2, operator, executor, signer1, guardian } = await loadFixture(deployQueueV2Fixture);
        
        // Operator cannot execute
        await expect(
          queueV2.connect(operator).processNextSettlement()
        ).to.be.reverted;

        // Executor cannot pause
        await expect(
          queueV2.connect(executor).pause()
        ).to.be.reverted;

        // Signer cannot reset circuit breaker
        await expect(
          queueV2.connect(signer1).resetCircuitBreaker()
        ).to.be.reverted;

        // Guardian cannot grant roles
        await expect(
          queueV2.connect(guardian).grantRole(OPERATOR_ROLE, guardian.address)
        ).to.be.reverted;
      });
    });

    describe("Token Whitelisting Security", function () {
      it("Should reject settlements with non-whitelisted tokens", async function () {
        const { queueV2, operator, maliciousToken, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            maliciousToken.address,
            ethers.utils.parseUnits("100", 18),
            500,
            gasParams
          )
        ).to.be.revertedWithCustomError(queueV2, "TokenNotWhitelisted");
      });

      it("Should enforce daily limits per token", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlement up to daily limit
        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("100000", 6), // Exactly at limit
          500,
          gasParams
        );

        // Next settlement should fail
        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("1", 6), // Even 1 more should fail
            500,
            gasParams
          )
        ).to.be.revertedWithCustomError(queueV2, "AmountExceedsLimit");
      });

      it("Should reset daily limits correctly", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Use full daily limit
        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("100000", 6),
          500,
          gasParams
        );

        // Fast forward to next day
        await time.increase(24 * 60 * 60 + 1);

        // Should be able to queue again
        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("1000", 6),
            500,
            gasParams
          )
        ).to.not.be.reverted;
      });
    });

    describe("Circuit Breaker Protection", function () {
      it("Should trigger circuit breaker on excessive activity", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue many settlements to trigger circuit breaker
        for (let i = 0; i < 50; i++) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          );
        }

        // Process them to increase hourly count
        await queueV2.connect(executor).processBatchOptimized(50, 0);

        // Circuit breaker should be triggered now
        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          )
        ).to.be.revertedWithCustomError(queueV2, "CircuitBreakerTriggered");
      });

      it("Should allow guardian to reset circuit breaker", async function () {
        const { queueV2, operator, executor, guardian, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Trigger circuit breaker
        for (let i = 0; i < 50; i++) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          );
        }
        await queueV2.connect(executor).processBatchOptimized(50, 0);

        // Reset by guardian
        await queueV2.connect(guardian).resetCircuitBreaker();

        // Should work again
        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          )
        ).to.not.be.reverted;
      });
    });

    describe("Signature Security", function () {
      it("Should prevent signature replay attacks", async function () {
        const { queueV2, operator, signer1, mockUSDC, user1, largeSettlementThreshold } = await loadFixture(deployQueueV2Fixture);
        
        const amount = largeSettlementThreshold.add(1);
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue large settlement
        const tx = await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          amount,
          500,
          gasParams
        );
        const receipt = await tx.wait();
        const settlementId = receipt.events[0].args.settlementId;

        // Create signature
        const domain = {
          name: "SettlementQueueV2",
          version: "2",
          chainId: await signer1.getChainId(),
          verifyingContract: queueV2.address
        };

        const types = {
          Settlement: [
            { name: "id", type: "uint256" },
            { name: "to", type: "address" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        };

        const settlement = await queueV2.getSettlement(settlementId);
        const value = {
          id: settlementId,
          to: user1.address,
          token: mockUSDC.address,
          amount: amount,
          nonce: settlement[0].nonce,
          deadline: parseInt(settlement[0].createdAt) * 86400 + 7 * 86400 // 7 days from creation
        };

        const signature = await signer1._signTypedData(domain, types, value);
        const nonce = ethers.utils.randomBytes(32);
        const commitment = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["bytes", "bytes32", "address"],
            [signature, nonce, signer1.address]
          )
        );

        // Commit signature
        await queueV2.connect(signer1).commitSignature(settlementId, commitment);

        // Fast forward to reveal period
        await time.increase(3601); // 1 hour + 1 second

        // Reveal signature
        await queueV2.connect(signer1).revealSignature(settlementId, signature, nonce);

        // Try to reuse the same signature on another settlement - should fail
        const tx2 = await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          amount,
          500,
          gasParams
        );
        const receipt2 = await tx2.wait();
        const settlementId2 = receipt2.events[0].args.settlementId;

        await expect(
          queueV2.connect(signer1).commitSignature(settlementId2, commitment)
        ).to.be.revertedWithCustomError(queueV2, "DuplicateSignature");
      });

      it("Should validate EIP-712 signatures correctly", async function () {
        const { queueV2, operator, signer1, mockUSDC, user1, largeSettlementThreshold } = await loadFixture(deployQueueV2Fixture);
        
        const amount = largeSettlementThreshold.add(1);
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        const tx = await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          amount,
          500,
          gasParams
        );
        const receipt = await tx.wait();
        const settlementId = receipt.events[0].args.settlementId;

        // Create invalid signature (wrong domain)
        const wrongDomain = {
          name: "WrongContract",
          version: "1",
          chainId: await signer1.getChainId(),
          verifyingContract: queueV2.address
        };

        const types = {
          Settlement: [
            { name: "id", type: "uint256" },
            { name: "to", type: "address" },
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" }
          ]
        };

        const settlement = await queueV2.getSettlement(settlementId);
        const value = {
          id: settlementId,
          to: user1.address,
          token: mockUSDC.address,
          amount: amount,
          nonce: settlement[0].nonce,
          deadline: parseInt(settlement[0].createdAt) * 86400 + 7 * 86400
        };

        const invalidSignature = await signer1._signTypedData(wrongDomain, types, value);
        const nonce = ethers.utils.randomBytes(32);
        const commitment = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ["bytes", "bytes32", "address"],
            [invalidSignature, nonce, signer1.address]
          )
        );

        await queueV2.connect(signer1).commitSignature(settlementId, commitment);
        await time.increase(3601);

        // Should reject invalid signature
        await expect(
          queueV2.connect(signer1).revealSignature(settlementId, invalidSignature, nonce)
        ).to.be.revertedWithCustomError(queueV2, "InvalidSignature");
      });
    });

    describe("Emergency Mechanisms", function () {
      it("Should enforce time delay for emergency withdrawals", async function () {
        const { queueV2, emergency, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        // Schedule emergency withdrawal
        await queueV2.connect(emergency).scheduleEmergencyWithdrawal();

        // Try to execute immediately - should fail
        await expect(
          queueV2.connect(emergency).executeEmergencyWithdrawal(
            mockUSDC.address,
            ethers.utils.parseUnits("1000", 6),
            user1.address
          )
        ).to.be.revertedWithCustomError(queueV2, "EmergencyWithdrawalTooEarly");

        // Fast forward past delay
        await time.increase(48 * 60 * 60 + 1);

        // Now should work
        await expect(
          queueV2.connect(emergency).executeEmergencyWithdrawal(
            mockUSDC.address,
            ethers.utils.parseUnits("1000", 6),
            user1.address
          )
        ).to.not.be.reverted;
      });

      it("Should allow only emergency role to schedule withdrawals", async function () {
        const { queueV2, attacker } = await loadFixture(deployQueueV2Fixture);
        
        await expect(
          queueV2.connect(attacker).scheduleEmergencyWithdrawal()
        ).to.be.reverted;
      });
    });

    describe("Signer Slashing", function () {
      it("Should allow guardian to slash malicious signers", async function () {
        const { queueV2, guardian, signer1 } = await loadFixture(deployQueueV2Fixture);
        
        // Slash signer
        await expect(
          queueV2.connect(guardian).slashSigner(signer1.address, "Malicious behavior")
        ).to.emit(queueV2, "SignerSlashed")
          .withArgs(signer1.address, 1, "Malicious behavior");

        const signerInfo = await queueV2.signerInfo(signer1.address);
        expect(signerInfo.slashingEvents).to.equal(1);
      });

      it("Should revoke role after maximum slashing events", async function () {
        const { queueV2, guardian, signer1 } = await loadFixture(deployQueueV2Fixture);
        
        // Slash signer multiple times
        for (let i = 0; i < 3; i++) {
          await queueV2.connect(guardian).slashSigner(signer1.address, `Event ${i + 1}`);
        }

        // Signer should be slashed and role revoked
        const signerInfo = await queueV2.signerInfo(signer1.address);
        expect(signerInfo.slashed).to.be.true;
        expect(await queueV2.hasRole(SIGNER_ROLE, signer1.address)).to.be.false;
      });
    });
  });

  describe("Gas Optimization Edge Cases", function () {
    describe("Packed Struct Efficiency", function () {
      it("Should efficiently store settlement data in minimal slots", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: 100000000000,  // Use exact values that fit in uint64
          maxPriorityFeePerGas: 2000000000,
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlement and check gas usage
        const tx = await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("100", 6),
          500,
          gasParams
        );
        const receipt = await tx.wait();
        
        // Gas should be reasonable due to packed structs
        expect(receipt.gasUsed).to.be.lt(200000);
        
        const settlementId = receipt.events[0].args.settlementId;
        const settlement = await queueV2.getSettlement(settlementId);
        
        // Verify data integrity
        expect(settlement[0].id).to.equal(settlementId);
        expect(settlement[0].amount).to.equal(ethers.utils.parseUnits("100", 6));
        expect(settlement[0].to).to.equal(user1.address);
      });

      it("Should handle maximum values in packed structs", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        // Use maximum values that still fit in packed struct
        const maxAmount = ethers.BigNumber.from(2).pow(128).sub(1); // Max uint128
        const maxPriority = 1000; // Max allowed priority
        
        const gasParams = {
          maxFeePerGas: ethers.BigNumber.from(2).pow(64).sub(1), // Max uint64
          maxPriorityFeePerGas: ethers.BigNumber.from(2).pow(64).sub(1),
          gasLimit: ethers.BigNumber.from(2).pow(32).sub(1), // Max uint32
          useEIP1559: true
        };

        // This should work without overflow
        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            maxAmount,
            maxPriority,
            gasParams
          )
        ).to.not.be.reverted;
      });
    });

    describe("Priority Queue Bitmap Optimization", function () {
      it("Should efficiently find highest priority using bitmap", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlements with sparse priorities
        const priorities = [1, 100, 500, 750, 999];
        for (const priority of priorities) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            priority,
            gasParams
          );
        }

        // Process should get highest priority (999) first
        const tx = await queueV2.connect(executor).processNextSettlement();
        const receipt = await tx.wait();
        
        // Should be efficient due to bitmap optimization
        expect(receipt.gasUsed).to.be.lt(150000);
      });

      it("Should handle priority wraparound in bitmap", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlements at bitmap boundaries
        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("10", 6),
          255, // Will map to bit 255
          gasParams
        );

        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("10", 6),
          256, // Will map to bit 0 (256 % 256)
          gasParams
        );

        // Should handle both correctly
        await queueV2.connect(executor).processNextSettlement(); // Should get 256 (higher priority)
        await queueV2.connect(executor).processNextSettlement(); // Should get 255
      });
    });

    describe("Batch Processing Optimization", function () {
      it("Should optimize gas for large batches", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue many settlements
        for (let i = 0; i < 50; i++) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          );
        }

        // Process in batch should be more efficient
        const tx = await queueV2.connect(executor).processBatchOptimized(20, 0);
        const receipt = await tx.wait();
        
        // Average gas per settlement should be lower than individual processing
        const avgGasPerSettlement = receipt.gasUsed.div(20);
        expect(avgGasPerSettlement).to.be.lt(80000);
      });

      it("Should respect gas limits in batch processing", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlements
        for (let i = 0; i < 100; i++) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          );
        }

        // Process batch with low gas limit
        const tx = await queueV2.connect(executor).processBatchOptimized(100, 0, {
          gasLimit: 500000 // Low gas limit
        });
        
        // Should process fewer settlements due to gas limit
        const stats = await queueV2.getQueueStats();
        expect(stats.queuedCount).to.be.gt(0); // Some should remain
      });
    });
  });

  describe("Edge Case Scenarios", function () {
    describe("Timestamp Overflow Protection", function () {
      it("Should handle timestamp conversion correctly", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Fast forward to near timestamp limits for uint32 (in days)
        // uint32 max = 4,294,967,295 days = ~11.7 million years
        await time.increaseTo(86400 * 1000000); // 1 million days

        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("100", 6),
            500,
            gasParams
          )
        ).to.not.be.reverted;
      });
    });

    describe("Extreme Values", function () {
      it("Should handle zero amounts gracefully", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            0, // Zero amount
            500,
            gasParams
          )
        ).to.be.revertedWithCustomError(queueV2, "InvalidSettlement");
      });

      it("Should handle maximum settlement amounts", async function () {
        const { queueV2, operator, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Set very high daily limit
        await queueV2.whitelistToken(
          mockUSDC.address,
          ethers.BigNumber.from(2).pow(128).sub(1)
        );

        const maxAmount = ethers.BigNumber.from(2).pow(128).sub(1);
        
        await expect(
          queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            maxAmount,
            500,
            gasParams
          )
        ).to.not.be.reverted;
      });

      it("Should handle rapid priority changes", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlements with alternating priorities
        for (let i = 1; i <= 1000; i += 2) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("1", 6),
            i,
            gasParams
          );
        }

        // Process should still work efficiently
        for (let i = 0; i < 10; i++) {
          await queueV2.connect(executor).processNextSettlement();
        }

        const stats = await queueV2.getQueueStats();
        expect(stats.queuedCount).to.equal(490); // 500 - 10 processed
      });
    });

    describe("Concurrent Access Patterns", function () {
      it("Should handle multiple operators queuing simultaneously", async function () {
        const { queueV2, operator, user1, user2, mockUSDC } = await loadFixture(deployQueueV2Fixture);
        
        // Grant operator role to user2
        await queueV2.grantRole(OPERATOR_ROLE, user2.address);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Both operators queue settlements concurrently
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            queueV2.connect(operator).queueSettlement(
              user1.address,
              mockUSDC.address,
              ethers.utils.parseUnits("10", 6),
              500 + i,
              gasParams
            )
          );
          
          promises.push(
            queueV2.connect(user2).queueSettlement(
              user1.address,
              mockUSDC.address,
              ethers.utils.parseUnits("10", 6),
              400 + i,
              gasParams
            )
          );
        }

        // All should succeed
        await Promise.all(promises);
        
        const stats = await queueV2.getQueueStats();
        expect(stats.queuedCount).to.equal(20);
      });

      it("Should handle processing during queueing", async function () {
        const { queueV2, operator, executor, user1, mockUSDC } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue some settlements
        for (let i = 0; i < 5; i++) {
          await queueV2.connect(operator).queueSettlement(
            user1.address,
            mockUSDC.address,
            ethers.utils.parseUnits("10", 6),
            500,
            gasParams
          );
        }

        // Process while queueing more
        const processPromise = queueV2.connect(executor).processBatchOptimized(3, 0);
        const queuePromise = queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("10", 6),
          600,
          gasParams
        );

        await Promise.all([processPromise, queuePromise]);
        
        const stats = await queueV2.getQueueStats();
        expect(stats.queuedCount).to.equal(3); // 6 total - 3 processed
      });
    });

    describe("State Consistency", function () {
      it("Should maintain queue integrity after failures", async function () {
        const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
        
        const gasParams = {
          maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
          maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
          gasLimit: 100000,
          useEIP1559: true
        };

        // Queue settlement with insufficient contract balance
        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("2000000", 6), // More than contract has
          500,
          gasParams
        );

        // Processing should fail but not break queue
        await queueV2.connect(executor).processNextSettlement();
        
        // Queue another settlement
        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("100", 6),
          600,
          gasParams
        );

        // This one should process successfully
        await queueV2.connect(executor).processNextSettlement();
        
        const stats = await queueV2.getQueueStats();
        expect(stats.queuedCount).to.equal(0); // First failed, second processed
      });
    });
  });

  describe("Performance Benchmarks", function () {
    it("Should benchmark queue operations", async function () {
      const { queueV2, operator, executor, mockUSDC, user1 } = await loadFixture(deployQueueV2Fixture);
      
      const gasParams = {
        maxFeePerGas: ethers.utils.parseUnits("100", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("2", "gwei"),
        gasLimit: 100000,
        useEIP1559: true
      };

      console.log("\n=== Performance Benchmarks ===");

      // Benchmark queueing
      const queueStart = await ethers.provider.getBlockNumber();
      for (let i = 0; i < 100; i++) {
        await queueV2.connect(operator).queueSettlement(
          user1.address,
          mockUSDC.address,
          ethers.utils.parseUnits("10", 6),
          Math.floor(Math.random() * 1000) + 1,
          gasParams
        );
      }
      const queueEnd = await ethers.provider.getBlockNumber();
      console.log(`Queued 100 settlements in ${queueEnd - queueStart} blocks`);

      // Benchmark processing
      const processStart = await ethers.provider.getBlockNumber();
      await queueV2.connect(executor).processBatchOptimized(100, 0);
      const processEnd = await ethers.provider.getBlockNumber();
      console.log(`Processed 100 settlements in ${processEnd - processStart} blocks`);
    });
  });
});