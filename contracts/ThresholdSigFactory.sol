// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IThresholdWallet.sol";

/**
 * @title ThresholdSigFactory
 * @notice Factory for creating threshold signature wallets with distributed key generation
 * @dev Supports various threshold schemes (2-of-3, 3-of-5, etc.)
 */
contract ThresholdSigFactory is Ownable {
    using Clones for address;
    
    // Wallet implementation address
    address public immutable walletImplementation;
    
    // Deployed wallets tracking
    mapping(address => address[]) public userWallets;
    mapping(address => bool) public isThresholdWallet;
    
    // DKG (Distributed Key Generation) coordination
    mapping(bytes32 => DKGSession) public dkgSessions;
    
    struct DKGSession {
        bytes32 sessionId;
        address initiator;
        uint256 threshold;
        uint256 participants;
        uint256 commitmentsReceived;
        uint256 sharesDistributed;
        bool completed;
        mapping(address => bool) hasCommitted;
        mapping(address => bytes) commitments;
        mapping(address => mapping(address => bytes)) shares;
    }
    
    // Events
    event WalletCreated(
        address indexed wallet,
        address indexed creator,
        uint256 threshold,
        uint256 participants
    );
    
    event DKGSessionStarted(
        bytes32 indexed sessionId,
        address indexed initiator,
        uint256 threshold,
        uint256 participants
    );
    
    event DKGCommitmentSubmitted(
        bytes32 indexed sessionId,
        address indexed participant
    );
    
    event DKGSharesDistributed(
        bytes32 indexed sessionId,
        address indexed participant
    );
    
    event DKGCompleted(
        bytes32 indexed sessionId,
        address indexed wallet
    );
    
    constructor(address _walletImplementation) {
        require(_walletImplementation != address(0), "Invalid implementation");
        walletImplementation = _walletImplementation;
    }
    
    /**
     * @notice Create a new threshold signature wallet
     * @param threshold Number of signatures required
     * @param owners Initial owners of the wallet
     * @param salt Unique salt for deterministic deployment
     */
    function createThresholdWallet(
        uint256 threshold,
        address[] calldata owners,
        bytes32 salt
    ) external returns (address wallet) {
        require(threshold > 0 && threshold <= owners.length, "Invalid threshold");
        require(owners.length >= 2 && owners.length <= 20, "Invalid owners count");
        
        // Deploy wallet using CREATE2 for deterministic addresses
        wallet = Clones.cloneDeterministic(walletImplementation, salt);
        
        // Initialize the wallet
        IThresholdWallet(wallet).initialize(threshold, owners);
        
        // Track the wallet
        isThresholdWallet[wallet] = true;
        for (uint256 i = 0; i < owners.length; i++) {
            userWallets[owners[i]].push(wallet);
        }
        
        emit WalletCreated(wallet, msg.sender, threshold, owners.length);
    }
    
    /**
     * @notice Start a distributed key generation session
     * @param threshold Threshold for the generated keys
     * @param participants Array of participant addresses
     */
    function startDKGSession(
        uint256 threshold,
        address[] calldata participants
    ) external returns (bytes32 sessionId) {
        require(threshold > 0 && threshold <= participants.length, "Invalid threshold");
        require(participants.length >= 2, "Not enough participants");
        
        sessionId = keccak256(
            abi.encodePacked(
                msg.sender,
                threshold,
                participants,
                block.timestamp
            )
        );
        
        DKGSession storage session = dkgSessions[sessionId];
        session.sessionId = sessionId;
        session.initiator = msg.sender;
        session.threshold = threshold;
        session.participants = participants.length;
        
        emit DKGSessionStarted(sessionId, msg.sender, threshold, participants.length);
    }
    
    /**
     * @notice Submit commitment for DKG session
     * @param sessionId The DKG session ID
     * @param commitment Cryptographic commitment
     */
    function submitDKGCommitment(
        bytes32 sessionId,
        bytes calldata commitment
    ) external {
        DKGSession storage session = dkgSessions[sessionId];
        require(!session.completed, "Session completed");
        require(!session.hasCommitted[msg.sender], "Already committed");
        require(commitment.length > 0, "Invalid commitment");
        
        session.hasCommitted[msg.sender] = true;
        session.commitments[msg.sender] = commitment;
        session.commitmentsReceived++;
        
        emit DKGCommitmentSubmitted(sessionId, msg.sender);
    }
    
    /**
     * @notice Distribute shares in DKG session
     * @param sessionId The DKG session ID
     * @param recipients Share recipients
     * @param encryptedShares Encrypted shares for each recipient
     */
    function distributeDKGShares(
        bytes32 sessionId,
        address[] calldata recipients,
        bytes[] calldata encryptedShares
    ) external {
        require(recipients.length == encryptedShares.length, "Length mismatch");
        
        DKGSession storage session = dkgSessions[sessionId];
        require(!session.completed, "Session completed");
        require(session.hasCommitted[msg.sender], "Must commit first");
        
        for (uint256 i = 0; i < recipients.length; i++) {
            session.shares[msg.sender][recipients[i]] = encryptedShares[i];
        }
        
        session.sharesDistributed++;
        
        emit DKGSharesDistributed(sessionId, msg.sender);
        
        // Check if DKG is complete
        if (session.sharesDistributed == session.participants) {
            _completeDKG(sessionId);
        }
    }
    
    /**
     * @notice Complete DKG and create wallet
     */
    function _completeDKG(bytes32 sessionId) internal {
        DKGSession storage session = dkgSessions[sessionId];
        session.completed = true;
        
        // In a real implementation, this would:
        // 1. Verify all shares
        // 2. Compute the public key
        // 3. Deploy a wallet with the generated key
        
        emit DKGCompleted(sessionId, address(0)); // Placeholder
    }
    
    /**
     * @notice Get user's threshold wallets
     */
    function getUserWallets(address user) external view returns (address[] memory) {
        return userWallets[user];
    }
    
    /**
     * @notice Calculate deterministic wallet address
     */
    function calculateWalletAddress(bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(walletImplementation, salt);
    }
    
    /**
     * @notice Get DKG session details
     */
    function getDKGSession(bytes32 sessionId) external view returns (
        address initiator,
        uint256 threshold,
        uint256 participants,
        uint256 commitmentsReceived,
        bool completed
    ) {
        DKGSession storage session = dkgSessions[sessionId];
        return (
            session.initiator,
            session.threshold,
            session.participants,
            session.commitmentsReceived,
            session.completed
        );
    }
}