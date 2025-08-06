// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AdvancedMatchingEngine
 * @author SwappiQ Protocol
 * @notice Implements a sophisticated order matching engine with multiple order types and anti-gaming measures
 * @dev Supports limit, market, stop-loss, and iceberg orders with price-time priority matching
 */
contract AdvancedMatchingEngine is ReentrancyGuard, Pausable, AccessControl {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    // Constants
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint256 public constant PRECISION = 1e18;
    uint256 public constant MAX_ORDERS_PER_USER = 100;
    uint256 public constant MIN_ORDER_LIFETIME = 1 minutes;
    uint256 public constant WASH_TRADE_COOLDOWN = 5 minutes;
    uint256 public constant MAX_PRICE_LEVELS = 1000;

    // Order types
    enum OrderType {
        LIMIT,
        MARKET,
        STOP_LOSS,
        ICEBERG
    }

    // Order status
    enum OrderStatus {
        ACTIVE,
        PARTIALLY_FILLED,
        FILLED,
        CANCELLED,
        EXPIRED
    }

    // Order side
    enum Side {
        BUY,
        SELL
    }

    // Order structure
    struct Order {
        uint256 orderId;
        address trader;
        address baseToken;
        address quoteToken;
        Side side;
        OrderType orderType;
        uint256 price; // For market orders, this is 0
        uint256 stopPrice; // For stop-loss orders
        uint256 amount; // Original amount
        uint256 filledAmount; // Amount already filled
        uint256 visibleAmount; // For iceberg orders
        uint256 timestamp;
        uint256 expirationTime;
        OrderStatus status;
        bytes32 crossChainId; // For cross-chain orders
    }

    // Trade execution record
    struct Trade {
        uint256 tradeId;
        uint256 buyOrderId;
        uint256 sellOrderId;
        address baseToken;
        address quoteToken;
        uint256 price;
        uint256 amount;
        uint256 timestamp;
        address buyer;
        address seller;
    }

    // Token pair configuration
    struct PairConfig {
        bool active;
        uint256 minOrderSize;
        uint256 maxOrderSize;
        uint256 tickSize; // Minimum price increment
        uint256 makerFee; // in basis points
        uint256 takerFee; // in basis points
        bool washTradingCheckEnabled;
        uint256 maxPriceDeviation; // For market order protection (in basis points)
    }

    // Anti-gaming tracking
    struct TradingActivity {
        uint256 lastTradeTime;
        uint256 volume24h;
        mapping(address => uint256) lastTradeWithUser;
    }

    // State variables
    uint256 public nextOrderId = 1;
    uint256 public nextTradeId = 1;
    address public feeCollector;
    
    // Mappings
    mapping(uint256 => Order) public orders;
    mapping(address => EnumerableSet.UintSet) private userOrders;
    mapping(bytes32 => PairConfig) public pairConfigs;
    mapping(bytes32 => EnumerableSet.UintSet) private buyOrders; // price => orderIds
    mapping(bytes32 => EnumerableSet.UintSet) private sellOrders; // price => orderIds
    mapping(bytes32 => mapping(uint256 => EnumerableSet.UintSet)) private ordersAtPrice;
    mapping(address => mapping(address => TradingActivity)) private tradingActivity;
    mapping(uint256 => Trade) public trades;
    mapping(bytes32 => bool) public processedCrossChainOrders;

    // Events
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        address baseToken,
        address quoteToken,
        Side side,
        OrderType orderType,
        uint256 price,
        uint256 amount
    );

    event OrderCancelled(uint256 indexed orderId, address indexed trader);
    
    event OrderMatched(
        uint256 indexed tradeId,
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 price,
        uint256 amount
    );

    event StopLossTriggered(uint256 indexed orderId, uint256 marketPrice);
    
    event PairConfigUpdated(
        address indexed baseToken,
        address indexed quoteToken,
        PairConfig config
    );

    event WashTradeDetected(
        address indexed user1,
        address indexed user2,
        address baseToken,
        address quoteToken
    );

    event CrossChainOrderPrepared(
        uint256 indexed orderId,
        bytes32 crossChainId,
        uint256 chainId
    );

    // Custom errors
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

    modifier onlyValidPair(address baseToken, address quoteToken) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        if (!pairConfigs[pairId].active) revert PairNotActive();
        _;
    }

    constructor(address _feeCollector) {
        if (_feeCollector == address(0)) revert InvalidPair();
        feeCollector = _feeCollector;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    /**
     * @notice Place a new order
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param side Buy or sell
     * @param orderType Type of order
     * @param price Price per token (0 exploitation market orders)
     * @param amount Amount of base tokens
     * @param stopPrice Stop price for stop-loss orders
     * @param visibleAmount Visible amount for iceberg orders
     * @param expirationTime Order expiration timestamp
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
        // Validate order parameters
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

        // Check wash trading
        if (pairConfigs[getPairId(baseToken, quoteToken)].washTradingCheckEnabled) {
            _checkWashTrading(msg.sender, baseToken, quoteToken, side);
        }

        // Create order
        uint256 orderId = nextOrderId++;
        Order storage order = orders[orderId];
        order.orderId = orderId;
        order.trader = msg.sender;
        order.baseToken = baseToken;
        order.quoteToken = quoteToken;
        order.side = side;
        order.orderType = orderType;
        order.price = price;
        order.stopPrice = stopPrice;
        order.amount = amount;
        order.filledAmount = 0;
        order.visibleAmount = visibleAmount;
        order.timestamp = block.timestamp;
        order.expirationTime = expirationTime;
        order.status = OrderStatus.ACTIVE;

        // Add to user orders
        userOrders[msg.sender].add(orderId);

        // Transfer tokens to contract
        if (side == Side.BUY) {
            uint256 requiredAmount = (price * amount) / PRECISION;
            IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), requiredAmount);
        } else {
            IERC20(baseToken).safeTransferFrom(msg.sender, address(this), amount);
        }

        emit OrderPlaced(orderId, msg.sender, baseToken, quoteToken, side, orderType, price, amount);

        // Process order based on type
        if (orderType == OrderType.MARKET) {
            _processMarketOrder(orderId);
        } else if (orderType == OrderType.LIMIT || 
                   (orderType == OrderType.ICEBERG && visibleAmount > 0)) {
            _addToOrderBook(orderId);
            _matchOrders(baseToken, quoteToken);
        }
        // Stop-loss orders are not added to order book until triggered

        return orderId;
    }

    /**
     * @notice Cancel an active order
     * @param orderId Order ID to cancel
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.trader != msg.sender) revert Unauthorized();
        if (order.status != OrderStatus.ACTIVE && order.status != OrderStatus.PARTIALLY_FILLED) {
            revert OrderAlreadyFilled();
        }

        order.status = OrderStatus.CANCELLED;
        userOrders[msg.sender].remove(orderId);
        _removeFromOrderBook(orderId);

        // Refund remaining tokens
        if (order.side == Side.BUY) {
            uint256 remainingAmount = order.amount - order.filledAmount;
            uint256 refundAmount = (order.price * remainingAmount) / PRECISION;
            IERC20(order.quoteToken).safeTransfer(msg.sender, refundAmount);
        } else {
            uint256 remainingAmount = order.amount - order.filledAmount;
            IERC20(order.baseToken).safeTransfer(msg.sender, remainingAmount);
        }

        emit OrderCancelled(orderId, msg.sender);
    }

    /**
     * @notice Execute matching for a specific token pair
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     */
    function matchOrders(address baseToken, address quoteToken) 
        external 
        onlyRole(RELAYER_ROLE) 
        onlyValidPair(baseToken, quoteToken) 
    {
        _matchOrders(baseToken, quoteToken);
    }

    /**
     * @notice Trigger stop-loss orders based on current market price
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param currentPrice Current market price
     */
    function triggerStopLossOrders(
        address baseToken,
        address quoteToken,
        uint256 currentPrice
    ) external onlyRole(RELAYER_ROLE) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        
        // Check all active orders for stop-loss triggers
        for (uint i = 0; i < userOrders[msg.sender].length(); i++) {
            uint256 orderId = userOrders[msg.sender].at(i);
            Order storage order = orders[orderId];
            
            if (order.orderType == OrderType.STOP_LOSS && 
                order.status == OrderStatus.ACTIVE &&
                order.baseToken == baseToken &&
                order.quoteToken == quoteToken) {
                
                bool shouldTrigger = false;
                if (order.side == Side.SELL && currentPrice <= order.stopPrice) {
                    shouldTrigger = true;
                } else if (order.side == Side.BUY && currentPrice >= order.stopPrice) {
                    shouldTrigger = true;
                }
                
                if (shouldTrigger) {
                    emit StopLossTriggered(orderId, currentPrice);
                    order.orderType = OrderType.MARKET;
                    _processMarketOrder(orderId);
                }
            }
        }
    }

    /**
     * @notice Prepare order for cross-chain execution
     * @param orderId Order ID
     * @param targetChainId Target chain ID
     */
    function prepareCrossChainOrder(
        uint256 orderId,
        uint256 targetChainId
    ) external returns (bytes32) {
        Order storage order = orders[orderId];
        if (order.trader != msg.sender) revert Unauthorized();
        
        bytes32 crossChainId = keccak256(
            abi.encodePacked(
                orderId,
                block.chainid,
                targetChainId,
                block.timestamp
            )
        );
        
        order.crossChainId = crossChainId;
        
        emit CrossChainOrderPrepared(orderId, crossChainId, targetChainId);
        return crossChainId;
    }

    /**
     * @notice Update pair configuration
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param config New configuration
     */
    function updatePairConfig(
        address baseToken,
        address quoteToken,
        PairConfig memory config
    ) external onlyRole(OPERATOR_ROLE) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        pairConfigs[pairId] = config;
        emit PairConfigUpdated(baseToken, quoteToken, config);
    }

    /**
     * @notice Get order book for a token pair
     * @param baseToken Base token address
     * @param quoteToken Quote token address
     * @param side Order side
     * @param limit Maximum number of price levels to return
     */
    function getOrderBook(
        address baseToken,
        address quoteToken,
        Side side,
        uint256 limit
    ) external view returns (uint256[] memory prices, uint256[] memory amounts) {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        EnumerableSet.UintSet storage orderSet = side == Side.BUY ? buyOrders[pairId] : sellOrders[pairId];
        
        uint256 count = orderSet.length() < limit ? orderSet.length() : limit;
        prices = new uint256[](count);
        amounts = new uint256[](count);
        
        for (uint i = 0; i < count; i++) {
            uint256 price = orderSet.at(i);
            prices[i] = price;
            
            EnumerableSet.UintSet storage ordersAtThisPrice = ordersAtPrice[pairId][price];
            uint256 totalAmount = 0;
            
            for (uint j = 0; j < ordersAtThisPrice.length(); j++) {
                Order storage order = orders[ordersAtThisPrice.at(j)];
                if (order.status == OrderStatus.ACTIVE || order.status == OrderStatus.PARTIALLY_FILLED) {
                    uint256 visibleAmt = order.orderType == OrderType.ICEBERG ? 
                        order.visibleAmount : order.amount - order.filledAmount;
                    totalAmount += visibleAmt;
                }
            }
            
            amounts[i] = totalAmount;
        }
    }

    // Internal functions

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
        
        if (amount < config.minOrderSize) revert OrderSizeTooSmall();
        if (amount > config.maxOrderSize) revert OrderSizeTooBig();
        
        if (orderType == OrderType.LIMIT || orderType == OrderType.ICEBERG) {
            if (price == 0) revert InvalidPrice();
            if (price % config.tickSize != 0) revert InvalidTickSize();
        }
        
        if (orderType == OrderType.STOP_LOSS) {
            if (stopPrice == 0) revert InvalidPrice();
        }
        
        if (orderType == OrderType.ICEBERG) {
            if (visibleAmount == 0 || visibleAmount > amount) revert InvalidAmount();
        }
        
        if (expirationTime != 0 && expirationTime < block.timestamp + MIN_ORDER_LIFETIME) {
            revert OrderExpired();
        }
    }

    function _checkWashTrading(
        address trader,
        address baseToken,
        address quoteToken,
        Side side
    ) private view {
        TradingActivity storage activity = tradingActivity[trader][
            side == Side.BUY ? quoteToken : baseToken
        ];
        
        // Check if user has traded with themselves recently
        if (activity.lastTradeWithUser[trader] + WASH_TRADE_COOLDOWN > block.timestamp) {
            revert WashTradeDetected();
        }
    }

    function _addToOrderBook(uint256 orderId) private {
        Order storage order = orders[orderId];
        bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
        
        if (order.side == Side.BUY) {
            buyOrders[pairId].add(order.price);
        } else {
            sellOrders[pairId].add(order.price);
        }
        
        ordersAtPrice[pairId][order.price].add(orderId);
    }

    function _removeFromOrderBook(uint256 orderId) private {
        Order storage order = orders[orderId];
        bytes32 pairId = getPairId(order.baseToken, order.quoteToken);
        
        ordersAtPrice[pairId][order.price].remove(orderId);
        
        if (ordersAtPrice[pairId][order.price].length() == 0) {
            if (order.side == Side.BUY) {
                buyOrders[pairId].remove(order.price);
            } else {
                sellOrders[pairId].remove(order.price);
            }
        }
    }

    function _processMarketOrder(uint256 orderId) private {
        Order storage marketOrder = orders[orderId];
        bytes32 pairId = getPairId(marketOrder.baseToken, marketOrder.quoteToken);
        
        EnumerableSet.UintSet storage oppositeOrders = marketOrder.side == Side.BUY ? 
            sellOrders[pairId] : buyOrders[pairId];
        
        uint256 remainingAmount = marketOrder.amount;
        uint256 totalCost = 0;
        
        // Get best prices first (sorted)
        uint256[] memory prices = new uint256[](oppositeOrders.length());
        for (uint i = 0; i < oppositeOrders.length(); i++) {
            prices[i] = oppositeOrders.at(i);
        }
        
        // Sort prices (ascending for buy market orders, descending for sell)
        _sortPrices(prices, marketOrder.side == Side.BUY);
        
        // Match against order book
        for (uint i = 0; i < prices.length && remainingAmount > 0; i++) {
            uint256 price = prices[i];
            EnumerableSet.UintSet storage ordersAtThisPrice = ordersAtPrice[pairId][price];
            
            // Check price deviation
            if (i == 0 && marketOrder.side == Side.BUY) {
                PairConfig memory config = pairConfigs[pairId];
                uint256 maxPrice = (marketOrder.price * (10000 + config.maxPriceDeviation)) / 10000;
                if (price > maxPrice) revert PriceDeviationTooHigh();
            }
            
            // Process orders at this price level (FIFO)
            for (uint j = 0; j < ordersAtThisPrice.length() && remainingAmount > 0; j++) {
                uint256 limitOrderId = ordersAtThisPrice.at(j);
                Order storage limitOrder = orders[limitOrderId];
                
                if (limitOrder.status == OrderStatus.ACTIVE || 
                    limitOrder.status == OrderStatus.PARTIALLY_FILLED) {
                    
                    uint256 fillAmount = _calculateFillAmount(limitOrder, remainingAmount);
                    if (fillAmount > 0) {
                        _executeTrade(orderId, limitOrderId, price, fillAmount);
                        remainingAmount -= fillAmount;
                        totalCost += (price * fillAmount) / PRECISION;
                    }
                }
            }
        }
        
        // Update market order status
        marketOrder.filledAmount = marketOrder.amount - remainingAmount;
        if (marketOrder.filledAmount == marketOrder.amount) {
            marketOrder.status = OrderStatus.FILLED;
        } else if (marketOrder.filledAmount > 0) {
            marketOrder.status = OrderStatus.PARTIALLY_FILLED;
        }
    }

    function _matchOrders(address baseToken, address quoteToken) private {
        bytes32 pairId = getPairId(baseToken, quoteToken);
        
        // Get sorted price levels
        uint256[] memory buyPrices = _getSortedPrices(buyOrders[pairId], false); // descending
        uint256[] memory sellPrices = _getSortedPrices(sellOrders[pairId], true); // ascending
        
        uint256 buyIndex = 0;
        uint256 sellIndex = 0;
        
        while (buyIndex < buyPrices.length && 
               sellIndex < sellPrices.length && 
               buyPrices[buyIndex] >= sellPrices[sellIndex]) {
            
            uint256 matchPrice = sellPrices[sellIndex]; // Price-time priority favors earlier orders
            
            EnumerableSet.UintSet storage buyOrdersAtPrice = ordersAtPrice[pairId][buyPrices[buyIndex]];
            EnumerableSet.UintSet storage sellOrdersAtPrice = ordersAtPrice[pairId][sellPrices[sellIndex]];
            
            uint256 buyOrderIndex = 0;
            uint256 sellOrderIndex = 0;
            
            while (buyOrderIndex < buyOrdersAtPrice.length() && 
                   sellOrderIndex < sellOrdersAtPrice.length()) {
                
                uint256 buyOrderId = buyOrdersAtPrice.at(buyOrderIndex);
                uint256 sellOrderId = sellOrdersAtPrice.at(sellOrderIndex);
                
                Order storage buyOrder = orders[buyOrderId];
                Order storage sellOrder = orders[sellOrderId];
                
                if ((buyOrder.status == OrderStatus.ACTIVE || buyOrder.status == OrderStatus.PARTIALLY_FILLED) &&
                    (sellOrder.status == OrderStatus.ACTIVE || sellOrder.status == OrderStatus.PARTIALLY_FILLED)) {
                    
                    uint256 buyRemaining = buyOrder.amount - buyOrder.filledAmount;
                    uint256 sellRemaining = sellOrder.amount - sellOrder.filledAmount;
                    
                    uint256 fillAmount = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;
                    
                    if (fillAmount > 0) {
                        _executeTrade(buyOrderId, sellOrderId, matchPrice, fillAmount);
                        
                        if (buyOrder.filledAmount == buyOrder.amount) {
                            buyOrderIndex++;
                        }
                        if (sellOrder.filledAmount == sellOrder.amount) {
                            sellOrderIndex++;
                        }
                    } else {
                        buyOrderIndex++;
                        sellOrderIndex++;
                    }
                } else {
                    if (buyOrder.status != OrderStatus.ACTIVE && buyOrder.status != OrderStatus.PARTIALLY_FILLED) {
                        buyOrderIndex++;
                    }
                    if (sellOrder.status != OrderStatus.ACTIVE && sellOrder.status != OrderStatus.PARTIALLY_FILLED) {
                        sellOrderIndex++;
                    }
                }
            }
            
            // Move to next price level if all orders at current level are processed
            if (buyOrderIndex >= buyOrdersAtPrice.length()) {
                buyIndex++;
            }
            if (sellOrderIndex >= sellOrdersAtPrice.length()) {
                sellIndex++;
            }
        }
    }

    function _executeTrade(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 price,
        uint256 amount
    ) private {
        Order storage buyOrder = orders[buyOrderId];
        Order storage sellOrder = orders[sellOrderId];
        
        // Update order fill amounts
        buyOrder.filledAmount += amount;
        sellOrder.filledAmount += amount;
        
        // Update order statuses
        if (buyOrder.filledAmount == buyOrder.amount) {
            buyOrder.status = OrderStatus.FILLED;
            _removeFromOrderBook(buyOrderId);
        } else {
            buyOrder.status = OrderStatus.PARTIALLY_FILLED;
        }
        
        if (sellOrder.filledAmount == sellOrder.amount) {
            sellOrder.status = OrderStatus.FILLED;
            _removeFromOrderBook(sellOrderId);
        } else {
            sellOrder.status = OrderStatus.PARTIALLY_FILLED;
            
            // Handle iceberg order refill
            if (sellOrder.orderType == OrderType.ICEBERG) {
                _refillIcebergOrder(sellOrderId);
            }
        }
        
        // Calculate fees
        bytes32 pairId = getPairId(buyOrder.baseToken, buyOrder.quoteToken);
        PairConfig memory config = pairConfigs[pairId];
        
        uint256 buyerFee = (amount * config.takerFee) / 10000;
        uint256 sellerFee = (amount * config.makerFee) / 10000;
        
        // Execute transfers
        uint256 quoteAmount = (price * amount) / PRECISION;
        uint256 netBaseAmount = amount - sellerFee;
        uint256 netQuoteAmount = quoteAmount;
        
        // Transfer base tokens to buyer
        IERC20(buyOrder.baseToken).safeTransfer(buyOrder.trader, netBaseAmount);
        
        // Transfer quote tokens to seller
        IERC20(buyOrder.quoteToken).safeTransfer(sellOrder.trader, netQuoteAmount);
        
        // Transfer fees
        if (buyerFee > 0) {
            IERC20(buyOrder.baseToken).safeTransfer(feeCollector, buyerFee);
        }
        if (sellerFee > 0) {
            IERC20(buyOrder.baseToken).safeTransfer(feeCollector, sellerFee);
        }
        
        // Record trade
        uint256 tradeId = nextTradeId++;
        trades[tradeId] = Trade({
            tradeId: tradeId,
            buyOrderId: buyOrderId,
            sellOrderId: sellOrderId,
            baseToken: buyOrder.baseToken,
            quoteToken: buyOrder.quoteToken,
            price: price,
            amount: amount,
            timestamp: block.timestamp,
            buyer: buyOrder.trader,
            seller: sellOrder.trader
        });
        
        // Update trading activity for wash trading detection
        _updateTradingActivity(buyOrder.trader, sellOrder.trader, buyOrder.baseToken, buyOrder.quoteToken);
        
        emit OrderMatched(tradeId, buyOrderId, sellOrderId, price, amount);
    }

    function _calculateFillAmount(
        Order storage order,
        uint256 requestedAmount
    ) private view returns (uint256) {
        uint256 available = order.amount - order.filledAmount;
        
        if (order.orderType == OrderType.ICEBERG) {
            available = order.visibleAmount < available ? order.visibleAmount : available;
        }
        
        return requestedAmount < available ? requestedAmount : available;
    }

    function _refillIcebergOrder(uint256 orderId) private {
        Order storage order = orders[orderId];
        uint256 remaining = order.amount - order.filledAmount;
        
        if (remaining > 0 && order.visibleAmount < remaining) {
            // Refill visible amount
            order.visibleAmount = order.visibleAmount < remaining ? order.visibleAmount : remaining;
        }
    }

    function _updateTradingActivity(
        address buyer,
        address seller,
        address baseToken,
        address quoteToken
    ) private {
        // Update buyer activity
        TradingActivity storage buyerActivity = tradingActivity[buyer][quoteToken];
        buyerActivity.lastTradeTime = block.timestamp;
        buyerActivity.lastTradeWithUser[seller] = block.timestamp;
        
        // Update seller activity
        TradingActivity storage sellerActivity = tradingActivity[seller][baseToken];
        sellerActivity.lastTradeTime = block.timestamp;
        sellerActivity.lastTradeWithUser[buyer] = block.timestamp;
        
        // Check for wash trading
        if (buyer == seller) {
            emit WashTradeDetected(buyer, seller, baseToken, quoteToken);
        }
    }

    function _sortPrices(uint256[] memory prices, bool ascending) private pure {
        // Simple bubble sort for demo (use more efficient algorithm in production)
        for (uint i = 0; i < prices.length; i++) {
            for (uint j = i + 1; j < prices.length; j++) {
                if ((ascending && prices[i] > prices[j]) || (!ascending && prices[i] < prices[j])) {
                    uint256 temp = prices[i];
                    prices[i] = prices[j];
                    prices[j] = temp;
                }
            }
        }
    }

    function _getSortedPrices(
        EnumerableSet.UintSet storage priceSet,
        bool ascending
    ) private view returns (uint256[] memory) {
        uint256[] memory prices = new uint256[](priceSet.length());
        for (uint i = 0; i < priceSet.length(); i++) {
            prices[i] = priceSet.at(i);
        }
        _sortPrices(prices, ascending);
        return prices;
    }

    function getPairId(address baseToken, address quoteToken) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(baseToken, quoteToken));
    }

    // Admin functions

    function pause() external onlyRole(OPERATOR_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(OPERATOR_ROLE) {
        _unpause();
    }

    function setFeeCollector(address _feeCollector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_feeCollector == address(0)) revert InvalidPair();
        feeCollector = _feeCollector;
    }

    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(to, amount);
    }
}