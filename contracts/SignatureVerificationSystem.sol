// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SignatureVerificationSystem
 * @author SwappiQ Protocol
 * @notice Comprehensive signature verification system with EIP-712, multi-sig, and cross-chain support
 * @dev Implements hardware wallet support, signature caching, and revocation mechanisms
 */
contract SignatureVerificationSystem is EIP712, AccessControl, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    // ========== CONSTANTS ==========
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    
    // EIP-712 Type Hashes
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address trader,address baseToken,address quoteToken,uint8 side,uint256 amount,uint256 price,uint256 deadline,uint256 salt,uint256 chainId)"
    );
    
    bytes32 public constant MULTISIG_ORDER_TYPEHASH = keccak256(
        "MultiSigOrder(address trader,address baseToken,address quoteToken,uint8 side,uint256 amount,uint256 price,uint256 deadline,uint256 salt,uint256 chainId,uint256 requiredSignatures,address[] signers)"
    );
    
    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256(
        "Authorization(address owner,address delegate,uint256 deadline,uint256 nonce,uint256 chainId)"
    );
    
    bytes32 public constant REVOCATION_TYPEHASH = keccak256(
        "Revocation(bytes32 signatureHash,uint256 deadline,uint256 nonce,uint256 chainId)"
    );
    
    bytes32 public constant CROSS_CHAIN_TYPEHASH = keccak256(
        "CrossChainOrder(address trader,address baseToken,address quoteToken,uint8 side,uint256 amount,uint256 price,uint256 deadline,uint256 salt,uint256 sourceChain,uint256 targetChain,bytes32 bridgeId)"
    );

    // Cache and limits
    uint256 public constant MAX_SIGNERS_PER_MULTISIG = 20;
    uint256 public constant DEFAULT_SIGNATURE_TTL = 1 hours;
    uint256 public constant MAX_SIGNATURE_TTL = 24 hours;
    uint256 public constant HARDWARE_WALLET_DEADLINE_EXTENSION = 5 minutes;

    // ========== ENUMS ==========
    enum SignatureType {
        STANDARD,
        MULTISIG,
        HARDWARE_WALLET,
        CROSS_CHAIN
    }

    enum SignatureStatus {
        VALID,
        EXPIRED,
        REVOKED,
        USED,
        INVALID
    }

    // ========== STRUCTS ==========
    
    /// @notice Standard order signature structure
    struct OrderSignature {
        address trader;
        address baseToken;
        address quoteToken;
        uint8 side; // 0 = buy, 1 = sell
        uint256 amount;
        uint256 price;
        uint256 deadline;
        uint256 salt;
        uint256 chainId;
        bytes signature;
        SignatureType sigType;
    }

    /// @notice Multi-signature order structure
    struct MultiSigOrder {
        address trader; // Multi-sig wallet address
        address baseToken;
        address quoteToken;
        uint8 side;
        uint256 amount;
        uint256 price;
        uint256 deadline;
        uint256 salt;
        uint256 chainId;
        uint256 requiredSignatures;
        address[] signers;
        bytes[] signatures;
    }

    /// @notice Cross-chain order structure
    struct CrossChainOrder {
        address trader;
        address baseToken;
        address quoteToken;
        uint8 side;
        uint256 amount;
        uint256 price;
        uint256 deadline;
        uint256 salt;
        uint256 sourceChain;
        uint256 targetChain;
        bytes32 bridgeId;
        bytes signature;
    }

    /// @notice Signature cache entry
    struct SignatureCache {
        bytes32 structHash;
        address signer;
        uint256 expiryTime;
        bool isValid;
        SignatureType sigType;
    }

    /// @notice Hardware wallet configuration
    struct HardwareWalletConfig {
        bool isRegistered;
        string deviceType; // "ledger", "trezor", etc.
        bytes32 deviceId;
        address owner;
        uint256 registrationTime;
        bool requiresExtendedDeadline;
    }

    /// @notice Multi-sig wallet configuration
    struct MultiSigWallet {
        bool isActive;
        uint256 requiredSignatures;
        uint256 totalSigners;
        EnumerableSet.AddressSet signers;
        mapping(bytes32 => uint256) signatureCount;
        mapping(bytes32 => mapping(address => bool)) hasSignedOrder;
    }

    // ========== STATE VARIABLES ==========
    
    // Signature tracking
    mapping(bytes32 => SignatureCache) public signatureCache;
    mapping(bytes32 => bool) public usedSignatures;
    mapping(bytes32 => bool) public revokedSignatures;
    mapping(address => uint256) public nonces;
    
    // Multi-signature wallets
    mapping(address => MultiSigWallet) public multiSigWallets;
    mapping(address => bool) public isMultiSigWallet;
    
    // Hardware wallets
    mapping(address => HardwareWalletConfig) public hardwareWallets;
    mapping(bytes32 => address) public deviceIdToAddress;
    
    // Cross-chain validation
    mapping(uint256 => bool) public supportedChains;
    mapping(bytes32 => bool) public processedCrossChainOrders;
    mapping(uint256 => address) public chainVerifiers; // Chain ID to verifier contract
    
    // Delegation system
    mapping(address => mapping(address => uint256)) public delegationDeadlines;
    mapping(address => EnumerableSet.AddressSet) private delegatedTo;
    
    // Performance settings
    uint256 public defaultSignatureTTL = DEFAULT_SIGNATURE_TTL;
    bool public cacheEnabled = true;

    // ========== EVENTS ==========
    
    event SignatureVerified(
        bytes32 indexed signatureHash,
        address indexed signer,
        SignatureType sigType,
        bool cached
    );
    
    event SignatureRevoked(
        bytes32 indexed signatureHash,
        address indexed revoker,
        uint256 timestamp
    );
    
    event MultiSigWalletRegistered(
        address indexed wallet,
        uint256 requiredSignatures,
        address[] signers
    );
    
    event HardwareWalletRegistered(
        address indexed wallet,
        string deviceType,
        bytes32 deviceId
    );
    
    event DelegationGranted(
        address indexed owner,
        address indexed delegate,
        uint256 deadline
    );
    
    event DelegationRevoked(
        address indexed owner,
        address indexed delegate
    );
    
    event CrossChainOrderProcessed(
        bytes32 indexed orderHash,
        uint256 sourceChain,
        uint256 targetChain
    );

    event SignatureCacheUpdated(
        bytes32 indexed signatureHash,
        bool isValid,
        uint256 expiryTime
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

    // ========== MODIFIERS ==========
    
    modifier validAddress(address addr) {
        if (addr == address(0)) revert ZeroAddress();
        _;
    }
    
    modifier validChain(uint256 chainId) {
        if (!supportedChains[chainId]) revert UnsupportedChain();
        _;
    }
    
    modifier notExpired(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExceeded();
        _;
    }

    // ========== CONSTRUCTOR ==========
    
    constructor(string memory name, string memory version) EIP712(name, version) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
        
        // Add current chain as supported
        supportedChains[block.chainid] = true;
    }

    // ========== SIGNATURE VERIFICATION FUNCTIONS ==========

    /**
     * @notice Verify a standard order signature with caching
     * @param orderSig The order signature struct
     * @return isValid Whether the signature is valid
     * @return signatureHash The hash of the signature for tracking
     */
    function verifyOrderSignature(OrderSignature calldata orderSig) 
        external 
        returns (bool isValid, bytes32 signatureHash) 
    {
        // Generate struct hash
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
            orderSig.chainId
        ));
        
        signatureHash = keccak256(abi.encodePacked(structHash, orderSig.signature));
        
        // Check cache first
        if (cacheEnabled && _checkSignatureCache(signatureHash)) {
            emit SignatureVerified(signatureHash, orderSig.trader, orderSig.sigType, true);
            return (true, signatureHash);
        }
        
        // Verify signature hasn't been used or revoked
        _checkSignatureStatus(signatureHash);
        
        // Verify deadline
        if (block.timestamp > orderSig.deadline) revert SignatureExpired();
        
        // Generate EIP-712 hash
        bytes32 digest = _hashTypedDataV4(structHash);
        
        // Verify signature based on type
        address recoveredSigner;
        if (orderSig.sigType == SignatureType.HARDWARE_WALLET) {
            recoveredSigner = _verifyHardwareWalletSignature(orderSig.trader, digest, orderSig.signature);
        } else {
            recoveredSigner = digest.recover(orderSig.signature);
        }
        
        // Check if signer is authorized
        isValid = _isAuthorizedSigner(orderSig.trader, recoveredSigner);
        
        if (isValid) {
            // Cache the signature
            _cacheSignature(signatureHash, structHash, recoveredSigner, orderSig.sigType);
            usedSignatures[signatureHash] = true;
        }
        
        emit SignatureVerified(signatureHash, recoveredSigner, orderSig.sigType, false);
        return (isValid, signatureHash);
    }

    /**
     * @notice Verify a multi-signature order
     * @param multiSigOrder The multi-signature order struct
     * @return isValid Whether all required signatures are valid
     * @return orderHash The hash of the order for tracking
     */
    function verifyMultiSigOrder(MultiSigOrder calldata multiSigOrder) 
        external 
        returns (bool isValid, bytes32 orderHash) 
    {
        // Verify multi-sig wallet is registered
        if (!isMultiSigWallet[multiSigOrder.trader]) revert InvalidMultiSigWallet();
        
        MultiSigWallet storage wallet = multiSigWallets[multiSigOrder.trader];
        if (!wallet.isActive) revert InvalidMultiSigWallet();
        
        // Generate order hash
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
            multiSigOrder.requiredSignatures,
            keccak256(abi.encodePacked(multiSigOrder.signers))
        ));
        
        orderHash = _hashTypedDataV4(structHash);
        
        // Check if order was already processed
        if (usedSignatures[orderHash]) revert SignatureAlreadyUsed();
        if (revokedSignatures[orderHash]) revert SignatureRevoked();
        
        // Verify deadline
        if (block.timestamp > multiSigOrder.deadline) revert SignatureExpired();
        
        // Verify signatures
        uint256 validSignatures = _verifyMultiSigSignatures(
            multiSigOrder,
            orderHash,
            wallet
        );
        
        isValid = validSignatures >= multiSigOrder.requiredSignatures;
        
        if (isValid) {
            usedSignatures[orderHash] = true;
        }
        
        return (isValid, orderHash);
    }

    /**
     * @notice Verify a cross-chain order signature
     * @param crossChainOrder The cross-chain order struct
     * @return isValid Whether the signature is valid
     * @return orderHash The hash of the order
     */
    function verifyCrossChainOrder(CrossChainOrder calldata crossChainOrder)
        external
        validChain(crossChainOrder.sourceChain)
        validChain(crossChainOrder.targetChain)
        returns (bool isValid, bytes32 orderHash)
    {
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
            crossChainOrder.bridgeId
        ));
        
        orderHash = _hashTypedDataV4(structHash);
        
        // Check if already processed
        if (processedCrossChainOrders[orderHash]) revert SignatureAlreadyUsed();
        
        // Verify deadline
        if (block.timestamp > crossChainOrder.deadline) revert SignatureExpired();
        
        // Verify signature
        address recoveredSigner = orderHash.recover(crossChainOrder.signature);
        isValid = _isAuthorizedSigner(crossChainOrder.trader, recoveredSigner);
        
        if (isValid) {
            processedCrossChainOrders[orderHash] = true;
            emit CrossChainOrderProcessed(orderHash, crossChainOrder.sourceChain, crossChainOrder.targetChain);
        }
        
        return (isValid, orderHash);
    }

    // ========== MULTI-SIGNATURE WALLET MANAGEMENT ==========

    /**
     * @notice Register a multi-signature wallet
     * @param wallet The wallet address
     * @param requiredSignatures Number of required signatures
     * @param signers Array of authorized signers
     */
    function registerMultiSigWallet(
        address wallet,
        uint256 requiredSignatures,
        address[] calldata signers
    ) external validAddress(wallet) {
        if (signers.length == 0 || signers.length > MAX_SIGNERS_PER_MULTISIG) revert TooManySigners();
        if (requiredSignatures == 0 || requiredSignatures > signers.length) revert InsufficientSignatures();
        
        MultiSigWallet storage msWallet = multiSigWallets[wallet];
        msWallet.isActive = true;
        msWallet.requiredSignatures = requiredSignatures;
        msWallet.totalSigners = signers.length;
        
        // Clear existing signers and add new ones
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == address(0)) revert ZeroAddress();
            msWallet.signers.add(signers[i]);
        }
        
        isMultiSigWallet[wallet] = true;
        
        emit MultiSigWalletRegistered(wallet, requiredSignatures, signers);
    }

    /**
     * @notice Update multi-signature wallet configuration
     * @param wallet The wallet address
     * @param requiredSignatures New required signatures count
     * @param signersToAdd Signers to add
     * @param signersToRemove Signers to remove
     */
    function updateMultiSigWallet(
        address wallet,
        uint256 requiredSignatures,
        address[] calldata signersToAdd,
        address[] calldata signersToRemove
    ) external onlyRole(OPERATOR_ROLE) {
        if (!isMultiSigWallet[wallet]) revert InvalidMultiSigWallet();
        
        MultiSigWallet storage msWallet = multiSigWallets[wallet];
        
        // Remove signers
        for (uint256 i = 0; i < signersToRemove.length; i++) {
            msWallet.signers.remove(signersToRemove[i]);
        }
        
        // Add signers
        for (uint256 i = 0; i < signersToAdd.length; i++) {
            if (signersToAdd[i] == address(0)) revert ZeroAddress();
            msWallet.signers.add(signersToAdd[i]);
        }
        
        uint256 totalSigners = msWallet.signers.length();
        if (totalSigners > MAX_SIGNERS_PER_MULTISIG) revert TooManySigners();
        if (requiredSignatures > totalSigners) revert InsufficientSignatures();
        
        msWallet.requiredSignatures = requiredSignatures;
        msWallet.totalSigners = totalSigners;
    }

    // ========== HARDWARE WALLET MANAGEMENT ==========

    /**
     * @notice Register a hardware wallet
     * @param walletAddress The wallet address
     * @param deviceType Type of device ("ledger", "trezor", etc.)
     * @param deviceId Unique device identifier
     * @param requiresExtendedDeadline Whether device needs extended deadline
     */
    function registerHardwareWallet(
        address walletAddress,
        string calldata deviceType,
        bytes32 deviceId,
        bool requiresExtendedDeadline
    ) external validAddress(walletAddress) {
        if (deviceIdToAddress[deviceId] != address(0)) revert InvalidSignature();
        
        hardwareWallets[walletAddress] = HardwareWalletConfig({
            isRegistered: true,
            deviceType: deviceType,
            deviceId: deviceId,
            owner: msg.sender,
            registrationTime: block.timestamp,
            requiresExtendedDeadline: requiresExtendedDeadline
        });
        
        deviceIdToAddress[deviceId] = walletAddress;
        
        emit HardwareWalletRegistered(walletAddress, deviceType, deviceId);
    }

    // ========== DELEGATION SYSTEM ==========

    /**
     * @notice Grant delegation to another address
     * @param delegate The address to delegate to
     * @param deadline Delegation expiry time
     * @param signature EIP-712 signature authorizing delegation
     */
    function grantDelegation(
        address delegate,
        uint256 deadline,
        bytes calldata signature
    ) external validAddress(delegate) notExpired(deadline) {
        bytes32 structHash = keccak256(abi.encode(
            AUTHORIZATION_TYPEHASH,
            msg.sender,
            delegate,
            deadline,
            nonces[msg.sender]++,
            block.chainid
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        
        if (signer != msg.sender) revert InvalidSignature();
        
        delegationDeadlines[msg.sender][delegate] = deadline;
        delegatedTo[msg.sender].add(delegate);
        
        emit DelegationGranted(msg.sender, delegate, deadline);
    }

    /**
     * @notice Revoke delegation from an address
     * @param delegate The address to revoke delegation from
     */
    function revokeDelegation(address delegate) external {
        delegationDeadlines[msg.sender][delegate] = 0;
        delegatedTo[msg.sender].remove(delegate);
        
        emit DelegationRevoked(msg.sender, delegate);
    }

    // ========== SIGNATURE REVOCATION ==========

    /**
     * @notice Revoke a signature
     * @param signatureHash The hash of the signature to revoke
     * @param deadline Revocation deadline
     * @param signature Authorization signature for revocation
     */
    function revokeSignature(
        bytes32 signatureHash,
        uint256 deadline,
        bytes calldata signature
    ) external notExpired(deadline) {
        bytes32 structHash = keccak256(abi.encode(
            REVOCATION_TYPEHASH,
            signatureHash,
            deadline,
            nonces[msg.sender]++,
            block.chainid
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = digest.recover(signature);
        
        if (signer != msg.sender) revert InvalidSignature();
        
        revokedSignatures[signatureHash] = true;
        
        // Remove from cache if present
        delete signatureCache[signatureHash];
        
        emit SignatureRevoked(signatureHash, msg.sender, block.timestamp);
    }

    // ========== SIGNATURE CACHING ==========

    /**
     * @notice Update signature cache settings
     * @param enabled Whether caching is enabled
     * @param ttl Default TTL for cached signatures
     */
    function updateCacheSettings(bool enabled, uint256 ttl) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        if (ttl > MAX_SIGNATURE_TTL) revert InvalidTTL();
        
        cacheEnabled = enabled;
        defaultSignatureTTL = ttl;
    }

    /**
     * @notice Clear expired signatures from cache
     * @param signatureHashes Array of signature hashes to check and clear
     */
    function clearExpiredCache(bytes32[] calldata signatureHashes) 
        external 
        onlyRole(VERIFIER_ROLE) 
    {
        for (uint256 i = 0; i < signatureHashes.length; i++) {
            SignatureCache storage cache = signatureCache[signatureHashes[i]];
            if (cache.expiryTime != 0 && block.timestamp > cache.expiryTime) {
                delete signatureCache[signatureHashes[i]];
            }
        }
    }

    // ========== CROSS-CHAIN MANAGEMENT ==========

    /**
     * @notice Add support for a new chain
     * @param chainId The chain ID to support
     * @param verifierContract Address of verifier contract on that chain
     */
    function addSupportedChain(uint256 chainId, address verifierContract) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        supportedChains[chainId] = true;
        chainVerifiers[chainId] = verifierContract;
    }

    /**
     * @notice Remove support for a chain
     * @param chainId The chain ID to remove
     */
    function removeSupportedChain(uint256 chainId) 
        external 
        onlyRole(OPERATOR_ROLE) 
    {
        supportedChains[chainId] = false;
        delete chainVerifiers[chainId];
    }

    // ========== INTERNAL FUNCTIONS ==========

    function _verifyHardwareWalletSignature(
        address wallet,
        bytes32 digest,
        bytes calldata signature
    ) private view returns (address) {
        HardwareWalletConfig storage hwConfig = hardwareWallets[wallet];
        if (!hwConfig.isRegistered) revert HardwareWalletNotRegistered();
        
        // Hardware wallets may have different signature formats
        // This is a simplified implementation
        return digest.recover(signature);
    }

    function _verifyMultiSigSignatures(
        MultiSigOrder calldata order,
        bytes32 orderHash,
        MultiSigWallet storage wallet
    ) private returns (uint256 validSignatures) {
        if (order.signatures.length != order.signers.length) revert InvalidSignature();
        
        validSignatures = 0;
        
        for (uint256 i = 0; i < order.signatures.length; i++) {
            address signer = orderHash.recover(order.signatures[i]);
            
            // Check if signer is authorized and hasn't already signed
            if (wallet.signers.contains(signer) && !wallet.hasSignedOrder[orderHash][signer]) {
                wallet.hasSignedOrder[orderHash][signer] = true;
                validSignatures++;
            }
        }
        
        return validSignatures;
    }

    function _isAuthorizedSigner(address owner, address signer) private view returns (bool) {
        // Owner can always sign
        if (owner == signer) return true;
        
        // Check delegation
        if (delegationDeadlines[owner][signer] > block.timestamp) return true;
        
        // Check if it's a hardware wallet
        if (hardwareWallets[owner].isRegistered && hardwareWallets[owner].owner == signer) {
            return true;
        }
        
        return false;
    }

    function _checkSignatureStatus(bytes32 signatureHash) private view {
        if (usedSignatures[signatureHash]) revert SignatureAlreadyUsed();
        if (revokedSignatures[signatureHash]) revert SignatureRevoked();
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
            expiryTime: block.timestamp + defaultSignatureTTL,
            isValid: true,
            sigType: sigType
        });
        
        emit SignatureCacheUpdated(signatureHash, true, block.timestamp + defaultSignatureTTL);
    }

    // ========== VIEW FUNCTIONS ==========

    function getMultiSigWalletInfo(address wallet) 
        external 
        view 
        returns (
            bool isActive,
            uint256 requiredSignatures,
            uint256 totalSigners,
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

    function getHardwareWalletInfo(address wallet) 
        external 
        view 
        returns (HardwareWalletConfig memory) 
    {
        return hardwareWallets[wallet];
    }

    function getDelegatedAddresses(address owner) 
        external 
        view 
        returns (address[] memory) 
    {
        return delegatedTo[owner].values();
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

    // ========== ADMIN FUNCTIONS ==========

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function emergencyRevokeSignature(bytes32 signatureHash) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        revokedSignatures[signatureHash] = true;
        delete signatureCache[signatureHash];
        emit SignatureRevoked(signatureHash, msg.sender, block.timestamp);
    }
}