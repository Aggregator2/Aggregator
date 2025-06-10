// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Minimal Escrow Contract
 * @notice A completely simplified version to test basic functionality
 */
contract MinimalEscrow {
    enum State { AWAITING_DEPOSIT, AWAITING_CONFIRMATION, COMPLETE, REFUNDED }
    
    State public currentState;
    address public immutable depositor;
    address public immutable token;
    address public immutable arbiter;
    uint256 private amount;

    constructor(
        address _depositor,
        address _token,
        uint256 _amount,
        address _arbiter
    ) {
        require(_depositor != address(0), "Depositor address cannot be zero");
        require(_token != address(0), "Token address cannot be zero");
        require(_amount > 0, "Amount must be greater than zero");
        require(_arbiter != address(0), "Arbiter address cannot be zero");

        depositor = _depositor;
        token = _token;
        amount = _amount;
        arbiter = _arbiter;
        currentState = State.AWAITING_DEPOSIT;
    }

    function getAmount() public view returns (uint256) {
        return amount;
    }
    
    function getState() public view returns (State) {
        return currentState;
    }
    
    function setState(State _newState) public {
        require(msg.sender == depositor || msg.sender == arbiter, "Unauthorized");
        currentState = _newState;
    }
}
