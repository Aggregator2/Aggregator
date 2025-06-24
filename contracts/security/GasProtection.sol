// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title GasProtection
 * @notice Protection against gas griefing attacks
 */
abstract contract GasProtection {
    uint256 private constant MAX_CALLBACK_GAS = 100000;
    uint256 private constant MIN_GAS_RESERVE = 50000;
    
    // Gas stipend for external calls
    uint256 private constant SAFE_GAS_STIPEND = 2300;
    
    modifier ensureGasReserve() {
        require(gasleft() >= MIN_GAS_RESERVE, "Insufficient gas");
        _;
    }
    
    /**
     * @notice Safe external call with gas limit
     * @param target Address to call
     * @param data Calldata
     * @param gasLimit Maximum gas for the call
     */
    function _safeExternalCall(
        address target,
        bytes memory data,
        uint256 gasLimit
    ) internal returns (bool success, bytes memory returnData) {
        // Ensure we don't provide too much gas
        uint256 gasToUse = gasLimit > MAX_CALLBACK_GAS ? MAX_CALLBACK_GAS : gasLimit;
        
        // Make the call with limited gas
        (success, returnData) = target.call{gas: gasToUse}(data);
    }
    
    /**
     * @notice Safe ETH transfer with minimal gas
     * @param recipient Address to send ETH to
     * @param amount Amount of ETH to send
     */
    function _safeTransferETH(address recipient, uint256 amount) internal {
        (bool success, ) = recipient.call{value: amount, gas: SAFE_GAS_STIPEND}("");
        require(success, "ETH transfer failed");
    }
    
    /**
     * @notice Pull pattern for ETH withdrawals
     * @dev Prevents gas griefing by allowing users to withdraw their own funds
     */
    mapping(address => uint256) public pendingWithdrawals;
    
    function _recordPendingWithdrawal(address user, uint256 amount) internal {
        pendingWithdrawals[user] += amount;
    }
    
    function withdrawPending() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No pending withdrawal");
        
        pendingWithdrawals[msg.sender] = 0;
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal failed");
    }
}