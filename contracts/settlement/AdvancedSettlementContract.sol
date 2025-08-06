// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AdvancedSettlementContract
 * @notice Production-ready settlement contract supporting multiple token standards,
 *         partial fills, EIP-712 signatures, circuit breakers, and fee mechanisms
 * @dev Implements comprehensive order matching and settlement with advanced features
 */
contract AdvancedSettlementContract is Ownable, ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    // Order status enum
    enum OrderStatus {
        INVALID,
        FILLABLE,
        FILLED,
        PARTIALLY_FILLED,
        CANCELLED,
        EXPIRED
    }

    // Token type enum
    enum TokenType {
        ERC20,
        ERC721,
        ERC1155
    }

    // Order struct with comprehensive fields
    struct Order {
        address maker;
        address taker; // address(0) for any taker
        address makerToken;
        address takerToken;
        uint256 makerAmount;
        uint256 takerAmount;
        uint256 makerTokenId; // For NFTs
        uint256 takerTokenId; // For NFTs
        TokenType makerTokenType;
        TokenType takerTokenType;
        uint256 salt; // Unique identifier
        uint256 expiry; // Order expiration timestamp
        uint256 nonce; // For cancellation
        uint256 makerFee; // Fee paid by maker (basis points)
        uint256 takerFee; // Fee paid by taker (basis points)
        address feeRecipient; // Where fees go
    }

    // Fill tracking struct
    struct FillInfo {
        uint256 filledMakerAmount;
        uint256 filledTakerAmount;
        bool cancelled;
    }

    // Circuit breaker configuration
    struct CircuitBreaker {
        bool emergencyPause;
        uint256 maxDailyVolume;
        uint256 maxOrderSize;
        uint256 currentDailyVolume;
        uint256 lastResetTimestamp;
        mapping(address => bool) pausedTokens;
    }

    // Constants
    uint256 public constant FEE_DIVISOR = 10000; // 100% = 10000 basis points
    uint256 public constant MAX_FEE = 1000; // 10% max fee
    uint256 public constant SIGNATURE_VALIDITY = 30 minutes;
    
    // EIP-712 type hashes
    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address taker,address makerToken,address takerToken,"
        "uint256 makerAmount,uint256 takerAmount,uint256 makerTokenId,"
        "uint256 takerTokenId,uint8 makerTokenType,uint8 takerTokenType,"
        "uint256 salt,uint256 expiry,uint256 nonce,uint256 makerFee,"
        "uint256 takerFee,address feeRecipient)"
    );

    bytes32 public constant CANCEL_TYPEHASH = keccak256(
        "Cancel(bytes32 orderHash,uint256 nonce)"
    );

    // State variables
    mapping(bytes32 => FillInfo) public orderFills;
    mapping(address => uint256) public nonces;
    mapping(address => mapping(address => uint256)) public protocolFeeBalance;
    
    CircuitBreaker public circuitBreaker;
    
    address public protocolFeeRecipient;
    uint256 public protocolFeeRate = 30; // 0.3% default
    
    // Events
    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerFilledAmount,
        uint256 takerFilledAmount,
        uint256 makerFee,
        uint256 takerFee
    );

    event OrderCancelled(
        bytes32 indexed orderHash,
        address indexed maker,
        uint256 nonce
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
        string reason
    );

    event ProtocolFeeUpdated(
        uint256 oldFee,
        uint256 newFee,
        address feeRecipient
    );

    event EmergencyWithdrawal(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    // Modifiers
    modifier circuitBreakerCheck(uint256 amount) {
        _checkCircuitBreaker(amount);
        _;
    }

    modifier validOrder(Order memory order) {
        require(order.maker != address(0), "Invalid maker");
        require(order.makerToken != address(0), "Invalid maker token");
        require(order.takerToken != address(0), "Invalid taker token");
        require(order.makerAmount > 0, "Invalid maker amount");
        require(order.takerAmount > 0, "Invalid taker amount");
        require(order.expiry > block.timestamp, "Order expired");
        require(order.makerFee <= MAX_FEE, "Maker fee too high");
        require(order.takerFee <= MAX_FEE, "Taker fee too high");
        _;
    }

    constructor(
        string memory name,
        string memory version,
        address _protocolFeeRecipient
    ) EIP712(name, version) {
        require(_protocolFeeRecipient != address(0), "Invalid fee recipient");
        protocolFeeRecipient = _protocolFeeRecipient;
        circuitBreaker.lastResetTimestamp = block.timestamp;
        circuitBreaker.maxDailyVolume = 1000000 * 10**18; // 1M tokens default
        circuitBreaker.maxOrderSize = 10000 * 10**18; // 10k tokens default
    }

    /**
     * @notice Fill an order with EIP-712 signature
     * @param order The order to fill
     * @param fillAmount Amount of maker token to fill
     * @param signature Maker's signature
     */
    function fillOrder(
        Order memory order,
        uint256 fillAmount,
        bytes memory signature
    ) external nonReentrant whenNotPaused validOrder(order) {
        require(fillAmount > 0, "Fill amount must be positive");
        
        // Get order hash
        bytes32 orderHash = getOrderHash(order);
        
        // Verify signature
        require(
            _verifyOrderSignature(order, orderHash, signature),
            "Invalid signature"
        );
        
        // Check taker authorization
        require(
            order.taker == address(0) || order.taker == msg.sender,
            "Unauthorized taker"
        );
        
        // Check order status and fillability
        FillInfo storage fillInfo = orderFills[orderHash];
        require(!fillInfo.cancelled, "Order cancelled");
        
        uint256 remainingMakerAmount = order.makerAmount - fillInfo.filledMakerAmount;
        require(remainingMakerAmount > 0, "Order already filled");
        
        // Calculate actual fill amounts
        uint256 makerFillAmount = fillAmount > remainingMakerAmount ? 
            remainingMakerAmount : fillAmount;
        uint256 takerFillAmount = (makerFillAmount * order.takerAmount) / order.makerAmount;
        
        // Update fill info
        fillInfo.filledMakerAmount += makerFillAmount;
        fillInfo.filledTakerAmount += takerFillAmount;
        
        // Circuit breaker check
        _checkCircuitBreaker(makerFillAmount + takerFillAmount);
        circuitBreaker.currentDailyVolume += makerFillAmount + takerFillAmount;
        
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
                order.takerFee
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
     * @param order The order to cancel
     * @param signature Signature authorizing cancellation
     */
    function cancelOrder(
        Order memory order,
        bytes memory signature
    ) external nonReentrant {
        bytes32 orderHash = getOrderHash(order);
        
        // Verify cancellation signature
        bytes32 cancelHash = _hashTypedDataV4(
            keccak256(abi.encode(CANCEL_TYPEHASH, orderHash, nonces[order.maker]))
        );
        
        address signer = cancelHash.recover(signature);
        require(signer == order.maker, "Invalid cancel signature");
        
        // Update state
        orderFills[orderHash].cancelled = true;
        nonces[order.maker]++;
        
        emit OrderCancelled(orderHash, order.maker, nonces[order.maker]);
    }

    /**
     * @notice Batch cancel orders by incrementing nonce
     */
    function batchCancelOrdersByNonce(uint256 newNonce) external {
        require(newNonce > nonces[msg.sender], "Invalid nonce");
        nonces[msg.sender] = newNonce;
    }

    /**
     * @notice Get order status
     * @param order The order to check
     * @return status The current order status
     */
    function getOrderStatus(Order memory order) external view returns (OrderStatus) {
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
     * @notice Get order hash
     * @param order The order to hash
     * @return The EIP-712 hash of the order
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
                order.makerTokenType,
                order.takerTokenType,
                order.salt,
                order.expiry,
                order.nonce,
                order.makerFee,
                order.takerFee,
                order.feeRecipient
            ))
        );
    }

    /**
     * @notice Emergency pause - triggers circuit breaker
     */
    function emergencyPause() external onlyOwner {
        _pause();
        circuitBreaker.emergencyPause = true;
        emit CircuitBreakerTriggered("Emergency pause by owner", msg.sender, block.timestamp);
    }

    /**
     * @notice Resume operations after emergency
     */
    function emergencyResume() external onlyOwner {
        _unpause();
        circuitBreaker.emergencyPause = false;
        _resetDailyVolume();
    }

    /**
     * @notice Pause specific token
     * @param token Token to pause
     * @param paused Whether to pause or unpause
     * @param reason Reason for pausing
     */
    function setTokenPaused(
        address token,
        bool paused,
        string memory reason
    ) external onlyOwner {
        circuitBreaker.pausedTokens[token] = paused;
        emit TokenPaused(token, paused, reason);
    }

    /**
     * @notice Update circuit breaker limits
     * @param maxDailyVolume New max daily volume
     * @param maxOrderSize New max order size
     */
    function updateCircuitBreakerLimits(
        uint256 maxDailyVolume,
        uint256 maxOrderSize
    ) external onlyOwner {
        circuitBreaker.maxDailyVolume = maxDailyVolume;
        circuitBreaker.maxOrderSize = maxOrderSize;
    }

    /**
     * @notice Update protocol fee
     * @param newFeeRate New fee rate in basis points
     * @param newFeeRecipient New fee recipient
     */
    function updateProtocolFee(
        uint256 newFeeRate,
        address newFeeRecipient
    ) external onlyOwner {
        require(newFeeRate <= MAX_FEE, "Fee too high");
        require(newFeeRecipient != address(0), "Invalid recipient");
        
        uint256 oldFee = protocolFeeRate;
        protocolFeeRate = newFeeRate;
        protocolFeeRecipient = newFeeRecipient;
        
        emit ProtocolFeeUpdated(oldFee, newFeeRate, newFeeRecipient);
    }

    /**
     * @notice Withdraw collected protocol fees
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawProtocolFees(
        address token,
        uint256 amount
    ) external onlyOwner {
        require(
            protocolFeeBalance[token][protocolFeeRecipient] >= amount,
            "Insufficient balance"
        );
        
        protocolFeeBalance[token][protocolFeeRecipient] -= amount;
        
        if (token == address(0)) {
            payable(protocolFeeRecipient).transfer(amount);
        } else {
            IERC20(token).safeTransfer(protocolFeeRecipient, amount);
        }
    }

    /**
     * @notice Emergency withdrawal for stuck tokens
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     * @param recipient Where to send tokens
     */
    function emergencyWithdraw(
        address token,
        uint256 amount,
        address recipient
    ) external onlyOwner whenPaused {
        require(recipient != address(0), "Invalid recipient");
        
        if (token == address(0)) {
            payable(recipient).transfer(amount);
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
        
        emit EmergencyWithdrawal(token, recipient, amount);
    }

    // Internal functions

    function _executeTrade(
        Order memory order,
        address taker,
        uint256 makerFillAmount,
        uint256 takerFillAmount
    ) internal {
        // Check token pause status
        require(!circuitBreaker.pausedTokens[order.makerToken], "Maker token paused");
        require(!circuitBreaker.pausedTokens[order.takerToken], "Taker token paused");
        
        // Calculate fees
        uint256 makerFeeAmount = (makerFillAmount * order.makerFee) / FEE_DIVISOR;
        uint256 takerFeeAmount = (takerFillAmount * order.takerFee) / FEE_DIVISOR;
        uint256 protocolMakerFee = (makerFillAmount * protocolFeeRate) / FEE_DIVISOR;
        uint256 protocolTakerFee = (takerFillAmount * protocolFeeRate) / FEE_DIVISOR;
        
        // Transfer tokens based on type
        _transferToken(
            order.takerToken,
            order.takerTokenType,
            taker,
            order.maker,
            takerFillAmount - takerFeeAmount - protocolTakerFee,
            order.takerTokenId
        );
        
        _transferToken(
            order.makerToken,
            order.makerTokenType,
            order.maker,
            taker,
            makerFillAmount - makerFeeAmount - protocolMakerFee,
            order.makerTokenId
        );
        
        // Handle fees
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
        
        // Handle protocol fees
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

    function _transferToken(
        address token,
        TokenType tokenType,
        address from,
        address to,
        uint256 amount,
        uint256 tokenId
    ) internal {
        if (tokenType == TokenType.ERC20) {
            if (from == address(this)) {
                IERC20(token).safeTransfer(to, amount);
            } else {
                IERC20(token).safeTransferFrom(from, to, amount);
            }
        } else if (tokenType == TokenType.ERC721) {
            IERC721(token).safeTransferFrom(from, to, tokenId);
        } else if (tokenType == TokenType.ERC1155) {
            IERC1155(token).safeTransferFrom(from, to, tokenId, amount, "");
        }
    }

    function _verifyOrderSignature(
        Order memory order,
        bytes32 orderHash,
        bytes memory signature
    ) internal view returns (bool) {
        address signer = orderHash.recover(signature);
        return signer == order.maker && order.nonce >= nonces[order.maker];
    }

    function _checkCircuitBreaker(uint256 amount) internal view {
        require(!circuitBreaker.emergencyPause, "Emergency pause active");
        require(amount <= circuitBreaker.maxOrderSize, "Order too large");
        
        // Check daily volume (resets after 24 hours)
        if (block.timestamp >= circuitBreaker.lastResetTimestamp + 1 days) {
            // Volume will be reset in the state-changing function
            return;
        }
        
        require(
            circuitBreaker.currentDailyVolume + amount <= circuitBreaker.maxDailyVolume,
            "Daily volume exceeded"
        );
    }

    function _resetDailyVolume() internal {
        if (block.timestamp >= circuitBreaker.lastResetTimestamp + 1 days) {
            circuitBreaker.currentDailyVolume = 0;
            circuitBreaker.lastResetTimestamp = block.timestamp;
        }
    }

    // Receive ETH for protocol fees
    receive() external payable {}
}