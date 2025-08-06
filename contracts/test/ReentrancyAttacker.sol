// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISettlementWithProofs {
    struct ClaimData {
        string epochId;
        address token;
        uint256 amount;
        bytes32[] merkleProof;
    }

    function claimSettlement(
        string calldata epochId,
        address user,
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external;

    function batchClaimSettlements(ClaimData[] calldata claims) external;
}

contract ReentrancyAttacker {
    ISettlementWithProofs public immutable target;
    bool public attacking;
    uint256 public attackCount;
    
    string public attackEpochId;
    address public attackToken;
    uint256 public attackAmount;
    bytes32[] public attackProof;

    constructor(address _target) {
        target = ISettlementWithProofs(_target);
    }

    function setAttackParams(
        string memory epochId,
        address token,
        uint256 amount,
        bytes32[] memory proof
    ) external {
        attackEpochId = epochId;
        attackToken = token;
        attackAmount = amount;
        attackProof = proof;
    }

    function attack() external {
        attacking = true;
        attackCount = 0;
        
        // Initial claim
        target.claimSettlement(
            attackEpochId,
            address(this),
            attackToken,
            attackAmount,
            attackProof
        );
        
        attacking = false;
    }

    function attackBatch() external {
        attacking = true;
        attackCount = 0;
        
        ISettlementWithProofs.ClaimData[] memory claims = new ISettlementWithProofs.ClaimData[](1);
        claims[0] = ISettlementWithProofs.ClaimData({
            epochId: attackEpochId,
            token: attackToken,
            amount: attackAmount,
            merkleProof: attackProof
        });
        
        target.batchClaimSettlements(claims);
        
        attacking = false;
    }

    // This function is called when receiving tokens
    // In a real attack, this would try to re-enter the target contract
    receive() external payable {
        if (attacking && attackCount < 2) {
            attackCount++;
            // Try to re-enter
            try target.claimSettlement(
                attackEpochId,
                address(this),
                attackToken,
                attackAmount,
                attackProof
            ) {
                // Re-entry succeeded (should not happen with proper protection)
            } catch {
                // Re-entry failed (expected with nonReentrant modifier)
            }
        }
    }

    // ERC20 callback hook for reentrancy attempts
    function onERC20Received(address, uint256) external returns (bool) {
        if (attacking && attackCount < 2) {
            attackCount++;
            // Try to re-enter
            try target.claimSettlement(
                attackEpochId,
                address(this),
                attackToken,
                attackAmount,
                attackProof
            ) {
                // Re-entry succeeded
            } catch {
                // Re-entry failed
            }
        }
        return true;
    }
}