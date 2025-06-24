// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title MEVProtection
 * @notice Advanced MEV protection mechanisms
 */
abstract contract MEVProtection {
    // Commit-reveal delay
    uint256 public constant COMMIT_DELAY = 1; // blocks
    uint256 public constant MAX_REVEAL_WINDOW = 50; // blocks
    
    // Private mempool simulation protection
    mapping(bytes32 => uint256) private commitmentBlocks;
    mapping(address => uint256) private lastActionBlock;
    
    // Flashloan protection
    uint256 private constant FLASHLOAN_PROTECTION_BLOCKS = 2;
    
    event CommitmentMade(bytes32 indexed commitHash, uint256 blockNumber);
    event CommitmentRevealed(bytes32 indexed commitHash);
    
    modifier preventSameBlockAction() {
        require(
            lastActionBlock[msg.sender] < block.number,
            "MEV: Same block action prevented"
        );
        lastActionBlock[msg.sender] = block.number;
        _;
    }
    
    modifier preventFlashLoan() {
        require(
            lastActionBlock[msg.sender] + FLASHLOAN_PROTECTION_BLOCKS < block.number,
            "MEV: Potential flashloan detected"
        );
        _;
    }
    
    function _commitAction(bytes32 commitHash) internal {
        require(commitmentBlocks[commitHash] == 0, "Commitment already exists");
        commitmentBlocks[commitHash] = block.number;
        emit CommitmentMade(commitHash, block.number);
    }
    
    function _revealAction(bytes32 commitHash) internal view {
        uint256 commitBlock = commitmentBlocks[commitHash];
        require(commitBlock > 0, "No commitment found");
        require(
            block.number >= commitBlock + COMMIT_DELAY,
            "Reveal too early"
        );
        require(
            block.number <= commitBlock + MAX_REVEAL_WINDOW,
            "Reveal window expired"
        );
    }
    
    function _clearCommitment(bytes32 commitHash) internal {
        delete commitmentBlocks[commitHash];
        emit CommitmentRevealed(commitHash);
    }
    
    // Sandwich attack protection for swaps
    function _calculateMinOutput(
        uint256 amountIn,
        uint256 expectedOut,
        uint256 maxSlippageBps // basis points, e.g., 100 = 1%
    ) internal pure returns (uint256) {
        return expectedOut - (expectedOut * maxSlippageBps / 10000);
    }
    
    // Time-weighted average price protection
    function _isWithinPriceRange(
        uint256 currentPrice,
        uint256 twapPrice,
        uint256 maxDeviationBps
    ) internal pure returns (bool) {
        uint256 deviation = currentPrice > twapPrice
            ? ((currentPrice - twapPrice) * 10000) / twapPrice
            : ((twapPrice - currentPrice) * 10000) / twapPrice;
            
        return deviation <= maxDeviationBps;
    }
}