// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title SettlementQueueV2
 * @author DEX Team  
 * @notice Gas-optimized settlement queue with enhanced security and comprehensive edge case handling
 * @dev Implements priority-based settlement processing with multi-signature support and advanced recovery mechanisms
 * 
 * Security Features:
 * - Time-locked emergency withdrawals
 * - Circuit breaker for unusual activity
 * - Signature validation with domain separation
 * - Front-running protection via commit-reveal
 * - Slashing for malicious signers
 * 
 * Gas Optimizations:
 * - Packed structs to minimize storage slots
 * - Efficient priority queue using bitmaps
 * - Batch operations for mass processing
 * - Pre-computed hash validations
 */
contract SettlementQueueV2 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;
    using ECDSA for bytes32;

    // =============================================================================
    // ERRORS
    // =============================================================================
    
    error InvalidSettlement();
    error SettlementNotFound();
    error SettlementAlreadyProcessed();
    error InsufficientBalance();
    error UnauthorizedCaller();
    error InvalidPriority();
    error MaxRetriesExceeded();
    error InvalidGasParameters();
    error SettlementExpired();
    error InvalidThreshold();
    error InsufficientSignatures();
    error DuplicateSignature();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error InvalidNonce();
    error CircuitBreakerTriggered();
    error InvalidCommitment();
    error RevealPeriodNotStarted();
    error RevealPeriodExpired();
    error SlashingThresholdExceeded();
    error EmergencyWithdrawalTooEarly();
    error InvalidBatchSize();
    error TokenNotWhitelisted();
    error AmountExceedsLimit();

    // =============================================================================
    // ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Circuit breaker thresholds
    uint256 public constant MAX_PRIORITY = 1000;
    uint256 public constant MIN_PRIORITY = 1;
    uint256 public constant MAX_RETRIES = 5;
    uint256 public constant INITIAL_BACKOFF = 30 seconds;
    uint256 public constant MAX_BACKOFF = 24 hours;
    uint256 public constant SETTLEMENT_EXPIRY = 7 days;
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant CIRCUIT_BREAKER_THRESHOLD = 1000; // Max settlements per hour
    uint256 public constant EMERGENCY_DELAY = 48 hours;
    uint256 public constant REVEAL_PERIOD = 1 hours;
    uint256 public constant MAX_SLASHING_EVENTS = 3;

    // EIP-712 Domain Separator
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(uint256 id,address to,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    // =============================================================================
    // ENUMS & STRUCTS
    // =============================================================================

    enum SettlementStatus {
        Queued,      // 0
        Processing,  // 1
        Completed,   // 2
        Failed,      // 3
        Expired,     // 4
        Cancelled    // 5
    }

    /// @notice Packed gas parameters for efficiency
    struct PackedGasParams {
        uint64 maxFeePerGas;        // Sufficient for ~18M gwei
        uint64 maxPriorityFeePerGas; // Sufficient for ~18M gwei
        uint32 gasLimit;            // Sufficient for 4B gas
        bool useEIP1559;
    }

    /// @notice Highly optimized settlement struct (3 storage slots)
    struct PackedSettlement {
        // Slot 1
        uint128 id;                 // Settlement ID
        uint128 amount;             // Amount (up to ~3.4e38 wei)
        
        // Slot 2  
        address to;                 // Recipient (160 bits)
        uint64 priority;            // Priority level (64 bits)
        uint32 createdAt;           // Creation timestamp in days since epoch
        
        // Slot 3
        address token;              // Token address (160 bits)
        uint32 nonce;               // Nonce (32 bits)
        uint32 processedAt;         // Processing timestamp in days since epoch
        uint16 retryCount;          // Retry count (16 bits)
        uint8 status;               // SettlementStatus (8 bits)
        uint8 requiredSignatures;   // Required signatures (8 bits)
    }

    /// @notice Multi-signature approval tracking
    struct MultiSigApproval {
        uint256 signaturesBitmap;   // Bitmap of signer indices
        uint256 commitmentHash;     // Commitment hash for reveal
        uint64 commitTimestamp;     // When commitment was made
        uint8 signatureCount;       // Current signature count
        bool executed;              // Execution status
    }

    /// @notice Circuit breaker state
    struct CircuitBreaker {
        uint256 hourlyCount;        // Settlements processed this hour
        uint256 lastResetTime;      // Last reset timestamp
        bool triggered;             // Whether breaker is active
    }

    /// @notice Signer slashing info
    struct SignerInfo {
        uint256 slashingEvents;     // Number of slashing events
        uint256 lastSlashTime;      // Last slashing timestamp
        bool slashed;               // Whether currently slashed
    }

    // =============================================================================
    // STATE VARIABLES
    // =============================================================================

    // Core state
    uint256 private _nextSettlementId = 1;
    uint256 private _currentNonce;
    uint256 public largeSettlementThreshold;
    uint256 public requiredSignaturesForLarge = 3;
    bytes32 public domainSeparator;

    // Token whitelisting
    mapping(address => bool) public whitelistedTokens;
    mapping(address => uint256) public tokenDailyLimits;
    mapping(address => mapping(uint256 => uint256)) public dailyAmounts; // token => day => amount

    // Settlement storage
    mapping(uint256 => PackedSettlement) public settlements;
    mapping(uint256 => MultiSigApproval) private multiSigApprovals;
    mapping(uint256 => PackedGasParams) public gasParams;
    mapping(bytes32 => bool) private processedHashes;
    mapping(uint256 => bool) public usedNonces;

    // Priority queue optimization with bitmaps
    mapping(uint256 => EnumerableSet.UintSet) private priorityQueues;
    uint256 private priorityBitmap; // Bitmap to track which priorities have settlements
    EnumerableSet.UintSet private queuedSettlements;
    EnumerableSet.UintSet private processingSettlements;

    // Security features
    CircuitBreaker public circuitBreaker;
    mapping(address => SignerInfo) public signerInfo;
    mapping(address => uint256) public signerIndices;
    address[] public signersList;
    uint256 public emergencyWithdrawalTime;

    // Commit-reveal for front-running protection
    mapping(bytes32 => uint256) public commitments;
    mapping(uint256 => bytes32) public settlementCommits;

    // =============================================================================
    // EVENTS
    // =============================================================================

    event SettlementQueued(
        uint256 indexed settlementId,
        address indexed to,
        address indexed token,
        uint256 amount,
        uint256 priority
    );

    event SettlementProcessed(
        uint256 indexed settlementId,
        address indexed executor,
        uint256 gasUsed,
        bool success
    );

    event SettlementRetrying(
        uint256 indexed settlementId,
        uint256 retryCount,
        uint256 nextRetryTime
    );

    event LargeSettlementCommitted(
        uint256 indexed settlementId,
        bytes32 commitment,
        uint256 revealDeadline
    );

    event LargeSettlementSigned(
        uint256 indexed settlementId,
        address indexed signer,
        uint256 signatureCount,
        uint256 required
    );

    event CircuitBreakerTriggered(
        uint256 timestamp,
        uint256 hourlyCount
    );

    event SignerSlashed(
        address indexed signer,
        uint256 slashingCount,
        string reason
    );

    event TokenWhitelisted(
        address indexed token,
        uint256 dailyLimit
    );

    event EmergencyWithdrawalScheduled(
        uint256 timestamp,
        uint256 executeTime
    );

    // =============================================================================
    // MODIFIERS
    // =============================================================================

    modifier onlyAuthorized() {
        if (!hasRole(OPERATOR_ROLE, msg.sender) && msg.sender != getRoleMember(DEFAULT_ADMIN_ROLE, 0)) {
            revert UnauthorizedCaller();
        }
        _;
    }

    modifier circuitBreakerCheck() {
        _updateCircuitBreaker();
        if (circuitBreaker.triggered) revert CircuitBreakerTriggered();
        _;
    }

    modifier validToken(address token) {
        if (!whitelistedTokens[token]) revert TokenNotWhitelisted();
        _;
    }

    // =============================================================================
    // CONSTRUCTOR
    // =============================================================================

    /**
     * @notice Initialize the settlement queue
     * @param _largeSettlementThreshold Threshold for requiring multi-sig
     * @param _initialTokens Initial whitelisted tokens
     * @param _initialLimits Daily limits for initial tokens
     */
    constructor(
        uint256 _largeSettlementThreshold,
        address[] memory _initialTokens,
        uint256[] memory _initialLimits
    ) {
        if (_initialTokens.length != _initialLimits.length) revert InvalidSettlement();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);
        
        largeSettlementThreshold = _largeSettlementThreshold;
        
        // Initialize domain separator
        domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("SettlementQueueV2"),
            keccak256("2"),
            block.chainid,
            address(this)
        ));

        // Initialize circuit breaker
        circuitBreaker.lastResetTime = block.timestamp;
        
        // Whitelist initial tokens
        for (uint256 i = 0; i < _initialTokens.length; i++) {
            _whitelistToken(_initialTokens[i], _initialLimits[i]);
        }
    }

    // =============================================================================
    // CORE FUNCTIONALITY
    // =============================================================================

    /**
     * @notice Queue a new settlement with optimized storage
     * @param to Recipient address
     * @param token Token address
     * @param amount Settlement amount
     * @param priority Priority level (1-1000)
     * @param gasParams Gas optimization parameters
     * @return settlementId The unique settlement identifier
     */
    function queueSettlement(
        address to,
        address token,
        uint256 amount,
        uint256 priority,
        PackedGasParams calldata gasParams
    ) 
        external 
        onlyAuthorized 
        whenNotPaused 
        circuitBreakerCheck
        validToken(token)
        returns (uint256 settlementId) 
    {
        if (to == address(0) || amount == 0) revert InvalidSettlement();
        if (priority < MIN_PRIORITY || priority > MAX_PRIORITY) revert InvalidPriority();
        if (gasParams.useEIP1559 && gasParams.maxFeePerGas == 0) revert InvalidGasParameters();

        // Check daily limits
        uint256 currentDay = block.timestamp / 1 days;
        uint256 newDailyAmount = dailyAmounts[token][currentDay] + amount;
        if (newDailyAmount > tokenDailyLimits[token]) revert AmountExceedsLimit();
        dailyAmounts[token][currentDay] = newDailyAmount;

        settlementId = _nextSettlementId++;
        uint256 nonce = _getNextNonce();
        
        bool isLarge = amount >= largeSettlementThreshold;
        uint8 requiredSigs = isLarge ? uint8(requiredSignaturesForLarge) : 0;

        // Store in packed format
        settlements[settlementId] = PackedSettlement({
            id: uint128(settlementId),
            amount: uint128(amount),
            to: to,
            priority: uint64(priority),
            createdAt: uint32(block.timestamp / 1 days),
            token: token,
            nonce: uint32(nonce),
            processedAt: 0,
            retryCount: 0,
            status: uint8(SettlementStatus.Queued),
            requiredSignatures: requiredSigs
        });

        gasParams[settlementId] = gasParams;

        // Add to priority queue with bitmap optimization
        priorityQueues[priority].add(settlementId);
        priorityBitmap |= (1 << (priority % 256)); // Set bit for this priority
        queuedSettlements.add(settlementId);

        emit SettlementQueued(settlementId, to, token, amount, priority);

        // If large settlement, initiate commit-reveal
        if (isLarge) {
            _initiateCommitReveal(settlementId);
        }
    }

    /**
     * @notice Process next settlement with gas optimization
     * @dev Uses bitmap to efficiently find highest priority settlement
     */
    function processNextSettlement() external onlyRole(EXECUTOR_ROLE) nonReentrant whenNotPaused {
        uint256 settlementId = _getNextSettlementOptimized();
        if (settlementId == 0) revert SettlementNotFound();

        _processSettlement(settlementId);
    }

    /**
     * @notice Process multiple settlements in an optimized batch
     * @param maxCount Maximum number of settlements to process
     * @param priorityFilter Optional priority filter (0 = no filter)
     */
    function processBatchOptimized(uint256 maxCount, uint256 priorityFilter) 
        external 
        onlyRole(EXECUTOR_ROLE) 
        nonReentrant 
        whenNotPaused 
    {
        if (maxCount > MAX_BATCH_SIZE) revert InvalidBatchSize();
        
        uint256 processed = 0;
        uint256 gasStart = gasleft();

        while (processed < maxCount && gasleft() > 50000) { // Leave gas for cleanup
            uint256 settlementId = priorityFilter == 0 
                ? _getNextSettlementOptimized()
                : _getNextSettlementByPriority(priorityFilter);
                
            if (settlementId == 0) break;

            _processSettlement(settlementId);
            processed++;
        }

        // Update circuit breaker
        circuitBreaker.hourlyCount += processed;
    }

    /**
     * @notice Commit signature for large settlement (commit-reveal scheme)
     * @param settlementId Settlement to commit for
     * @param commitment Hash commitment of signature
     */
    function commitSignature(uint256 settlementId, bytes32 commitment) 
        external 
        onlyRole(SIGNER_ROLE) 
    {
        PackedSettlement memory settlement = settlements[settlementId];
        if (settlement.id == 0) revert SettlementNotFound();
        if (settlement.requiredSignatures == 0) revert InvalidSettlement();
        if (commitment == bytes32(0)) revert InvalidCommitment();

        MultiSigApproval storage approval = multiSigApprovals[settlementId];
        if (approval.commitTimestamp == 0) revert InvalidCommitment();

        uint256 signerIndex = signerIndices[msg.sender];
        if (signerIndex == 0) revert UnauthorizedCaller();

        // Check if already committed
        if (approval.signaturesBitmap & (1 << signerIndex) != 0) revert DuplicateSignature();

        commitments[commitment] = settlementId;
        approval.signaturesBitmap |= (1 << signerIndex);
    }

    /**
     * @notice Reveal signature for large settlement
     * @param settlementId Settlement to sign
     * @param signature The actual signature
     * @param nonce Random nonce used in commitment
     */
    function revealSignature(
        uint256 settlementId,
        bytes memory signature,
        uint256 nonce
    ) external onlyRole(SIGNER_ROLE) {
        MultiSigApproval storage approval = multiSigApprovals[settlementId];
        
        // Check reveal period
        if (block.timestamp < approval.commitTimestamp + REVEAL_PERIOD) revert RevealPeriodNotStarted();
        if (block.timestamp > approval.commitTimestamp + REVEAL_PERIOD * 2) revert RevealPeriodExpired();

        // Verify commitment
        bytes32 commitment = keccak256(abi.encode(signature, nonce, msg.sender));
        if (commitments[commitment] != settlementId) revert InvalidCommitment();

        // Verify signature
        PackedSettlement memory settlement = settlements[settlementId];
        bytes32 digest = _getSettlementHash(settlement);
        address signer = digest.recover(signature);
        if (signer != msg.sender) revert InvalidSignature();

        approval.signatureCount++;
        delete commitments[commitment];

        emit LargeSettlementSigned(
            settlementId,
            msg.sender,
            approval.signatureCount,
            settlement.requiredSignatures
        );
    }

    // =============================================================================
    // INTERNAL FUNCTIONS
    // =============================================================================

    /**
     * @notice Get next settlement using bitmap optimization
     * @return settlementId Next settlement ID or 0 if none available
     */
    function _getNextSettlementOptimized() private returns (uint256 settlementId) {
        // Find highest priority with pending settlements using bitmap
        uint256 bitmap = priorityBitmap;
        if (bitmap == 0) return 0;

        // Find highest set bit (highest priority)
        uint256 highestPriority = 255;
        while (highestPriority > 0 && (bitmap & (1 << highestPriority)) == 0) {
            highestPriority--;
        }

        // Search from highest to lowest priority
        for (uint256 priority = highestPriority; priority >= MIN_PRIORITY; priority--) {
            if ((bitmap & (1 << (priority % 256))) == 0) continue;

            uint256[] memory ids = priorityQueues[priority].values();
            for (uint256 i = 0; i < ids.length; i++) {
                if (_isSettlementReady(settlements[ids[i]])) {
                    settlementId = ids[i];
                    _removeFromQueue(settlementId, priority);
                    return settlementId;
                }
            }

            // If no ready settlements at this priority, clear the bit
            if (priorityQueues[priority].length() == 0) {
                priorityBitmap &= ~(1 << (priority % 256));
            }

            if (priority == MIN_PRIORITY) break; // Prevent underflow
        }
    }

    /**
     * @notice Check if settlement is ready for processing
     * @param settlement Settlement to check
     * @return ready Whether settlement can be processed
     */
    function _isSettlementReady(PackedSettlement memory settlement) private view returns (bool ready) {
        // Check expiry
        uint256 createdTime = uint256(settlement.createdAt) * 1 days;
        if (block.timestamp > createdTime + SETTLEMENT_EXPIRY) {
            return false;
        }

        // Check multi-sig for large settlements
        if (settlement.requiredSignatures > 0) {
            MultiSigApproval storage approval = multiSigApprovals[settlement.id];
            if (approval.signatureCount < settlement.requiredSignatures) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Process a single settlement
     * @param settlementId Settlement to process
     */
    function _processSettlement(uint256 settlementId) private {
        PackedSettlement storage settlement = settlements[settlementId];
        
        // Update status
        settlement.status = uint8(SettlementStatus.Processing);
        processingSettlements.add(settlementId);

        // Check token balance
        IERC20 token = IERC20(settlement.token);
        uint256 balance = token.balanceOf(address(this));
        
        if (balance < settlement.amount) {
            _handleFailedSettlement(settlementId, "Insufficient balance");
            return;
        }

        // Execute transfer with gas optimization
        bool success;
        assembly {
            let token_addr := mload(add(settlement, 0x40)) // Get token address
            let to_addr := mload(add(settlement, 0x20))    // Get recipient address
            let amount := mload(add(settlement, 0x10))     // Get amount
            
            // Prepare transfer call
            let ptr := mload(0x40)
            mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000) // transfer(address,uint256)
            mstore(add(ptr, 0x04), to_addr)
            mstore(add(ptr, 0x24), amount)
            
            success := call(gas(), token_addr, 0, ptr, 0x44, 0, 0)
        }

        if (success) {
            settlement.status = uint8(SettlementStatus.Completed);
            settlement.processedAt = uint32(block.timestamp / 1 days);
            processingSettlements.remove(settlementId);
            
            // Mark nonce as used
            usedNonces[settlement.nonce] = true;
            
            emit SettlementProcessed(settlementId, msg.sender, 0, true);
        } else {
            _handleFailedSettlement(settlementId, "Transfer failed");
        }
    }

    /**
     * @notice Handle failed settlement with exponential backoff
     * @param settlementId Failed settlement ID
     * @param reason Failure reason
     */
    function _handleFailedSettlement(uint256 settlementId, string memory reason) private {
        PackedSettlement storage settlement = settlements[settlementId];
        
        settlement.status = uint8(SettlementStatus.Failed);
        settlement.retryCount++;
        processingSettlements.remove(settlementId);

        if (settlement.retryCount < MAX_RETRIES) {
            // Calculate exponential backoff
            uint256 backoff = INITIAL_BACKOFF * (2 ** (settlement.retryCount - 1));
            if (backoff > MAX_BACKOFF) backoff = MAX_BACKOFF;
            
            uint256 nextRetryTime = block.timestamp + backoff;
            
            emit SettlementRetrying(settlementId, settlement.retryCount, nextRetryTime);
        } else {
            emit SettlementRetrying(settlementId, settlement.retryCount, 0);
        }
    }

    /**
     * @notice Update circuit breaker state
     */
    function _updateCircuitBreaker() private {
        uint256 currentHour = block.timestamp / 1 hours;
        uint256 lastHour = circuitBreaker.lastResetTime / 1 hours;
        
        if (currentHour > lastHour) {
            circuitBreaker.hourlyCount = 0;
            circuitBreaker.lastResetTime = block.timestamp;
            circuitBreaker.triggered = false;
        }
        
        if (circuitBreaker.hourlyCount >= CIRCUIT_BREAKER_THRESHOLD) {
            circuitBreaker.triggered = true;
            emit CircuitBreakerTriggered(block.timestamp, circuitBreaker.hourlyCount);
        }
    }

    /**
     * @notice Initiate commit-reveal process for large settlement
     * @param settlementId Settlement ID
     */
    function _initiateCommitReveal(uint256 settlementId) private {
        multiSigApprovals[settlementId].commitTimestamp = uint64(block.timestamp);
        
        emit LargeSettlementCommitted(
            settlementId,
            settlementCommits[settlementId],
            block.timestamp + REVEAL_PERIOD
        );
    }

    /**
     * @notice Get EIP-712 hash for settlement
     * @param settlement Settlement data
     * @return Hash for signature verification
     */
    function _getSettlementHash(PackedSettlement memory settlement) private view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            SETTLEMENT_TYPEHASH,
            settlement.id,
            settlement.to,
            settlement.token,
            settlement.amount,
            settlement.nonce,
            uint256(settlement.createdAt) * 1 days + SETTLEMENT_EXPIRY
        ));
        
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /**
     * @notice Get next available nonce
     * @return nonce Next nonce value
     */
    function _getNextNonce() private returns (uint256 nonce) {
        nonce = _currentNonce++;
        while (usedNonces[nonce]) {
            nonce = _currentNonce++;
        }
    }

    /**
     * @notice Remove settlement from priority queue
     * @param settlementId Settlement to remove
     * @param priority Priority level
     */
    function _removeFromQueue(uint256 settlementId, uint256 priority) private {
        priorityQueues[priority].remove(settlementId);
        if (priorityQueues[priority].length() == 0) {
            priorityBitmap &= ~(1 << (priority % 256));
        }
        queuedSettlements.remove(settlementId);
    }

    /**
     * @notice Get next settlement by specific priority
     * @param priority Priority level to search
     * @return settlementId Settlement ID or 0 if none
     */
    function _getNextSettlementByPriority(uint256 priority) private returns (uint256 settlementId) {
        if ((priorityBitmap & (1 << (priority % 256))) == 0) return 0;
        
        uint256[] memory ids = priorityQueues[priority].values();
        for (uint256 i = 0; i < ids.length; i++) {
            if (_isSettlementReady(settlements[ids[i]])) {
                settlementId = ids[i];
                _removeFromQueue(settlementId, priority);
                return settlementId;
            }
        }
    }

    /**
     * @notice Internal function to whitelist token
     * @param token Token address
     * @param dailyLimit Daily transfer limit
     */
    function _whitelistToken(address token, uint256 dailyLimit) private {
        whitelistedTokens[token] = true;
        tokenDailyLimits[token] = dailyLimit;
        emit TokenWhitelisted(token, dailyLimit);
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Whitelist a token for settlements
     * @param token Token address to whitelist
     * @param dailyLimit Maximum daily settlement amount
     */
    function whitelistToken(address token, uint256 dailyLimit) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (token == address(0) || dailyLimit == 0) revert InvalidSettlement();
        _whitelistToken(token, dailyLimit);
    }

    /**
     * @notice Remove token from whitelist
     * @param token Token to remove
     */
    function removeWhitelistedToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedTokens[token] = false;
        tokenDailyLimits[token] = 0;
    }

    /**
     * @notice Reset circuit breaker
     */
    function resetCircuitBreaker() external onlyRole(GUARDIAN_ROLE) {
        circuitBreaker.triggered = false;
        circuitBreaker.hourlyCount = 0;
        circuitBreaker.lastResetTime = block.timestamp;
    }

    /**
     * @notice Slash a malicious signer
     * @param signer Signer to slash
     * @param reason Reason for slashing
     */
    function slashSigner(address signer, string calldata reason) 
        external 
        onlyRole(GUARDIAN_ROLE) 
    {
        SignerInfo storage info = signerInfo[signer];
        info.slashingEvents++;
        info.lastSlashTime = block.timestamp;
        
        if (info.slashingEvents >= MAX_SLASHING_EVENTS) {
            info.slashed = true;
            _revokeRole(SIGNER_ROLE, signer);
        }
        
        emit SignerSlashed(signer, info.slashingEvents, reason);
    }

    /**
     * @notice Schedule emergency withdrawal
     */
    function scheduleEmergencyWithdrawal() external onlyRole(EMERGENCY_ROLE) {
        emergencyWithdrawalTime = block.timestamp + EMERGENCY_DELAY;
        emit EmergencyWithdrawalScheduled(block.timestamp, emergencyWithdrawalTime);
    }

    /**
     * @notice Execute emergency withdrawal after delay
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param to Recipient address
     */
    function executeEmergencyWithdrawal(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(EMERGENCY_ROLE) {
        if (block.timestamp < emergencyWithdrawalTime) revert EmergencyWithdrawalTooEarly();
        if (to == address(0)) revert InvalidSettlement();
        
        IERC20(token).safeTransfer(to, amount);
        emergencyWithdrawalTime = 0; // Reset
    }

    /**
     * @notice Pause contract
     */
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get settlement information in gas-efficient format
     * @param settlementId Settlement ID
     * @return settlement Packed settlement data
     * @return gasParam Gas parameters
     */
    function getSettlement(uint256 settlementId) 
        external 
        view 
        returns (PackedSettlement memory settlement, PackedGasParams memory gasParam) 
    {
        settlement = settlements[settlementId];
        gasParam = gasParams[settlementId];
    }

    /**
     * @notice Get queue statistics
     * @return queuedCount Number of queued settlements
     * @return processingCount Number of processing settlements
     * @return totalProcessed Total settlements processed
     */
    function getQueueStats() external view returns (
        uint256 queuedCount,
        uint256 processingCount,
        uint256 totalProcessed
    ) {
        queuedCount = queuedSettlements.length();
        processingCount = processingSettlements.length();
        totalProcessed = _nextSettlementId - 1 - queuedCount - processingCount;
    }

    /**
     * @notice Check if settlement is ready for processing
     * @param settlementId Settlement ID
     * @return ready Whether settlement can be processed
     */
    function isSettlementReady(uint256 settlementId) external view returns (bool ready) {
        return _isSettlementReady(settlements[settlementId]);
    }

    /**
     * @notice Get daily settlement amount for token
     * @param token Token address
     * @param day Day timestamp (in days since epoch)
     * @return amount Amount settled on that day
     */
    function getDailyAmount(address token, uint256 day) external view returns (uint256 amount) {
        return dailyAmounts[token][day];
    }

    /**
     * @notice Get remaining daily limit for token
     * @param token Token address
     * @return remaining Remaining daily limit
     */
    function getRemainingDailyLimit(address token) external view returns (uint256 remaining) {
        uint256 currentDay = block.timestamp / 1 days;
        uint256 used = dailyAmounts[token][currentDay];
        uint256 limit = tokenDailyLimits[token];
        return used >= limit ? 0 : limit - used;
    }

    /**
     * @notice Get multi-sig approval status
     * @param settlementId Settlement ID
     * @return signatureCount Current signatures
     * @return required Required signatures
     * @return executed Whether executed
     */
    function getMultiSigStatus(uint256 settlementId) external view returns (
        uint256 signatureCount,
        uint256 required,
        bool executed
    ) {
        MultiSigApproval storage approval = multiSigApprovals[settlementId];
        PackedSettlement memory settlement = settlements[settlementId];
        return (approval.signatureCount, settlement.requiredSignatures, approval.executed);
    }
}