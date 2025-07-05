import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

describe("SettlementWithProofs Contract", function () {
  let settlementContract: Contract;
  let owner: Signer;
  let engine: Signer;
  let user1: Signer;
  let user2: Signer;
  let user3: Signer;
  let mockToken: Contract;
  let ownerAddress: string;
  let engineAddress: string;
  let user1Address: string;
  let user2Address: string;
  let user3Address: string;

  // Test data
  const epochId = "epoch-001";
  let merkleTree: MerkleTree;
  let merkleRoot: string;
  let settlements: any[];

  beforeEach(async function () {
    // Get signers
    [owner, engine, user1, user2, user3] = await ethers.getSigners();
    ownerAddress = await owner.getAddress();
    engineAddress = await engine.getAddress();
    user1Address = await user1.getAddress();
    user2Address = await user2.getAddress();
    user3Address = await user3.getAddress();

    // Deploy mock token
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock USDC", "USDC", 6);
    await mockToken.deployed();

    // Deploy settlement contract
    const SettlementWithProofs = await ethers.getContractFactory("SettlementWithProofs");
    settlementContract = await SettlementWithProofs.deploy();
    await settlementContract.deployed();

    // Authorize engine
    await settlementContract.connect(owner).authorizeEngine(engineAddress, true);

    // Create test settlements
    settlements = [
      { user: user1Address, token: mockToken.address, amount: ethers.utils.parseUnits("1000", 6) },
      { user: user2Address, token: mockToken.address, amount: ethers.utils.parseUnits("2000", 6) },
      { user: user3Address, token: mockToken.address, amount: ethers.utils.parseUnits("1500", 6) }
    ];

    // Create Merkle tree
    const leaves = settlements.map(s => 
      ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [s.user, s.token, s.amount]
      )
    );
    
    merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    merkleRoot = merkleTree.getHexRoot();

    // Fund the settlement contract
    await mockToken.mint(settlementContract.address, ethers.utils.parseUnits("10000", 6));
    await settlementContract.connect(engine).depositTokens(
      mockToken.address,
      ethers.utils.parseUnits("10000", 6)
    );
  });

  describe("Settlement Batch Creation", function () {
    it("should create a settlement batch with valid Merkle root", async function () {
      await expect(
        settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          "ipfs://QmTest"
        )
      ).to.emit(settlementContract, "SettlementBatchCreated")
        .withArgs(epochId, merkleRoot, settlements.length, await getBlockTimestamp());

      const batch = await settlementContract.getSettlementBatch(epochId);
      expect(batch.merkleRoot).to.equal(merkleRoot);
      expect(batch.totalSettlements).to.equal(settlements.length);
      expect(batch.ipfsHash).to.equal("ipfs://QmTest");
      expect(batch.finalized).to.be.false;
    });

    it("should prevent duplicate batch creation", async function () {
      await settlementContract.connect(engine).createSettlementBatch(
        epochId,
        merkleRoot,
        settlements.length,
        ""
      );

      await expect(
        settlementContract.connect(engine).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          ""
        )
      ).to.be.revertedWith("Batch already exists");
    });

    it("should require authorization to create batch", async function () {
      await expect(
        settlementContract.connect(user1).createSettlementBatch(
          epochId,
          merkleRoot,
          settlements.length,
          ""
        )
      ).to.be.revertedWith("Not authorized");
    });

    it("should reject zero Merkle root", async function () {
      await expect(
        settlementContract.connect(engine).createSettlementBatch(
          epochId,
          ethers.constants.HashZero,
          settlements.length,
          ""
        )
      ).to.be.revertedWith("Invalid merkle root");
    });
  });

  describe("Batch Finalization", function () {
    beforeEach(async function () {
      await settlementContract.connect(engine).createSettlementBatch(
        epochId,
        merkleRoot,
        settlements.length,
        ""
      );
    });

    it("should finalize a settlement batch", async function () {
      await expect(
        settlementContract.connect(engine).finalizeSettlementBatch(epochId)
      ).to.emit(settlementContract, "SettlementBatchFinalized")
        .withArgs(epochId, merkleRoot);

      const batch = await settlementContract.getSettlementBatch(epochId);
      expect(batch.finalized).to.be.true;
    });

    it("should prevent double finalization", async function () {
      await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

      await expect(
        settlementContract.connect(engine).finalizeSettlementBatch(epochId)
      ).to.be.revertedWith("Already finalized");
    });

    it("should require authorization to finalize", async function () {
      await expect(
        settlementContract.connect(user1).finalizeSettlementBatch(epochId)
      ).to.be.revertedWith("Not authorized");
    });
  });

  describe("Merkle Proof Verification", function () {
    beforeEach(async function () {
      await settlementContract.connect(engine).createSettlementBatch(
        epochId,
        merkleRoot,
        settlements.length,
        ""
      );
      await settlementContract.connect(engine).finalizeSettlementBatch(epochId);
    });

    it("should verify valid Merkle proofs", async function () {
      for (let i = 0; i < settlements.length; i++) {
        const settlement = settlements[i];
        const leaf = ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [settlement.user, settlement.token, settlement.amount]
        );
        const proof = merkleTree.getHexProof(leaf);

        const isValid = await settlementContract.verifyProof(
          epochId,
          settlement.user,
          settlement.token,
          settlement.amount,
          proof
        );

        expect(isValid).to.be.true;
      }
    });

    it("should reject invalid proofs", async function () {
      const settlement = settlements[0];
      const wrongProof = merkleTree.getHexProof(
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user2Address, settlement.token, settlement.amount]
        )
      );

      const isValid = await settlementContract.verifyProof(
        epochId,
        settlement.user,
        settlement.token,
        settlement.amount,
        wrongProof
      );

      expect(isValid).to.be.false;
    });

    it("should handle non-existent epochs", async function () {
      const isValid = await settlementContract.verifyProof(
        "invalid-epoch",
        user1Address,
        mockToken.address,
        100,
        []
      );

      expect(isValid).to.be.false;
    });
  });

  describe("Settlement Claims", function () {
    beforeEach(async function () {
      await settlementContract.connect(engine).createSettlementBatch(
        epochId,
        merkleRoot,
        settlements.length,
        ""
      );
      await settlementContract.connect(engine).finalizeSettlementBatch(epochId);
    });

    it("should allow users to claim settlements with valid proof", async function () {
      const settlement = settlements[0];
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [settlement.user, settlement.token, settlement.amount]
      );
      const proof = merkleTree.getHexProof(leaf);

      const initialBalance = await mockToken.balanceOf(settlement.user);

      await expect(
        settlementContract.connect(user1).claimSettlement(
          epochId,
          settlement.user,
          settlement.token,
          settlement.amount,
          proof
        )
      ).to.emit(settlementContract, "SettlementClaimed")
        .withArgs(epochId, settlement.user, settlement.token, settlement.amount);

      const finalBalance = await mockToken.balanceOf(settlement.user);
      expect(finalBalance.sub(initialBalance)).to.equal(settlement.amount);

      // Check claimed status
      const hasClaimed = await settlementContract.hasClaimed(epochId, settlement.user);
      expect(hasClaimed).to.be.true;
    });

    it("should prevent double claims", async function () {
      const settlement = settlements[0];
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [settlement.user, settlement.token, settlement.amount]
      );
      const proof = merkleTree.getHexProof(leaf);

      // First claim
      await settlementContract.connect(user1).claimSettlement(
        epochId,
        settlement.user,
        settlement.token,
        settlement.amount,
        proof
      );

      // Second claim attempt
      await expect(
        settlementContract.connect(user1).claimSettlement(
          epochId,
          settlement.user,
          settlement.token,
          settlement.amount,
          proof
        )
      ).to.be.revertedWith("Already claimed");
    });

    it("should reject claims with invalid proof", async function () {
      const settlement = settlements[0];
      const wrongProof = merkleTree.getHexProof(
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [user2Address, settlement.token, settlement.amount]
        )
      );

      await expect(
        settlementContract.connect(user1).claimSettlement(
          epochId,
          settlement.user,
          settlement.token,
          settlement.amount,
          wrongProof
        )
      ).to.be.revertedWith("Invalid proof");
    });

    it("should only allow users to claim their own settlements", async function () {
      const settlement = settlements[0];
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [settlement.user, settlement.token, settlement.amount]
      );
      const proof = merkleTree.getHexProof(leaf);

      await expect(
        settlementContract.connect(user2).claimSettlement(
          epochId,
          settlement.user,
          settlement.token,
          settlement.amount,
          proof
        )
      ).to.be.revertedWith("Can only claim own settlement");
    });

    it("should require finalized batch for claims", async function () {
      // Create new unfinalized batch
      const newEpoch = "epoch-002";
      await settlementContract.connect(engine).createSettlementBatch(
        newEpoch,
        merkleRoot,
        settlements.length,
        ""
      );

      const settlement = settlements[0];
      const leaf = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [settlement.user, settlement.token, settlement.amount]
      );
      const proof = merkleTree.getHexProof(leaf);

      await expect(
        settlementContract.connect(user1).claimSettlement(
          newEpoch,
          settlement.user,
          settlement.token,
          settlement.amount,
          proof
        )
      ).to.be.revertedWith("Batch not finalized");
    });
  });

  describe("Batch Claims", function () {
    const epochId2 = "epoch-002";
    let merkleRoot2: string;
    let settlements2: any[];

    beforeEach(async function () {
      // First batch
      await settlementContract.connect(engine).createSettlementBatch(
        epochId,
        merkleRoot,
        settlements.length,
        ""
      );
      await settlementContract.connect(engine).finalizeSettlementBatch(epochId);

      // Second batch with different amounts
      settlements2 = [
        { user: user1Address, token: mockToken.address, amount: ethers.utils.parseUnits("500", 6) },
        { user: user2Address, token: mockToken.address, amount: ethers.utils.parseUnits("750", 6) }
      ];

      const leaves2 = settlements2.map(s => 
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [s.user, s.token, s.amount]
        )
      );
      
      const merkleTree2 = new MerkleTree(leaves2, keccak256, { sortPairs: true });
      merkleRoot2 = merkleTree2.getHexRoot();

      await settlementContract.connect(engine).createSettlementBatch(
        epochId2,
        merkleRoot2,
        settlements2.length,
        ""
      );
      await settlementContract.connect(engine).finalizeSettlementBatch(epochId2);
    });

    it("should handle batch claims across multiple epochs", async function () {
      // Prepare claim data for user1 across both epochs
      const settlement1 = settlements[0];
      const leaf1 = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [settlement1.user, settlement1.token, settlement1.amount]
      );
      const proof1 = merkleTree.getHexProof(leaf1);

      const settlement2 = settlements2[0];
      const leaves2 = settlements2.map(s => 
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [s.user, s.token, s.amount]
        )
      );
      const merkleTree2 = new MerkleTree(leaves2, keccak256, { sortPairs: true });
      const leaf2 = ethers.utils.solidityKeccak256(
        ["address", "address", "uint256"],
        [settlement2.user, settlement2.token, settlement2.amount]
      );
      const proof2 = merkleTree2.getHexProof(leaf2);

      const claimData = [
        {
          epochId: epochId,
          token: settlement1.token,
          amount: settlement1.amount,
          merkleProof: proof1
        },
        {
          epochId: epochId2,
          token: settlement2.token,
          amount: settlement2.amount,
          merkleProof: proof2
        }
      ];

      const initialBalance = await mockToken.balanceOf(user1Address);

      // Execute batch claim
      await settlementContract.connect(user1).batchClaimSettlements(claimData);

      const finalBalance = await mockToken.balanceOf(user1Address);
      const expectedAmount = settlement1.amount.add(settlement2.amount);
      expect(finalBalance.sub(initialBalance)).to.equal(expectedAmount);

      // Verify both are marked as claimed
      expect(await settlementContract.hasClaimed(epochId, user1Address)).to.be.true;
      expect(await settlementContract.hasClaimed(epochId2, user1Address)).to.be.true;
    });
  });

  describe("Token Management", function () {
    it("should track deposited tokens", async function () {
      const depositAmount = ethers.utils.parseUnits("5000", 6);
      
      await mockToken.mint(engineAddress, depositAmount);
      await mockToken.connect(engine).approve(settlementContract.address, depositAmount);
      
      await expect(
        settlementContract.connect(engine).depositTokens(mockToken.address, depositAmount)
      ).to.emit(settlementContract, "TokensDeposited")
        .withArgs(mockToken.address, depositAmount);

      const balance = await settlementContract.tokenBalances(mockToken.address);
      expect(balance).to.equal(depositAmount.add(ethers.utils.parseUnits("10000", 6)));
    });

    it("should handle emergency withdrawals", async function () {
      const withdrawAmount = ethers.utils.parseUnits("1000", 6);
      const recipientAddress = await user3.getAddress();

      const initialBalance = await mockToken.balanceOf(recipientAddress);
      
      await settlementContract.connect(owner).emergencyWithdraw(
        mockToken.address,
        withdrawAmount,
        recipientAddress
      );

      const finalBalance = await mockToken.balanceOf(recipientAddress);
      expect(finalBalance.sub(initialBalance)).to.equal(withdrawAmount);
    });

    it("should prevent unauthorized emergency withdrawals", async function () {
      await expect(
        settlementContract.connect(user1).emergencyWithdraw(
          mockToken.address,
          100,
          user1Address
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Gas Optimization Tests", function () {
    it("should efficiently handle large Merkle trees", async function () {
      // Create 100 settlements
      const largeSettlements = [];
      for (let i = 0; i < 100; i++) {
        const wallet = ethers.Wallet.createRandom();
        largeSettlements.push({
          user: wallet.address,
          token: mockToken.address,
          amount: ethers.utils.parseUnits((100 + i).toString(), 6)
        });
      }

      const leaves = largeSettlements.map(s => 
        ethers.utils.solidityKeccak256(
          ["address", "address", "uint256"],
          [s.user, s.token, s.amount]
        )
      );
      
      const largeMerkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      const largeMerkleRoot = largeMerkleTree.getHexRoot();

      const tx = await settlementContract.connect(engine).createSettlementBatch(
        "large-epoch",
        largeMerkleRoot,
        largeSettlements.length,
        ""
      );

      const receipt = await tx.wait();
      console.log(`Gas used for 100 settlements batch: ${receipt.gasUsed.toString()}`);
      
      // Gas should be reasonable (under 100k)
      expect(receipt.gasUsed.lt(100000)).to.be.true;
    });
  });
});

// Helper function to get current block timestamp
async function getBlockTimestamp(): Promise<number> {
  const blockNumber = await ethers.provider.getBlockNumber();
  const block = await ethers.provider.getBlock(blockNumber);
  return block.timestamp;
}