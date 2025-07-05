// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SettlementWithMerkleProof
 * @notice Settlement contract that stores Merkle roots for proof verification
 */
contract SettlementWithMerkleProof is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Settlement root information
    struct SettlementRoot {
        bytes32 root;
        uint256 blockNumber;
        uint256 timestamp;
        uint256 leafCount;
        bool exists;
    }

    // Events
    event SettlementExecuted(
        bytes32 indexed batchId,
        bytes32 indexed merkleRoot,
        uint256 leafCount,
        uint256 timestamp
    );
    
    event SettlementVerified(
        bytes32 indexed batchId,
        address indexed verifier,
        bool valid
    );

    // State variables
    mapping(bytes32 => SettlementRoot) public settlementRoots;
    mapping(address => bool) public authorizedSettlers;
    
    uint256 public totalSettlements;
    uint256 public minBatchSize = 1;
    uint256 public maxBatchSize = 1000;

    // Modifiers
    modifier onlyAuthorizedSettler() {
        require(
            authorizedSettlers[msg.sender] || msg.sender == owner(),
            "Not authorized settler"
        );
        _;
    }

    constructor() {
        authorizedSettlers[msg.sender] = true;
    }

    /**
     * @notice Execute settlement batch and store Merkle root
     * @param batchId Unique identifier for the batch
     * @param merkleRoot Merkle root of the settlement batch
     * @param users Array of user addresses
     * @param tokens Array of token addresses
     * @param amounts Array of amounts (positive for receiving, negative for sending)
     * @param leafCount Number of leaves in the Merkle tree
     */
    function executeSettlementWithProof(
        bytes32 batchId,
        bytes32 merkleRoot,
        address[] calldata users,
        address[] calldata tokens,
        int256[] calldata amounts,
        uint256 leafCount
    ) external onlyAuthorizedSettler nonReentrant whenNotPaused {
        require(!settlementRoots[batchId].exists, "Batch already settled");
        require(merkleRoot != bytes32(0), "Invalid merkle root");
        require(leafCount >= minBatchSize && leafCount <= maxBatchSize, "Invalid batch size");
        require(
            users.length == tokens.length && tokens.length == amounts.length,
            "Array length mismatch"
        );

        // Execute the settlement transfers
        for (uint256 i = 0; i < users.length; i++) {
            if (amounts[i] > 0) {
                // User receives tokens
                IERC20(tokens[i]).safeTransfer(users[i], uint256(amounts[i]));
            } else if (amounts[i] < 0) {
                // User sends tokens (should have been pre-collected)
                // In production, this would involve more complex logic
                require(
                    IERC20(tokens[i]).balanceOf(address(this)) >= uint256(-amounts[i]),
                    "Insufficient contract balance"
                );
            }
        }

        // Store the Merkle root
        settlementRoots[batchId] = SettlementRoot({
            root: merkleRoot,
            blockNumber: block.number,
            timestamp: block.timestamp,
            leafCount: leafCount,
            exists: true
        });

        totalSettlements++;

        emit SettlementExecuted(batchId, merkleRoot, leafCount, block.timestamp);
    }

    /**
     * @notice Verify a settlement was included in a batch
     * @param batchId The batch identifier
     * @param leaf The leaf hash to verify
     * @param proof Array of sibling hashes for the Merkle proof
     * @param position The position of the leaf in the tree
     * @return valid Whether the proof is valid
     */
    function verifySettlement(
        bytes32 batchId,
        bytes32 leaf,
        bytes32[] calldata proof,
        uint256 position
    ) external view returns (bool valid) {
        SettlementRoot memory root = settlementRoots[batchId];
        require(root.exists, "Settlement batch not found");

        bytes32 computedHash = leaf;
        uint256 index = position;

        for (uint256 i = 0; i < proof.length; i++) {
            if (index % 2 == 0) {
                computedHash = keccak256(abi.encodePacked(computedHash, proof[i]));
            } else {
                computedHash = keccak256(abi.encodePacked(proof[i], computedHash));
            }
            index = index / 2;
        }

        return computedHash == root.root;
    }

    /**
     * @notice Get settlement root information
     * @param batchId The batch identifier
     * @return root The Merkle root
     */
    function getSettlementRoot(bytes32 batchId) external view returns (bytes32 root) {
        require(settlementRoots[batchId].exists, "Settlement batch not found");
        return settlementRoots[batchId].root;
    }

    /**
     * @notice Get full settlement information
     * @param batchId The batch identifier
     */
    function getSettlementInfo(bytes32 batchId) 
        external 
        view 
        returns (
            bytes32 root,
            uint256 blockNumber,
            uint256 timestamp,
            uint256 leafCount,
            bool exists
        ) 
    {
        SettlementRoot memory info = settlementRoots[batchId];
        return (
            info.root,
            info.blockNumber,
            info.timestamp,
            info.leafCount,
            info.exists
        );
    }

    /**
     * @notice Authorize a new settler
     * @param settler Address to authorize
     */
    function authorizeSettler(address settler) external onlyOwner {
        authorizedSettlers[settler] = true;
    }

    /**
     * @notice Revoke settler authorization
     * @param settler Address to revoke
     */
    function revokeSettler(address settler) external onlyOwner {
        authorizedSettlers[settler] = false;
    }

    /**
     * @notice Update batch size limits
     * @param _minBatchSize New minimum batch size
     * @param _maxBatchSize New maximum batch size
     */
    function updateBatchSizeLimits(
        uint256 _minBatchSize,
        uint256 _maxBatchSize
    ) external onlyOwner {
        require(_minBatchSize > 0 && _minBatchSize <= _maxBatchSize, "Invalid batch size limits");
        minBatchSize = _minBatchSize;
        maxBatchSize = _maxBatchSize;
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Emergency withdrawal
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    // Receive ETH
    receive() external payable {}
}