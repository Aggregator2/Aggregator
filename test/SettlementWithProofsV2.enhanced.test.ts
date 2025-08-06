import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer, BigNumber } from "ethers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

describe("SettlementWithProofsV2 - Enhanced Security & Edge Cases", function () {
  // Test fixture for efficient test setup
  async function deploySettlementFixture() {
    const [owner, engine, attacker, user1, user2, user3, user4] = await ethers.getSigners();
    
    // Deploy mock tokens
    const MockToken = await ethers.getContractFactory("MockERC20");
    const mockToken1 = await MockToken.deploy("Mock USDC", "USDC", 6);
    const mockToken2 = await MockToken.deploy("Mock WETH", "WETH", 18);
    
    // Deploy settlement contract
    const SettlementWithProofsV2 = await ethers.getContractFactory("SettlementWithProofsV2");
    const settlementContract = await SettlementWithProofsV2.deploy();
    
    // Setup initial state
    await settlementContract.connect(owner).setEngineAuthorization(await engine.getAddress(), true);
    
    const INITIAL_BALANCE = ethers.utils.parseEther("10000");
    const SETTLEMENT_AMOUNT = ethers.utils.parseEther("100");
    
    // Mint tokens
    const users = [user1, user2, user3, user4];
    for (const user of users) {
      const address = await user.getAddress();
      await mockToken1.mint(address, INITIAL_BALANCE);
      await mockToken2.mint(address, INITIAL_BALANCE);
    }
    
    return {
      settlementContract,
      mockToken1,
      mockToken2,
      owner,
      engine,
      attacker,
      user1,
      user2,
      user3,
      user4,
      INITIAL_BALANCE,
      SETTLEMENT_AMOUNT
    };
  }

  describe("Additional Edge Cases", function () {
    describe("Epoch ID Edge Cases", function () {
      it("Should handle very long epoch IDs", async function () {
        const { settlementContract, engine, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const longEpochId = "epoch-" + "x".repeat(1000);
        const settlements = [
          { user: await engine.getAddress(), token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        // Should handle long epoch IDs
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            longEpochId,
            merkleRoot,
            settlements.length,
            30 // 30 days claim deadline
          )
        ).to.not.be.reverted;
      });

      it("Should reject empty epoch IDs", async function () {
        const { settlementContract, engine } = await loadFixture(deploySettlementFixture);
        
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "",
            ethers.utils.hexZeroPad("0x1", 32),
            1,
            30
          )
        ).to.be.revertedWithCustomError(settlementContract, "InvalidEpochId");
      });

      it("Should handle special characters in epoch IDs", async function () {
        const { settlementContract, engine, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const specialEpochId = "epoch-!@#$%^&*()_+-=[]{}|;':\",./<>?";
        const settlements = [
          { user: await engine.getAddress(), token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            specialEpochId,
            merkleRoot,
            settlements.length,
            30
          )
        ).to.not.be.reverted;
      });
    });

    describe("Claim Deadline Edge Cases", function () {
      it("Should enforce maximum claim deadline", async function () {
        const { settlementContract, engine } = await loadFixture(deploySettlementFixture);
        
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "epoch-001",
            ethers.utils.hexZeroPad("0x1", 32),
            1,
            366 // More than 365 days
          )
        ).to.be.revertedWithCustomError(settlementContract, "InvalidAmount");
      });

      it("Should reject zero claim deadline", async function () {
        const { settlementContract, engine } = await loadFixture(deploySettlementFixture);
        
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "epoch-001",
            ethers.utils.hexZeroPad("0x1", 32),
            1,
            0
          )
        ).to.be.revertedWithCustomError(settlementContract, "InvalidAmount");
      });

      it("Should prevent claims after deadline", async function () {
        const { settlementContract, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "deadline-test";
        const user1Address = await user1.getAddress();
        const settlements = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        // Deposit tokens
        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        // Create batch with 1 day deadline
        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          1
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // Fast forward past deadline
        await time.increase(2 * 24 * 60 * 60); // 2 days

        // Claim should fail
        const proof = merkleTree.getHexProof(leaves[0]);
        await expect(
          settlementContract.connect(user1).claimSettlement(
            epochId,
            mockToken1.address,
            SETTLEMENT_AMOUNT,
            proof
          )
        ).to.be.revertedWithCustomError(settlementContract, "ClaimDeadlinePassed");
      });
    });

    describe("Token Edge Cases", function () {
      it("Should reject claims with zero address token", async function () {
        const { settlementContract, engine, user1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "zero-token";
        const user1Address = await user1.getAddress();
        
        // Create settlement with valid token for merkle tree
        const settlements = [
          { user: user1Address, token: ethers.constants.AddressZero, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        const proof = merkleTree.getHexProof(leaves[0]);
        await expect(
          settlementContract.connect(user1).claimSettlement(
            epochId,
            ethers.constants.AddressZero,
            SETTLEMENT_AMOUNT,
            proof
          )
        ).to.be.revertedWithCustomError(settlementContract, "InvalidToken");
      });

      it("Should handle tokens with different decimals correctly", async function () {
        const { settlementContract, engine, user1 } = await loadFixture(deploySettlementFixture);
        
        // Deploy tokens with different decimals
        const MockToken = await ethers.getContractFactory("MockERC20");
        const token6Decimals = await MockToken.deploy("USDC", "USDC", 6);
        const token18Decimals = await MockToken.deploy("DAI", "DAI", 18);
        const token0Decimals = await MockToken.deploy("ZERO", "ZERO", 0);
        
        const epochId = "decimals-test";
        const user1Address = await user1.getAddress();
        
        const settlements = [
          { user: user1Address, token: token6Decimals.address, amount: ethers.utils.parseUnits("100", 6) },
          { user: user1Address, token: token18Decimals.address, amount: ethers.utils.parseUnits("100", 18) },
          { user: user1Address, token: token0Decimals.address, amount: 100 }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        // Mint and deposit tokens
        for (const settlement of settlements) {
          const token = await ethers.getContractAt("MockERC20", settlement.token);
          await token.mint(settlementContract.address, settlement.amount.mul(2));
          await settlementContract.connect(engine).depositTokens(
            settlement.token,
            settlement.amount
          );
        }

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // Claim each token type
        for (let i = 0; i < settlements.length; i++) {
          const settlement = settlements[i];
          const proof = merkleTree.getHexProof(leaves[i]);
          
          await expect(
            settlementContract.connect(user1).claimSettlement(
              epochId,
              settlement.token,
              settlement.amount,
              proof
            )
          ).to.not.be.reverted;
        }
      });
    });

    describe("Merkle Proof Edge Cases", function () {
      it("Should handle empty merkle proof arrays", async function () {
        const { settlementContract, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "empty-proof";
        const user1Address = await user1.getAddress();
        
        // Single leaf tree (no siblings needed for proof)
        const settlements = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // For single leaf, proof should be empty
        await expect(
          settlementContract.connect(user1).claimSettlement(
            epochId,
            mockToken1.address,
            SETTLEMENT_AMOUNT,
            [] // Empty proof
          )
        ).to.not.be.reverted;
      });

      it("Should reject proofs with incorrect length", async function () {
        const { settlementContract, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "wrong-proof-length";
        const user1Address = await user1.getAddress();
        
        // Create multiple settlements for deeper tree
        const settlements = Array(8).fill(null).map((_, i) => ({
          user: ethers.Wallet.createRandom().address,
          token: mockToken1.address,
          amount: SETTLEMENT_AMOUNT
        }));
        settlements[0] = { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT };

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // Get correct proof and add extra element
        const correctProof = merkleTree.getHexProof(leaves[0]);
        const wrongProof = [...correctProof, ethers.utils.hexZeroPad("0x99", 32)];

        await expect(
          settlementContract.connect(user1).claimSettlement(
            epochId,
            mockToken1.address,
            SETTLEMENT_AMOUNT,
            wrongProof
          )
        ).to.be.revertedWithCustomError(settlementContract, "InvalidProof");
      });
    });

    describe("Pausability Edge Cases", function () {
      it("Should prevent all operations when paused", async function () {
        const { settlementContract, owner, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        // Pause contract
        await settlementContract.connect(owner).pause();

        // Try various operations
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "paused-epoch",
            ethers.utils.hexZeroPad("0x1", 32),
            1,
            30
          )
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          settlementContract.connect(engine).finalizeSettlementBatch("any-epoch")
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          settlementContract.connect(user1).claimSettlement(
            "any-epoch",
            mockToken1.address,
            SETTLEMENT_AMOUNT,
            []
          )
        ).to.be.revertedWith("Pausable: paused");

        await expect(
          settlementContract.connect(engine).depositTokens(
            mockToken1.address,
            SETTLEMENT_AMOUNT
          )
        ).to.be.revertedWith("Pausable: paused");
      });

      it("Should resume operations after unpausing", async function () {
        const { settlementContract, owner, engine } = await loadFixture(deploySettlementFixture);
        
        // Pause and unpause
        await settlementContract.connect(owner).pause();
        await settlementContract.connect(owner).unpause();

        // Operations should work again
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "unpaused-epoch",
            ethers.utils.hexZeroPad("0x1", 32),
            1,
            30
          )
        ).to.not.be.reverted;
      });
    });

    describe("Emergency Withdrawal Edge Cases", function () {
      it("Should only allow emergency withdrawal after deadline + delay", async function () {
        const { settlementContract, owner, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "emergency-test";
        const user1Address = await user1.getAddress();
        const ownerAddress = await owner.getAddress();
        
        const settlements = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        // Create batch with 30 day deadline
        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // Try emergency withdrawal immediately - should fail
        await expect(
          settlementContract.connect(owner).emergencyWithdraw(
            mockToken1.address,
            epochId,
            ownerAddress
          )
        ).to.be.revertedWithCustomError(settlementContract, "ClaimDeadlinePassed");

        // Fast forward past claim deadline but not emergency deadline
        await time.increase(31 * 24 * 60 * 60); // 31 days

        // Still should fail
        await expect(
          settlementContract.connect(owner).emergencyWithdraw(
            mockToken1.address,
            epochId,
            ownerAddress
          )
        ).to.be.revertedWithCustomError(settlementContract, "ClaimDeadlinePassed");

        // Fast forward past emergency deadline
        await time.increase(90 * 24 * 60 * 60); // Additional 90 days

        // Now should succeed
        await expect(
          settlementContract.connect(owner).emergencyWithdraw(
            mockToken1.address,
            epochId,
            ownerAddress
          )
        ).to.not.be.reverted;
      });

      it("Should prevent claims after emergency withdrawal", async function () {
        const { settlementContract, owner, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "post-emergency";
        const user1Address = await user1.getAddress();
        const ownerAddress = await owner.getAddress();
        
        const settlements = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          1 // 1 day deadline for faster test
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // Fast forward past emergency deadline
        await time.increase(92 * 24 * 60 * 60);

        // Emergency withdraw
        await settlementContract.connect(owner).emergencyWithdraw(
          mockToken1.address,
          epochId,
          ownerAddress
        );

        // Try to claim - should fail
        const proof = merkleTree.getHexProof(leaves[0]);
        await expect(
          settlementContract.connect(user1).claimSettlement(
            epochId,
            mockToken1.address,
            SETTLEMENT_AMOUNT,
            proof
          )
        ).to.be.revertedWithCustomError(settlementContract, "BatchExpired");
      });
    });

    describe("Batch Operations Edge Cases", function () {
      it("Should handle maximum settlements per batch", async function () {
        const { settlementContract, engine } = await loadFixture(deploySettlementFixture);
        
        const MAX_SETTLEMENTS = await settlementContract.MAX_SETTLEMENTS_PER_BATCH();
        
        // Should accept maximum
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "max-settlements",
            ethers.utils.hexZeroPad("0x1", 32),
            MAX_SETTLEMENTS,
            30
          )
        ).to.not.be.reverted;

        // Should reject over maximum
        await expect(
          settlementContract.connect(engine).createSettlementBatch(
            "over-max-settlements",
            ethers.utils.hexZeroPad("0x2", 32),
            MAX_SETTLEMENTS.add(1),
            30
          )
        ).to.be.revertedWithCustomError(settlementContract, "TooManySettlements");
      });

      it("Should handle batch claims with mixed valid/invalid claims", async function () {
        const { settlementContract, engine, user1, mockToken1, mockToken2, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const user1Address = await user1.getAddress();
        
        // Create two epochs
        const epochId1 = "mixed-batch-1";
        const epochId2 = "mixed-batch-2";
        
        for (const [epochId, token] of [[epochId1, mockToken1], [epochId2, mockToken2]]) {
          const settlements = [
            { user: user1Address, token: token.address, amount: SETTLEMENT_AMOUNT }
          ];

          const leaves = settlements.map(s => 
            ethers.utils.solidityKeccak256(
              ["address", "address", "uint256"],
              [s.user, s.token, s.amount]
            )
          );
          const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
          const merkleRoot = merkleTree.getHexRoot();

          await token.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
          await settlementContract.connect(engine).depositTokens(
            token.address,
            SETTLEMENT_AMOUNT
          );

          await settlementContract.connect(engine).createSettlementBatch(
            epochId,
            merkleRoot,
            settlements.length,
            30
          );
          await settlementContract.connect(engine).finalizeSettlementBatch(epochId);
        }

        // Claim from first epoch normally
        const settlements1 = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];
        const leaves1 = settlements1.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree1 = new MerkleTree(leaves1, keccak256, { sortPairs: true });
        
        await settlementContract.connect(user1).claimSettlement(
          epochId1,
          mockToken1.address,
          SETTLEMENT_AMOUNT,
          merkleTree1.getHexProof(leaves1[0])
        );

        // Now try batch claim with already claimed and new claim
        const settlements2 = [
          { user: user1Address, token: mockToken2.address, amount: SETTLEMENT_AMOUNT }
        ];
        const leaves2 = settlements2.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree2 = new MerkleTree(leaves2, keccak256, { sortPairs: true });

        const claims = [
          {
            epochId: epochId1,
            token: mockToken1.address,
            amount: SETTLEMENT_AMOUNT,
            merkleProof: merkleTree1.getHexProof(leaves1[0])
          },
          {
            epochId: epochId2,
            token: mockToken2.address,
            amount: SETTLEMENT_AMOUNT,
            merkleProof: merkleTree2.getHexProof(leaves2[0])
          }
        ];

        // Should succeed and skip already claimed
        const balanceBefore = await mockToken2.balanceOf(user1Address);
        await settlementContract.connect(user1).batchClaimSettlements(claims);
        const balanceAfter = await mockToken2.balanceOf(user1Address);

        // Only second claim should process
        expect(balanceAfter.sub(balanceBefore)).to.equal(SETTLEMENT_AMOUNT);
      });
    });

    describe("Value Tracking Edge Cases", function () {
      it("Should correctly track total value locked across multiple tokens", async function () {
        const { settlementContract, engine, mockToken1, mockToken2 } = await loadFixture(deploySettlementFixture);
        
        const amount1 = ethers.utils.parseEther("100");
        const amount2 = ethers.utils.parseEther("200");
        
        // Initial TVL should be 0
        expect(await settlementContract.totalValueLocked(mockToken1.address)).to.equal(0);
        expect(await settlementContract.totalValueLocked(mockToken2.address)).to.equal(0);

        // Deposit token1
        await mockToken1.connect(engine).approve(settlementContract.address, amount1);
        await settlementContract.connect(engine).depositTokens(mockToken1.address, amount1);
        
        expect(await settlementContract.totalValueLocked(mockToken1.address)).to.equal(amount1);

        // Deposit token2
        await mockToken2.connect(engine).approve(settlementContract.address, amount2);
        await settlementContract.connect(engine).depositTokens(mockToken2.address, amount2);
        
        expect(await settlementContract.totalValueLocked(mockToken2.address)).to.equal(amount2);

        // Deposit more token1
        await mockToken1.connect(engine).approve(settlementContract.address, amount1);
        await settlementContract.connect(engine).depositTokens(mockToken1.address, amount1);
        
        expect(await settlementContract.totalValueLocked(mockToken1.address)).to.equal(amount1.mul(2));
      });

      it("Should handle underflow protection in balance tracking", async function () {
        const { settlementContract, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const epochId = "underflow-test";
        const user1Address = await user1.getAddress();
        
        // Create settlement for more than deposited
        const settlements = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT.mul(2) }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        // Deposit less than settlement amount
        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        // Try to claim more than available
        const proof = merkleTree.getHexProof(leaves[0]);
        await expect(
          settlementContract.connect(user1).claimSettlement(
            epochId,
            mockToken1.address,
            SETTLEMENT_AMOUNT.mul(2),
            proof
          )
        ).to.be.revertedWithCustomError(settlementContract, "InsufficientContractBalance");
      });
    });

    describe("Authorization Edge Cases", function () {
      it("Should handle authorization changes during active batches", async function () {
        const { settlementContract, owner, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
        
        const engineAddress = await engine.getAddress();
        const epochId = "auth-change";
        
        // Create batch while authorized
        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          ethers.utils.hexZeroPad("0x1", 32),
          1,
          30
        );

        // Revoke authorization
        await settlementContract.connect(owner).setEngineAuthorization(engineAddress, false);

        // Should not be able to finalize
        await expect(
          settlementContract.connect(engine).finalizeSettlementBatch(epochId)
        ).to.be.revertedWithCustomError(settlementContract, "NotAuthorized");

        // Re-authorize
        await settlementContract.connect(owner).setEngineAuthorization(engineAddress, true);

        // Now should be able to finalize
        await expect(
          settlementContract.connect(engine).finalizeSettlementBatch(epochId)
        ).to.not.be.reverted;
      });

      it("Should prevent authorization of zero address", async function () {
        const { settlementContract, owner } = await loadFixture(deploySettlementFixture);
        
        await expect(
          settlementContract.connect(owner).setEngineAuthorization(ethers.constants.AddressZero, true)
        ).to.be.revertedWithCustomError(settlementContract, "InvalidRecipient");
      });
    });

    describe("View Function Edge Cases", function () {
      it("Should handle getBatchStatuses with empty array", async function () {
        const { settlementContract } = await loadFixture(deploySettlementFixture);
        
        const statuses = await settlementContract.getBatchStatuses([]);
        expect(statuses).to.have.lengthOf(0);
      });

      it("Should handle getBatchStatuses with non-existent epochs", async function () {
        const { settlementContract } = await loadFixture(deploySettlementFixture);
        
        const epochIds = ["non-existent-1", "non-existent-2", "non-existent-3"];
        const statuses = await settlementContract.getBatchStatuses(epochIds);
        
        expect(statuses).to.have.lengthOf(3);
        statuses.forEach(status => expect(status).to.be.false);
      });

      it("Should correctly report mixed batch statuses", async function () {
        const { settlementContract, engine } = await loadFixture(deploySettlementFixture);
        
        // Create some batches
        await settlementContract.connect(engine).createSettlementBatch(
          "exists-1",
          ethers.utils.hexZeroPad("0x1", 32),
          1,
          30
        );
        await settlementContract.connect(engine).createSettlementBatch(
          "exists-2",
          ethers.utils.hexZeroPad("0x2", 32),
          1,
          30
        );

        const epochIds = ["exists-1", "non-existent", "exists-2", "also-non-existent"];
        const statuses = await settlementContract.getBatchStatuses(epochIds);
        
        expect(statuses).to.deep.equal([true, false, true, false]);
      });
    });
  });

  describe("Gas Optimization Verification", function () {
    it("Should use less gas with packed struct", async function () {
      const { settlementContract, engine } = await loadFixture(deploySettlementFixture);
      
      // Create multiple batches and measure gas
      const gasUsed = [];
      
      for (let i = 0; i < 5; i++) {
        const tx = await settlementContract.connect(engine).createSettlementBatch(
          `gas-test-${i}`,
          ethers.utils.hexZeroPad(`0x${i + 1}`, 32),
          1000,
          30
        );
        const receipt = await tx.wait();
        gasUsed.push(receipt.gasUsed);
      }

      // Gas usage should be consistent and reasonable
      const avgGas = gasUsed.reduce((a, b) => a.add(b)).div(gasUsed.length);
      console.log("Average gas for createSettlementBatch:", avgGas.toString());
      
      // Should be under 150k gas
      expect(avgGas).to.be.lt(150000);
    });

    it("Should efficiently handle batch claims with early exits", async function () {
      const { settlementContract, engine, user1, mockToken1, SETTLEMENT_AMOUNT } = await loadFixture(deploySettlementFixture);
      
      const user1Address = await user1.getAddress();
      const claims = [];
      
      // Create 10 epochs
      for (let i = 0; i < 10; i++) {
        const epochId = `batch-gas-${i}`;
        const settlements = [
          { user: user1Address, token: mockToken1.address, amount: SETTLEMENT_AMOUNT }
        ];

        const leaves = settlements.map(s => 
          ethers.utils.solidityKeccak256(
            ["address", "address", "uint256"],
            [s.user, s.token, s.amount]
          )
        );
        const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const merkleRoot = merkleTree.getHexRoot();

        await mockToken1.connect(engine).approve(settlementContract.address, SETTLEMENT_AMOUNT);
        await settlementContract.connect(engine).depositTokens(
          mockToken1.address,
          SETTLEMENT_AMOUNT
        );

        await settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          30
        );
        await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

        claims.push({
          epochId: epochId,
          token: mockToken1.address,
          amount: SETTLEMENT_AMOUNT,
          merkleProof: merkleTree.getHexProof(leaves[0])
        });
      }

      // Claim first 5 individually
      for (let i = 0; i < 5; i++) {
        await settlementContract.connect(user1).claimSettlement(
          claims[i].epochId,
          claims[i].token,
          claims[i].amount,
          claims[i].merkleProof
        );
      }

      // Batch claim all 10 (5 already claimed, 5 new)
      const tx = await settlementContract.connect(user1).batchClaimSettlements(claims);
      const receipt = await tx.wait();
      
      console.log("Gas for batch claim with 5 skipped, 5 processed:", receipt.gasUsed.toString());
      
      // Should be efficient despite skipping claims
      expect(receipt.gasUsed).to.be.lt(500000);
    });
  });
});