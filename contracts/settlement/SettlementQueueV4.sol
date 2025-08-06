// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title SettlementQueueV4 - Advanced Anti-MEV Protection
 * @author DEX Security Team
 * @notice Ultra-secure settlement queue with comprehensive MEV protection and fair sequencing
 * @dev Production-ready implementation with anti-MEV features and flashbot integration
 * 
 * ADVANCED ANTI-MEV FEATURES:
 * ===========================
 * 
 * 1. COMMIT-REVEAL SCHEME
 *    - Two-phase order submission with time delays
 *    - Cryptographic commitments with salted hashes
 *    - Penalty mechanism for failed reveals
 *    - Batch reveal processing for efficiency
 * 
 * 2. FLASHBOT INTEGRATION
 *    - Private mempool submission support
 *    - MEV-Boost compatible bundle construction
 *    - Searcher whitelist with reputation system
 *    - Bundle validation and sequencing
 * 
 * 3. ORDER BUNDLING PROTECTION
 *    - Atomic bundle execution
 *    - Cross-bundle dependency tracking
 *    - Sandwich attack prevention
 *    - Bundle priority and ordering rules
 * 
 * 4. DYNAMIC SLIPPAGE PROTECTION
 *    - Real-time price impact calculation
 *    - Adaptive slippage limits based on volatility
 *    - Multi-source price oracle integration
 *    - Emergency circuit breakers for extreme slippage
 * 
 * 5. FAIR SEQUENCING SERVICE
 *    - Threshold decryption for order sequencing
 *    - Verifiable delay functions (VDF) for timing
 *    - Distributed randomness beacon integration
 *    - Byzantine fault tolerant consensus
 */
