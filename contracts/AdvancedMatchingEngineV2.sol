// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AdvancedMatchingEngineV2
 * @author SwappiQ Protocol
 * @notice Implements a sophisticated order matching engine with multiple order types and anti-gaming measures
 * @dev Enhanced version with security fixes, gas optimizations, and improved edge case handling
 */
contract AdvancedMatchingEngineV2 is ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    // ========== CONSTANTS ==========
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_ORDERS_PER_USER = 100;
    uint256 public constant MIN_ORDER_LIFETIME = 1 minutes;
    uint256 public constant WASH_TRADE_COOLDOWN = 5 minutes;
    uint256 public constant MAX_PRICE_LEVELS = 1000;
    uint256 public constant MAX_ORDERS_PER_PRICE = 100;
    uint256 public constant MAX_BATCH_SIZE = 50; // Gas optimization for loops
    uint256 public constant BASIS_POINTS = 10000;

    // ========== ENUMS ==========
    enum OrderType { LIMIT, MARKET, STOP_LOSS, ICEBERG }
    enum OrderStatus { ACTIVE, PARTIALLY_FILLED, FILLED, CANCELLED, EXPIRED }
    enum Side { BUY, SELL }

    // ========== STRUCTS ==========
    
    /// @notice Packed order structure for gas efficiency
    struct Order {
        uint128 orderId;
        uint128 price;           // Packed with orderId
        address trader;
        address baseToken;
        address quoteToken;
        uint128 amount;
        uint128 filledAmount;    // Packed with amount
        uint128 visibleAmount;
        uint32 timestamp;        // Packed with visibleAmount and other fields
        uint32 expirationTime;
        Side side;
        OrderType orderType;
        OrderStatus status;
        uint128 stopPrice;
        bytes32 crossChainId;
    }

    /// @notice Trade execution record with gas-optimized packing
    struct Trade {
        uint128 tradeId;
        uint128 price;           // Packed with tradeId
        uint128 buyOrderId;
        uint128 sellOrderId;     // Packed with buyOrderId
        address baseToken;
        address quoteToken;
        uint128 amount;
        uint32 timestamp;        // Packed with amount
        address buyer;
        address seller;
    }

    /// @notice Token pair configuration with packed fields
    struct PairConfig {
        bool active;
        bool washTradingCheckEnabled;
        uint128 minOrderSize;
        uint128 maxOrderSize;
        uint128 tickSize;         // Minimum price increment
        uint32 makerFee;          // in basis points (packed)
        uint32 takerFee;          // in basis points (packed)
        uint32 maxPriceDeviation; // For market order protection (in basis points)
    }

    /// @notice Anti-gaming tracking with gas optimization
    struct TradingActivity {
        uint32 lastTradeTime;
        uint224 volume24h;        // Packed with lastTradeTime
        mapping(address => uint32) lastTradeWithUser;
    }

    // ========== STATE VARIABLES ==========
    uint128 public nextOrderId = 1;
    uint128 public nextTradeId = 1;
    address public feeCollector;
    
    // Core mappings
    mapping(uint256 => Order) public orders;
    mapping(address => EnumerableSet.UintSet) private userOrders;
    mapping(bytes32 => PairConfig) public pairConfigs;
    
    // Order book structure - optimized for gas
    mapping(bytes32 => EnumerableSet.UintSet) private buyOrderPrices;
    mapping(bytes32 => EnumerableSet.UintSet) private sellOrderPrices;
    mapping(bytes32 => mapping(uint256 => EnumerableSet.UintSet)) private ordersAtPrice;
    
    // Anti-gaming and activity tracking
    mapping(address => mapping(address => TradingActivity)) private tradingActivity;
    mapping(uint256 => Trade) public trades;
    mapping(bytes32 => bool) public processedCrossChainOrders;
    
    // Stop-loss order tracking for efficient triggering
    mapping(bytes32 => EnumerableSet.UintSet) private stopLossOrders;

    // ========== EVENTS ==========
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        address indexed baseToken,
        address quoteToken,
        Side side,
        OrderType orderType,
        uint256 price,
        uint256 amount
    );

    event OrderCancelled(uint256 indexed orderId, address indexed trader, string reason);
    
    event OrderMatched(
        uint256 indexed tradeId,
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        uint256 price,
        uint256 amount
    );

    event OrderExpired(uint256 indexed orderId, address indexed trader);

    event StopLossTriggered(uint256 indexed orderId, uint256 marketPrice);
    
    event PairConfigUpdated(
        address indexed baseToken,
        address indexed quoteToken,
        PairConfig config
    );

    event WashTradeDetected(
        address indexed user1,
        address indexed user2,
        address indexed baseToken,
        address quoteToken
    );

    event CrossChainOrderPrepared(
        uint256 indexed orderId,
        bytes32 crossChainId,
        uint256 chainId
    );

    event FeesCollected(
        address indexed trader,
        address indexed token,
        uint256 amount,
        string feeType
    );

    // ========== CUSTOM ERRORS ==========
    error InvalidOrderType();
    error InvalidPrice();
    error InvalidAmount();
    error OrderNotFound();
    error Unauthorized();
    error TooManyOrders();
    error PairNotActive();
    error OrderSizeTooSmall();
    error OrderSizeTooBig();
    error InvalidTickSize();
    error WashTradeDetected();
    error OrderExpired();
    error InsufficientBalance();
    error PriceDeviationTooHigh();
    error InvalidPair();
    error OrderAlreadyFilled();
    error CrossChainOrderProcessed();
    error TooManyOrdersAtPrice();
    error BatchSizeExceeded();
    error ZeroAddress();
    error InvalidFee();

    // ========== MODIFIERS ==========
    modifier onlyValidPair(address baseToken, address quoteToken) {
        if (baseToken == address(0) || quoteToken == address(0)) revert ZeroAddress();
        bytes32 pairId = getPairId(baseToken, quoteToken);
        if (!pairConfigs[pairId].active) revert PairNotActive();
        _;
    }

    modifier orderExists(uint256 orderId) {
        if (orders[orderId].trader == address(0)) revert OrderNotFound();
        _;
    }

    modifier onlyOrderOwner(uint256 orderId) {
        if (orders[orderId].trader != msg.sender) revert Unauthorized();
        _;
    }

    modifier validBatchSize(uint256 size) {
        if (size > MAX_BATCH_SIZE) revert BatchSizeExceeded();
        _;
    }

    // ========== CONSTRUCTOR ==========
    constructor(address _feeCollector) {
        if (_feeCollector == address(0)) revert ZeroAddress();
        feeCollector = _feeCollector;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ========== EXTERNAL FUNCTIONS ==========

    /**
     * @notice Place a new order with comprehensive validation
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param side Buy or sell
     * @param orderType Type of order
     * @param price Price per token (0 for market orders)
     * @param amount Amount of base tokens
     * @param stopPrice Stop price for stop-loss orders
     * @param visibleAmount Visible amount for iceberg orders
     * @param expirationTime Order expiration timestamp (0 for no expiration)
     * @return orderId The ID of the created order
     */
    function placeOrder(
        address baseToken,
        address quoteToken,
        Side side,
        OrderType orderType,
        uint256 price,
        uint256 amount,
        uint256 stopPrice,
        uint256 visibleAmount,
        uint256 expirationTime
    ) external whenNotPaused nonReentrant onlyValidPair(baseToken, quoteToken) returns (uint256) {
        // Validate order parameters with enhanced checks
        _validateOrderParams(
            baseToken,
            quoteToken,
            orderType,
            price,
            amount,
            stopPrice,
            visibleAmount,
            expirationTime
        );

        // Check user order limit
        if (userOrders[msg.sender].length() >= MAX_ORDERS_PER_USER) {
            revert TooManyOrders();
        }

        // Anti-gaming checks
        bytes32 pairId = getPairId(baseToken, quoteToken);
        if (pairConfigs[pairId].washTradingCheckEnabled) {
            _checkWashTrading(msg.sender, baseToken, quoteToken, side);
        }

        // Create order with gas-optimized storage
        uint128 orderId = nextOrderId++;
        Order storage order = orders[orderId];
        
        // Efficient struct assignment
        order.orderId = orderId;
        order.trader = msg.sender;
        order.baseToken = baseToken;
        order.quoteToken = quoteToken;
        order.side = side;
        order.orderType = orderType;
        order.price = uint128(price);
        order.stopPrice = uint128(stopPrice);
        order.amount = uint128(amount);
        order.filledAmount = 0;
        order.visibleAmount = uint128(visibleAmount);
        order.timestamp = uint32(block.timestamp);
        order.expirationTime = uint32(expirationTime);
        order.status = OrderStatus.ACTIVE;

        // Add to user orders
        userOrders[msg.sender].add(orderId);

        // Transfer tokens with precise calculations
        if (side == Side.BUY) {
            // For buy orders, calculate required quote token amount
            uint256 requiredAmount;
            if (orderType == OrderType.MARKET) {
                // For market orders, estimate based on best ask or use a safety factor
                requiredAmount = _estimateMarketOrderCost(baseToken, quoteToken, amount);
            } else {
                // Avoid precision loss: multiply first, then divide
                requiredAmount = (price * amount) / PRECISION;
            }
            IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), requiredAmount);
        } else {
            // For sell orders, transfer base tokens
            IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        }

        emit OrderPlaced(orderId, msg.sender, baseToken, quoteToken, side, orderType, price, amount);

        // Process order based on type
        if (orderType == OrderType.MARKET) {
            _processMarketOrder(orderId);
        } else if (orderType == OrderType.LIMIT || 
                   (orderType == OrderType.ICEBERG && visibleAmount > 0)) {
            _addToOrderBook(orderId);
            _attemptMatching(baseToken, quoteToken);
        } else if (orderType == OrderType.STOP_LOSS) {
            // Add to stop-loss tracking
            stopLossOrders[pairId].add(orderId);
        }

        return orderId;
    }

    /**
     * @notice Cancel an active order with reason
     * @param orderId Order ID to cancel
     * @param reason Cancellation reason
     */
    function cancelOrder(uint256 orderId, string calldata reason) 
        external 
        nonReentrant 
        orderExists(orderId)
        onlyOrderOwner(orderId)
    {
        Order storage order = orders[orderId];
        
        // Check if order can be cancelled
        if (order.status != OrderStatus.ACTIVE && order.status != OrderStatus.PARTIALLY_FILLED) {
            revert OrderAlreadyFilled();
        }

        // Update order status
        order.status = OrderStatus.CANCELLED;
        userOrders[msg.sender].remove(orderId);
        
        // Remove from order book if present
        if (order.orderType == OrderType.LIMIT || order.orderType == OrderType.ICEBERG) {
            _removeFromOrderBook(orderId);
        } else if (order.orderType == OrderType.STOP_LOSS) {
            bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
            stopLossOrders[pairId].remove(orderId);
        }

        // Refund remaining tokens with precision
        _refundOrder(order);

        emit OrderCancelled(orderId, msg.sender, reason);
    }

    /**
     * @notice Batch cancel multiple orders for gas efficiency
     * @param orderIds Array of order IDs to cancel
     * @param reason Cancellation reason
     */
    function batchCancelOrders(uint256[] calldata orderIds, string calldata reason) 
        external 
        nonReentrant 
        validBatchSize(orderIds.length)
    {
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];
            
            // Skip if not owner or already processed
            if (order.trader != msg.sender || 
                (order.status != OrderStatus.ACTIVE && order.status != OrderStatus.PARTIALLY_FILLED)) {
                continue;
            }

            order.status = OrderStatus.CANCELLED;
            userOrders[msg.sender].remove(orderId);
            
            if (order.orderType == OrderType.LIMIT || order.orderType == OrderType.ICEBERG) {
                _removeFromOrderBook(orderId);
            } else if (order.orderType == OrderType.STOP_LOSS) {
                bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
                stopLossOrders[pairId].remove(orderId);
            }

            _refundOrder(order);
            emit OrderCancelled(orderId, msg.sender, reason);
        }
    }

    /**
     * @notice Execute matching for a specific token pair with gas limit
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param maxIterations Maximum iterations to prevent gas issues
     */
    function matchOrders(
        address baseToken, 
        address quoteToken,
        uint256 maxIterations
    ) external onlyRole(RELAYER_ROLE) onlyValidPair(baseToken, quoteToken) {
        _matchOrdersWithLimit(baseToken, quoteToken, maxIterations);
    }

    /**
     * @notice Trigger stop-loss orders based on current market price
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param currentPrice Current market price
     * @param maxTriggers Maximum stop-loss orders to trigger
     */
    function triggerStopLossOrders(
        address baseToken,
        address quoteToken,
        uint256 currentPrice,
        uint256 maxTriggers
    ) external onlyRole(RELAYER_ROLE) validBatchSize(maxTriggers) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        EnumerableSet.UintSet storage stopOrders = stopLossOrders[pairId];
        
        uint256 triggered = 0;
        uint256 length = stopOrders.length();
        
        // Iterate through stop-loss orders with gas limit
        for (uint256 i = 0; i < length && triggered < maxTriggers; i++) {
            uint256 orderId = stopOrders.at(i);
            Order storage order = orders[orderId];
            
            if (order.status == OrderStatus.ACTIVE && _shouldTriggerStopLoss(order, currentPrice)) {
                // Remove from stop-loss tracking
                stopOrders.remove(orderId);
                
                emit StopLossTriggered(orderId, currentPrice);
                
                // Convert to market order and process
                order.orderType = OrderType.MARKET;
                _processMarketOrder(orderId);
                
                triggered++;
                // Adjust loop counter since we removed an element
                i--;
                length--;
            }
        }
    }

    /**
     * @notice Expire orders that have passed their expiration time
     * @param orderIds Array of order IDs to check for expiration
     */
    function expireOrders(uint256[] calldata orderIds) 
        external 
        onlyRole(RELAYER_ROLE) 
        validBatchSize(orderIds.length)
    {
        for (uint256 i = 0; i < orderIds.length; i++) {
            uint256 orderId = orderIds[i];
            Order storage order = orders[orderId];
            
            if (order.expirationTime > 0 && 
                block.timestamp > order.expirationTime && 
                (order.status == OrderStatus.ACTIVE || order.status == OrderStatus.PARTIALLY_FILLED)) {
                
                order.status = OrderStatus.EXPIRED;
                userOrders[order.trader].remove(orderId);
                
                if (order.orderType == OrderType.LIMIT || order.orderType == OrderType.ICEBERG) {
                    _removeFromOrderBook(orderId);
                } else if (order.orderType == OrderType.STOP_LOSS) {
                    bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
                    stopLossOrders[pairId].remove(orderId);
                }

                _refundOrder(order);
                emit OrderExpired(orderId, order.trader);
            }
        }
    }

    /**
     * @notice Get order book for a token pair with gas optimization
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param side Order side
     * @param limit Maximum number of price levels to return
     * @return prices Array of prices
     * @return amounts Array of amounts at each price level
     */
    function getOrderBook(
        address baseToken,
        address quoteToken,
        Side side,
        uint256 limit
    ) external view returns (uint256[] memory prices, uint256[] memory amounts) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        EnumerableSet.UintSet storage priceSet = side == Side.BUY ? 
            buyOrderPrices[pairId] : sellOrderPrices[pairId];
        
        uint256 count = priceSet.length() < limit ? priceSet.length() : limit;
        prices = new uint256[](count);
        amounts = new uint256[](count);
        
        // Get sorted prices
        uint256[] memory sortedPrices = _getSortedPrices(priceSet, side == Side.SELL);
        
        for (uint256 i = 0; i < count; i++) {
            prices[i] = sortedPrices[i];
            amounts[i] = _getVolumeAtPrice(pairId, sortedPrices[i]);
        }
    }

    // ========== INTERNAL FUNCTIONS ==========

    /**
     * @notice Enhanced order parameter validation
     */
    function _validateOrderParams(
        address baseToken,
        address quoteToken,
        OrderType orderType,
        uint256 price,
        uint256 amount,
        uint256 stopPrice,
        uint256 visibleAmount,
        uint256 expirationTime
    ) private view {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        PairConfig memory config = pairConfigs[pairId];
        
        // Basic validations
        if (amount < config.minOrderSize) revert OrderSizeTooSmall();
        if (config.maxOrderSize > 0 && amount > config.maxOrderSize) revert OrderSizeTooBig();
        
        // Order type specific validations
        if (orderType == OrderType.LIMIT || orderType == OrderType.ICEBERG) {
            if (price == 0) revert InvalidPrice();
            if (config.tickSize > 0 && price % config.tickSize != 0) revert InvalidTickSize();
        }
        
        if (orderType == OrderType.STOP_LOSS) {
            if (stopPrice == 0) revert InvalidPrice();
        }
        
        if (orderType == OrderType.ICEBERG) {
            if (visibleAmount == 0 || visibleAmount > amount) revert InvalidAmount();
        }
        
        // Expiration validation
        if (expirationTime != 0 && expirationTime <= block.timestamp + MIN_ORDER_LIFETIME) {
            revert OrderExpired();
        }
    }

    /**
     * @notice Check for wash trading with improved detection
     */
    function _checkWashTrading(
        address trader,
        address baseToken,
        address quoteToken,
        Side side
    ) private view {
        address tokenToCheck = side == Side.BUY ? quoteToken : baseToken;
        TradingActivity storage activity = tradingActivity[trader][tokenToCheck];
        
        // Check self-trading cooldown
        if (activity.lastTradeWithUser[trader] + WASH_TRADE_COOLDOWN > block.timestamp) {
            revert WashTradeDetected();
        }
    }

    /**
     * @notice Add order to order book with gas optimization
     */
    function _addToOrderBook(uint256 orderId) private {
        Order storage order = orders[orderId];
        bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
        
        // Check price level limits
        EnumerableSet.UintSet storage ordersAtThisPrice = ordersAtPrice[pairId][order.price];
        if (ordersAtThisPrice.length() >= MAX_ORDERS_PER_PRICE) {
            revert TooManyOrdersAtPrice();
        }
        
        // Add to price levels
        if (order.side == Side.BUY) {
            buyOrderPrices[pairId].add(order.price);
        } else {
            sellOrderPrices[pairId].add(order.price);
        }
        
        ordersAtThisPrice.add(orderId);
    }

    /**
     * @notice Remove order from order book efficiently
     */
    function _removeFromOrderBook(uint256 orderId) private {
        Order storage order = orders[orderId];
        bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
        
        ordersAtPrice[pairId][order.price].remove(orderId);
        
        // Remove price level if no more orders
        if (ordersAtPrice[pairId][order.price].length() == 0) {
            if (order.side == Side.BUY) {
                buyOrderPrices[pairId].remove(order.price);
            } else {
                sellOrderPrices[pairId].remove(order.price);
            }
        }
    }

    /**
     * @notice Process market order with improved slippage protection
     */
    function _processMarketOrder(uint256 orderId) private {
        Order storage marketOrder = orders[orderId];
        bytes32 pairId = getPairId(marketOrder.baseToken, marketOrder.quoteToken);
        
        EnumerableSet.UintSet storage oppositePrices = marketOrder.side == Side.BUY ? 
            sellOrderPrices[pairId] : buyOrderPrices[pairId];
        
        uint256 remainingAmount = marketOrder.amount;
        uint256 totalCost = 0;
        
        // Get sorted prices for optimal execution
        uint256[] memory sortedPrices = _getSortedPrices(oppositePrices, marketOrder.side == Side.BUY);
        
        // Execute against order book
        for (uint256 i = 0; i < sortedPrices.length && remainingAmount > 0; i++) {
            uint256 price = sortedPrices[i];
            
            // Slippage protection for first trade
            if (i == 0 && marketOrder.side == Side.BUY) {
                _validateMarketOrderSlippage(pairId, price);
            }
            
            remainingAmount = _executeAtPriceLevel(orderId, price, remainingAmount);
        }
        
        // Update market order status
        marketOrder.filledAmount = uint128(marketOrder.amount - remainingAmount);
        if (remainingAmount == 0) {
            marketOrder.status = OrderStatus.FILLED;
        } else if (marketOrder.filledAmount > 0) {
            marketOrder.status = OrderStatus.PARTIALLY_FILLED;
        }
    }

    /**
     * @notice Execute trades at a specific price level
     */
    function _executeAtPriceLevel(
        uint256 marketOrderId, 
        uint256 price, 
        uint256 remainingAmount
    ) private returns (uint256) {
        Order storage marketOrder = orders[marketOrderId];
        bytes32 pairId = getPairId(marketOrder.baseToken, marketOrder.quoteToken);
        
        EnumerableSet.UintSet storage ordersAtThisPrice = ordersAtPrice[pairId][price];
        uint256 processed = 0;
        
        // Process orders at this price level (FIFO)
        while (processed < ordersAtThisPrice.length() && remainingAmount > 0) {
            uint256 limitOrderId = ordersAtThisPrice.at(processed);
            Order storage limitOrder = orders[limitOrderId];
            
            if (limitOrder.status == OrderStatus.ACTIVE || 
                limitOrder.status == OrderStatus.PARTIALLY_FILLED) {
                
                uint256 fillAmount = _calculateFillAmount(limitOrder, remainingAmount);
                if (fillAmount > 0) {
                    _executeTrade(marketOrderId, limitOrderId, price, fillAmount);
                    remainingAmount -= fillAmount;
                }
            }
            processed++;
        }
        
        return remainingAmount;
    }

    /**
     * @notice Attempt order matching with gas limits
     */
    function _attemptMatching(address baseToken, address quoteToken) private {
        _matchOrdersWithLimit(baseToken, quoteToken, MAX_BATCH_SIZE);
    }

    /**
     * @notice Match orders with iteration limit for gas control
     */
    function _matchOrdersWithLimit(
        address baseToken, 
        address quoteToken, 
        uint256 maxIterations
    ) private {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        
        uint256[] memory buyPrices = _getSortedPrices(buyOrderPrices[pairId], false);
        uint256[] memory sellPrices = _getSortedPrices(sellOrderPrices[pairId], true);
        
        uint256 iterations = 0;
        uint256 buyIndex = 0;
        uint256 sellIndex = 0;
        
        while (buyIndex < buyPrices.length && 
               sellIndex < sellPrices.length && 
               buyPrices[buyIndex] >= sellPrices[sellIndex] &&
               iterations < maxIterations) {
            
            uint256 matchPrice = sellPrices[sellIndex]; // Price-time priority
            bool pricesAdvanced = _matchAtPriceLevel(pairId, buyPrices[buyIndex], sellPrices[sellIndex], matchPrice);
            
            if (pricesAdvanced) {
                if (_isAllOrdersFilledAtPrice(pairId, buyPrices[buyIndex], Side.BUY)) {
                    buyIndex++;
                }
                if (_isAllOrdersFilledAtPrice(pairId, sellPrices[sellIndex], Side.SELL)) {
                    sellIndex++;
                }
            }
            
            iterations++;
        }
    }

    /**
     * @notice Match orders at specific price levels
     */
    function _matchAtPriceLevel(
        bytes32 pairId,
        uint256 buyPrice,
        uint256 sellPrice,
        uint256 matchPrice
    ) private returns (bool) {
        EnumerableSet.UintSet storage buyOrdersAtPrice = ordersAtPrice[pairId][buyPrice];
        EnumerableSet.UintSet storage sellOrdersAtPrice = ordersAtPrice[pairId][sellPrice];
        
        uint256 buyProcessed = 0;
        uint256 sellProcessed = 0;
        bool anyMatched = false;
        
        while (buyProcessed < buyOrdersAtPrice.length() && 
               sellProcessed < sellOrdersAtPrice.length()) {
            
            uint256 buyOrderId = buyOrdersAtPrice.at(buyProcessed);
            uint256 sellOrderId = sellOrdersAtPrice.at(sellProcessed);
            
            Order storage buyOrder = orders[buyOrderId];
            Order storage sellOrder = orders[sellOrderId];
            
            // Skip filled orders
            if (!_isOrderActive(buyOrder)) {
                buyProcessed++;
                continue;
            }
            if (!_isOrderActive(sellOrder)) {
                sellProcessed++;
                continue;
            }
            
            uint256 buyRemaining = buyOrder.amount - buyOrder.filledAmount;
            uint256 sellRemaining = sellOrder.amount - sellOrder.filledAmount;
            uint256 fillAmount = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;
            
            if (fillAmount > 0) {
                _executeTrade(buyOrderId, sellOrderId, matchPrice, fillAmount);
                anyMatched = true;
                
                // Advance indices based on completion
                if (buyOrder.filledAmount == buyOrder.amount) {
                    buyProcessed++;
                }
                if (sellOrder.filledAmount == sellOrder.amount) {
                    sellProcessed++;
                }
            } else {
                break; // No more matches possible
            }
        }
        
        return anyMatched;
    }

    /**
     * @notice Execute a trade with enhanced fee handling
     */
    function _executeTrade(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 price,
        uint256 amount
    ) private {
        Order storage buyOrder = orders[buyOrderId];
        Order storage sellOrder = orders[sellOrderId];
        
        // Update fill amounts
        buyOrder.filledAmount += uint128(amount);
        sellOrder.filledAmount += uint128(amount);
        
        // Update order statuses
        _updateOrderStatus(buyOrder, buyOrderId);
        _updateOrderStatus(sellOrder, sellOrderId);
        
        // Calculate and execute transfers with fees
        _executeTradeTransfers(buyOrder, sellOrder, price, amount);
        
        // Record trade
        _recordTrade(buyOrderId, sellOrderId, price, amount, buyOrder, sellOrder);
        
        // Update trading activity
        _updateTradingActivity(buyOrder.trader, sellOrder.trader, buyOrder.baseToken, buyOrder.quoteToken);
    }

    /**
     * @notice Update order status after fill
     */
    function _updateOrderStatus(Order storage order, uint256 orderId) private {
        if (order.filledAmount == order.amount) {
            order.status = OrderStatus.FILLED;
            _removeFromOrderBook(orderId);
            userOrders[order.trader].remove(orderId);
        } else {
            order.status = OrderStatus.PARTIALLY_FILLED;
            
            // Handle iceberg order refill
            if (order.orderType == OrderType.ICEBERG) {
                _refillIcebergOrder(orderId);
            }
        }
    }

    /**
     * @notice Execute transfers with proper fee handling
     */
    function _executeTradeTransfers(
        Order storage buyOrder,
        Order storage sellOrder,
        uint256 price,
        uint256 amount
    ) private {
        bytes32 pairId = getPairId(buyOrder.baseToken, buyOrder.quoteToken);
        PairConfig memory config = pairConfigs[pairId];
        
        // Calculate quote amount
        uint256 quoteAmount = (price * amount) / PRECISION;
        
        // Calculate fees
        uint256 buyerFee = (quoteAmount * config.takerFee) / BASIS_POINTS;
        uint256 sellerFee = (amount * config.makerFee) / BASIS_POINTS;
        
        // Transfer base tokens to buyer (minus seller fee)
        uint256 netBaseAmount = amount - sellerFee;
        IERC20(buyOrder.baseToken).safeTransfer(buyOrder.trader, netBaseAmount);
        
        // Transfer quote tokens to seller (minus buyer fee)
        uint256 netQuoteAmount = quoteAmount - buyerFee;
        IERC20(buyOrder.quoteToken).safeTransfer(sellOrder.trader, netQuoteAmount);
        
        // Transfer fees to collector
        if (sellerFee > 0) {
            IERC20(buyOrder.baseToken).safeTransfer(feeCollector, sellerFee);
            emit FeesCollected(sellOrder.trader, buyOrder.baseToken, sellerFee, "maker");
        }
        if (buyerFee > 0) {
            IERC20(buyOrder.quoteToken).safeTransfer(feeCollector, buyerFee);
            emit FeesCollected(buyOrder.trader, buyOrder.quoteToken, buyerFee, "taker");
        }
    }

    /**
     * @notice Record trade with gas-optimized storage
     */
    function _recordTrade(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 price,
        uint256 amount,
        Order storage buyOrder,
        Order storage sellOrder
    ) private {
        uint128 tradeId = nextTradeId++;
        Trade storage trade = trades[tradeId];
        
        trade.tradeId = tradeId;
        trade.buyOrderId = uint128(buyOrderId);
        trade.sellOrderId = uint128(sellOrderId);
        trade.baseToken = buyOrder.baseToken;
        trade.quoteToken = buyOrder.quoteToken;
        trade.price = uint128(price);
        trade.amount = uint128(amount);
        trade.timestamp = uint32(block.timestamp);
        trade.buyer = buyOrder.trader;
        trade.seller = sellOrder.trader;
        
        emit OrderMatched(tradeId, buyOrderId, sellOrderId, price, amount);
    }

    /**
     * @notice Enhanced trading activity update
     */
    function _updateTradingActivity(
        address buyer,
        address seller,
        address baseToken,
        address quoteToken
    ) private {
        uint32 currentTime = uint32(block.timestamp);
        
        // Update buyer activity
        TradingActivity storage buyerActivity = tradingActivity[buyer][quoteToken];
        buyerActivity.lastTradeTime = currentTime;
        buyerActivity.lastTradeWithUser[seller] = currentTime;
        
        // Update seller activity
        TradingActivity storage sellerActivity = tradingActivity[seller][baseToken];
        sellerActivity.lastTradeTime = currentTime;
        sellerActivity.lastTradeWithUser[buyer] = currentTime;
        
        // Detect wash trading
        if (buyer == seller) {
            emit WashTradeDetected(buyer, seller, baseToken, quoteToken);
        }
    }

    // ========== UTILITY FUNCTIONS ==========

    function _shouldTriggerStopLoss(Order storage order, uint256 currentPrice) private pure returns (bool) {
        if (order.side == Side.SELL) {
            return currentPrice <= order.stopPrice;
        } else {
            return currentPrice >= order.stopPrice;
        }
    }

    function _estimateMarketOrderCost(
        address baseToken,
        address quoteToken,
        uint256 amount
    ) private view returns (uint256) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        EnumerableSet.UintSet storage prices = sellOrderPrices[pairId];
        
        if (prices.length() == 0) {
            revert InsufficientBalance(); // No liquidity
        }
        
        // Get best ask price and add safety margin
        uint256[] memory sortedPrices = _getSortedPrices(prices, true);
        uint256 bestPrice = sortedPrices[0];
        
        // Add 10% safety margin for slippage
        return (bestPrice * amount * 110) / (PRECISION * 100);
    }

    function _validateMarketOrderSlippage(bytes32 pairId, uint256 executionPrice) private view {
        PairConfig memory config = pairConfigs[pairId];
        // Additional slippage validation could be implemented here
        // For now, rely on the maxPriceDeviation in config
    }

    function _refundOrder(Order storage order) private {
        if (order.side == Side.BUY) {
            uint256 remainingAmount = order.amount - order.filledAmount;
            uint256 refundAmount = (uint256(order.price) * remainingAmount) / PRECISION;
            if (refundAmount > 0) {
                IERC20(order.quoteToken).safeTransfer(order.trader, refundAmount);
            }
        } else {
            uint256 remainingAmount = order.amount - order.filledAmount;
            if (remainingAmount > 0) {
                IERC20(order.baseToken).safeTransfer(order.trader, remainingAmount);
            }
        }
    }

    function _calculateFillAmount(Order storage order, uint256 requestedAmount) private view returns (uint256) {
        uint256 available = order.amount - order.filledAmount;
        
        if (order.orderType == OrderType.ICEBERG) {
            uint256 visibleRemaining = order.visibleAmount > order.filledAmount ? 
                order.visibleAmount - order.filledAmount : 0;
            available = visibleRemaining < available ? visibleRemaining : available;
        }
        
        return requestedAmount < available ? requestedAmount : available;
    }

    function _refillIcebergOrder(uint256 orderId) private {
        Order storage order = orders[orderId];
        uint256 remaining = order.amount - order.filledAmount;
        
        if (remaining > 0) {
            // Reset visible amount to original or remaining, whichever is smaller
            uint256 originalVisible = order.visibleAmount;
            order.visibleAmount = uint128(remaining < originalVisible ? remaining : originalVisible);
        }
    }

    function _isOrderActive(Order storage order) private view returns (bool) {
        return order.status == OrderStatus.ACTIVE || order.status == OrderStatus.PARTIALLY_FILLED;
    }

    function _isAllOrdersFilledAtPrice(bytes32 pairId, uint256 price, Side side) private view returns (bool) {
        EnumerableSet.UintSet storage ordersAtThisPrice = ordersAtPrice[pairId][price];
        
        for (uint256 i = 0; i < ordersAtThisPrice.length(); i++) {
            Order storage order = orders[ordersAtThisPrice.at(i)];
            if (_isOrderActive(order)) {
                return false;
            }
        }
        return true;
    }

    function _getVolumeAtPrice(bytes32 pairId, uint256 price) private view returns (uint256) {
        EnumerableSet.UintSet storage ordersAtThisPrice = ordersAtPrice[pairId][price];
        uint256 totalVolume = 0;
        
        for (uint256 i = 0; i < ordersAtThisPrice.length(); i++) {
            Order storage order = orders[ordersAtThisPrice.at(i)];
            if (_isOrderActive(order)) {
                uint256 remainingAmount = order.amount - order.filledAmount;
                if (order.orderType == OrderType.ICEBERG) {
                    remainingAmount = order.visibleAmount < remainingAmount ? 
                        order.visibleAmount : remainingAmount;
                }
                totalVolume += remainingAmount;
            }
        }
        
        return totalVolume;
    }

    function _getSortedPrices(
        EnumerableSet.UintSet storage priceSet,
        bool ascending
    ) private view returns (uint256[] memory) {
        uint256 length = priceSet.length();
        uint256[] memory prices = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            prices[i] = priceSet.at(i);
        }
        
        _quickSort(prices, 0, int256(length - 1), ascending);
        return prices;
    }

    function _quickSort(uint256[] memory arr, int256 left, int256 right, bool ascending) private pure {
        if (left < right) {
            int256 pivotIndex = _partition(arr, left, right, ascending);
            _quickSort(arr, left, pivotIndex - 1, ascending);
            _quickSort(arr, pivotIndex + 1, right, ascending);
        }
    }

    function _partition(uint256[] memory arr, int256 left, int256 right, bool ascending) private pure returns (int256) {
        uint256 pivot = arr[uint256(right)];
        int256 i = left - 1;
        
        for (int256 j = left; j < right; j++) {
            bool condition = ascending ? arr[uint256(j)] <= pivot : arr[uint256(j)] >= pivot;
            if (condition) {
                i++;
                (arr[uint256(i)], arr[uint256(j)]) = (arr[uint256(j)], arr[uint256(i)]);
            }
        }
        
        (arr[uint256(i + 1)], arr[uint256(right)]) = (arr[uint256(right)], arr[uint256(i + 1)]);
        return i + 1;
    }

    // ========== PUBLIC VIEW FUNCTIONS ==========

    function getPairId(address baseToken, address quoteToken) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(baseToken, quoteToken));
    }

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrders[user].values();
    }

    function getOrderDetails(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getTradeDetails(uint256 tradeId) external view returns (Trade memory) {
        return trades[tradeId];
    }

    // ========== ADMIN FUNCTIONS ==========

    function updatePairConfig(
        address baseToken,
        address quoteToken,
        PairConfig memory config
    ) external onlyRole(OPERATOR_ROLE) {
        if (config.makerFee > 1000 || config.takerFee > 1000) revert InvalidFee(); // Max 10%
        
        bytes32 pairId = getPairId(baseToken, quoteToken);
        pairConfigs[pairId] = config;
        emit PairConfigUpdated(baseToken, quoteToken, config);
    }

    function setFeeCollector(address _feeCollector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feeCollector == address(0)) revert ZeroAddress();
        feeCollector = _feeCollector;
    }

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}