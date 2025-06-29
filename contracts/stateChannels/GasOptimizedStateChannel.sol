// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../security/SignatureVerifier.sol";

/**
 * @title GasOptimizedStateChannel
 * @notice Gas-optimized version of StateChannel with packed storage and efficient operations
 */
contract GasOptimizedStateChannel is SignatureVerifier, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Packed struct to save storage slots
    struct ChannelData {
        uint8 status; // 0: Active, 1: Disputing, 2: Finalized, 3: ForceClosing
        uint32 challengePeriod;
        uint32 participantCount;
        uint48 latestNonce;
        uint48 challengeEnd;
        address challenger;
    }

    // Packed participant data
    struct ParticipantData {
        uint128 deposit;
        uint128 balance;
    }

    // Storage
    ChannelData public channelData;
    IERC20 public immutable token;
    address public immutable factory;
    
    mapping(uint256 => address) public participantByIndex;
    mapping(address => ParticipantData) public participants;
    mapping(address => bool) public isParticipant;
    
    bytes32 public latestStateRoot;
    uint256 public totalDeposited;

    // Events
    event Deposited(address indexed participant, uint128 amount);
    event StateUpdated(uint48 indexed nonce, bytes32 stateRoot);
    event ChannelFinalized(uint48 finalNonce);

    // Custom errors
    error NotParticipant();
    error InvalidStatus();
    error InvalidStateTransition();
    error InsufficientBalance();

    modifier onlyParticipant() {
        if (!isParticipant[msg.sender]) revert NotParticipant();
        _;
    }

    constructor(
        address[] memory _participants,
        address _token,
        uint32 _challengePeriod,
        address _factory
    ) {
        uint256 participantCount = _participants.length;
        require(participantCount >= 2 && participantCount <= 10, "Invalid participant count");
        
        token = IERC20(_token);
        factory = _factory;
        
        channelData = ChannelData({
            status: 0, // Active
            challengePeriod: _challengePeriod,
            participantCount: uint32(participantCount),
            latestNonce: 0,
            challengeEnd: 0,
            challenger: address(0)
        });
        
        for (uint256 i; i < participantCount;) {
            address participant = _participants[i];
            participantByIndex[i] = participant;
            isParticipant[participant] = true;
            unchecked { ++i; }
        }
    }

    function deposit(uint128 amount) external onlyParticipant nonReentrant {
        if (channelData.status != 0) revert InvalidStatus();
        
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        ParticipantData storage data = participants[msg.sender];
        data.deposit += amount;
        totalDeposited += amount;
        
        emit Deposited(msg.sender, amount);
    }

    function updateState(
        uint48 nonce,
        bytes32 stateRoot,
        uint128[] calldata balances,
        bytes calldata packedSignatures // Packed signatures to save calldata
    ) external onlyParticipant {
        if (channelData.status != 0) revert InvalidStatus();
        if (nonce <= channelData.latestNonce) revert InvalidStateTransition();
        
        uint256 participantCount = channelData.participantCount;
        if (balances.length != participantCount) revert InvalidStateTransition();
        
        // Verify total balance
        uint256 total;
        for (uint256 i; i < participantCount;) {
            total += balances[i];
            unchecked { ++i; }
        }
        if (total > totalDeposited) revert InvalidStateTransition();
        
        // Verify signatures (unpacked on-chain)
        _verifyPackedSignatures(nonce, stateRoot, balances, packedSignatures);
        
        // Update state
        channelData.latestNonce = nonce;
        latestStateRoot = stateRoot;
        
        // Update balances
        for (uint256 i; i < participantCount;) {
            address participant = participantByIndex[i];
            participants[participant].balance = balances[i];
            unchecked { ++i; }
        }
        
        emit StateUpdated(nonce, stateRoot);
    }

    function cooperativeClose(
        uint48 nonce,
        bytes32 stateRoot,
        uint128[] calldata balances,
        bytes calldata packedSignatures
    ) external onlyParticipant {
        if (channelData.status == 2) revert InvalidStatus(); // Already finalized
        
        _verifyPackedSignatures(nonce, stateRoot, balances, packedSignatures);
        
        // Update final state
        channelData.latestNonce = nonce;
        channelData.status = 2; // Finalized
        latestStateRoot = stateRoot;
        
        uint256 participantCount = channelData.participantCount;
        for (uint256 i; i < participantCount;) {
            address participant = participantByIndex[i];
            participants[participant].balance = balances[i];
            unchecked { ++i; }
        }
        
        emit ChannelFinalized(nonce);
    }

    function withdraw() external nonReentrant {
        if (channelData.status != 2) revert InvalidStatus();
        
        ParticipantData storage data = participants[msg.sender];
        uint128 amount = data.balance;
        if (amount == 0) revert InsufficientBalance();
        
        data.balance = 0;
        token.safeTransfer(msg.sender, amount);
    }

    function batchWithdraw(address[] calldata recipients) external nonReentrant {
        if (channelData.status != 2) revert InvalidStatus();
        
        uint256 length = recipients.length;
        for (uint256 i; i < length;) {
            address recipient = recipients[i];
            ParticipantData storage data = participants[recipient];
            uint128 amount = data.balance;
            
            if (amount > 0) {
                data.balance = 0;
                token.safeTransfer(recipient, amount);
            }
            
            unchecked { ++i; }
        }
    }

    function _verifyPackedSignatures(
        uint48 nonce,
        bytes32 stateRoot,
        uint128[] calldata balances,
        bytes calldata packedSignatures
    ) private view {
        uint256 participantCount = channelData.participantCount;
        require(packedSignatures.length == participantCount * 65, "Invalid signature length");
        
        bytes32 messageHash = keccak256(abi.encode(
            address(this),
            nonce,
            stateRoot,
            balances,
            block.chainid
        ));
        
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        
        for (uint256 i; i < participantCount;) {
            uint256 offset = i * 65;
            bytes memory signature = packedSignatures[offset:offset + 65];
            
            address recoveredSigner = recoverSigner(ethSignedMessageHash, signature);
            require(recoveredSigner == participantByIndex[i], "Invalid signature");
            
            unchecked { ++i; }
        }
    }

    // View functions with minimal gas usage
    function getChannelInfo() external view returns (
        uint8 status,
        uint48 nonce,
        uint256 deposited,
        uint32 participants
    ) {
        ChannelData memory data = channelData;
        return (data.status, data.latestNonce, totalDeposited, data.participantCount);
    }

    function getParticipantInfo(address participant) external view returns (
        uint128 deposited,
        uint128 balance,
        bool active
    ) {
        ParticipantData memory data = participants[participant];
        return (data.deposit, data.balance, isParticipant[participant]);
    }
}