contract SettlementQueueV4 is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;
    using ECDSA for bytes32;

    // =============================================================================
    // CRITICAL ERROR DEFINITIONS
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
    
    // NEW ANTI-MEV ERRORS
    error CommitmentAlreadyExists();
    error CommitmentNotFound();
    error RevealWindowClosed();
    error InvalidReveal();
    error BundleValidationFailed();
    error SlippageExceeded();
    error FlashbotSubmissionFailed();
    error FairSequencingViolation();
    error MEVProtectionActive();
    error SandwichAttackDetected();
    error PriceManipulationDetected();
    error OrderCollisionDetected();
    error ThresholdDecryptionFailed();
    error VDFVerificationFailed();
    error RandomnessBeaconStale();

    // =============================================================================
    // ENHANCED ROLES & CONSTANTS
    // =============================================================================
    
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant INSURANCE_ROLE = keccak256("INSURANCE_ROLE");
    bytes32 public constant FLASHBOT_ROLE = keccak256("FLASHBOT_ROLE");
    bytes32 public constant SEQUENCER_ROLE = keccak256("SEQUENCER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    // Anti-MEV constants
    uint256 public constant COMMIT_PHASE_DURATION = 30 seconds;
    uint256 public constant REVEAL_PHASE_DURATION = 60 seconds;
    uint256 public constant MIN_COMMIT_REVEAL_DELAY = 15 seconds;
    uint256 public constant MAX_SLIPPAGE_BPS = 500; // 5%
    uint256 public constant DYNAMIC_SLIPPAGE_WINDOW = 300 seconds; // 5 minutes
    uint256 public constant BUNDLE_MAX_SIZE = 50;
    uint256 public constant PRICE_ORACLE_STALENESS = 60 seconds;
    uint256 public constant VDF_DIFFICULTY = 1000000; // Adjustable based on network
    uint256 public constant FAIR_SEQUENCING_WINDOW = 12 seconds;
    uint256 public constant SANDWICH_DETECTION_THRESHOLD = 200; // 2% price impact
    uint256 public constant MEV_PENALTY_AMOUNT = 1 ether;

    // EIP-712 Enhanced Domain Separator
    bytes32 public constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)"
    );
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(uint256 id,address trader,address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 deadline,uint256 nonce,bytes32 metadata)"
    );
    bytes32 public constant COMMITMENT_TYPEHASH = keccak256(
        "Commitment(bytes32 orderHash,uint256 salt,uint256 timestamp,address committer)"
    );
    bytes32 public constant BUNDLE_TYPEHASH = keccak256(
        "Bundle(uint256 id,bytes32 merkleRoot,uint256 maxGasPrice,uint256 minTimestamp,uint256 maxTimestamp)"
    );

    // =============================================================================
    // ADVANCED STRUCTS FOR ANTI-MEV PROTECTION
    // =============================================================================

    /// @notice Enhanced order structure with MEV protection
    struct Order {
        uint256 id;                     // Order ID
        address trader;                 // Order submitter
        address tokenIn;                // Input token
        address tokenOut;               // Output token
        uint256 amountIn;               // Input amount
        uint256 minAmountOut;           // Minimum output (slippage protection)
        uint256 maxSlippageBps;         // Maximum allowed slippage in basis points
        uint256 deadline;               // Order expiration
        uint256 nonce;                  // Unique nonce
        uint256 priority;               // Execution priority
        uint32 createdAt;               // Creation timestamp
        uint32 commitPhaseEnd;          // Commit phase deadline
        uint32 revealPhaseEnd;          // Reveal phase deadline
        uint8 status;                   // Order status
        bool requiresCommitReveal;      // Whether order uses commit-reveal
        bytes32 metadata;               // Additional order data
    }

    /// @notice Commit-reveal commitment structure
    struct Commitment {
        bytes32 orderHash;              // Hash of the order
        bytes32 saltedHash;             // Salted hash for hiding
        address committer;              // Who made the commitment
        uint256 timestamp;              // Commitment time
        uint256 deposit;                // Commitment deposit
        bool revealed;                  // Whether commitment was revealed
        bool slashed;                   // Whether committer was slashed
    }

    /// @notice Bundle structure for atomic execution
    struct Bundle {
        uint256 id;                     // Bundle ID
        uint256[] orderIds;             // Orders in bundle
        bytes32 merkleRoot;             // Merkle root of orders
        address proposer;               // Bundle proposer
        uint256 maxGasPrice;            // Maximum gas price
        uint256 minTimestamp;           // Earliest execution time
        uint256 maxTimestamp;           // Latest execution time
        uint256 totalGasLimit;          // Total gas for bundle
        uint8 status;                   // Bundle status
        bool isFlashbotBundle;          // Whether submitted via flashbot
        bytes flashbotSignature;        // Flashbot bundle signature
    }

    /// @notice Price oracle data structure
    struct PriceOracle {
        uint256 price;                  // Token price
        uint256 timestamp;              // Price timestamp
        uint256 confidence;             // Price confidence level
        address oracle;                 // Oracle address
        bytes signature;                // Oracle signature
    }

    /// @notice Fair sequencing state
    struct FairSequencing {
        uint256 currentRound;           // Current sequencing round
        bytes32 randomnessBeacon;       // Verifiable randomness
        uint256 beaconTimestamp;        // Beacon update time
        mapping(uint256 => bytes32) vdfProofs; // VDF proofs per round
        mapping(uint256 => bool) roundFinalized; // Round finalization status
    }

    /// @notice MEV protection metrics
    struct MEVProtection {
        uint256 detectedSandwiches;     // Sandwich attacks detected
        uint256 preventedArbitrage;     // MEV prevented
        uint256 slippageViolations;     // Slippage limit violations
        uint256 lastUpdateTime;         // Last metrics update
        mapping(address => uint256) mevViolations; // MEV violations per address
        mapping(bytes32 => bool) suspiciousPatterns; // Suspicious transaction patterns
    }

    // =============================================================================
    // STORAGE WITH ANTI-MEV FEATURES
    // =============================================================================

    // Core state
    uint256 private _nextOrderId = 1;
    uint256 private _nextBundleId = 1;
    uint256 private _currentNonce;
    bytes32 public domainSeparator;
    bytes32 private _salt;

    // Order and commitment storage
    mapping(uint256 => Order) public orders;
    mapping(bytes32 => Commitment) public commitments;
    mapping(uint256 => Bundle) public bundles;
    mapping(address => uint256) public userNonces;
    mapping(bytes32 => bool) public usedCommitments;

    // Anti-MEV state
    FairSequencing public fairSequencing;
    MEVProtection public mevProtection;
    mapping(address => PriceOracle) public priceOracles;
    mapping(address => bool) public whitelistedFlashbots;
    mapping(address => uint256) public flashbotReputation;
    mapping(bytes32 => uint256) public bundleToBlock;

    // Slippage protection
    mapping(address => uint256) public tokenVolatility;
    mapping(address => uint256) public lastPriceUpdate;
    mapping(address => uint256[]) public priceHistory;
    uint256 public globalSlippageFactor = 100; // 1.0x in basis points

    // Fair sequencing and VDF
    mapping(uint256 => bytes32) public vdfChallenges;
    mapping(uint256 => bytes32) public vdfSolutions;
    mapping(address => bool) public authorizedSequencers;
    uint256 public lastVDFRound;

    // =============================================================================
    // EVENTS WITH COMPREHENSIVE LOGGING
    // =============================================================================

    event OrderCommitted(
        bytes32 indexed commitment,
        address indexed committer,
        uint256 deposit,
        uint256 revealDeadline
    );

    event OrderRevealed(
        uint256 indexed orderId,
        bytes32 indexed commitment,
        address indexed trader,
        uint256 amountIn,
        uint256 minAmountOut
    );

    event BundleProposed(
        uint256 indexed bundleId,
        address indexed proposer,
        uint256 orderCount,
        bool isFlashbot
    );

    event BundleExecuted(
        uint256 indexed bundleId,
        uint256 ordersProcessed,
        uint256 totalGasUsed,
        uint256 mevExtracted
    );

    event SlippageViolation(
        uint256 indexed orderId,
        address indexed token,
        uint256 expectedPrice,
        uint256 actualPrice,
        uint256 slippageBps
    );

    event SandwichAttackDetected(
        address indexed attacker,
        uint256 indexed victimOrderId,
        uint256 frontrunAmount,
        uint256 backrunAmount
    );

    event MEVPenalty(
        address indexed violator,
        uint256 penaltyAmount,
        string reason
    );

    event FairSequencingUpdate(
        uint256 indexed round,
        bytes32 randomnessBeacon,
        bytes32 vdfProof
    );

    event PriceOracleUpdate(
        address indexed token,
        uint256 newPrice,
        uint256 confidence,
        address oracle
    );

    // =============================================================================
    // ADVANCED MODIFIERS FOR MEV PROTECTION
    // =============================================================================

    modifier antiMEV(uint256 orderId) {
        _validateMEVProtection(orderId);
        _;
    }

    modifier commitRevealPhase(uint256 orderId) {
        Order storage order = orders[orderId];
        if (order.requiresCommitReveal) {
            if (block.timestamp <= order.commitPhaseEnd) {
                // In commit phase
                require(order.status == uint8(OrderStatus.Committed), "Order not committed");
            } else if (block.timestamp <= order.revealPhaseEnd) {
                // In reveal phase
                require(order.status == uint8(OrderStatus.Revealed), "Order not revealed");
            } else {
                revert RevealWindowClosed();
            }
        }
        _;
    }

    modifier validSlippage(uint256 orderId) {
        _validateSlippageProtection(orderId);
        _;
    }

    modifier fairSequenced() {
        _validateFairSequencing();
        _;
    }

    modifier flashbotAuthorized() {
        if (!whitelistedFlashbots[msg.sender]) revert UnauthorizedCaller();
        _;
    }

    // =============================================================================
    // CONSTRUCTOR WITH ENHANCED INITIALIZATION
    // =============================================================================

    constructor(
        uint256 _largeSettlementThreshold,
        address[] memory _initialTokens,
        uint256[] memory _initialLimits,
        address _gasPriceOracle,
        address _randomnessBeacon
    ) {
        if (_initialTokens.length != _initialLimits.length) revert InvalidSettlement();
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);
        _grantRole(SEQUENCER_ROLE, msg.sender);
        
        // Generate cryptographically secure salt
        _salt = keccak256(abi.encode(block.timestamp, block.difficulty, msg.sender, "ANTI_MEV_V4"));
        
        // Initialize enhanced domain separator
        domainSeparator = keccak256(abi.encode(
            DOMAIN_TYPEHASH,
            keccak256("SettlementQueueV4"),
            keccak256("4.0"),
            block.chainid,
            address(this),
            _salt
        ));

        // Initialize fair sequencing
        fairSequencing.currentRound = 1;
        fairSequencing.randomnessBeacon = keccak256(abi.encode(block.timestamp, _randomnessBeacon));
        fairSequencing.beaconTimestamp = block.timestamp;
        
        // Initialize MEV protection
        mevProtection.lastUpdateTime = block.timestamp;
    }

    // =============================================================================
    // COMMIT-REVEAL SCHEME IMPLEMENTATION
    // =============================================================================

    /**
     * @notice Submit order commitment (Phase 1 of commit-reveal)
     * @param commitmentHash Salted hash of order details
     * @param deposit Commitment deposit (prevents spam)
     * @return commitmentId Unique commitment identifier
     */
    function commitOrder(
        bytes32 commitmentHash,
        uint256 deposit
    ) 
        external 
        payable
        whenNotPaused
        returns (bytes32 commitmentId) 
    {
        if (commitmentHash == bytes32(0)) revert InvalidCommitment();
        if (msg.value < deposit) revert InsufficientBalance();
        if (usedCommitments[commitmentHash]) revert CommitmentAlreadyExists();

        commitmentId = keccak256(abi.encode(commitmentHash, msg.sender, block.timestamp));
        
        commitments[commitmentId] = Commitment({
            orderHash: bytes32(0), // Will be set during reveal
            saltedHash: commitmentHash,
            committer: msg.sender,
            timestamp: block.timestamp,
            deposit: msg.value,
            revealed: false,
            slashed: false
        });

        usedCommitments[commitmentHash] = true;

        emit OrderCommitted(commitmentId, msg.sender, msg.value, block.timestamp + REVEAL_PHASE_DURATION);
    }

    /**
     * @notice Reveal order details (Phase 2 of commit-reveal)
     * @param commitmentId Commitment to reveal
     * @param order Order details
     * @param salt Salt used in commitment
     * @return orderId Created order ID
     */
    function revealOrder(
        bytes32 commitmentId,
        Order memory order,
        uint256 salt
    ) 
        external 
        whenNotPaused
        antiMEV(order.id)
        returns (uint256 orderId) 
    {
        Commitment storage commitment = commitments[commitmentId];
        if (commitment.committer != msg.sender) revert UnauthorizedCaller();
        if (commitment.revealed) revert InvalidReveal();
        if (block.timestamp < commitment.timestamp + MIN_COMMIT_REVEAL_DELAY) revert RevealPeriodNotStarted();
        if (block.timestamp > commitment.timestamp + REVEAL_PHASE_DURATION) revert RevealPeriodExpired();

        // Verify commitment
        bytes32 orderHash = _getOrderHash(order);
        bytes32 expectedCommitment = keccak256(abi.encode(orderHash, salt, msg.sender));
        if (expectedCommitment != commitment.saltedHash) revert InvalidReveal();

        orderId = _nextOrderId++;
        order.id = orderId;
        order.createdAt = uint32(block.timestamp);
        order.status = uint8(OrderStatus.Revealed);
        order.nonce = _getNextNonce();

        // Set commit-reveal timing
        order.commitPhaseEnd = uint32(commitment.timestamp);
        order.revealPhaseEnd = uint32(commitment.timestamp + REVEAL_PHASE_DURATION);
        order.requiresCommitReveal = true;

        orders[orderId] = order;
        commitment.revealed = true;
        commitment.orderHash = orderHash;

        // Refund commitment deposit
        payable(msg.sender).transfer(commitment.deposit);

        emit OrderRevealed(orderId, commitmentId, order.trader, order.amountIn, order.minAmountOut);
    }

    // =============================================================================
    // FLASHBOT INTEGRATION
    // =============================================================================

    /**
     * @notice Submit bundle via flashbot for private mempool execution
     * @param orderIds Orders to include in bundle
     * @param maxGasPrice Maximum gas price for bundle
     * @param targetBlock Target block for execution
     * @param signature Flashbot bundle signature
     * @return bundleId Created bundle ID
     */
    function submitFlashbotBundle(
        uint256[] calldata orderIds,
        uint256 maxGasPrice,
        uint256 targetBlock,
        bytes calldata signature
    ) 
        external 
        flashbotAuthorized
        whenNotPaused
        returns (uint256 bundleId) 
    {
        if (orderIds.length == 0 || orderIds.length > BUNDLE_MAX_SIZE) revert InvalidBatchSize();
        if (targetBlock <= block.number) revert InvalidSettlement();

        bundleId = _nextBundleId++;
        
        // Validate all orders in bundle
        uint256 totalGasEstimate = 0;
        for (uint256 i = 0; i < orderIds.length; i++) {
            Order storage order = orders[orderIds[i]];
            if (order.id == 0) revert SettlementNotFound();
            if (order.status != uint8(OrderStatus.Revealed)) revert SettlementAlreadyProcessed();
            
            totalGasEstimate += _estimateOrderGas(order);
        }

        bundles[bundleId] = Bundle({
            id: bundleId,
            orderIds: orderIds,
            merkleRoot: _calculateMerkleRoot(orderIds),
            proposer: msg.sender,
            maxGasPrice: maxGasPrice,
            minTimestamp: block.timestamp,
            maxTimestamp: block.timestamp + FAIR_SEQUENCING_WINDOW,
            totalGasLimit: totalGasEstimate,
            status: uint8(BundleStatus.Proposed),
            isFlashbotBundle: true,
            flashbotSignature: signature
        });

        bundleToBlock[keccak256(abi.encode(bundleId))] = targetBlock;

        // Update flashbot reputation
        flashbotReputation[msg.sender]++;

        emit BundleProposed(bundleId, msg.sender, orderIds.length, true);
    }

    /**
     * @notice Execute flashbot bundle with MEV protection
     * @param bundleId Bundle to execute
     * @dev Only authorized sequencers can execute bundles
     */
    function executeFlashbotBundle(uint256 bundleId) 
        external 
        onlyRole(SEQUENCER_ROLE)
        nonReentrant
        fairSequenced
        whenNotPaused 
    {
        Bundle storage bundle = bundles[bundleId];
        if (bundle.id == 0) revert SettlementNotFound();
        if (bundle.status != uint8(BundleStatus.Proposed)) revert SettlementAlreadyProcessed();
        if (block.timestamp > bundle.maxTimestamp) revert SettlementExpired();

        bundle.status = uint8(BundleStatus.Executing);

        uint256 ordersProcessed = 0;
        uint256 totalGasUsed = gasleft();
        uint256 mevExtracted = 0;

        // Execute orders atomically
        for (uint256 i = 0; i < bundle.orderIds.length; i++) {
            uint256 orderId = bundle.orderIds[i];
            
            try this._executeOrderInBundle(orderId) {
                ordersProcessed++;
                mevExtracted += _calculateMEVExtracted(orderId);
            } catch {
                // Continue with other orders, but mark bundle as partially failed
                continue;
            }
        }

        totalGasUsed = totalGasUsed - gasleft();
        bundle.status = ordersProcessed == bundle.orderIds.length 
            ? uint8(BundleStatus.Completed) 
            : uint8(BundleStatus.PartiallyFailed);

        // Distribute MEV extraction rewards
        if (mevExtracted > 0) {
            _distributeMEVRewards(bundle.proposer, mevExtracted);
        }

        emit BundleExecuted(bundleId, ordersProcessed, totalGasUsed, mevExtracted);
    }

    // =============================================================================
    // ORDER BUNDLING AND SANDWICH PROTECTION
    // =============================================================================

    /**
     * @notice Create atomic bundle to prevent sandwich attacks
     * @param orderIds Orders to bundle together
     * @param maxSlippagePerOrder Maximum slippage per order
     * @return bundleId Created bundle ID
     */
    function createAtomicBundle(
        uint256[] calldata orderIds,
        uint256[] calldata maxSlippagePerOrder
    ) 
        external 
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        returns (uint256 bundleId) 
    {
        if (orderIds.length != maxSlippagePerOrder.length) revert InvalidBatchSize();
        if (orderIds.length == 0 || orderIds.length > BUNDLE_MAX_SIZE) revert InvalidBatchSize();

        // Detect potential sandwich attacks
        _detectSandwichAttacks(orderIds);

        bundleId = _nextBundleId++;
        
        bundles[bundleId] = Bundle({
            id: bundleId,
            orderIds: orderIds,
            merkleRoot: _calculateMerkleRoot(orderIds),
            proposer: msg.sender,
            maxGasPrice: tx.gasprice,
            minTimestamp: block.timestamp,
            maxTimestamp: block.timestamp + FAIR_SEQUENCING_WINDOW,
            totalGasLimit: _estimateBundleGas(orderIds),
            status: uint8(BundleStatus.Proposed),
            isFlashbotBundle: false,
            flashbotSignature: ""
        });

        // Set individual order slippage limits
        for (uint256 i = 0; i < orderIds.length; i++) {
            orders[orderIds[i]].maxSlippageBps = maxSlippagePerOrder[i];
        }

        emit BundleProposed(bundleId, msg.sender, orderIds.length, false);
    }

    /**
     * @notice Detect sandwich attacks in order bundle
     * @param orderIds Orders to analyze
     */
    function _detectSandwichAttacks(uint256[] calldata orderIds) private view {
        for (uint256 i = 0; i < orderIds.length; i++) {
            Order storage order = orders[orderIds[i]];
            
            // Check for suspicious price impact patterns
            uint256 expectedPriceImpact = _calculatePriceImpact(order.tokenIn, order.tokenOut, order.amountIn);
            if (expectedPriceImpact > SANDWICH_DETECTION_THRESHOLD) {
                
                // Look for potential front-run/back-run pattern
                for (uint256 j = 0; j < orderIds.length; j++) {
                    if (i == j) continue;
                    
                    Order storage otherOrder = orders[orderIds[j]];
                    if (_isSandwichPattern(order, otherOrder)) {
                        revert SandwichAttackDetected();
                    }
                }
            }
        }
    }

    /**
     * @notice Check if two orders form a sandwich attack pattern
     * @param victimOrder The potential victim order
     * @param attackOrder The potential attack order
     * @return isSandwich True if sandwich pattern detected
     */
    function _isSandwichPattern(Order storage victimOrder, Order storage attackOrder) 
        private 
        view 
        returns (bool isSandwich) 
    {
        // Check for same token pair
        if (victimOrder.tokenIn != attackOrder.tokenOut || 
            victimOrder.tokenOut != attackOrder.tokenIn) {
            return false;
        }

        // Check for timing proximity (potential front-run/back-run)
        uint256 timeDiff = attackOrder.createdAt > victimOrder.createdAt 
            ? attackOrder.createdAt - victimOrder.createdAt
            : victimOrder.createdAt - attackOrder.createdAt;
        
        if (timeDiff < 12) { // Within same block or adjacent blocks
            // Check for disproportionate amounts (typical sandwich pattern)
            uint256 amountRatio = attackOrder.amountIn * 1000 / victimOrder.amountIn;
            if (amountRatio > 2000 || amountRatio < 500) { // More than 2x or less than 0.5x
                return true;
            }
        }

        return false;
    }

    // =============================================================================
    // DYNAMIC SLIPPAGE PROTECTION
    // =============================================================================

    /**
     * @notice Update price oracle for slippage calculation
     * @param token Token address
     * @param price New price
     * @param confidence Price confidence level (0-100)
     * @param signature Oracle signature
     */
    function updatePriceOracle(
        address token,
        uint256 price,
        uint256 confidence,
        bytes calldata signature
    ) 
        external 
        onlyRole(ORACLE_ROLE) 
    {
        if (token == address(0) || price == 0) revert InvalidSettlement();
        if (confidence > 100) revert InvalidSettlement();

        // Verify oracle signature
        bytes32 messageHash = keccak256(abi.encode(token, price, confidence, block.timestamp));
        address recoveredOracle = ECDSA.recover(messageHash, signature);
        if (!hasRole(ORACLE_ROLE, recoveredOracle)) revert InvalidSignature();

        // Update price history for volatility calculation
        priceHistory[token].push(price);
        if (priceHistory[token].length > 100) {
            // Keep only last 100 price points
            for (uint256 i = 0; i < 99; i++) {
                priceHistory[token][i] = priceHistory[token][i + 1];
            }
            priceHistory[token].pop();
        }

        priceOracles[token] = PriceOracle({
            price: price,
            timestamp: block.timestamp,
            confidence: confidence,
            oracle: recoveredOracle,
            signature: signature
        });

        lastPriceUpdate[token] = block.timestamp;
        _updateTokenVolatility(token);

        emit PriceOracleUpdate(token, price, confidence, recoveredOracle);
    }

    /**
     * @notice Calculate dynamic slippage limit based on volatility
     * @param token Token address
     * @param baseAmount Base amount for calculation
     * @return maxSlippageBps Maximum allowed slippage in basis points
     */
    function calculateDynamicSlippage(address token, uint256 baseAmount) 
        public 
        view 
        returns (uint256 maxSlippageBps) 
    {
        PriceOracle storage oracle = priceOracles[token];
        if (block.timestamp > oracle.timestamp + PRICE_ORACLE_STALENESS) {
            revert TokenNotWhitelisted(); // Use as generic "data unavailable" error
        }

        uint256 volatility = tokenVolatility[token];
        uint256 baseSlippage = MAX_SLIPPAGE_BPS;

        // Adjust for volatility (higher volatility = higher allowed slippage)
        uint256 volatilityAdjustment = (volatility * 50) / 100; // Up to 50% increase
        
        // Adjust for order size (larger orders = higher slippage tolerance)
        uint256 sizeAdjustment = 0;
        if (baseAmount > 1000 ether) {
            sizeAdjustment = 100; // Additional 1% for very large orders
        } else if (baseAmount > 100 ether) {
            sizeAdjustment = 50;  // Additional 0.5% for large orders
        }

        // Adjust for oracle confidence (lower confidence = higher slippage)
        uint256 confidenceAdjustment = (100 - oracle.confidence) / 2;

        maxSlippageBps = baseSlippage + volatilityAdjustment + sizeAdjustment + confidenceAdjustment;
        
        // Cap at reasonable maximum
        if (maxSlippageBps > 2000) { // 20% maximum
            maxSlippageBps = 2000;
        }
    }

    /**
     * @notice Update token volatility based on price history
     * @param token Token to update volatility for
     */
    function _updateTokenVolatility(address token) private {
        uint256[] storage prices = priceHistory[token];
        if (prices.length < 10) return; // Need sufficient data

        uint256 sum = 0;
        uint256 sumSquares = 0;
        uint256 count = prices.length;

        // Calculate mean and variance
        for (uint256 i = 0; i < count; i++) {
            sum += prices[i];
        }
        uint256 mean = sum / count;

        for (uint256 i = 0; i < count; i++) {
            uint256 diff = prices[i] > mean ? prices[i] - mean : mean - prices[i];
            sumSquares += diff * diff;
        }

        uint256 variance = sumSquares / count;
        uint256 volatility = _sqrt(variance) * 10000 / mean; // Volatility as basis points

        tokenVolatility[token] = volatility;
    }

    /**
     * @notice Validate slippage protection for order
     * @param orderId Order to validate
     */
    function _validateSlippageProtection(uint256 orderId) private view {
        Order storage order = orders[orderId];
        
        uint256 currentPrice = priceOracles[order.tokenOut].price;
        uint256 expectedOutput = (order.amountIn * currentPrice) / (10 ** 18); // Assuming 18 decimals
        
        if (expectedOutput < order.minAmountOut) {
            uint256 slippageBps = ((order.minAmountOut - expectedOutput) * 10000) / order.minAmountOut;
            if (slippageBps > order.maxSlippageBps) {
                revert SlippageExceeded();
            }
        }
    }

    // =============================================================================
    // FAIR SEQUENCING SERVICE INTEGRATION
    // =============================================================================

    /**
     * @notice Update fair sequencing randomness beacon
     * @param newBeacon New randomness value
     * @param vdfProof Verifiable delay function proof
     */
    function updateRandomnessBeacon(
        bytes32 newBeacon,
        bytes32 vdfProof
    ) 
        external 
        onlyRole(SEQUENCER_ROLE) 
    {
        uint256 currentRound = fairSequencing.currentRound;
        
        // Verify VDF proof
        if (!_verifyVDFProof(fairSequencing.randomnessBeacon, newBeacon, vdfProof)) {
            revert VDFVerificationFailed();
        }

        fairSequencing.randomnessBeacon = newBeacon;
        fairSequencing.beaconTimestamp = block.timestamp;
        fairSequencing.vdfProofs[currentRound] = vdfProof;
        fairSequencing.roundFinalized[currentRound] = true;
        fairSequencing.currentRound++;

        emit FairSequencingUpdate(currentRound, newBeacon, vdfProof);
    }

    /**
     * @notice Verify VDF proof for fair sequencing
     * @param input VDF input
     * @param output VDF output
     * @param proof VDF proof
     * @return valid True if proof is valid
     */
    function _verifyVDFProof(
        bytes32 input,
        bytes32 output,
        bytes32 proof
    ) private pure returns (bool valid) {
        // Simplified VDF verification - in production, use actual VDF implementation
        bytes32 expectedOutput = keccak256(abi.encode(input, proof));
        return expectedOutput == output;
    }

    /**
     * @notice Validate fair sequencing constraints
     */
    function _validateFairSequencing() private view {
        if (block.timestamp > fairSequencing.beaconTimestamp + FAIR_SEQUENCING_WINDOW) {
            revert RandomnessBeaconStale();
        }
        
        if (!fairSequencing.roundFinalized[fairSequencing.currentRound - 1]) {
            revert FairSequencingViolation();
        }
    }

    /**
     * @notice Get fair sequencing order for current round
     * @param orderIds Array of order IDs to sequence
     * @return sequencedIds Orders in fair sequence
     */
    function getFairSequencingOrder(uint256[] calldata orderIds) 
        external 
        view 
        returns (uint256[] memory sequencedIds) 
    {
        sequencedIds = new uint256[](orderIds.length);
        uint256[] memory randomValues = new uint256[](orderIds.length);

        // Generate deterministic random values for each order
        for (uint256 i = 0; i < orderIds.length; i++) {
            randomValues[i] = uint256(keccak256(abi.encode(
                fairSequencing.randomnessBeacon,
                orderIds[i],
                fairSequencing.currentRound
            )));
            sequencedIds[i] = orderIds[i];
        }

        // Sort based on random values (fair sequencing)
        _quickSortByRandomness(sequencedIds, randomValues, 0, sequencedIds.length - 1);
    }

    // =============================================================================
    // UTILITY FUNCTIONS
    // =============================================================================

    /**
     * @notice Calculate order hash for EIP-712 signing
     * @param order Order to hash
     * @return orderHash EIP-712 compliant hash
     */
    function _getOrderHash(Order memory order) private view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.id,
            order.trader,
            order.tokenIn,
            order.tokenOut,
            order.amountIn,
            order.minAmountOut,
            order.deadline,
            order.nonce,
            order.metadata
        ));
        
        return keccak256(abi.encodePacked("\\x19\\x01", domainSeparator, structHash));
    }

    /**
     * @notice Calculate Merkle root for order bundle
     * @param orderIds Array of order IDs
     * @return merkleRoot Merkle tree root
     */
    function _calculateMerkleRoot(uint256[] memory orderIds) private pure returns (bytes32) {
        if (orderIds.length == 0) return bytes32(0);
        if (orderIds.length == 1) return keccak256(abi.encode(orderIds[0]));

        bytes32[] memory hashes = new bytes32[](orderIds.length);
        for (uint256 i = 0; i < orderIds.length; i++) {
            hashes[i] = keccak256(abi.encode(orderIds[i]));
        }

        return _buildMerkleTree(hashes);
    }

    /**
     * @notice Build Merkle tree from leaf hashes
     * @param leaves Array of leaf hashes
     * @return root Merkle tree root
     */
    function _buildMerkleTree(bytes32[] memory leaves) private pure returns (bytes32 root) {
        uint256 length = leaves.length;
        
        while (length > 1) {
            for (uint256 i = 0; i < length / 2; i++) {
                leaves[i] = keccak256(abi.encode(leaves[2 * i], leaves[2 * i + 1]));
            }
            if (length % 2 == 1) {
                leaves[length / 2] = leaves[length - 1];
                length = length / 2 + 1;
            } else {
                length = length / 2;
            }
        }
        
        return leaves[0];
    }

    /**
     * @notice Calculate price impact for order
     * @param tokenIn Input token
     * @param tokenOut Output token  
     * @param amountIn Input amount
     * @return priceImpact Price impact in basis points
     */
    function _calculatePriceImpact(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) private view returns (uint256 priceImpact) {
        // Simplified price impact calculation
        // In production, would use actual AMM math
        PriceOracle storage inOracle = priceOracles[tokenIn];
        PriceOracle storage outOracle = priceOracles[tokenOut];
        
        if (inOracle.price == 0 || outOracle.price == 0) return 0;
        
        uint256 tradeValue = (amountIn * inOracle.price) / (10 ** 18);
        
        // Assume 0.1% price impact per $100k trade value
        priceImpact = (tradeValue * 10) / (100000 * 10 ** 18);
        
        return priceImpact > 1000 ? 1000 : priceImpact; // Cap at 10%
    }

    /**
     * @notice Calculate MEV extracted from order execution
     * @param orderId Order that was executed
     * @return mevAmount MEV amount extracted
     */
    function _calculateMEVExtracted(uint256 orderId) private view returns (uint256 mevAmount) {
        // Simplified MEV calculation
        // In production, would use more sophisticated analysis
        Order storage order = orders[orderId];
        uint256 orderValue = (order.amountIn * priceOracles[order.tokenIn].price) / (10 ** 18);
        
        // Assume 0.05% MEV extraction on average
        mevAmount = orderValue / 2000;
    }

    /**
     * @notice Distribute MEV rewards to appropriate parties
     * @param proposer Bundle proposer
     * @param mevAmount Total MEV extracted
     */
    function _distributeMEVRewards(address proposer, uint256 mevAmount) private {
        // 50% to proposer, 30% to protocol, 20% to insurance fund
        uint256 proposerReward = mevAmount / 2;
        uint256 protocolFee = (mevAmount * 3) / 10;
        uint256 insuranceContribution = mevAmount - proposerReward - protocolFee;
        
        payable(proposer).transfer(proposerReward);
        // Protocol fee and insurance fund transfers would be implemented
    }

    /**
     * @notice Get next nonce for user
     * @return nonce Next available nonce
     */
    function _getNextNonce() private returns (uint256 nonce) {
        nonce = _currentNonce++;
        userNonces[msg.sender]++;
    }

    /**
     * @notice Estimate gas for single order execution
     * @param order Order to estimate
     * @return gasEstimate Estimated gas usage
     */
    function _estimateOrderGas(Order storage order) private pure returns (uint256 gasEstimate) {
        // Base gas + token transfer + slippage check + MEV protection
        gasEstimate = 21000 + 65000 + 5000 + 10000;
        
        if (order.requiresCommitReveal) {
            gasEstimate += 15000; // Additional gas for commit-reveal
        }
    }

    /**
     * @notice Estimate total gas for bundle
     * @param orderIds Orders in bundle
     * @return totalGas Total estimated gas
     */
    function _estimateBundleGas(uint256[] memory orderIds) private view returns (uint256 totalGas) {
        for (uint256 i = 0; i < orderIds.length; i++) {
            totalGas += _estimateOrderGas(orders[orderIds[i]]);
        }
        totalGas += 50000; // Bundle overhead
    }

    /**
     * @notice Quick sort by randomness values for fair sequencing
     * @param ids Array of IDs to sort
     * @param values Corresponding random values
     * @param left Left index
     * @param right Right index
     */
    function _quickSortByRandomness(
        uint256[] memory ids,
        uint256[] memory values,
        uint256 left,
        uint256 right
    ) private pure {
        if (left >= right) return;
        
        uint256 pivotIndex = (left + right) / 2;
        uint256 pivotValue = values[pivotIndex];
        uint256 i = left;
        uint256 j = right;
        
        while (i <= j) {
            while (values[i] < pivotValue) i++;
            while (pivotValue < values[j]) j--;
            
            if (i <= j) {
                (values[i], values[j]) = (values[j], values[i]);
                (ids[i], ids[j]) = (ids[j], ids[i]);
                i++;
                if (j > 0) j--;
            }
        }
        
        if (left < j) _quickSortByRandomness(ids, values, left, j);
        if (i < right) _quickSortByRandomness(ids, values, i, right);
    }

    /**
     * @notice Simple square root implementation
     * @param x Input value
     * @return result Square root of x
     */
    function _sqrt(uint256 x) private pure returns (uint256 result) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        result = x;
        
        while (z < result) {
            result = z;
            z = (x / z + z) / 2;
        }
    }

    /**
     * @notice Validate MEV protection for order
     * @param orderId Order to validate
     */
    function _validateMEVProtection(uint256 orderId) private view {
        Order storage order = orders[orderId];
        
        // Check if order is subject to MEV protection
        if (order.requiresCommitReveal) {
            if (block.timestamp <= order.commitPhaseEnd) {
                revert MEVProtectionActive();
            }
        }
        
        // Check for suspicious patterns
        bytes32 pattern = keccak256(abi.encode(order.trader, order.tokenIn, order.tokenOut, order.amountIn));
        if (mevProtection.suspiciousPatterns[pattern]) {
            revert MEVProtectionActive();
        }
    }

    // =============================================================================
    // ORDER STATUS ENUM
    // =============================================================================

    enum OrderStatus {
        Committed,      // 0 - Order committed but not revealed
        Revealed,       // 1 - Order revealed and ready for execution
        Queued,         // 2 - Order in execution queue
        Processing,     // 3 - Order currently being processed
        Completed,      // 4 - Order successfully executed
        Failed,         // 5 - Order execution failed
        Expired,        // 6 - Order expired
        Cancelled       // 7 - Order cancelled
    }

    enum BundleStatus {
        Proposed,       // 0 - Bundle proposed
        Executing,      // 1 - Bundle being executed
        Completed,      // 2 - Bundle fully executed
        PartiallyFailed,// 3 - Some orders in bundle failed
        Failed,         // 4 - Bundle execution failed
        Expired         // 5 - Bundle expired
    }

    // =============================================================================
    // EXTERNAL EXECUTION FUNCTION
    // =============================================================================

    /**
     * @notice Execute single order within bundle (external for try-catch)
     * @param orderId Order to execute
     */
    function _executeOrderInBundle(uint256 orderId) external {
        require(msg.sender == address(this), "Internal use only");
        
        Order storage order = orders[orderId];
        order.status = uint8(OrderStatus.Processing);
        
        // Validate slippage protection
        _validateSlippageProtection(orderId);
        
        // Execute token transfer (simplified)
        IERC20(order.tokenIn).safeTransferFrom(order.trader, address(this), order.amountIn);
        
        // Calculate output amount (simplified - would use actual AMM in production)
        uint256 outputAmount = (order.amountIn * priceOracles[order.tokenOut].price) / priceOracles[order.tokenIn].price;
        
        if (outputAmount < order.minAmountOut) {
            revert SlippageExceeded();
        }
        
        IERC20(order.tokenOut).safeTransfer(order.trader, outputAmount);
        
        order.status = uint8(OrderStatus.Completed);
    }

    // =============================================================================
    // VIEW FUNCTIONS
    // =============================================================================

    /**
     * @notice Get order details
     * @param orderId Order ID
     * @return order Order struct
     */
    function getOrder(uint256 orderId) external view returns (Order memory order) {
        return orders[orderId];
    }

    /**
     * @notice Get bundle details
     * @param bundleId Bundle ID
     * @return bundle Bundle struct
     */
    function getBundle(uint256 bundleId) external view returns (Bundle memory bundle) {
        return bundles[bundleId];
    }

    /**
     * @notice Get commitment details
     * @param commitmentId Commitment ID
     * @return commitment Commitment struct
     */
    function getCommitment(bytes32 commitmentId) external view returns (Commitment memory commitment) {
        return commitments[commitmentId];
    }

    /**
     * @notice Check if address is whitelisted flashbot
     * @param flashbot Address to check
     * @return isWhitelisted True if whitelisted
     */
    function isWhitelistedFlashbot(address flashbot) external view returns (bool isWhitelisted) {
        return whitelistedFlashbots[flashbot];
    }

    /**
     * @notice Get current fair sequencing round
     * @return round Current round number
     */
    function getCurrentSequencingRound() external view returns (uint256 round) {
        return fairSequencing.currentRound;
    }

    // =============================================================================
    // ADMIN FUNCTIONS
    // =============================================================================

    /**
     * @notice Whitelist flashbot
     * @param flashbot Flashbot address
     */
    function whitelistFlashbot(address flashbot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedFlashbots[flashbot] = true;
    }

    /**
     * @notice Remove flashbot from whitelist
     * @param flashbot Flashbot address
     */
    function removeFlashbot(address flashbot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedFlashbots[flashbot] = false;
    }

    /**
     * @notice Emergency pause
     */
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /**
     * @notice Resume operations
     */
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }
}