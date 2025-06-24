// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPriceOracle {
    function getPrice(address tokenA, address tokenB) external view returns (uint256);
    function getPriceWithMaxAge(address tokenA, address tokenB, uint256 maxAge) external view returns (uint256);
}