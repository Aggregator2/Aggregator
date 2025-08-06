// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "../interfaces/IZKVerifier.sol";

/**
 * @title CommitRevealOrder
 * @notice Implements commit-reveal mechanism with ZK proofs for MEV protection
 * @dev Orders are first committed with a hash, then revealed after a delay
 */
contract CommitRevealOrder is ReentrancyGuard, Ownable {
    using ECDSA for bytes32;

    // Constants
    uint256 public constant COMMIT_DURATION = 2 minutes;
    uint256 public constant REVEAL_WINDOW = 5 minutes;
    uint256 public constant MIN_REVEAL_DELAY = 1 minutes;
    
    // ZK Verifier for proof validation
    IZKVerifier public immutable zkVerifier;
    
    // Order commitment structure
    struct OrderCommitment {
        bytes32 commitmentHash;
        uint256 commitTimestamp;
        uint256 revealDeadline;
        address committer;
        bool revealed;
        bool cancelled;
        uint256 stake; // Anti-spam stake
    }
    
    // Revealed order structure
    struct RevealedOrder {
        address trader;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        uint256 deadline;
        bytes zkProof; // Proof of order validity
        uint256 nonce;
        bytes signature;
    }
    
    // State variables
    mapping(bytes32 => OrderCommitment) public commitments;
    mapping(address => uint256) public userNonces;
    mapping(address => uint256) public userStakes;
    
    // Events
    event OrderCommitted(
        bytes32 indexed commitmentId,
        address indexed committer,
        uint256 commitTimestamp,
        uint256 revealDeadline
    );
    
    event OrderRevealed(
        bytes32 indexed commitmentId,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    );
    
    event OrderCancelled(
        bytes32 indexed commitmentId,
        address indexed committer,
        uint256 stakeReturned
    );
    
    event StakeSlashed(
        address indexed violator,
        uint256 amount,
        string reason
    );
    
    // Modifiers
    modifier validCommitment(bytes32 commitmentId) {
        require(
            commitments[commitmentId].commitTimestamp > 0,
            "Invalid commitment"
        );
        require(
            !commitments[commitmentId].revealed,
            "Already revealed"
        );
        require(
            !commitments[commitmentId].cancelled,
            "Already cancelled"
        );
        _;
    }
    
    constructor(address _zkVerifier) {
        require(_zkVerifier != address(0), "Invalid verifier");
        zkVerifier = IZKVerifier(_zkVerifier);
    }
    
    /**
     * @notice Commit to an order with a hash
     * @param commitmentHash Hash of the order details
     * @return commitmentId Unique identifier for the commitment
     */
    function commitOrder(bytes32 commitmentHash) 
        external 
        payable 
        nonReentrant 
        returns (bytes32 commitmentId) 
    {
        require(commitmentHash != bytes32(0), "Invalid hash");
        require(msg.value >= getRequiredStake(msg.sender), "Insufficient stake");
        
        // Generate unique commitment ID
        commitmentId = keccak256(
            abi.encodePacked(
                commitmentHash,
                msg.sender,
                block.timestamp,
                userNonces[msg.sender]++
            )
        );
        
        // Store commitment
        commitments[commitmentId] = OrderCommitment({
            commitmentHash: commitmentHash,
            commitTimestamp: block.timestamp,
            revealDeadline: block.timestamp + COMMIT_DURATION + REVEAL_WINDOW,
            committer: msg.sender,
            revealed: false,
            cancelled: false,
            stake: msg.value
        });
        
        userStakes[msg.sender] += msg.value;
        
        emit OrderCommitted(
            commitmentId,
            msg.sender,
            block.timestamp,
            block.timestamp + COMMIT_DURATION + REVEAL_WINDOW
        );
    }
    
    /**
     * @notice Reveal a committed order
     * @param commitmentId The commitment to reveal
     * @param order The order details
     */
    function revealOrder(
        bytes32 commitmentId,
        RevealedOrder calldata order
    ) 
        external 
        nonReentrant
        validCommitment(commitmentId)
    {
        OrderCommitment storage commitment = commitments[commitmentId];
        
        // Timing checks
        require(
            block.timestamp >= commitment.commitTimestamp + MIN_REVEAL_DELAY,
            "Too early to reveal"
        );
        require(
            block.timestamp <= commitment.revealDeadline,
            "Reveal window expired"
        );
        
        // Verify commitment hash
        bytes32 orderHash = computeOrderHash(order);
        require(
            commitment.commitmentHash == orderHash,
            "Hash mismatch"
        );
        
        // Verify ZK proof
        require(
            zkVerifier.verifyOrderProof(
                order.zkProof,
                orderHash,
                order.trader
            ),
            "Invalid ZK proof"
        );
        
        // Verify signature
        require(
            verifyOrderSignature(order, orderHash),
            "Invalid signature"
        );
        
        // Mark as revealed
        commitment.revealed = true;
        
        // Return stake
        uint256 stakeToReturn = commitment.stake;
        userStakes[commitment.committer] -= stakeToReturn;
        
        // Execute order through MEV-protected pathway
        _executeProtectedOrder(order);
        
        // Return stake
        payable(commitment.committer).transfer(stakeToReturn);
        
        emit OrderRevealed(
            commitmentId,
            order.trader,
            order.tokenIn,
            order.tokenOut,
            order.amountIn
        );
    }
    
    /**
     * @notice Cancel a commitment before reveal
     * @param commitmentId The commitment to cancel
     */
    function cancelCommitment(bytes32 commitmentId)
        external
        nonReentrant
        validCommitment(commitmentId)
    {
        OrderCommitment storage commitment = commitments[commitmentId];
        
        require(
            msg.sender == commitment.committer,
            "Not committer"
        );
        require(
            block.timestamp < commitment.commitTimestamp + MIN_REVEAL_DELAY,
            "Cannot cancel after reveal period"
        );
        
        commitment.cancelled = true;
        
        // Apply cancellation penalty (10%)
        uint256 penalty = commitment.stake / 10;
        uint256 refund = commitment.stake - penalty;
        
        userStakes[msg.sender] -= commitment.stake;
        
        // Transfer refund
        if (refund > 0) {
            payable(msg.sender).transfer(refund);
        }
        
        emit OrderCancelled(commitmentId, msg.sender, refund);
        
        if (penalty > 0) {
            emit StakeSlashed(msg.sender, penalty, "Cancellation penalty");
        }
    }
    
    /**
     * @notice Slash stake for expired commitments
     * @param commitmentId The expired commitment
     */
    function slashExpiredCommitment(bytes32 commitmentId)
        external
        nonReentrant
    {
        OrderCommitment storage commitment = commitments[commitmentId];
        
        require(
            commitment.commitTimestamp > 0,
            "Invalid commitment"
        );
        require(
            !commitment.revealed && !commitment.cancelled,
            "Already processed"
        );
        require(
            block.timestamp > commitment.revealDeadline,
            "Not expired"
        );
        
        commitment.cancelled = true;
        
        uint256 slashedStake = commitment.stake;
        userStakes[commitment.committer] -= slashedStake;
        
        // Reward caller with 10% of slashed stake
        uint256 reward = slashedStake / 10;
        if (reward > 0) {
            payable(msg.sender).transfer(reward);
        }
        
        emit StakeSlashed(
            commitment.committer,
            slashedStake,
            "Expired commitment"
        );
    }
    
    /**
     * @notice Compute order hash
     */
    function computeOrderHash(RevealedOrder calldata order) 
        public 
        pure 
        returns (bytes32) 
    {
        return keccak256(abi.encode(
            order.trader,
            order.tokenIn,
            order.tokenOut,
            order.amountIn,
            order.amountOutMin,
            order.deadline,
            order.nonce
        ));
    }
    
    /**
     * @notice Verify order signature
     */
    function verifyOrderSignature(
        RevealedOrder calldata order,
        bytes32 orderHash
    ) 
        internal 
        pure 
        returns (bool) 
    {
        bytes32 ethSignedHash = orderHash.toEthSignedMessageHash();
        address signer = ethSignedHash.recover(order.signature);
        return signer == order.trader;
    }
    
    /**
     * @notice Get required stake amount
     */
    function getRequiredStake(address user) 
        public 
        view 
        returns (uint256) 
    {
        // Base stake: 0.01 ETH
        uint256 baseStake = 0.01 ether;
        
        // Increase stake for repeat offenders
        uint256 violations = 0; // Would track this in production
        
        return baseStake * (2 ** violations);
    }
    
    /**
     * @notice Execute order through MEV-protected pathway
     */
    function _executeProtectedOrder(RevealedOrder memory order) 
        internal 
    {
        // This would integrate with the DEX trading engine
        // Orders are executed in commit order, preventing front-running
        
        // Placeholder for actual execution logic
        // In production, this would:
        // 1. Validate order parameters
        // 2. Check balances and allowances
        // 3. Execute through private pool or batch auction
        // 4. Emit execution events
    }
    
    /**
     * @notice Emergency pause (only owner)
     */
    function emergencyWithdraw() 
        external 
        onlyOwner 
    {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance");
        payable(owner()).transfer(balance);
    }
}