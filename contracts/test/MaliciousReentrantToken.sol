// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISettlement {
    struct Order {
        address maker;
        address taker;
        address makerToken;
        address takerToken;
        uint128 makerAmount;
        uint128 takerAmount;
        uint256 makerTokenId;
        uint256 takerTokenId;
        uint256 salt;
        uint64 expiry;
        uint64 nonce;
        uint8 makerTokenType;
        uint8 takerTokenType;
        uint16 makerFee;
        uint16 takerFee;
        address feeRecipient;
    }
    
    function fillOrder(Order calldata order, uint128 fillAmount, bytes calldata signature) external;
}

contract MaliciousReentrantToken is ERC20 {
    address public settlementContract;
    bool public attackMode;
    
    constructor(address _settlementContract) ERC20("Malicious", "MAL") {
        settlementContract = _settlementContract;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    function setAttackMode(bool _attackMode) external {
        attackMode = _attackMode;
    }
    
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (attackMode && to == settlementContract) {
            // Attempt reentrancy attack
            // This will fail due to reentrancy guard
            bytes memory emptySignature = new bytes(65);
            ISettlement.Order memory dummyOrder;
            
            try ISettlement(settlementContract).fillOrder(dummyOrder, 0, emptySignature) {
                // If this succeeds, reentrancy guard failed
            } catch {
                // Expected - reentrancy guard working
            }
        }
        return super.transferFrom(from, to, amount);
    }
}