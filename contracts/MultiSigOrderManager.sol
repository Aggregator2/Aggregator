// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@gnosis.pm/safe-contracts/contracts/interfaces/ISignatureValidator.sol";

/**
 * @title MultiSigOrderManager
 * @notice Manages multi-signature orders with threshold signatures and time-locks
 * @dev Supports various signature schemes including hardware wallets and Gnosis Safe
 */
contract MultiSigOrderManager is ReentrancyGuard, AccessControl, ISignatureValidator {
    using ECDSA for bytes32;
    using EnumerableSet for EnumerableSet.AddressSet;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes4 public constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
    
    // Order status
    enum OrderStatus {
        Pending,
        PartiallyApproved,
        Approved,
        Executed,
        Cancelled,
        Expired
    }
    
    // Multi-sig schemes
    enum SignatureScheme {
        EOA,           // Externally Owned Account
        EIP1271,       // Smart contract wallet
        Threshold,     // M-of-N threshold
        TimeLocked,    // Time-locked with multi-sig
        GnosisSafe     // Gnosis Safe integration
    }
    
    struct MultiSigOrder {
        bytes32 orderHash;
        address initiator;
        uint256 value;
        uint256 requiredSignatures;
        uint256 expirationTime;
        uint256 timeLock;
        SignatureScheme scheme;
        OrderStatus status;
        mapping(address => bool) hasSigned;
        EnumerableSet.AddressSet signers;
        bytes orderData;
    }
    
    struct SignerConfig {
        bool isActive;
        uint256 weight;
        uint256 nonce;
        bytes publicKey; // For hardware wallet verification
    }
    
    struct ThresholdConfig {
        uint256 threshold;
        uint256 totalWeight;
        EnumerableSet.AddressSet members;
        mapping(address => uint256) weights;
    }
    
    // State variables
    mapping(bytes32 => MultiSigOrder) public orders;
    mapping(address => mapping(address => SignerConfig)) public signerConfigs;
    mapping(address => ThresholdConfig) private thresholdConfigs;
    mapping(address => bool) public hardwareWallets;
    mapping(address => address) public gnosisSafeProxies;
    
    uint256 public orderCounter;
    uint256 public constant MAX_SIGNERS = 20;
    uint256 public constant MIN_TIME_LOCK = 1 hours;
    uint256 public constant MAX_TIME_LOCK = 30 days;
    
    // Events
    event OrderCreated(
        bytes32 indexed orderId,
        address indexed initiator,
        uint256 requiredSignatures,
        SignatureScheme scheme
    );
    
    event OrderSigned(
        bytes32 indexed orderId,
        address indexed signer,
        uint256 currentSignatures,
        uint256 requiredSignatures
    );
    
    event OrderApproved(bytes32 indexed orderId, uint256 totalSignatures);
    event OrderExecuted(bytes32 indexed orderId, address indexed executor);
    event OrderCancelled(bytes32 indexed orderId, address indexed canceller);
    
    event ThresholdConfigured(
        address indexed account,
        uint256 threshold,
        uint256 totalMembers
    );
    
    event HardwareWalletRegistered(address indexed wallet, bytes publicKey);
    event GnosisSafeLinked(address indexed user, address indexed safeProxy);
    
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }
    
    /**
     * @notice Create a new multi-signature order
     * @param orderData The order data to be signed
     * @param requiredSigs Number of required signatures
     * @param signers Array of authorized signers
     * @param scheme Signature scheme to use
     * @param timeLock Optional time-lock period
     */
    function createMultiSigOrder(
        bytes calldata orderData,
        uint256 requiredSigs,
        address[] calldata signers,
        SignatureScheme scheme,
        uint256 timeLock
    ) external returns (bytes32 orderId) {
        require(signers.length > 0 && signers.length <= MAX_SIGNERS, "Invalid signers count");
        require(requiredSigs > 0 && requiredSigs <= signers.length, "Invalid threshold");
        require(timeLock == 0 || (timeLock >= MIN_TIME_LOCK && timeLock <= MAX_TIME_LOCK), "Invalid timelock");
        
        orderId = keccak256(
            abi.encodePacked(
                msg.sender,
                orderCounter++,
                orderData,
                block.timestamp
            )
        );
        
        MultiSigOrder storage order = orders[orderId];
        order.orderHash = keccak256(orderData);
        order.initiator = msg.sender;
        order.requiredSignatures = requiredSigs;
        order.expirationTime = block.timestamp + 7 days; // Default expiration
        order.timeLock = timeLock;
        order.scheme = scheme;
        order.status = OrderStatus.Pending;
        order.orderData = orderData;
        
        // Add authorized signers
        for (uint256 i = 0; i < signers.length; i++) {
            require(signers[i] != address(0), "Invalid signer");
            order.signers.add(signers[i]);
        }
        
        emit OrderCreated(orderId, msg.sender, requiredSigs, scheme);
    }
    
    /**
     * @notice Sign a multi-signature order
     * @param orderId The order ID to sign
     * @param signature The signature data
     */
    function signOrder(bytes32 orderId, bytes calldata signature) external {
        MultiSigOrder storage order = orders[orderId];
        require(order.status == OrderStatus.Pending || order.status == OrderStatus.PartiallyApproved, "Invalid order status");
        require(block.timestamp < order.expirationTime, "Order expired");
        require(order.signers.contains(msg.sender), "Not authorized signer");
        require(!order.hasSigned[msg.sender], "Already signed");
        
        // Verify signature based on scheme
        bool isValid = _verifySignature(order, msg.sender, signature);
        require(isValid, "Invalid signature");
        
        order.hasSigned[msg.sender] = true;
        uint256 signatureCount = _countSignatures(orderId);
        
        if (signatureCount >= order.requiredSignatures) {
            order.status = OrderStatus.Approved;
            emit OrderApproved(orderId, signatureCount);
            
            // If time-locked, set the unlock time
            if (order.timeLock > 0) {
                order.expirationTime = block.timestamp + order.timeLock;
            }
        } else {
            order.status = OrderStatus.PartiallyApproved;
        }
        
        emit OrderSigned(orderId, msg.sender, signatureCount, order.requiredSignatures);
    }
    
    /**
     * @notice Sign order with hardware wallet
     * @param orderId The order ID
     * @param v ECDSA signature v
     * @param r ECDSA signature r
     * @param s ECDSA signature s
     * @param derivationPath Hardware wallet derivation path
     */
    function signWithHardwareWallet(
        bytes32 orderId,
        uint8 v,
        bytes32 r,
        bytes32 s,
        string calldata derivationPath
    ) external {
        MultiSigOrder storage order = orders[orderId];
        require(order.status == OrderStatus.Pending || order.status == OrderStatus.PartiallyApproved, "Invalid status");
        require(hardwareWallets[msg.sender], "Not registered hardware wallet");
        
        // Verify hardware wallet signature
        bytes32 messageHash = _getMessageHash(order.orderHash, derivationPath);
        address signer = ecrecover(messageHash, v, r, s);
        require(signer == msg.sender, "Invalid hardware signature");
        
        order.hasSigned[msg.sender] = true;
        _updateOrderStatus(orderId);
    }
    
    /**
     * @notice Execute an approved order
     * @param orderId The order ID to execute
     */
    function executeOrder(bytes32 orderId) external nonReentrant {
        MultiSigOrder storage order = orders[orderId];
        require(order.status == OrderStatus.Approved, "Order not approved");
        
        // Check time-lock if applicable
        if (order.timeLock > 0) {
            require(block.timestamp >= order.expirationTime - 7 days + order.timeLock, "Still in timelock");
        }
        
        order.status = OrderStatus.Executed;
        
        // Execute the order (this would integrate with your order execution logic)
        _executeOrderData(order.orderData);
        
        emit OrderExecuted(orderId, msg.sender);
    }
    
    /**
     * @notice Configure threshold signature requirements
     * @param threshold Required weight for approval
     * @param members Array of member addresses
     * @param weights Array of member weights
     */
    function configureThreshold(
        uint256 threshold,
        address[] calldata members,
        uint256[] calldata weights
    ) external {
        require(members.length == weights.length, "Length mismatch");
        require(members.length <= MAX_SIGNERS, "Too many members");
        
        ThresholdConfig storage config = thresholdConfigs[msg.sender];
        config.threshold = threshold;
        config.totalWeight = 0;
        
        // Clear existing members
        uint256 currentLength = config.members.length();
        for (uint256 i = 0; i < currentLength; i++) {
            config.members.remove(config.members.at(0));
        }
        
        // Add new members
        for (uint256 i = 0; i < members.length; i++) {
            require(members[i] != address(0), "Invalid member");
            require(weights[i] > 0, "Invalid weight");
            
            config.members.add(members[i]);
            config.weights[members[i]] = weights[i];
            config.totalWeight += weights[i];
        }
        
        require(config.threshold <= config.totalWeight, "Invalid threshold");
        
        emit ThresholdConfigured(msg.sender, threshold, members.length);
    }
    
    /**
     * @notice Register a hardware wallet
     * @param wallet The wallet address
     * @param publicKey The wallet's public key
     */
    function registerHardwareWallet(
        address wallet,
        bytes calldata publicKey
    ) external onlyRole(OPERATOR_ROLE) {
        require(wallet != address(0), "Invalid wallet");
        require(publicKey.length > 0, "Invalid public key");
        
        hardwareWallets[wallet] = true;
        signerConfigs[wallet][wallet].publicKey = publicKey;
        
        emit HardwareWalletRegistered(wallet, publicKey);
    }
    
    /**
     * @notice Link a Gnosis Safe proxy
     * @param safeProxy The Gnosis Safe proxy address
     */
    function linkGnosisSafe(address safeProxy) external {
        require(safeProxy != address(0), "Invalid safe proxy");
        
        // Verify it's a valid Gnosis Safe
        (bool success, bytes memory data) = safeProxy.staticcall(
            abi.encodeWithSignature("getThreshold()")
        );
        require(success && data.length > 0, "Not a valid Gnosis Safe");
        
        gnosisSafeProxies[msg.sender] = safeProxy;
        
        emit GnosisSafeLinked(msg.sender, safeProxy);
    }
    
    /**
     * @notice Cancel a pending order
     * @param orderId The order ID to cancel
     */
    function cancelOrder(bytes32 orderId) external {
        MultiSigOrder storage order = orders[orderId];
        require(
            order.status == OrderStatus.Pending || 
            order.status == OrderStatus.PartiallyApproved,
            "Cannot cancel"
        );
        require(
            msg.sender == order.initiator || 
            hasRole(OPERATOR_ROLE, msg.sender),
            "Not authorized"
        );
        
        order.status = OrderStatus.Cancelled;
        emit OrderCancelled(orderId, msg.sender);
    }
    
    /**
     * @notice Verify signature based on scheme
     */
    function _verifySignature(
        MultiSigOrder storage order,
        address signer,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 messageHash = order.orderHash;
        
        if (order.scheme == SignatureScheme.EOA) {
            return _verifyEOASignature(messageHash, signer, signature);
        } else if (order.scheme == SignatureScheme.EIP1271) {
            return _verifyEIP1271Signature(messageHash, signer, signature);
        } else if (order.scheme == SignatureScheme.GnosisSafe) {
            return _verifyGnosisSafeSignature(messageHash, signer, signature);
        } else if (order.scheme == SignatureScheme.Threshold) {
            return _verifyThresholdSignature(messageHash, signer, signature);
        }
        
        return false;
    }
    
    /**
     * @notice Verify EOA signature
     */
    function _verifyEOASignature(
        bytes32 messageHash,
        address signer,
        bytes calldata signature
    ) internal pure returns (bool) {
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recovered = ethSignedHash.recover(signature);
        return recovered == signer;
    }
    
    /**
     * @notice Verify EIP-1271 signature
     */
    function _verifyEIP1271Signature(
        bytes32 messageHash,
        address signer,
        bytes calldata signature
    ) internal view returns (bool) {
        (bool success, bytes memory result) = signer.staticcall(
            abi.encodeWithSelector(
                ISignatureValidator.isValidSignature.selector,
                messageHash,
                signature
            )
        );
        
        return success && result.length == 32 && abi.decode(result, (bytes4)) == EIP1271_MAGIC_VALUE;
    }
    
    /**
     * @notice Verify Gnosis Safe signature
     */
    function _verifyGnosisSafeSignature(
        bytes32 messageHash,
        address signer,
        bytes calldata signature
    ) internal view returns (bool) {
        address safeProxy = gnosisSafeProxies[signer];
        if (safeProxy == address(0)) return false;
        
        return _verifyEIP1271Signature(messageHash, safeProxy, signature);
    }
    
    /**
     * @notice Verify threshold signature
     */
    function _verifyThresholdSignature(
        bytes32 messageHash,
        address signer,
        bytes calldata signature
    ) internal view returns (bool) {
        ThresholdConfig storage config = thresholdConfigs[signer];
        require(config.members.contains(signer), "Not a member");
        
        // For threshold, we use standard EOA verification
        return _verifyEOASignature(messageHash, signer, signature);
    }
    
    /**
     * @notice Count valid signatures for an order
     */
    function _countSignatures(bytes32 orderId) internal view returns (uint256) {
        MultiSigOrder storage order = orders[orderId];
        uint256 count = 0;
        
        uint256 signersLength = order.signers.length();
        for (uint256 i = 0; i < signersLength; i++) {
            address signer = order.signers.at(i);
            if (order.hasSigned[signer]) {
                count++;
            }
        }
        
        return count;
    }
    
    /**
     * @notice Update order status based on signatures
     */
    function _updateOrderStatus(bytes32 orderId) internal {
        MultiSigOrder storage order = orders[orderId];
        uint256 signatureCount = _countSignatures(orderId);
        
        if (signatureCount >= order.requiredSignatures) {
            order.status = OrderStatus.Approved;
            emit OrderApproved(orderId, signatureCount);
        }
    }
    
    /**
     * @notice Get message hash for hardware wallet
     */
    function _getMessageHash(
        bytes32 orderHash,
        string calldata derivationPath
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(orderHash, derivationPath));
    }
    
    /**
     * @notice Execute order data (placeholder)
     */
    function _executeOrderData(bytes memory /*orderData*/) internal {
        // This would integrate with your order execution system
        // For now, it's a placeholder
    }
    
    /**
     * @notice Check if order is approved
     */
    function isOrderApproved(bytes32 orderId) external view returns (bool) {
        return orders[orderId].status == OrderStatus.Approved;
    }
    
    /**
     * @notice Get order details
     */
    function getOrderDetails(bytes32 orderId) external view returns (
        address initiator,
        uint256 requiredSignatures,
        uint256 currentSignatures,
        OrderStatus status,
        uint256 expirationTime
    ) {
        MultiSigOrder storage order = orders[orderId];
        return (
            order.initiator,
            order.requiredSignatures,
            _countSignatures(orderId),
            order.status,
            order.expirationTime
        );
    }
    
    /**
     * @notice Get signers for an order
     */
    function getOrderSigners(bytes32 orderId) external view returns (address[] memory) {
        MultiSigOrder storage order = orders[orderId];
        uint256 length = order.signers.length();
        address[] memory signers = new address[](length);
        
        for (uint256 i = 0; i < length; i++) {
            signers[i] = order.signers.at(i);
        }
        
        return signers;
    }
    
    /**
     * @notice EIP-1271 signature validation
     */
    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) external view override returns (bytes4) {
        // Implementation for smart contract wallet validation
        if (_verifyEOASignature(_hash, msg.sender, _signature)) {
            return EIP1271_MAGIC_VALUE;
        }
        return bytes4(0);
    }
}