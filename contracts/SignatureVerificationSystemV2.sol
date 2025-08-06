// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SignatureVerificationSystemV2
 * @author SwappiQ Protocol
 * @notice Enhanced signature verification system with comprehensive security fixes and optimizations
 * @dev Addresses signature malleability, replay attacks, and gas optimization
 */
contract SignatureVerificationSystemV2 is EIP712, AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    // ========== CONSTANTS ==========
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // EIP-712 Type Hashes - Enhanced with contract address and version
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address trader,address baseToken,address quoteToken,uint8 side,uint256 amount,uint256 price,uint256 deadline,uint256 salt,uint256 chainId,address verifyingContract,uint256 nonce)"
    );
    
    bytes32 public constant MULTISIG_ORDER_TYPEHASH = keccak256(
        "MultiSigOrder(address trader,address baseToken,address quoteToken,uint8 side,uint256 amount,uint256 price,uint256 deadline,uint256 salt,uint256 chainId,address verifyingContract,uint256 nonce,uint256 requiredSignatures,bytes32 signersHash)"
    );
    
    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256(
        "Authorization(address owner,address delegate,uint256 deadline,uint256 nonce,uint256 chainId,address verifyingContract)"
    );
    
    bytes32 public constant REVOCATION_TYPEHASH = keccak256(
        "Revocation(bytes32 signatureHash,uint256 deadline,uint256 nonce,uint256 chainId,address verifyingContract)"
    );
    
    bytes32 public constant CROSS_CHAIN_TYPEHASH = keccak256(
        "CrossChainOrder(address trader,address baseToken,address quoteToken,uint8 side,uint256 amount,uint256 price,uint256 deadline,uint256 salt,uint256 sourceChain,uint256 targetChain,bytes32 bridgeId,address verifyingContract,uint256 nonce)"
    );

    // Optimized constants
    uint8 public constant MAX_SIGNERS_PER_MULTISIG = 20;
    uint32 public constant DEFAULT_SIGNATURE_TTL = 1 hours;
    uint32 public constant MAX_SIGNATURE_TTL = 24 hours;
    uint32 public constant HARDWARE_WALLET_DEADLINE_EXTENSION = 5 minutes;
    uint32 public constant MIN_DELEGATION_PERIOD = 1 minutes;
    uint32 public constant MAX_DELEGATION_PERIOD = 30 days;
    uint16 public constant MAX_BATCH_SIZE = 100;

    // ========== ENUMS ==========
    enum SignatureType { STANDARD, MULTISIG, HARDWARE_WALLET, CROSS_CHAIN }
    enum SignatureStatus { VALID, EXPIRED, REVOKED, USED, INVALID }

    // ========== OPTIMIZED STRUCTS ==========
    
    /// @notice Gas-optimized order signature structure
    struct OrderSignature {
        address trader;
        address baseToken;
        address quoteToken;
        uint8 side;
        uint128 amount;          // Packed with price
        uint128 price;
        uint32 deadline;         // Packed with salt
        uint32 salt;             // Reduced from uint256
        uint32 chainId;          // Packed with nonce
        uint32 nonce;
        bytes signature;
        SignatureType sigType;
    }

    /// @notice Optimized multi-signature order structure
    struct MultiSigOrder {
        address trader;
        address baseToken;
        address quoteToken;
        uint8 side;
        uint128 amount;
        uint128 price;
        uint32 deadline;
        uint32 salt;
        uint32 chainId;
        uint32 nonce;
        uint8 requiredSignatures;
        address[] signers;
        bytes[] signatures;
    }

    /// @notice Optimized cross-chain order structure
    struct CrossChainOrder {
        address trader;
        address baseToken;
        address quoteToken;
        uint8 side;
        uint128 amount;
        uint128 price;
        uint32 deadline;
        uint32 salt;
        uint32 sourceChain;
        uint32 targetChain;
        uint32 nonce;
        bytes32 bridgeId;
        bytes signature;
    }

    /// @notice Optimized signature cache entry
    struct SignatureCache {
        bytes32 structHash;
        address signer;
        uint32 expiryTime;      // Packed with sigType and isValid
        SignatureType sigType;
        bool isValid;
    }

    /// @notice Optimized hardware wallet configuration
    struct HardwareWalletConfig {
        bool isRegistered;
        bool requiresExtendedDeadline;
        string deviceType;
        bytes32 deviceId;
        address owner;
        uint32 registrationTime;
    }

    /// @notice Optimized multi-sig wallet configuration
    struct MultiSigWallet {
        bool isActive;
        uint8 requiredSignatures;
        uint8 totalSigners;
        EnumerableSet.AddressSet signers;
        mapping(bytes32 => mapping(address => bool)) hasSignedOrder;
        mapping(bytes32 => uint8) signatureCount;
    }

    /// @notice Anti-gaming tracking with time windows
    struct TradingActivity {
        uint32 lastTradeTime;
        uint32 tradeCount24h;
        uint32 windowStart;
        mapping(address => uint32) lastTradeWithUser;
    }

    // ========== STATE VARIABLES ==========
    
    // Core signature tracking - optimized storage
    mapping(bytes32 => SignatureCache) public signatureCache;
    mapping(bytes32 => bool) public usedSignatures;
    mapping(bytes32 => bool) public revokedSignatures;
    mapping(address => uint32) public nonces;          // Reduced from uint256
    
    // Multi-signature wallets
    mapping(address => MultiSigWallet) public multiSigWallets;
    mapping(address => bool) public isMultiSigWallet;
    
    // Hardware wallets
    mapping(address => HardwareWalletConfig) public hardwareWallets;
    mapping(bytes32 => address) public deviceIdToAddress;
    
    // Cross-chain validation
    mapping(uint32 => bool) public supportedChains;    // Reduced from uint256
    mapping(bytes32 => bool) public processedCrossChainOrders;
    mapping(uint32 => address) public chainVerifiers;
    
    // Enhanced delegation system
    mapping(address => mapping(address => uint32)) public delegationDeadlines;
    mapping(address => EnumerableSet.AddressSet) private delegatedTo;
    mapping(address => mapping(address => uint32)) public delegationNonces;
    
    // Anti-gaming and monitoring
    mapping(address => TradingActivity) private tradingActivity;
    mapping(address => uint32) public userSignatureCount;
    
    // Performance settings
    uint32 public defaultSignatureTTL = DEFAULT_SIGNATURE_TTL;
    bool public cacheEnabled = true;
    bool public antiSpamEnabled = true;
    uint32 public maxSignaturesPerUser = 1000;

    // ========== EVENTS ==========
    
    event SignatureVerified(
        bytes32 indexed signatureHash,
        address indexed signer,
        address indexed trader,
        SignatureType sigType,
        bool cached
    );
    
    event SignatureRevoked(
        bytes32 indexed signatureHash,
        address indexed revoker,
        string reason,
        uint256 timestamp
    );
    
    event MultiSigWalletRegistered(
        address indexed wallet,
        uint8 requiredSignatures,
        address[] signers
    );
    
    event MultiSigWalletUpdated(
        address indexed wallet,
        uint8 newRequiredSignatures,
        address[] addedSigners,
        address[] removedSigners
    );
    
    event HardwareWalletRegistered(
        address indexed wallet,
        string deviceType,
        bytes32 indexed deviceId,
        address indexed owner
    );
    
    event DelegationGranted(
        address indexed owner,
        address indexed delegate,
        uint32 deadline,
        uint32 nonce
    );
    
    event DelegationRevoked(
        address indexed owner,
        address indexed delegate,
        uint32 nonce
    );
    
    event CrossChainOrderProcessed(
        bytes32 indexed orderHash,
        uint32 sourceChain,
        uint32 targetChain,
        address indexed trader
    );

    event SignatureCacheUpdated(
        bytes32 indexed signatureHash,
        bool isValid,
        uint32 expiryTime
    );

    event EmergencyAction(
        address indexed admin,
        string action,
        bytes32 indexed target
    );

    event AntiSpamTriggered(
        address indexed user,
        string reason,
        uint256 timestamp
    );

    // ========== CUSTOM ERRORS ==========
    error InvalidSignature();
    error SignatureExpired();
    error SignatureRevoked();
    error SignatureAlreadyUsed();
    error InsufficientSignatures();
    error UnauthorizedSigner();
    error InvalidMultiSigWallet();
    error HardwareWalletNotRegistered();
    error UnsupportedChain();
    error InvalidDelegation();
    error SignatureReplayAttack();
    error InvalidNonce();
    error DeadlineExceeded();
    error TooManySigners();
    error ZeroAddress();
    error InvalidTTL();
    error BatchSizeExceeded();
    error SpamDetected();
    error InvalidChainId();
    error MalformedSignature();
    error SignatureMalleability();

    // ========== MODIFIERS ==========
    
    modifier validAddress(address addr) {
        if (addr == address(0)) revert ZeroAddress();
        _;
    }
    
    modifier validChain(uint32 chainId) {
        if (!supportedChains[chainId]) revert UnsupportedChain();
        _;
    }
    
    modifier notExpired(uint32 deadline) {
        if (block.timestamp > deadline) revert DeadlineExceeded();
        _;
    }

    modifier validBatchSize(uint256 size) {
        if (size > MAX_BATCH_SIZE) revert BatchSizeExceeded();
        _;
    }

    modifier antiSpam(address user) {
        if (antiSpamEnabled) {
            _checkAntiSpam(user);
        }
        _;
    }

    modifier validSignatureLength(bytes calldata signature) {
        if (signature.length != 65) revert MalformedSignature();
        _;
    }

    // ========== CONSTRUCTOR ==========
    
    constructor(string memory name, string memory version) EIP712(name, version) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
        _grantRole(EMERGENCY_ROLE, msg.sender);
        
        // Add current chain as supported
        supportedChains[uint32(block.chainid)] = true;
    }

    // ========== SIGNATURE VERIFICATION FUNCTIONS ==========

    /**
     * @notice Verify a standard order signature with enhanced security
     * @param orderSig The order signature struct
     * @return isValid Whether the signature is valid
     * @return signatureHash The hash of the signature for tracking
     */
    function verifyOrderSignature(OrderSignature calldata orderSig) 
        external 
        whenNotPaused
        antiSpam(orderSig.trader)
        validSignatureLength(orderSig.signature)
        returns (bool isValid, bytes32 signatureHash) 
    {
        // Validate chain ID
        if (orderSig.chainId != block.chainid) revert InvalidChainId();
        
        // Validate deadline
        if (block.timestamp > orderSig.deadline) revert SignatureExpired();
        
        // Generate enhanced struct hash with contract address and nonce
        bytes32 structHash = keccak256(abi.encode(
            ORDER_TYPEHASH,
            orderSig.trader,
            orderSig.baseToken,
            orderSig.quoteToken,
            orderSig.side,
            orderSig.amount,
            orderSig.price,
            orderSig.deadline,
            orderSig.salt,
            orderSig.chainId,
            address(this),  // Include contract address to prevent cross-contract replay
            orderSig.nonce
        ));
        
        signatureHash = keccak256(abi.encodePacked(structHash, orderSig.signature));
        
        // Check cache first for performance
        if (cacheEnabled && _checkSignatureCache(signatureHash)) {
            emit SignatureVerified(signatureHash, orderSig.trader, orderSig.trader, orderSig.sigType, true);
            return (true, signatureHash);
        }
        
        // Enhanced signature status checks
        _validateSignatureStatus(signatureHash);
        
        // Generate EIP-712 hash
        bytes32 digest = _hashTypedDataV4(structHash);
        
        // Enhanced signature recovery with malleability protection
        address recoveredSigner = _recoverSignerSafe(digest, orderSig.signature);
        
        // Verify nonce to prevent replay attacks
        if (orderSig.nonce != nonces[orderSig.trader]) revert InvalidNonce();
        
        // Check authorization with enhanced validation
        isValid = _isAuthorizedSigner(orderSig.trader, recoveredSigner, orderSig.sigType);
        
        if (isValid) {
            // Increment nonce to prevent replay
            nonces[orderSig.trader]++;
            
            // Cache the signature for performance
            _cacheSignature(signatureHash, structHash, recoveredSigner, orderSig.sigType);
            
            // Mark as used
            usedSignatures[signatureHash] = true;
            
            // Update user statistics
            userSignatureCount[orderSig.trader]++;
            _updateTradingActivity(orderSig.trader);
        }
        
        emit SignatureVerified(signatureHash, recoveredSigner, orderSig.trader, orderSig.sigType, false);
        return (isValid, signatureHash);
    }

    /**
     * @notice Verify a multi-signature order with enhanced replay protection
     * @param multiSigOrder The multi-signature order struct
     * @return isValid Whether all required signatures are valid
     * @return orderHash The hash of the order for tracking
     */
    function verifyMultiSigOrder(MultiSigOrder calldata multiSigOrder) 
        external 
        whenNotPaused
        antiSpam(multiSigOrder.trader)
        returns (bool isValid, bytes32 orderHash) 
    {
        // Enhanced multi-sig wallet validation
        if (!isMultiSigWallet[multiSigOrder.trader]) revert InvalidMultiSigWallet();
        
        MultiSigWallet storage wallet = multiSigWallets[multiSigOrder.trader];
        if (!wallet.isActive) revert InvalidMultiSigWallet();
        
        // Validate signature array lengths
        if (multiSigOrder.signatures.length != multiSigOrder.signers.length) revert InvalidSignature();
        if (multiSigOrder.signatures.length < multiSigOrder.requiredSignatures) revert InsufficientSignatures();
        
        // Validate chain ID and deadline
        if (multiSigOrder.chainId != block.chainid) revert InvalidChainId();
        if (block.timestamp > multiSigOrder.deadline) revert SignatureExpired();
        
        // Generate enhanced order hash with signers hash for uniqueness
        bytes32 signersHash = keccak256(abi.encodePacked(multiSigOrder.signers));
        bytes32 structHash = keccak256(abi.encode(
            MULTISIG_ORDER_TYPEHASH,
            multiSigOrder.trader,
            multiSigOrder.baseToken,
            multiSigOrder.quoteToken,
            multiSigOrder.side,
            multiSigOrder.amount,
            multiSigOrder.price,
            multiSigOrder.deadline,
            multiSigOrder.salt,
            multiSigOrder.chainId,
            address(this),
            multiSigOrder.nonce,
            multiSigOrder.requiredSignatures,
            signersHash
        ));
        
        orderHash = _hashTypedDataV4(structHash);
        
        // Enhanced replay protection
        if (usedSignatures[orderHash]) revert SignatureAlreadyUsed();
        if (revokedSignatures[orderHash]) revert SignatureRevoked();
        
        // Verify nonce
        if (multiSigOrder.nonce != nonces[multiSigOrder.trader]) revert InvalidNonce();
        
        // Verify signatures with enhanced validation
        uint8 validSignatures = _verifyMultiSigSignatures(
            multiSigOrder,
            orderHash,
            wallet
        );
        
        isValid = validSignatures >= multiSigOrder.requiredSignatures;
        
        if (isValid) {
            // Increment nonce
            nonces[multiSigOrder.trader]++;
            
            // Mark as used
            usedSignatures[orderHash] = true;
            
            // Update statistics
            userSignatureCount[multiSigOrder.trader]++;
            _updateTradingActivity(multiSigOrder.trader);
        }
        
        return (isValid, orderHash);
    }

    /**
     * @notice Verify a cross-chain order signature with enhanced security
     * @param crossChainOrder The cross-chain order struct
     * @return isValid Whether the signature is valid
     * @return orderHash The hash of the order
     */
    function verifyCrossChainOrder(CrossChainOrder calldata crossChainOrder)
        external
        whenNotPaused
        validChain(crossChainOrder.sourceChain)
        validChain(crossChainOrder.targetChain)
        antiSpam(crossChainOrder.trader)
        validSignatureLength(crossChainOrder.signature)
        returns (bool isValid, bytes32 orderHash)
    {
        // Enhanced struct hash with contract address
        bytes32 structHash = keccak256(abi.encode(
            CROSS_CHAIN_TYPEHASH,
            crossChainOrder.trader,
            crossChainOrder.baseToken,
            crossChainOrder.quoteToken,
            crossChainOrder.side,
            crossChainOrder.amount,
            crossChainOrder.price,
            crossChainOrder.deadline,
            crossChainOrder.salt,
            crossChainOrder.sourceChain,
            crossChainOrder.targetChain,
            crossChainOrder.bridgeId,
            address(this),
            crossChainOrder.nonce
        ));
        
        orderHash = _hashTypedDataV4(structHash);
        
        // Enhanced replay protection
        if (processedCrossChainOrders[orderHash]) revert SignatureAlreadyUsed();
        if (revokedSignatures[orderHash]) revert SignatureRevoked();
        
        // Validate deadline and nonce
        if (block.timestamp > crossChainOrder.deadline) revert SignatureExpired();
        if (crossChainOrder.nonce != nonces[crossChainOrder.trader]) revert InvalidNonce();
        
        // Enhanced signature verification
        address recoveredSigner = _recoverSignerSafe(orderHash, crossChainOrder.signature);
        isValid = _isAuthorizedSigner(crossChainOrder.trader, recoveredSigner, SignatureType.CROSS_CHAIN);
        
        if (isValid) {
            // Increment nonce
            nonces[crossChainOrder.trader]++;
            
            // Mark as processed
            processedCrossChainOrders[orderHash] = true;
            
            // Update statistics
            userSignatureCount[crossChainOrder.trader]++;
            _updateTradingActivity(crossChainOrder.trader);
            
            emit CrossChainOrderProcessed(
                orderHash, 
                crossChainOrder.sourceChain, 
                crossChainOrder.targetChain,
                crossChainOrder.trader
            );
        }
        
        return (isValid, orderHash);
    }

    // ========== BATCH OPERATIONS ==========

    /**
     * @notice Batch verify multiple signatures for gas efficiency
     * @param orderSigs Array of order signatures to verify
     * @return results Array of verification results
     */
    function batchVerifySignatures(OrderSignature[] calldata orderSigs)
        external
        whenNotPaused
        validBatchSize(orderSigs.length)
        returns (bool[] memory results, bytes32[] memory hashes)
    {
        results = new bool[](orderSigs.length);
        hashes = new bytes32[](orderSigs.length);
        
        for (uint256 i = 0; i < orderSigs.length; i++) {
            try this.verifyOrderSignature(orderSigs[i]) returns (bool isValid, bytes32 hash) {
                results[i] = isValid;
                hashes[i] = hash;
            } catch {
                results[i] = false;
                hashes[i] = bytes32(0);
            }
        }
        
        return (results, hashes);
    }

    /**
     * @notice Batch revoke multiple signatures
     * @param signatureHashes Array of signature hashes to revoke
     * @param reason Reason for revocation
     */
    function batchRevokeSignatures(
        bytes32[] calldata signatureHashes,
        string calldata reason
    ) external onlyRole(EMERGENCY_ROLE) validBatchSize(signatureHashes.length) {
        for (uint256 i = 0; i < signatureHashes.length; i++) {
            revokedSignatures[signatureHashes[i]] = true;
            delete signatureCache[signatureHashes[i]];
            
            emit SignatureRevoked(signatureHashes[i], msg.sender, reason, block.timestamp);
        }
    }

    // ========== MULTI-SIGNATURE WALLET MANAGEMENT ==========

    /**
     * @notice Register a multi-signature wallet with enhanced validation
     * @param wallet The wallet address
     * @param requiredSignatures Number of required signatures
     * @param signers Array of authorized signers
     */
    function registerMultiSigWallet(
        address wallet,
        uint8 requiredSignatures,
        address[] calldata signers
    ) external validAddress(wallet) {
        if (signers.length == 0 || signers.length > MAX_SIGNERS_PER_MULTISIG) revert TooManySigners();
        if (requiredSignatures == 0 || requiredSignatures > signers.length) revert InsufficientSignatures();
        
        // Validate signers are unique and non-zero
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < signers.length; j++) {
                if (signers[i] == signers[j]) revert InvalidSignature();
            }
        }
        
        MultiSigWallet storage msWallet = multiSigWallets[wallet];
        msWallet.isActive = true;
        msWallet.requiredSignatures = requiredSignatures;
        msWallet.totalSigners = uint8(signers.length);
        
        // Clear existing signers and add new ones
        for (uint256 i = 0; i < signers.length; i++) {
            msWallet.signers.add(signers[i]);
        }
        
        isMultiSigWallet[wallet] = true;
        
        emit MultiSigWalletRegistered(wallet, requiredSignatures, signers);
    }

    // ========== HARDWARE WALLET MANAGEMENT ==========

    /**
     * @notice Register a hardware wallet with enhanced validation
     * @param walletAddress The wallet address
     * @param deviceType Type of device
     * @param deviceId Unique device identifier
     * @param requiresExtendedDeadline Whether device needs extended deadline
     */
    function registerHardwareWallet(
        address walletAddress,
        string calldata deviceType,
        bytes32 deviceId,
        bool requiresExtendedDeadline
    ) external validAddress(walletAddress) {
        // Validate device ID is unique
        if (deviceIdToAddress[deviceId] != address(0)) revert InvalidSignature();
        
        // Validate device type
        bytes memory deviceTypeBytes = bytes(deviceType);
        if (deviceTypeBytes.length == 0 || deviceTypeBytes.length > 32) revert InvalidSignature();
        
        hardwareWallets[walletAddress] = HardwareWalletConfig({
            isRegistered: true,
            deviceType: deviceType,
            deviceId: deviceId,
            owner: msg.sender,
            registrationTime: uint32(block.timestamp),
            requiresExtendedDeadline: requiresExtendedDeadline
        });
        
        deviceIdToAddress[deviceId] = walletAddress;
        
        emit HardwareWalletRegistered(walletAddress, deviceType, deviceId, msg.sender);
    }

    // ========== ENHANCED DELEGATION SYSTEM ==========

    /**
     * @notice Grant delegation with enhanced security
     * @param delegate The address to delegate to
     * @param deadline Delegation expiry time
     * @param signature EIP-712 signature authorizing delegation
     */
    function grantDelegation(
        address delegate,
        uint32 deadline,
        bytes calldata signature
    ) external validAddress(delegate) notExpired(deadline) validSignatureLength(signature) {
        // Validate delegation period
        uint32 delegationPeriod = deadline - uint32(block.timestamp);
        if (delegationPeriod < MIN_DELEGATION_PERIOD || delegationPeriod > MAX_DELEGATION_PERIOD) {
            revert InvalidDelegation();
        }
        
        uint32 currentNonce = delegationNonces[msg.sender][delegate]++;
        
        bytes32 structHash = keccak256(abi.encode(
            AUTHORIZATION_TYPEHASH,
            msg.sender,
            delegate,
            deadline,
            currentNonce,
            block.chainid,
            address(this)
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = _recoverSignerSafe(digest, signature);
        
        if (signer != msg.sender) revert InvalidSignature();
        
        delegationDeadlines[msg.sender][delegate] = deadline;
        delegatedTo[msg.sender].add(delegate);
        
        emit DelegationGranted(msg.sender, delegate, deadline, currentNonce);
    }

    // ========== ENHANCED SIGNATURE REVOCATION ==========

    /**
     * @notice Revoke a signature with enhanced authorization
     * @param signatureHash The hash of the signature to revoke
     * @param deadline Revocation deadline
     * @param signature Authorization signature for revocation
     * @param reason Reason for revocation
     */
    function revokeSignature(
        bytes32 signatureHash,
        uint32 deadline,
        bytes calldata signature,
        string calldata reason
    ) external notExpired(deadline) validSignatureLength(signature) {
        uint32 currentNonce = nonces[msg.sender]++;
        
        bytes32 structHash = keccak256(abi.encode(
            REVOCATION_TYPEHASH,
            signatureHash,
            deadline,
            currentNonce,
            block.chainid,
            address(this)
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = _recoverSignerSafe(digest, signature);
        
        if (signer != msg.sender) revert InvalidSignature();
        
        revokedSignatures[signatureHash] = true;
        delete signatureCache[signatureHash];
        
        emit SignatureRevoked(signatureHash, msg.sender, reason, block.timestamp);
    }

    // ========== INTERNAL FUNCTIONS ==========

    function _recoverSignerSafe(bytes32 hash, bytes calldata signature) 
        private 
        pure 
        returns (address) 
    {
        // Check for signature malleability
        bytes32 s;
        assembly {
            s := calldataload(add(signature.offset, 0x20))
        }
        
        // Ensure s is in the lower half to prevent malleability
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert SignatureMalleability();
        }
        
        address signer = hash.recover(signature);
        if (signer == address(0)) revert InvalidSignature();
        
        return signer;
    }

    function _validateSignatureStatus(bytes32 signatureHash) private view {
        if (usedSignatures[signatureHash]) revert SignatureAlreadyUsed();
        if (revokedSignatures[signatureHash]) revert SignatureRevoked();
    }

    function _isAuthorizedSigner(
        address owner, 
        address signer, 
        SignatureType sigType
    ) private view returns (bool) {
        // Owner can always sign
        if (owner == signer) return true;
        
        // Check delegation with time validation
        uint32 delegationDeadline = delegationDeadlines[owner][signer];
        if (delegationDeadline > block.timestamp) return true;
        
        // Enhanced hardware wallet validation
        if (sigType == SignatureType.HARDWARE_WALLET) {
            HardwareWalletConfig storage hwConfig = hardwareWallets[owner];
            return hwConfig.isRegistered && hwConfig.owner == signer;
        }
        
        return false;
    }

    function _verifyMultiSigSignatures(
        MultiSigOrder calldata order,
        bytes32 orderHash,
        MultiSigWallet storage wallet
    ) private returns (uint8 validSignatures) {
        validSignatures = 0;
        
        for (uint256 i = 0; i < order.signatures.length; i++) {
            address signer = _recoverSignerSafe(orderHash, order.signatures[i]);
            
            // Enhanced validation: check if signer is authorized and hasn't already signed
            if (wallet.signers.contains(signer) && 
                !wallet.hasSignedOrder[orderHash][signer] &&
                signer == order.signers[i]) { // Ensure signer matches expected order
                
                wallet.hasSignedOrder[orderHash][signer] = true;
                validSignatures++;
            }
        }
        
        wallet.signatureCount[orderHash] = validSignatures;
        return validSignatures;
    }

    function _checkSignatureCache(bytes32 signatureHash) private view returns (bool) {
        SignatureCache storage cache = signatureCache[signatureHash];
        
        if (cache.expiryTime == 0) return false; // Not cached
        if (block.timestamp > cache.expiryTime) return false; // Expired
        if (!cache.isValid) return false; // Invalid
        
        return true;
    }

    function _cacheSignature(
        bytes32 signatureHash,
        bytes32 structHash,
        address signer,
        SignatureType sigType
    ) private {
        if (!cacheEnabled) return;
        
        signatureCache[signatureHash] = SignatureCache({
            structHash: structHash,
            signer: signer,
            expiryTime: uint32(block.timestamp + defaultSignatureTTL),
            isValid: true,
            sigType: sigType
        });
        
        emit SignatureCacheUpdated(signatureHash, true, uint32(block.timestamp + defaultSignatureTTL));
    }

    function _checkAntiSpam(address user) private {
        TradingActivity storage activity = tradingActivity[user];
        uint32 currentTime = uint32(block.timestamp);
        
        // Reset window if needed (24 hour windows)
        if (currentTime > activity.windowStart + 24 hours) {
            activity.windowStart = currentTime;
            activity.tradeCount24h = 0;
        }
        
        // Check rate limits
        if (userSignatureCount[user] > maxSignaturesPerUser) {
            emit AntiSpamTriggered(user, "Max signatures exceeded", block.timestamp);
            revert SpamDetected();
        }
        
        // Check for suspicious activity patterns
        if (activity.tradeCount24h > 100) { // Configurable threshold
            emit AntiSpamTriggered(user, "High frequency trading detected", block.timestamp);
            revert SpamDetected();
        }
    }

    function _updateTradingActivity(address user) private {
        TradingActivity storage activity = tradingActivity[user];
        uint32 currentTime = uint32(block.timestamp);
        
        activity.lastTradeTime = currentTime;
        activity.tradeCount24h++;
    }

    // ========== VIEW FUNCTIONS ==========

    function getMultiSigWalletInfo(address wallet) 
        external 
        view 
        returns (
            bool isActive,
            uint8 requiredSignatures,
            uint8 totalSigners,
            address[] memory signers
        ) 
    {
        MultiSigWallet storage msWallet = multiSigWallets[wallet];
        return (
            msWallet.isActive,
            msWallet.requiredSignatures,
            msWallet.totalSigners,
            msWallet.signers.values()
        );
    }

    function isSignatureValid(bytes32 signatureHash) 
        external 
        view 
        returns (SignatureStatus) 
    {
        if (revokedSignatures[signatureHash]) return SignatureStatus.REVOKED;
        if (usedSignatures[signatureHash]) return SignatureStatus.USED;
        
        SignatureCache storage cache = signatureCache[signatureHash];
        if (cache.expiryTime != 0) {
            if (block.timestamp > cache.expiryTime) return SignatureStatus.EXPIRED;
            if (cache.isValid) return SignatureStatus.VALID;
        }
        
        return SignatureStatus.INVALID;
    }

    function getUserStats(address user) 
        external 
        view 
        returns (
            uint32 signatureCount,
            uint32 lastActivity,
            uint32 currentNonce,
            uint32 delegationCount
        ) 
    {
        return (
            userSignatureCount[user],
            tradingActivity[user].lastTradeTime,
            nonces[user],
            uint32(delegatedTo[user].length())
        );
    }

    // ========== ADMIN FUNCTIONS ==========

    function updateAntiSpamSettings(
        bool enabled,
        uint32 maxSigs
    ) external onlyRole(OPERATOR_ROLE) {
        antiSpamEnabled = enabled;
        maxSignaturesPerUser = maxSigs;
    }

    function addSupportedChain(uint32 chainId, address verifierContract) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        supportedChains[chainId] = true;
        chainVerifiers[chainId] = verifierContract;
    }

    function emergencyPause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
        emit EmergencyAction(msg.sender, "PAUSE", bytes32(0));
    }

    function emergencyUnpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
        emit EmergencyAction(msg.sender, "UNPAUSE", bytes32(0));
    }

    function emergencyRevokeSignature(bytes32 signatureHash, string calldata reason) 
        external 
        onlyRole(EMERGENCY_ROLE) 
    {
        revokedSignatures[signatureHash] = true;
        delete signatureCache[signatureHash];
        
        emit SignatureRevoked(signatureHash, msg.sender, reason, block.timestamp);
        emit EmergencyAction(msg.sender, "REVOKE_SIGNATURE", signatureHash);
    }
}