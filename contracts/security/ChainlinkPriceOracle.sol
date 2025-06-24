// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../interfaces/IPriceOracle.sol";

/**
 * @title ChainlinkPriceOracle
 * @notice Secure price oracle using Chainlink price feeds with staleness checks
 */
contract ChainlinkPriceOracle is IPriceOracle {
    uint256 public constant DEFAULT_MAX_PRICE_AGE = 3600; // 1 hour
    uint256 public constant MAX_PRICE_DEVIATION = 500; // 5% in basis points
    
    mapping(address => mapping(address => address)) public priceFeeds;
    mapping(address => uint8) public tokenDecimals;
    
    event PriceFeedSet(address tokenA, address tokenB, address feed);
    event PriceQueried(address tokenA, address tokenB, uint256 price);
    
    constructor() {}
    
    function setPriceFeed(
        address tokenA, 
        address tokenB, 
        address feed,
        uint8 decimalsA,
        uint8 decimalsB
    ) external {
        require(feed != address(0), "Invalid feed");
        priceFeeds[tokenA][tokenB] = feed;
        priceFeeds[tokenB][tokenA] = feed;
        tokenDecimals[tokenA] = decimalsA;
        tokenDecimals[tokenB] = decimalsB;
        emit PriceFeedSet(tokenA, tokenB, feed);
    }
    
    function getPrice(address tokenA, address tokenB) external view override returns (uint256) {
        return getPriceWithMaxAge(tokenA, tokenB, DEFAULT_MAX_PRICE_AGE);
    }
    
    function getPriceWithMaxAge(
        address tokenA, 
        address tokenB, 
        uint256 maxAge
    ) public view override returns (uint256) {
        address feed = priceFeeds[tokenA][tokenB];
        require(feed != address(0), "Price feed not set");
        
        AggregatorV3Interface priceFeed = AggregatorV3Interface(feed);
        
        (
            uint80 roundId,
            int256 price,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = priceFeed.latestRoundData();
        
        // Security checks
        require(price > 0, "Invalid price");
        require(updatedAt > 0, "Round not complete");
        require(answeredInRound >= roundId, "Stale price");
        require(block.timestamp - updatedAt <= maxAge, "Price too old");
        
        // Adjust for decimals
        uint8 feedDecimals = priceFeed.decimals();
        uint8 decimalsA = tokenDecimals[tokenA];
        uint8 decimalsB = tokenDecimals[tokenB];
        
        uint256 normalizedPrice = uint256(price);
        
        // Convert to proper decimal places
        if (decimalsA > decimalsB) {
            normalizedPrice = normalizedPrice * 10**(decimalsA - decimalsB);
        } else if (decimalsB > decimalsA) {
            normalizedPrice = normalizedPrice / 10**(decimalsB - decimalsA);
        }
        
        // Adjust for feed decimals
        if (feedDecimals < 18) {
            normalizedPrice = normalizedPrice * 10**(18 - feedDecimals);
        } else if (feedDecimals > 18) {
            normalizedPrice = normalizedPrice / 10**(feedDecimals - 18);
        }
        
        return normalizedPrice;
    }
    
    function validatePriceDeviation(
        uint256 expectedPrice,
        uint256 actualPrice
    ) external pure returns (bool) {
        uint256 deviation = expectedPrice > actualPrice 
            ? ((expectedPrice - actualPrice) * 10000) / expectedPrice
            : ((actualPrice - expectedPrice) * 10000) / actualPrice;
            
        return deviation <= MAX_PRICE_DEVIATION;
    }
}