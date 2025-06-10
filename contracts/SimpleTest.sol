// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title Simple Test Contract
 * @notice A minimal contract to test basic functionality
 */
contract SimpleTest {
    uint256 public value;
    address public owner;
    
    constructor(uint256 _value) {
        value = _value;
        owner = msg.sender;
    }
    
    function getValue() public view returns (uint256) {
        return value;
    }
    
    function getOwner() public view returns (address) {
        return owner;
    }
    
    function setValue(uint256 _value) public {
        require(msg.sender == owner, "Only owner can set value");
        value = _value;
    }
}
