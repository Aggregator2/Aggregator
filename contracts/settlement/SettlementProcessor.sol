// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SettlementQueue.sol";

/**
 * @title SettlementProcessor
 * @author DEX Team
 * @notice Advanced settlement processor with gas optimization and monitoring
 * @dev Handles execution of settlements with EIP-1559 support and gas price optimization
 */
contract SettlementProcessor is Ownable, ReentrancyGuard {
    // Custom errors
    error InvalidGasOracle();
    error InvalidParameters();
    error ProcessingFailed();
    error GasPriceTooHigh();
    error InsufficientETH();

    // Gas optimization settings
    struct GasConfig {
        uint256 maxGasPrice;
        uint256 priorityFeePercentage; // Percentage of base fee to use as priority fee
        uint256 gasBufferPercentage;   // Buffer for gas estimation (e.g., 120 = 20% buffer)
        bool dynamicGasEnabled;
        address gasOracle;
    }

    // Processing statistics
    struct ProcessingStats {
        uint256 totalProcessed;
        uint256 totalGasUsed;
        uint256 totalGasCost;
        uint256 successCount;
        uint256 failureCount;
        uint256 averageGasPrice;
        uint256 lastProcessedBlock;
    }

    // EIP-1559 gas parameters
    struct EIP1559Params {
        uint256 baseFee;
        uint256 maxPriorityFeePerGas;
        uint256 maxFeePerGas;
        uint256 estimatedGas;
    }

    // State variables
    SettlementQueue public immutable settlementQueue;
    GasConfig public gasConfig;
    ProcessingStats public stats;
    
    // Gas price history for optimization
    uint256[] private gasPriceHistory;
    uint256 private constant HISTORY_SIZE = 100;
    uint256 private historyIndex;

    // Events
    event GasConfigUpdated(
        uint256 maxGasPrice,
        uint256 priorityFeePercentage,
        bool dynamicGasEnabled
    );

    event SettlementExecuted(
        uint256 indexed settlementId,
        uint256 gasUsed,
        uint256 gasPrice,
        uint256 gasCost
    );

    event GasPriceOptimized(
        uint256 baseFee,
        uint256 priorityFee,
        uint256 maxFee
    );

    event ProcessingBatchCompleted(
        uint256 settlementsProcessed,
        uint256 totalGasUsed,
        uint256 averageGasPrice
    );

    /**
     * @notice Constructor
     * @param _settlementQueue Address of settlement queue contract
     * @param _gasOracle Address of gas oracle (optional)
     */
    constructor(address _settlementQueue, address _gasOracle) {
        if (_settlementQueue == address(0)) revert InvalidParameters();
        
        settlementQueue = SettlementQueue(_settlementQueue);
        
        // Initialize gas config
        gasConfig = GasConfig({
            maxGasPrice: 500 gwei,
            priorityFeePercentage: 10, // 10% of base fee
            gasBufferPercentage: 120,  // 20% buffer
            dynamicGasEnabled: true,
            gasOracle: _gasOracle
        });

        // Initialize gas price history
        gasPriceHistory = new uint256[](HISTORY_SIZE);
    }

    /**
     * @notice Process settlements with optimized gas settings
     * @param maxSettlements Maximum number of settlements to process
     */
    function processSettlements(uint256 maxSettlements) external nonReentrant {
        uint256 processed = 0;
        uint256 batchGasUsed = 0;
        uint256 batchGasCost = 0;

        while (processed < maxSettlements) {
            // Get current gas parameters
            EIP1559Params memory gasParams = _optimizeGasParameters();
            
            // Check if gas price is acceptable
            if (gasParams.maxFeePerGas > gasConfig.maxGasPrice) {
                emit GasPriceOptimized(gasParams.baseFee, gasParams.maxPriorityFeePerGas, gasParams.maxFeePerGas);
                break; // Wait for better gas prices
            }

            // Process next settlement
            uint256 gasStart = gasleft();
            
            try settlementQueue.processNextSettlement() {
                uint256 gasUsed = gasStart - gasleft();
                uint256 gasCost = gasUsed * tx.gasprice;
                
                // Update statistics
                stats.totalProcessed++;
                stats.successCount++;
                stats.totalGasUsed += gasUsed;
                stats.totalGasCost += gasCost;
                
                batchGasUsed += gasUsed;
                batchGasCost += gasCost;
                
                // Record gas price
                _recordGasPrice(tx.gasprice);
                
                processed++;
            } catch {
                stats.failureCount++;
                break; // Stop batch on failure
            }
        }

        // Update statistics
        if (processed > 0) {
            stats.lastProcessedBlock = block.number;
            stats.averageGasPrice = stats.totalGasCost / stats.totalGasUsed;
            
            emit ProcessingBatchCompleted(
                processed,
                batchGasUsed,
                batchGasCost / batchGasUsed
            );
        }
    }

    /**
     * @notice Optimize gas parameters based on current network conditions
     * @return params Optimized EIP-1559 parameters
     */
    function _optimizeGasParameters() private view returns (EIP1559Params memory params) {
        // Get base fee from block
        params.baseFee = block.basefee;
        
        // Calculate priority fee
        if (gasConfig.dynamicGasEnabled && gasConfig.gasOracle != address(0)) {
            // In production, would call gas oracle for optimal priority fee
            params.maxPriorityFeePerGas = _calculateDynamicPriorityFee();
        } else {
            // Use configured percentage of base fee
            params.maxPriorityFeePerGas = (params.baseFee * gasConfig.priorityFeePercentage) / 100;
        }
        
        // Calculate max fee with buffer
        params.maxFeePerGas = params.baseFee + params.maxPriorityFeePerGas;
        params.maxFeePerGas = (params.maxFeePerGas * gasConfig.gasBufferPercentage) / 100;
        
        // Estimate gas (simplified - in production would simulate transaction)
        params.estimatedGas = 100000; // Base estimate for ERC20 transfer
    }

    /**
     * @notice Calculate dynamic priority fee based on network conditions
     * @return priorityFee Calculated priority fee
     */
    function _calculateDynamicPriorityFee() private view returns (uint256 priorityFee) {
        // Use historical gas prices to determine optimal priority fee
        uint256 sum = 0;
        uint256 count = 0;
        
        for (uint256 i = 0; i < HISTORY_SIZE; i++) {
            if (gasPriceHistory[i] > 0) {
                sum += gasPriceHistory[i];
                count++;
            }
        }
        
        if (count > 0) {
            uint256 avgGasPrice = sum / count;
            // Priority fee is typically 10-20% of average gas price
            priorityFee = (avgGasPrice * 15) / 100;
        } else {
            // Default to 2 gwei if no history
            priorityFee = 2 gwei;
        }
        
        // Cap priority fee
        uint256 maxPriorityFee = 50 gwei;
        if (priorityFee > maxPriorityFee) {
            priorityFee = maxPriorityFee;
        }
    }

    /**
     * @notice Record gas price for historical analysis
     * @param gasPrice Gas price to record
     */
    function _recordGasPrice(uint256 gasPrice) private {
        gasPriceHistory[historyIndex] = gasPrice;
        historyIndex = (historyIndex + 1) % HISTORY_SIZE;
    }

    /**
     * @notice Update gas configuration
     * @param newConfig New gas configuration
     */
    function updateGasConfig(GasConfig calldata newConfig) external onlyOwner {
        if (newConfig.maxGasPrice == 0) revert InvalidParameters();
        if (newConfig.gasBufferPercentage < 100) revert InvalidParameters();
        
        gasConfig = newConfig;
        
        emit GasConfigUpdated(
            newConfig.maxGasPrice,
            newConfig.priorityFeePercentage,
            newConfig.dynamicGasEnabled
        );
    }

    /**
     * @notice Get current gas optimization parameters
     * @return params Current EIP-1559 parameters
     */
    function getCurrentGasParams() external view returns (EIP1559Params memory params) {
        return _optimizeGasParameters();
    }

    /**
     * @notice Get processing statistics
     * @return Processing statistics
     */
    function getStats() external view returns (ProcessingStats memory) {
        return stats;
    }

    /**
     * @notice Get gas price history
     * @return prices Array of historical gas prices
     */
    function getGasPriceHistory() external view returns (uint256[] memory prices) {
        prices = new uint256[](HISTORY_SIZE);
        uint256 startIndex = historyIndex;
        
        for (uint256 i = 0; i < HISTORY_SIZE; i++) {
            prices[i] = gasPriceHistory[(startIndex + i) % HISTORY_SIZE];
        }
    }

    /**
     * @notice Check if gas price is currently acceptable
     * @return acceptable Whether current gas price is below threshold
     */
    function isGasPriceAcceptable() external view returns (bool acceptable) {
        EIP1559Params memory params = _optimizeGasParameters();
        return params.maxFeePerGas <= gasConfig.maxGasPrice;
    }

    /**
     * @notice Emergency pause settlement processing
     * @dev Pauses the settlement queue contract
     */
    function emergencyPause() external onlyOwner {
        settlementQueue.pause();
    }

    /**
     * @notice Resume settlement processing
     * @dev Unpauses the settlement queue contract
     */
    function resumeProcessing() external onlyOwner {
        settlementQueue.unpause();
    }

    /**
     * @notice Withdraw accumulated ETH (for gas refunds)
     * @param amount Amount to withdraw
     * @param to Recipient address
     */
    function withdrawETH(uint256 amount, address payable to) external onlyOwner {
        if (address(this).balance < amount) revert InsufficientETH();
        to.transfer(amount);
    }

    /**
     * @notice Receive ETH for gas payments
     */
    receive() external payable {}
}