// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title IThresholdWallet
 * @notice Interface for threshold signature wallets
 */
interface IThresholdWallet {
    function initialize(uint256 threshold, address[] memory owners) external;
    
    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline
    ) external returns (bytes32);
    
    function confirmTransaction(bytes32 transactionId) external;
    
    function revokeConfirmation(bytes32 transactionId) external;
    
    function executeTransaction(bytes32 transactionId) external;
    
    function executeWithSignatures(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata signatures
    ) external;
    
    function addOwner(address owner) external;
    
    function removeOwner(address owner) external;
    
    function changeThreshold(uint256 threshold) external;
}