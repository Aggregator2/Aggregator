// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../security/SignatureVerifier.sol";
import "../security/CircuitBreaker.sol";

contract StateChannel is SignatureVerifier, CircuitBreaker, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ChannelStatus { Active, Disputing, Finalized, ForceClosing }

    struct State {
        uint256 nonce;
        mapping(address => uint256) balances;
        bytes32 stateRoot;
        uint256 timestamp;
    }

    struct Challenge {
        State proposedState;
        address challenger;
        uint256 challengeEnd;
        bool responded;
    }

    address[] public participants;
    mapping(address => bool) public isParticipant;
    mapping(address => uint256) public participantIndex;
    
    IERC20 public immutable token;
    uint256 public immutable challengePeriod;
    address public immutable factory;
    
    ChannelStatus public status;
    State public latestState;
    Challenge public activeChallenge;
    
    mapping(address => uint256) public deposits;
    uint256 public totalDeposited;
    
    uint256 private constant MAX_UINT256 = type(uint256).max;
    uint256 private constant MINIMUM_DEPOSIT = 1e15;

    event Deposited(address indexed participant, uint256 amount);
    event StateUpdated(uint256 indexed nonce, bytes32 stateRoot);
    event ChallengeInitiated(address indexed challenger, uint256 nonce);
    event ChallengeResponded(uint256 nonce);
    event ChannelFinalized(uint256 finalNonce);
    event Withdrawn(address indexed participant, uint256 amount);
    event EmergencyWithdrawal(address indexed participant, uint256 amount);

    error NotParticipant();
    error InvalidStatus();
    error InsufficientDeposit();
    error InvalidStateTransition();
    error InvalidSignatures();
    error ChallengeActive();
    error ChallengePeriodNotEnded();
    error AlreadyFinalized();
    error InvalidWithdrawalAmount();
    error TransferFailed();

    modifier onlyParticipant() {
        if (!isParticipant[msg.sender]) revert NotParticipant();
        _;
    }

    modifier inStatus(ChannelStatus requiredStatus) {
        if (status != requiredStatus) revert InvalidStatus();
        _;
    }

    constructor(
        address[] memory _participants,
        address _token,
        uint256 _challengePeriod,
        address _factory
    ) {
        require(_participants.length >= 2, "Min 2 participants");
        require(_token != address(0), "Invalid token");
        require(_challengePeriod > 0, "Invalid challenge period");
        
        participants = _participants;
        token = IERC20(_token);
        challengePeriod = _challengePeriod;
        factory = _factory;
        
        for (uint256 i = 0; i < _participants.length; i++) {
            isParticipant[_participants[i]] = true;
            participantIndex[_participants[i]] = i;
        }
        
        status = ChannelStatus.Active;
    }

    function deposit(uint256 amount) external onlyParticipant nonReentrant whenNotPaused {
        if (amount < MINIMUM_DEPOSIT) revert InsufficientDeposit();
        if (status != ChannelStatus.Active) revert InvalidStatus();
        
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        deposits[msg.sender] += amount;
        totalDeposited += amount;
        
        emit Deposited(msg.sender, amount);
    }

    function updateState(
        uint256 nonce,
        bytes32 stateRoot,
        uint256[] calldata balances,
        bytes[] calldata signatures
    ) external onlyParticipant inStatus(ChannelStatus.Active) {
        if (nonce <= latestState.nonce) revert InvalidStateTransition();
        if (balances.length != participants.length) revert InvalidStateTransition();
        
        uint256 totalBalance = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            totalBalance += balances[i];
        }
        if (totalBalance > totalDeposited) revert InvalidStateTransition();
        
        _verifyStateSignatures(nonce, stateRoot, balances, signatures);
        
        latestState.nonce = nonce;
        latestState.stateRoot = stateRoot;
        latestState.timestamp = block.timestamp;
        
        for (uint256 i = 0; i < participants.length; i++) {
            latestState.balances[participants[i]] = balances[i];
        }
        
        emit StateUpdated(nonce, stateRoot);
    }

    function initiateChallenge(
        uint256 nonce,
        bytes32 stateRoot,
        uint256[] calldata balances,
        bytes[] calldata signatures
    ) external onlyParticipant {
        if (status == ChannelStatus.Finalized) revert AlreadyFinalized();
        if (status == ChannelStatus.Disputing) revert ChallengeActive();
        if (nonce <= latestState.nonce) revert InvalidStateTransition();
        
        _verifyStateSignatures(nonce, stateRoot, balances, signatures);
        
        status = ChannelStatus.Disputing;
        
        activeChallenge.proposedState.nonce = nonce;
        activeChallenge.proposedState.stateRoot = stateRoot;
        activeChallenge.proposedState.timestamp = block.timestamp;
        activeChallenge.challenger = msg.sender;
        activeChallenge.challengeEnd = block.timestamp + challengePeriod;
        activeChallenge.responded = false;
        
        for (uint256 i = 0; i < participants.length; i++) {
            activeChallenge.proposedState.balances[participants[i]] = balances[i];
        }
        
        emit ChallengeInitiated(msg.sender, nonce);
    }

    function respondToChallenge(
        uint256 nonce,
        bytes32 stateRoot,
        uint256[] calldata balances,
        bytes[] calldata signatures
    ) external onlyParticipant inStatus(ChannelStatus.Disputing) {
        if (nonce <= activeChallenge.proposedState.nonce) revert InvalidStateTransition();
        
        _verifyStateSignatures(nonce, stateRoot, balances, signatures);
        
        latestState.nonce = nonce;
        latestState.stateRoot = stateRoot;
        latestState.timestamp = block.timestamp;
        
        for (uint256 i = 0; i < participants.length; i++) {
            latestState.balances[participants[i]] = balances[i];
        }
        
        status = ChannelStatus.Active;
        activeChallenge.responded = true;
        
        emit ChallengeResponded(nonce);
    }

    function finalizeChallengeTimeout() external {
        if (status != ChannelStatus.Disputing) revert InvalidStatus();
        if (block.timestamp < activeChallenge.challengeEnd) revert ChallengePeriodNotEnded();
        if (activeChallenge.responded) revert InvalidStatus();
        
        latestState = activeChallenge.proposedState;
        status = ChannelStatus.Finalized;
        
        emit ChannelFinalized(latestState.nonce);
    }

    function cooperativeClose(
        uint256 nonce,
        bytes32 stateRoot,
        uint256[] calldata balances,
        bytes[] calldata signatures
    ) external onlyParticipant {
        if (status == ChannelStatus.Finalized) revert AlreadyFinalized();
        
        _verifyStateSignatures(nonce, stateRoot, balances, signatures);
        
        latestState.nonce = nonce;
        latestState.stateRoot = stateRoot;
        latestState.timestamp = block.timestamp;
        
        for (uint256 i = 0; i < participants.length; i++) {
            latestState.balances[participants[i]] = balances[i];
        }
        
        status = ChannelStatus.Finalized;
        
        emit ChannelFinalized(nonce);
    }

    function withdraw() external nonReentrant {
        if (status != ChannelStatus.Finalized) revert InvalidStatus();
        
        uint256 amount = latestState.balances[msg.sender];
        if (amount == 0) revert InvalidWithdrawalAmount();
        
        latestState.balances[msg.sender] = 0;
        
        token.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }

    function emergencyWithdraw() external onlyParticipant nonReentrant whenPaused {
        uint256 amount = deposits[msg.sender];
        if (amount == 0) revert InvalidWithdrawalAmount();
        
        deposits[msg.sender] = 0;
        totalDeposited -= amount;
        
        token.safeTransfer(msg.sender, amount);
        
        emit EmergencyWithdrawal(msg.sender, amount);
    }

    function forceClose() external onlyParticipant {
        if (status == ChannelStatus.Finalized) revert AlreadyFinalized();
        
        status = ChannelStatus.ForceClosing;
        activeChallenge.challengeEnd = block.timestamp + challengePeriod;
        
        emit ChallengeInitiated(msg.sender, latestState.nonce);
    }

    function finalizeForceClose() external {
        if (status != ChannelStatus.ForceClosing) revert InvalidStatus();
        if (block.timestamp < activeChallenge.challengeEnd) revert ChallengePeriodNotEnded();
        
        status = ChannelStatus.Finalized;
        
        if (latestState.nonce == 0) {
            for (uint256 i = 0; i < participants.length; i++) {
                latestState.balances[participants[i]] = deposits[participants[i]];
            }
        }
        
        emit ChannelFinalized(latestState.nonce);
    }

    function _verifyStateSignatures(
        uint256 nonce,
        bytes32 stateRoot,
        uint256[] calldata balances,
        bytes[] calldata signatures
    ) private view {
        if (signatures.length != participants.length) revert InvalidSignatures();
        
        bytes32 messageHash = keccak256(abi.encode(
            address(this),
            nonce,
            stateRoot,
            balances,
            block.chainid
        ));
        
        bytes32 ethSignedMessageHash = getEthSignedMessageHash(messageHash);
        
        for (uint256 i = 0; i < participants.length; i++) {
            address recoveredSigner = recoverSigner(ethSignedMessageHash, signatures[i]);
            if (recoveredSigner != participants[i]) revert InvalidSignatures();
        }
    }

    function getParticipantBalance(address participant) external view returns (uint256) {
        return latestState.balances[participant];
    }

    function getChannelInfo() external view returns (
        address[] memory _participants,
        ChannelStatus _status,
        uint256 _latestNonce,
        uint256 _totalDeposited
    ) {
        return (participants, status, latestState.nonce, totalDeposited);
    }
}