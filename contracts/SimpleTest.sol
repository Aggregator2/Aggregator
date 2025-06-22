// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title Simple Test Contract
 * @notice A minimal contract to test basic functionality
 */
contract SimpleTest is ERC20 {
    uint256 public value;
    address public owner;
    
    constructor() ERC20("TestToken", "TEST") {
        value = 0;
        owner = msg.sender;
        _mint(msg.sender, 1000000 * 10**decimals()); // Mint 1M tokens to deployer
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
    
    function mint(address to, uint256 amount) public {
        require(msg.sender == owner, "Only owner can mint");
        _mint(to, amount);
    }
}
