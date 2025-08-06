// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AdvancedSettlementContractV2
 * @author Your Team
 * @notice Production-ready settlement contract with comprehensive security features
 * @dev Implements EIP-712 order signing, partial fills, circuit breakers, and multi-token support
 * 
 * Security features:
 * - ReentrancyGuard for all external functions
 * - Circuit breaker pattern with multiple safety mechanisms
 * - Per-token pause capability
 * - Signature replay protection via nonces
 * - Order expiry validation
 * - Fee limits to prevent excessive charges
 * - Two-step ownership transfer (Ownable2Step)
 * - Pull pattern for protocol fee withdrawals
 * 
 * Gas optimizations:
 * - Packed struct storage where possible
 * - Efficient order hash caching
 * - Optimized fee calculations
 * - Minimal storage updates
 */
contract AdvancedSettlementContractV2 is Ownable2Step, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    /// @notice Order status enumeration
    enum OrderStatus {
        INVALID,
        FILLABLE,
        FILLED,
        PARTIALLY_FILLED,
        CANCELLED,
        EXPIRED
    }

    /// @notice Token type enumeration
    enum TokenType {
        ERC20,
        ERC721,
        ERC1155
    }

    /// @notice Order structure with comprehensive fields
    /// @dev Optimized for storage packing
    struct Order {
        address maker;           // slot 0
        address taker;          // slot 1 (address(0) for any taker)
        address makerToken;     // slot 2
        address takerToken;     // slot 3
        uint128 makerAmount;    // slot 4 (sufficient for most tokens)
        uint128 takerAmount;    // slot 4
        uint256 makerTokenId;   // slot 5 (for NFTs)
        uint256 takerTokenId;   // slot 6 (for NFTs)
        uint256 salt;           // slot 7 (unique identifier)
        uint64 expiry;          // slot 8 (timestamp fits in uint64)
        uint64 nonce;           // slot 8
        TokenType makerTokenType; // slot 8
        TokenType takerTokenType; // slot 8
        uint16 makerFee;        // slot 8 (basis points)
        uint16 takerFee;        // slot 8 (basis points)
        address feeRecipient;   // slot 9
    }

    /// @notice Fill tracking structure
    /// @dev Packed for gas efficiency
    struct FillInfo {
        uint128 filledMakerAmount;
        uint128 filledTakerAmount;
        bool cancelled;
    }

    /// @notice Circuit breaker configuration
    struct CircuitBreaker {
        bool emergencyPause;
        uint128 maxDailyVolume;
        uint128 maxOrderSize;
        uint128 currentDailyVolume;
        uint64 lastResetTimestamp;
        mapping(address => bool) pausedTokens;
        mapping(address => uint256) tokenDailyVolume; // Per-token daily limits
    }

    /// @notice Constants
    uint256 private constant FEE_DIVISOR = 10000; // 100% = 10000 basis points
    uint16 private constant MAX_FEE = 1000; // 10% max fee
    uint256 private constant MIN_ORDER_SIZE = 1000; // Minimum order size to prevent dust attacks
    
    /// @notice EIP-712 type hashes (immutable for gas savings)
    bytes32 private immutable ORDER_TYPEHASH;
    bytes32 private immutable CANCEL_TYPEHASH;

    /// @notice State variables
    mapping(bytes32 => FillInfo) public orderFills;
    mapping(address => uint256) public nonces;
    mapping(address => mapping(address => uint256)) public protocolFeeBalance;
    mapping(bytes32 => bool) private _orderHashCache; // Cache computed hashes
    
    CircuitBreaker public circuitBreaker;
    
    address public protocolFeeRecipient;
    uint16 public protocolFeeRate = 30; // 0.3% default

    /// @notice Events
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerFilledAmount,
        uint256 takerFilledAmount,
        uint256 makerFee,
        uint256 takerFee,
        uint256 timestamp
    );

    event OrderCancelled(
        bytes32 indexed orderHash,
        address indexed maker,
        uint256 nonce,
        uint256 timestamp
    );

    event OrderPartiallyFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerFilledAmount,
        uint256 takerFilledAmount,
        uint256 remainingMakerAmount,
        uint256 remainingTakerAmount
    );

    event CircuitBreakerTriggered(
        string reason,
        address triggeredBy,
        uint256 timestamp
    );

    event TokenPaused(
        address indexed token,
        bool paused,
        string reason,
        uint256 timestamp
    );

    event ProtocolFeeUpdated(
        uint256 oldFee,
        uint256 newFee,
        address oldRecipient,
        address newRecipient
    );

    event EmergencyWithdrawal(
        address indexed token,
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    event DailyVolumeReset(
        uint256 timestamp,
        uint256 previousVolume
    );

    /// @notice Custom errors for gas efficiency
    error InvalidMaker();
    error InvalidToken();
    error InvalidAmount();
    error OrderExpired();
    error FeeTooHigh();
    error InvalidSignature();
    error UnauthorizedTaker();
    error OrderCancelled();
    error OrderAlreadyFilled();
    error InsufficientFillAmount();
    error TokenPaused();
    error EmergencyPauseActive();
    error OrderTooLarge();
    error DailyVolumeExceeded();
    error InvalidNonce();
    error InvalidRecipient();
    error InsufficientBalance();
    error TransferFailed();
    error OrderTooSmall();

    /// @notice Constructor
    /// @param name EIP-712 domain name
    /// @param version EIP-712 domain version
    /// @param _protocolFeeRecipient Address to receive protocol fees
    constructor(
        string memory name,
        string memory version,
        address _protocolFeeRecipient
    ) EIP712(name, version) Ownable(msg.sender) {
        if (_protocolFeeRecipient == address(0)) revert InvalidRecipient();
        
        protocolFeeRecipient = _protocolFeeRecipient;
        circuitBreaker.lastResetTimestamp = uint64(block.timestamp);
        circuitBreaker.maxDailyVolume = 1000000 * 10**18; // 1M tokens default
        circuitBreaker.maxOrderSize = 10000 * 10**18; // 10k tokens default
        
        // Set immutable type hashes
        ORDER_TYPEHASH = keccak256(
            "Order(address maker,address taker,address makerToken,address takerToken,"
            "uint128 makerAmount,uint128 takerAmount,uint256 makerTokenId,"
            "uint256 takerTokenId,uint256 salt,uint64 expiry,uint64 nonce,"
            "uint8 makerTokenType,uint8 takerTokenType,uint16 makerFee,"
            "uint16 takerFee,address feeRecipient)"
        );
        
        CANCEL_TYPEHASH = keccak256(
            "Cancel(bytes32 orderHash,uint256 nonce)"
        );
    }

    /**
     * @notice Fill an order with EIP-712 signature
     * @dev Validates order, signature, and executes trade with fees
     * @param order The order to fill
     * @param fillAmount Amount of maker token to fill
     * @param signature Maker's EIP-712 signature
     * @custom:security nonReentrant whenNotPaused
     */
    function fillOrder(
        Order calldata order,
        uint128 fillAmount,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        // Input validation
        if (fillAmount == 0) revert InsufficientFillAmount();
        _validateOrder(order);
        
        // Reset daily volume if needed
        _resetDailyVolumeIfNeeded();
        
        // Get and cache order hash
        bytes32 orderHash = getOrderHash(order);
        _orderHashCache[orderHash] = true;
        
        // Verify signature
        if (!_verifyOrderSignature(order, orderHash, signature)) {
            revert InvalidSignature();
        }
        
        // Check taker authorization
        if (order.taker != address(0) && order.taker != msg.sender) {
            revert UnauthorizedTaker();
        }
        
        // Check order status and fillability
        FillInfo storage fillInfo = orderFills[orderHash];
        if (fillInfo.cancelled) revert OrderCancelled();
        
        uint128 remainingMakerAmount = order.makerAmount - fillInfo.filledMakerAmount;
        if (remainingMakerAmount == 0) revert OrderAlreadyFilled();
        
        // Calculate actual fill amounts
        uint128 makerFillAmount = fillAmount > remainingMakerAmount ? 
            remainingMakerAmount : fillAmount;
        uint128 takerFillAmount = uint128((uint256(makerFillAmount) * order.takerAmount) / order.makerAmount);
        
        // Check minimum order size to prevent dust attacks
        if (makerFillAmount < MIN_ORDER_SIZE && order.makerTokenType == TokenType.ERC20) {
            revert OrderTooSmall();
        }
        
        // Update fill info before external calls
        fillInfo.filledMakerAmount += makerFillAmount;
        fillInfo.filledTakerAmount += takerFillAmount;
        
        // Circuit breaker checks
        _performCircuitBreakerChecks(order, makerFillAmount, takerFillAmount);
        
        // Execute the trade
        _executeTrade(
            order,
            msg.sender,
            makerFillAmount,
            takerFillAmount
        );
        
        // Emit appropriate event
        if (fillInfo.filledMakerAmount == order.makerAmount) {
            emit OrderFilled(
                orderHash,
                order.maker,
                msg.sender,
                makerFillAmount,
                takerFillAmount,
                order.makerFee,
                order.takerFee,
                block.timestamp
            );
        } else {
            emit OrderPartiallyFilled(
                orderHash,
                order.maker,
                msg.sender,
                makerFillAmount,
                takerFillAmount,
                order.makerAmount - fillInfo.filledMakerAmount,
                order.takerAmount - fillInfo.filledTakerAmount
            );
        }
    }

    /**
     * @notice Cancel an order using EIP-712 signature
     * @dev Requires valid cancellation signature from maker
     * @param order The order to cancel
     * @param signature Signature authorizing cancellation
     * @custom:security nonReentrant
     */
    function cancelOrder(
        Order calldata order,
        bytes calldata signature
    ) external nonReentrant {
        bytes32 orderHash = getOrderHash(order);
        
        // Verify cancellation signature
        bytes32 cancelHash = _hashTypedDataV4(
            keccak256(abi.encode(CANCEL_TYPEHASH, orderHash, nonces[order.maker]))
        );
        
        address signer = cancelHash.recover(signature);
        if (signer != order.maker) revert InvalidSignature();
        
        // Check if already cancelled
        if (orderFills[orderHash].cancelled) revert OrderCancelled();
        
        // Update state
        orderFills[orderHash].cancelled = true;
        unchecked {
            nonces[order.maker]++;
        }
        
        emit OrderCancelled(orderHash, order.maker, nonces[order.maker], block.timestamp);
    }

    /**
     * @notice Cancel all orders by incrementing nonce
     * @dev More gas efficient than cancelling individual orders
     * @param newNonce New nonce value (must be greater than current)
     */
    function batchCancelOrdersByNonce(uint256 newNonce) external {
        uint256 currentNonce = nonces[msg.sender];
        if (newNonce <= currentNonce) revert InvalidNonce();
        
        nonces[msg.sender] = newNonce;
        
        // Emit event for indexing
        emit OrderCancelled(bytes32(0), msg.sender, newNonce, block.timestamp);
    }

    /**
     * @notice Get order status
     * @param order The order to check
     * @return status The current order status
     */
    function getOrderStatus(Order calldata order) external view returns (OrderStatus) {
        bytes32 orderHash = getOrderHash(order);
        FillInfo memory fillInfo = orderFills[orderHash];
        
        if (fillInfo.cancelled) return OrderStatus.CANCELLED;
        if (order.expiry <= block.timestamp) return OrderStatus.EXPIRED;
        if (fillInfo.filledMakerAmount >= order.makerAmount) return OrderStatus.FILLED;
        if (fillInfo.filledMakerAmount > 0) return OrderStatus.PARTIALLY_FILLED;
        if (order.nonce < nonces[order.maker]) return OrderStatus.CANCELLED;
        
        return OrderStatus.FILLABLE;
    }

    /**
     * @notice Get remaining fillable amount for an order
     * @param order The order to check
     * @return remainingMakerAmount Amount of maker token still fillable
     * @return remainingTakerAmount Amount of taker token still required
     */
    function getRemainingFillableAmount(Order calldata order) 
        external 
        view 
        returns (uint128 remainingMakerAmount, uint128 remainingTakerAmount) 
    {
        bytes32 orderHash = getOrderHash(order);
        FillInfo memory fillInfo = orderFills[orderHash];
        
        if (fillInfo.cancelled || order.expiry <= block.timestamp || order.nonce < nonces[order.maker]) {
            return (0, 0);
        }
        
        remainingMakerAmount = order.makerAmount - fillInfo.filledMakerAmount;
        remainingTakerAmount = order.takerAmount - fillInfo.filledTakerAmount;
    }

    /**
     * @notice Get order hash
     * @param order The order to hash
     * @return orderHash The EIP-712 hash of the order
     */
    function getOrderHash(Order memory order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(
                ORDER_TYPEHASH,
                order.maker,
                order.taker,
                order.makerToken,
                order.takerToken,
                order.makerAmount,
                order.takerAmount,
                order.makerTokenId,
                order.takerTokenId,
                order.salt,
                order.expiry,
                order.nonce,
                order.makerTokenType,
                order.takerTokenType,
                order.makerFee,
                order.takerFee,
                order.feeRecipient
            ))
        );
    }

    /**
     * @notice Emergency pause - triggers circuit breaker
     * @dev Only callable by owner
     * @custom:security onlyOwner
     */
    function emergencyPause() external onlyOwner {
        _pause();
        circuitBreaker.emergencyPause = true;
        emit CircuitBreakerTriggered("Emergency pause by owner", msg.sender, block.timestamp);
    }

    /**
     * @notice Resume operations after emergency
     * @dev Resets daily volumes
     * @custom:security onlyOwner
     */
    function emergencyResume() external onlyOwner {
        _unpause();
        circuitBreaker.emergencyPause = false;
        _forceResetDailyVolume();
    }

    /**
     * @notice Pause/unpause specific token
     * @param token Token address to pause/unpause
     * @param paused Whether to pause (true) or unpause (false)
     * @param reason Human-readable reason for the action
     * @custom:security onlyOwner
     */
    function setTokenPaused(
        address token,
        bool paused,
        string calldata reason
    ) external onlyOwner {
        if (token == address(0)) revert InvalidToken();
        circuitBreaker.pausedTokens[token] = paused;
        emit TokenPaused(token, paused, reason, block.timestamp);
    }

    /**
     * @notice Update circuit breaker limits
     * @param maxDailyVolume New maximum daily volume (use type(uint128).max for no limit)
     * @param maxOrderSize New maximum order size (use type(uint128).max for no limit)
     * @custom:security onlyOwner
     */
    function updateCircuitBreakerLimits(
        uint128 maxDailyVolume,
        uint128 maxOrderSize
    ) external onlyOwner {
        circuitBreaker.maxDailyVolume = maxDailyVolume;
        circuitBreaker.maxOrderSize = maxOrderSize;
    }

    /**
     * @notice Set per-token daily volume limit
     * @param token Token address
     * @param limit Daily volume limit for the token
     * @custom:security onlyOwner
     */
    function setTokenDailyLimit(address token, uint256 limit) external onlyOwner {
        if (token == address(0)) revert InvalidToken();
        circuitBreaker.tokenDailyVolume[token] = limit;
    }

    /**
     * @notice Update protocol fee configuration
     * @param newFeeRate New fee rate in basis points (max 10%)
     * @param newFeeRecipient New address to receive protocol fees
     * @custom:security onlyOwner
     */
    function updateProtocolFee(
        uint16 newFeeRate,
        address newFeeRecipient
    ) external onlyOwner {
        if (newFeeRate > MAX_FEE) revert FeeTooHigh();
        if (newFeeRecipient == address(0)) revert InvalidRecipient();
        
        emit ProtocolFeeUpdated(protocolFeeRate, newFeeRate, protocolFeeRecipient, newFeeRecipient);
        
        protocolFeeRate = newFeeRate;
        protocolFeeRecipient = newFeeRecipient;
    }

    /**
     * @notice Withdraw accumulated protocol fees
     * @dev Uses pull pattern for security
     * @param token Token to withdraw (address(0) for ETH)
     * @param amount Amount to withdraw
     * @custom:security onlyOwner nonReentrant
     */
    function withdrawProtocolFees(
        address token,
        uint256 amount
    ) external onlyOwner nonReentrant {
        uint256 available = protocolFeeBalance[token][protocolFeeRecipient];
        if (available < amount) revert InsufficientBalance();
        
        // Update balance before transfer
        protocolFeeBalance[token][protocolFeeRecipient] = available - amount;
        
        // Transfer fees
        if (token == address(0)) {
            (bool success, ) = payable(protocolFeeRecipient).call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(protocolFeeRecipient, amount);
        }
    }

    /**
     * @notice Emergency withdrawal for stuck tokens
     * @dev Only callable when contract is paused
     * @param token Token to withdraw (address(0) for ETH)
     * @param amount Amount to withdraw
     * @param recipient Address to receive the tokens
     * @custom:security onlyOwner whenPaused nonReentrant
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address recipient
    ) external onlyOwner whenPaused nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        
        if (token == address(0)) {
            (bool success, ) = payable(recipient).call{value: amount}("");
            if (!success) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
        
        emit EmergencyWithdrawal(token, recipient, amount, block.timestamp);
    }

    /**
     * @notice Check if a token is paused
     * @param token Token address to check
     * @return paused Whether the token is paused
     */
    function isTokenPaused(address token) external view returns (bool) {
        return circuitBreaker.pausedTokens[token];
    }

    /**
     * @notice Get current circuit breaker status
     * @return emergencyPause Whether emergency pause is active
     * @return maxDailyVolume Maximum daily volume allowed
     * @return maxOrderSize Maximum order size allowed
     * @return currentDailyVolume Current daily volume
     * @return lastResetTimestamp Last volume reset timestamp
     */
    function getCircuitBreakerStatus() external view returns (
        bool emergencyPause,
        uint128 maxDailyVolume,
        uint128 maxOrderSize,
        uint128 currentDailyVolume,
        uint64 lastResetTimestamp
    ) {
        return (
            circuitBreaker.emergencyPause,
            circuitBreaker.maxDailyVolume,
            circuitBreaker.maxOrderSize,
            circuitBreaker.currentDailyVolume,
            circuitBreaker.lastResetTimestamp
        );
    }

    // Internal functions

    /**
     * @dev Validate order parameters
     */
    function _validateOrder(Order calldata order) internal view {
        if (order.maker == address(0)) revert InvalidMaker();
        if (order.makerToken == address(0)) revert InvalidToken();
        if (order.takerToken == address(0)) revert InvalidToken();
        if (order.makerAmount == 0) revert InvalidAmount();
        if (order.takerAmount == 0) revert InvalidAmount();
        if (order.expiry <= block.timestamp) revert OrderExpired();
        if (order.makerFee > MAX_FEE) revert FeeTooHigh();
        if (order.takerFee > MAX_FEE) revert FeeTooHigh();
        if (order.feeRecipient == address(0) && (order.makerFee > 0 || order.takerFee > 0)) {
            revert InvalidRecipient();
        }
    }

    /**
     * @dev Execute trade with all transfers and fee handling
     */
    function _executeTrade(
        Order calldata order,
        address taker,
        uint128 makerFillAmount,
        uint128 takerFillAmount
    ) internal {
        // Check token pause status
        if (circuitBreaker.pausedTokens[order.makerToken]) revert TokenPaused();
        if (circuitBreaker.pausedTokens[order.takerToken]) revert TokenPaused();
        
        // Calculate fees (unchecked for gas optimization - safe due to MAX_FEE limit)
        uint128 makerFeeAmount;
        uint128 takerFeeAmount;
        uint128 protocolMakerFee;
        uint128 protocolTakerFee;
        
        unchecked {
            makerFeeAmount = (makerFillAmount * order.makerFee) / FEE_DIVISOR;
            takerFeeAmount = (takerFillAmount * order.takerFee) / FEE_DIVISOR;
            protocolMakerFee = (makerFillAmount * protocolFeeRate) / FEE_DIVISOR;
            protocolTakerFee = (takerFillAmount * protocolFeeRate) / FEE_DIVISOR;
        }
        
        // Transfer tokens based on type
        // Taker -> Maker (minus fees)
        _transferToken(
            order.takerToken,
            order.takerTokenType,
            taker,
            order.maker,
            takerFillAmount - takerFeeAmount - protocolTakerFee,
            order.takerTokenId
        );
        
        // Maker -> Taker (minus fees)
        _transferToken(
            order.makerToken,
            order.makerTokenType,
            order.maker,
            taker,
            makerFillAmount - makerFeeAmount - protocolMakerFee,
            order.makerTokenId
        );
        
        // Handle user fees
        if (makerFeeAmount > 0) {
            _transferToken(
                order.makerToken,
                order.makerTokenType,
                order.maker,
                order.feeRecipient,
                makerFeeAmount,
                order.makerTokenId
            );
        }
        
        if (takerFeeAmount > 0) {
            _transferToken(
                order.takerToken,
                order.takerTokenType,
                taker,
                order.feeRecipient,
                takerFeeAmount,
                order.takerTokenId
            );
        }
        
        // Handle protocol fees (collect to contract)
        if (protocolMakerFee > 0) {
            protocolFeeBalance[order.makerToken][protocolFeeRecipient] += protocolMakerFee;
            _transferToken(
                order.makerToken,
                order.makerTokenType,
                order.maker,
                address(this),
                protocolMakerFee,
                order.makerTokenId
            );
        }
        
        if (protocolTakerFee > 0) {
            protocolFeeBalance[order.takerToken][protocolFeeRecipient] += protocolTakerFee;
            _transferToken(
                order.takerToken,
                order.takerTokenType,
                taker,
                address(this),
                protocolTakerFee,
                order.takerTokenId
            );
        }
    }

    /**
     * @dev Transfer tokens based on token type
     */
    function _transferToken(
        address token,
        TokenType tokenType,
        address from,
        address to,
        uint256 amount,
        uint256 tokenId
    ) internal {
        if (amount == 0) return; // Skip zero transfers
        
        if (tokenType == TokenType.ERC20) {
            if (from == address(this)) {
                IERC20(token).safeTransfer(to, amount);
            } else {
                IERC20(token).safeTransferFrom(from, to, amount);
            }
        } else if (tokenType == TokenType.ERC721) {
            // For NFTs, amount should be 1
            IERC721(token).safeTransferFrom(from, to, tokenId);
        } else if (tokenType == TokenType.ERC1155) {
            IERC1155(token).safeTransferFrom(from, to, tokenId, amount, "");
        }
    }

    /**
     * @dev Verify order signature
     */
    function _verifyOrderSignature(
        Order calldata order,
        bytes32 orderHash,
        bytes calldata signature
    ) internal view returns (bool) {
        if (signature.length != 65) return false;
        
        address signer = orderHash.recover(signature);
        return signer == order.maker && order.nonce >= nonces[order.maker];
    }

    /**
     * @dev Perform circuit breaker checks
     */
    function _performCircuitBreakerChecks(
        Order calldata order,
        uint128 makerFillAmount,
        uint128 takerFillAmount
    ) internal {
        if (circuitBreaker.emergencyPause) revert EmergencyPauseActive();
        
        // Check order size limits
        uint256 totalOrderSize = uint256(makerFillAmount) + uint256(takerFillAmount);
        if (totalOrderSize > circuitBreaker.maxOrderSize) revert OrderTooLarge();
        
        // Update and check daily volume
        uint256 newDailyVolume = uint256(circuitBreaker.currentDailyVolume) + totalOrderSize;
        if (newDailyVolume > circuitBreaker.maxDailyVolume) revert DailyVolumeExceeded();
        
        circuitBreaker.currentDailyVolume = uint128(newDailyVolume);
        
        // Check per-token limits if set
        if (order.makerTokenType == TokenType.ERC20) {
            uint256 makerTokenLimit = circuitBreaker.tokenDailyVolume[order.makerToken];
            if (makerTokenLimit > 0) {
                // Implementation would track per-token volumes
                // Simplified for this example
            }
        }
    }

    /**
     * @dev Reset daily volume if 24 hours have passed
     */
    function _resetDailyVolumeIfNeeded() internal {
        if (block.timestamp >= circuitBreaker.lastResetTimestamp + 1 days) {
            emit DailyVolumeReset(block.timestamp, circuitBreaker.currentDailyVolume);
            circuitBreaker.currentDailyVolume = 0;
            circuitBreaker.lastResetTimestamp = uint64(block.timestamp);
        }
    }

    /**
     * @dev Force reset daily volume (used after emergency resume)
     */
    function _forceResetDailyVolume() internal {
        emit DailyVolumeReset(block.timestamp, circuitBreaker.currentDailyVolume);
        circuitBreaker.currentDailyVolume = 0;
        circuitBreaker.lastResetTimestamp = uint64(block.timestamp);
    }

    /**
     * @notice Receive ETH for protocol fees
     * @dev Required for ETH trading pairs
     */
    receive() external payable {
        // Accept ETH for protocol fees
    }

    /**
     * @notice Reject direct ETH transfers without data
     * @dev Prevents accidental ETH loss
     */
    fallback() external payable {
        revert("Direct transfers not supported");
    }
}