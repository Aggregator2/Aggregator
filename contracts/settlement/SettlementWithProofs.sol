// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract SettlementWithProofs is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct SettlementBatch {
        bytes32 merkleRoot;
        uint256 timestamp;
        uint256 blockNumber;
        uint256 totalSettlements;
        string ipfsHash; // Optional: store full data on IPFS
        bool finalized;
    }

    struct Settlement {
        address user;
        address token;
        uint256 amount;
        bool claimed;
    }

    // Epoch ID => Settlement Batch
    mapping(string => SettlementBatch) public settlementBatches;
    
    // Merkle root => claimed status for user
    mapping(bytes32 => mapping(address => bool)) public claimed;
    
    // Settlement contract balance tracking
    mapping(address => uint256) public tokenBalances;
    
    // Authorized settlement engines
    mapping(address => bool) public authorizedEngines;

    event SettlementBatchCreated(
        string indexed epochId,
        bytes32 merkleRoot,
        uint256 totalSettlements,
        uint256 timestamp
    );

    event SettlementClaimed(
        string indexed epochId,
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event SettlementBatchFinalized(
        string indexed epochId,
        bytes32 merkleRoot
    );

    event TokensDeposited(
        address indexed token,
        uint256 amount
    );

    modifier onlyAuthorized() {
        require(
            authorizedEngines[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }

    constructor() {
        // Constructor
    }

    function authorizeEngine(address engine, bool authorized) external onlyOwner {
        authorizedEngines[engine] = authorized;
    }

    /**
     * @dev Create a new settlement batch with Merkle root
     * @param epochId Unique identifier for the settlement epoch
     * @param merkleRoot Root of the Merkle tree containing all settlements
     * @param totalSettlements Total number of settlements in the batch
     * @param ipfsHash Optional IPFS hash containing full settlement data
     */
    function createSettlementBatch(
        string calldata epochId,
        bytes32 merkleRoot,
        uint256 totalSettlements,
        string calldata ipfsHash
    ) external onlyAuthorized {
        require(
            settlementBatches[epochId].merkleRoot == bytes32(0),
            "Batch already exists"
        );
        require(merkleRoot != bytes32(0), "Invalid merkle root");

        settlementBatches[epochId] = SettlementBatch({
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            blockNumber: block.number,
            totalSettlements: totalSettlements,
            ipfsHash: ipfsHash,
            finalized: false
        });

        emit SettlementBatchCreated(
            epochId,
            merkleRoot,
            totalSettlements,
            block.timestamp
        );
    }

    /**
     * @dev Finalize a settlement batch (no more changes allowed)
     * @param epochId Epoch to finalize
     */
    function finalizeSettlementBatch(string calldata epochId) external onlyAuthorized {
        SettlementBatch storage batch = settlementBatches[epochId];
        require(batch.merkleRoot != bytes32(0), "Batch does not exist");
        require(!batch.finalized, "Already finalized");
        
        batch.finalized = true;
        
        emit SettlementBatchFinalized(epochId, batch.merkleRoot);
    }

    /**
     * @dev Claim settlement using Merkle proof
     * @param epochId Settlement epoch ID
     * @param user Address of the user claiming
     * @param token Token address
     * @param amount Settlement amount
     * @param merkleProof Proof that this settlement is in the Merkle tree
     */
    function claimSettlement(
        string calldata epochId,
        address user,
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        require(msg.sender == user, "Can only claim own settlement");
        
        SettlementBatch memory batch = settlementBatches[epochId];
        require(batch.merkleRoot != bytes32(0), "Invalid epoch");
        require(batch.finalized, "Batch not finalized");
        require(!claimed[batch.merkleRoot][user], "Already claimed");

        // Verify the Merkle proof
        bytes32 leaf = keccak256(abi.encode(user, token, amount));
        require(
            MerkleProof.verify(merkleProof, batch.merkleRoot, leaf),
            "Invalid proof"
        );

        // Mark as claimed
        claimed[batch.merkleRoot][user] = true;

        // Check contract has sufficient balance
        require(
            tokenBalances[token] >= amount,
            "Insufficient contract balance"
        );

        // Update balance
        tokenBalances[token] -= amount;

        // Transfer tokens to user
        IERC20(token).safeTransfer(user, amount);

        emit SettlementClaimed(epochId, user, token, amount);
    }

    /**
     * @dev Batch claim multiple settlements
     * @param claims Array of claim data
     */
    function batchClaimSettlements(
        ClaimData[] calldata claims
    ) external nonReentrant {
        for (uint256 i = 0; i < claims.length; i++) {
            ClaimData calldata claim = claims[i];
            
            // Skip if already claimed
            SettlementBatch memory batch = settlementBatches[claim.epochId];
            if (claimed[batch.merkleRoot][msg.sender]) {
                continue;
            }

            // Verify and process claim
            claimSettlement(
                claim.epochId,
                msg.sender,
                claim.token,
                claim.amount,
                claim.merkleProof
            );
        }
    }

    /**
     * @dev Verify a Merkle proof without claiming
     * @return valid Whether the proof is valid
     */
    function verifyProof(
        string calldata epochId,
        address user,
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external view returns (bool valid) {
        SettlementBatch memory batch = settlementBatches[epochId];
        if (batch.merkleRoot == bytes32(0)) {
            return false;
        }

        bytes32 leaf = keccak256(abi.encode(user, token, amount));
        return MerkleProof.verify(merkleProof, batch.merkleRoot, leaf);
    }

    /**
     * @dev Check if a user has claimed their settlement
     * @param epochId Settlement epoch
     * @param user User address
     * @return Whether the user has claimed
     */
    function hasClaimed(
        string calldata epochId,
        address user
    ) external view returns (bool) {
        SettlementBatch memory batch = settlementBatches[epochId];
        return claimed[batch.merkleRoot][user];
    }

    /**
     * @dev Get settlement batch information
     * @param epochId Epoch to query
     * @return batch Settlement batch data
     */
    function getSettlementBatch(
        string calldata epochId
    ) external view returns (SettlementBatch memory batch) {
        return settlementBatches[epochId];
    }

    /**
     * @dev Deposit tokens for settlement distribution
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function depositTokens(
        address token,
        uint256 amount
    ) external onlyAuthorized {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        tokenBalances[token] += amount;
        
        emit TokensDeposited(token, amount);
    }

    /**
     * @dev Emergency withdrawal of tokens
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param to Recipient address
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address to
    ) external onlyOwner {
        require(tokenBalances[token] >= amount, "Insufficient balance");
        tokenBalances[token] -= amount;
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @dev Get the leaf hash for a settlement
     * @param user User address
     * @param token Token address
     * @param amount Settlement amount
     * @return leaf Keccak256 hash of the settlement data
     */
    function getLeafHash(
        address user,
        address token,
        uint256 amount
    ) public pure returns (bytes32 leaf) {
        return keccak256(abi.encode(user, token, amount));
    }

    struct ClaimData {
        string epochId;
        address token;
        uint256 amount;
        bytes32[] merkleProof;
    }
}