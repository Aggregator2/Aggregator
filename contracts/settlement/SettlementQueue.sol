// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SettlementQueue
 * @author DEX Team
 * @notice Advanced settlement queue system with priority ordering, retry mechanisms, and gas optimization
 * @dev Implements a priority queue for settlement processing with EIP-1559 support
 */
contract SettlementQueue is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    // Custom errors
    error InvalidSettlement();
    error SettlementNotFound();
    error SettlementAlreadyProcessed();
    error InsufficientBalance();
    error UnauthorizedCaller();
    error InvalidPriority();
    error MaxRetriesExceeded();
    error InvalidGasParameters();
    error SettlementExpired();
    error InvalidThreshold();
    error InsufficientSignatures();
    error DuplicateSignature();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error InvalidNonce();

    // Role definitions
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");

    // Constants
    uint256 public constant MAX_PRIORITY = 1000;
    uint256 public constant MIN_PRIORITY = 1;
    uint256 public constant MAX_RETRIES = 5;
    uint256 public constant INITIAL_BACKOFF = 30 seconds;
    uint256 public constant MAX_BACKOFF = 24 hours;
    uint256 public constant SETTLEMENT_EXPIRY = 7 days;
    uint256 public constant MAX_BATCH_SIZE = 100;

    // Settlement status enum
    enum SettlementStatus {
        Queued,
        Processing,
        Completed,
        Failed,
        Expired,
        Cancelled
    }

    // Gas optimization parameters
    struct GasParams {
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        uint256 gasLimit;
        bool useEIP1559;
    }

    // Settlement structure
    struct Settlement {
        uint256 id;
        address from;
        address to;
        address token;
        uint256 amount;
        uint256 priority;
        uint256 nonce;
        uint256 createdAt;
        uint256 processedAt;
        uint256 retryCount;
        uint256 nextRetryTime;
        SettlementStatus status;
        bytes32 dataHash;
        GasParams gasParams;
        uint256 requiredSignatures;
        bool isLargeSettlement;
    }

    // Multi-sig structure for large settlements
    struct MultiSigApproval {
        mapping(address => bool) hasSigned;
        address[] signers;
        uint256 signatureCount;
        bool executed;
    }

    // State variables
    uint256 private _nextSettlementId = 1;
    uint256 private _currentNonce;
    uint256 public largeSettlementThreshold;
    uint256 public requiredSignaturesForLarge = 3;

    // Mappings
    mapping(uint256 => Settlement) public settlements;
    mapping(uint256 => MultiSigApproval) private multiSigApprovals;
    mapping(bytes32 => bool) private processedHashes;
    mapping(address => uint256) public userNonces;
    mapping(uint256 => bool) public usedNonces;

    // Priority queue implementation using sorted sets
    mapping(uint256 => EnumerableSet.UintSet) private priorityQueues;
    EnumerableSet.UintSet private activePriorities;
    EnumerableSet.UintSet private queuedSettlements;
    EnumerableSet.UintSet private processingSettlements;

    // Events
    event SettlementQueued(
        uint256 indexed settlementId,
        address indexed from,
        address indexed to,
        address token,
        uint256 amount,
        uint256 priority
    );

    event SettlementProcessed(
        uint256 indexed settlementId,
        address indexed executor,
        uint256 gasUsed,
        bool success
    );

    event SettlementRetrying(
        uint256 indexed settlementId,
        uint256 retryCount,
        uint256 nextRetryTime
    );

    event SettlementFailed(
        uint256 indexed settlementId,
        string reason,
        uint256 retryCount
    );

    event LargeSettlementSigned(
        uint256 indexed settlementId,
        address indexed signer,
        uint256 signatureCount,
        uint256 required
    );

    event GasParamsUpdated(
        uint256 indexed settlementId,
        uint256 maxFeePerGas,
        uint256 maxPriorityFeePerGas
    );

    event ThresholdUpdated(
        uint256 oldThreshold,
        uint256 newThreshold
    );

    /**
     * @notice Constructor
     * @param _largeSettlementThreshold Threshold for multi-sig requirement
     */
    constructor(uint256 _largeSettlementThreshold) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
        
        largeSettlementThreshold = _largeSettlementThreshold;
    }

    /**
     * @notice Queue a new settlement
     * @param to Recipient address
     * @param token Token address
     * @param amount Settlement amount
     * @param priority Priority level (1-1000)
     * @param gasParams Gas optimization parameters
     * @return settlementId The ID of the queued settlement
     */
    function queueSettlement(
        address to,
        address token,
        uint256 amount,
        uint256 priority,
        GasParams calldata gasParams
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (uint256 settlementId) {
        if (to == address(0) || token == address(0)) revert InvalidSettlement();
        if (amount == 0) revert InvalidSettlement();
        if (priority < MIN_PRIORITY || priority > MAX_PRIORITY) revert InvalidPriority();
        if (gasParams.useEIP1559 && gasParams.maxFeePerGas == 0) revert InvalidGasParameters();

        settlementId = _nextSettlementId++;
        uint256 nonce = _getNextNonce();
        
        bool isLarge = amount >= largeSettlementThreshold;
        uint256 requiredSigs = isLarge ? requiredSignaturesForLarge : 0;

        settlements[settlementId] = Settlement({
            id: settlementId,
            from: address(this),
            to: to,
            token: token,
            amount: amount,
            priority: priority,
            nonce: nonce,
            createdAt: block.timestamp,
            processedAt: 0,
            retryCount: 0,
            nextRetryTime: 0,
            status: SettlementStatus.Queued,
            dataHash: keccak256(abi.encode(to, token, amount, nonce)),
            gasParams: gasParams,
            requiredSignatures: requiredSigs,
            isLargeSettlement: isLarge
        });

        // Add to priority queue
        priorityQueues[priority].add(settlementId);
        activePriorities.add(priority);
        queuedSettlements.add(settlementId);

        emit SettlementQueued(settlementId, address(this), to, token, amount, priority);
    }

    /**
     * @notice Process next settlement in queue
     * @dev Processes highest priority settlement first
     */
    function processNextSettlement() external onlyRole(EXECUTOR_ROLE) nonReentrant whenNotPaused {
        uint256 settlementId = _getNextSettlement();
        if (settlementId == 0) revert SettlementNotFound();

        _processSettlement(settlementId);
    }

    /**
     * @notice Process multiple settlements in batch
     * @param maxCount Maximum number of settlements to process
     */
    function processBatch(uint256 maxCount) external onlyRole(EXECUTOR_ROLE) nonReentrant whenNotPaused {
        uint256 processed = 0;
        uint256 count = maxCount > MAX_BATCH_SIZE ? MAX_BATCH_SIZE : maxCount;

        while (processed < count) {
            uint256 settlementId = _getNextSettlement();
            if (settlementId == 0) break;

            _processSettlement(settlementId);
            processed++;
        }
    }

    /**
     * @notice Sign a large settlement
     * @param settlementId Settlement to sign
     */
    function signLargeSettlement(uint256 settlementId) external onlyRole(SIGNER_ROLE) {
        Settlement storage settlement = settlements[settlementId];
        if (settlement.id == 0) revert SettlementNotFound();
        if (!settlement.isLargeSettlement) revert InvalidSettlement();
        if (settlement.status != SettlementStatus.Queued) revert SettlementAlreadyProcessed();

        MultiSigApproval storage approval = multiSigApprovals[settlementId];
        if (approval.hasSigned[msg.sender]) revert DuplicateSignature();

        approval.hasSigned[msg.sender] = true;
        approval.signers.push(msg.sender);
        approval.signatureCount++;

        emit LargeSettlementSigned(
            settlementId,
            msg.sender,
            approval.signatureCount,
            settlement.requiredSignatures
        );
    }

    /**
     * @notice Update gas parameters for a settlement
     * @param settlementId Settlement to update
     * @param newGasParams New gas parameters
     */
    function updateGasParams(
        uint256 settlementId,
        GasParams calldata newGasParams
    ) external onlyRole(OPERATOR_ROLE) {
        Settlement storage settlement = settlements[settlementId];
        if (settlement.id == 0) revert SettlementNotFound();
        if (settlement.status != SettlementStatus.Queued) revert SettlementAlreadyProcessed();

        settlement.gasParams = newGasParams;

        emit GasParamsUpdated(
            settlementId,
            newGasParams.maxFeePerGas,
            newGasParams.maxPriorityFeePerGas
        );
    }

    /**
     * @notice Retry a failed settlement
     * @param settlementId Settlement to retry
     */
    function retrySettlement(uint256 settlementId) external onlyRole(EXECUTOR_ROLE) whenNotPaused {
        Settlement storage settlement = settlements[settlementId];
        if (settlement.id == 0) revert SettlementNotFound();
        if (settlement.status != SettlementStatus.Failed) revert InvalidSettlement();
        if (settlement.retryCount >= MAX_RETRIES) revert MaxRetriesExceeded();
        if (block.timestamp < settlement.nextRetryTime) revert InvalidSettlement();

        // Reset status and add back to queue
        settlement.status = SettlementStatus.Queued;
        settlement.nextRetryTime = 0;
        
        priorityQueues[settlement.priority].add(settlementId);
        activePriorities.add(settlement.priority);
        queuedSettlements.add(settlementId);

        emit SettlementRetrying(settlementId, settlement.retryCount, settlement.nextRetryTime);
    }

    /**
     * @notice Cancel a settlement
     * @param settlementId Settlement to cancel
     */
    function cancelSettlement(uint256 settlementId) external onlyRole(OPERATOR_ROLE) {
        Settlement storage settlement = settlements[settlementId];
        if (settlement.id == 0) revert SettlementNotFound();
        if (settlement.status != SettlementStatus.Queued) revert SettlementAlreadyProcessed();

        _removeFromQueue(settlementId, settlement.priority);
        settlement.status = SettlementStatus.Cancelled;
    }

    /**
     * @notice Update large settlement threshold
     * @param newThreshold New threshold amount
     */
    function updateLargeSettlementThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newThreshold == 0) revert InvalidThreshold();
        
        uint256 oldThreshold = largeSettlementThreshold;
        largeSettlementThreshold = newThreshold;
        
        emit ThresholdUpdated(oldThreshold, newThreshold);
    }

    /**
     * @notice Update required signatures for large settlements
     * @param newRequired New number of required signatures
     */
    function updateRequiredSignatures(uint256 newRequired) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newRequired == 0) revert InvalidThreshold();
        requiredSignaturesForLarge = newRequired;
    }

    /**
     * @notice Get next settlement from priority queue
     * @return settlementId Next settlement ID or 0 if none
     */
    function _getNextSettlement() private returns (uint256 settlementId) {
        uint256[] memory priorities = activePriorities.values();
        if (priorities.length == 0) return 0;

        // Sort priorities in descending order
        _quickSort(priorities, 0, priorities.length - 1);

        // Find highest priority settlement
        for (uint256 i = 0; i < priorities.length; i++) {
            uint256 priority = priorities[i];
            if (priorityQueues[priority].length() > 0) {
                uint256[] memory ids = priorityQueues[priority].values();
                
                for (uint256 j = 0; j < ids.length; j++) {
                    Settlement storage settlement = settlements[ids[j]];
                    
                    // Check if settlement is ready
                    if (_isSettlementReady(settlement)) {
                        settlementId = ids[j];
                        _removeFromQueue(settlementId, priority);
                        return settlementId;
                    }
                }
            }
        }
    }

    /**
     * @notice Check if settlement is ready to process
     * @param settlement Settlement to check
     * @return ready Whether settlement is ready
     */
    function _isSettlementReady(Settlement storage settlement) private view returns (bool ready) {
        // Check expiry
        if (block.timestamp > settlement.createdAt + SETTLEMENT_EXPIRY) {
            return false;
        }

        // Check multi-sig for large settlements
        if (settlement.isLargeSettlement) {
            MultiSigApproval storage approval = multiSigApprovals[settlement.id];
            if (approval.signatureCount < settlement.requiredSignatures) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Process a settlement
     * @param settlementId Settlement to process
     */
    function _processSettlement(uint256 settlementId) private {
        Settlement storage settlement = settlements[settlementId];
        
        // Update status
        settlement.status = SettlementStatus.Processing;
        processingSettlements.add(settlementId);

        // Check token balance
        IERC20 token = IERC20(settlement.token);
        uint256 balance = token.balanceOf(address(this));
        
        if (balance < settlement.amount) {
            _handleFailedSettlement(settlementId, "Insufficient balance");
            return;
        }

        // Estimate and set gas parameters
        if (settlement.gasParams.useEIP1559) {
            // In production, would interact with gas oracle
            // For now, use provided parameters
        }

        // Execute transfer
        bool success;
        try token.safeTransfer(settlement.to, settlement.amount) {
            success = true;
        } catch {
            success = false;
        }

        if (success) {
            settlement.status = SettlementStatus.Completed;
            settlement.processedAt = block.timestamp;
            processingSettlements.remove(settlementId);
            
            // Mark nonce as used
            usedNonces[settlement.nonce] = true;
            
            emit SettlementProcessed(settlementId, msg.sender, 0, true);
        } else {
            _handleFailedSettlement(settlementId, "Transfer failed");
        }
    }

    /**
     * @notice Handle failed settlement
     * @param settlementId Failed settlement ID
     * @param reason Failure reason
     */
    function _handleFailedSettlement(uint256 settlementId, string memory reason) private {
        Settlement storage settlement = settlements[settlementId];
        
        settlement.status = SettlementStatus.Failed;
        settlement.retryCount++;
        processingSettlements.remove(settlementId);

        if (settlement.retryCount < MAX_RETRIES) {
            // Calculate exponential backoff
            uint256 backoff = INITIAL_BACKOFF * (2 ** (settlement.retryCount - 1));
            if (backoff > MAX_BACKOFF) backoff = MAX_BACKOFF;
            
            settlement.nextRetryTime = block.timestamp + backoff;
            
            emit SettlementFailed(settlementId, reason, settlement.retryCount);
        } else {
            emit SettlementFailed(settlementId, "Max retries exceeded", settlement.retryCount);
        }
    }

    /**
     * @notice Remove settlement from queue
     * @param settlementId Settlement to remove
     * @param priority Settlement priority
     */
    function _removeFromQueue(uint256 settlementId, uint256 priority) private {
        priorityQueues[priority].remove(settlementId);
        if (priorityQueues[priority].length() == 0) {
            activePriorities.remove(priority);
        }
        queuedSettlements.remove(settlementId);
    }

    /**
     * @notice Get next nonce
     * @return nonce Next available nonce
     */
    function _getNextNonce() private returns (uint256 nonce) {
        nonce = _currentNonce++;
        while (usedNonces[nonce]) {
            nonce = _currentNonce++;
        }
    }

    /**
     * @notice Quick sort implementation for priority sorting
     * @param arr Array to sort
     * @param left Left index
     * @param right Right index
     */
    function _quickSort(uint256[] memory arr, uint256 left, uint256 right) private pure {
        if (left >= right) return;
        
        uint256 pivotIndex = (left + right) / 2;
        uint256 pivotValue = arr[pivotIndex];
        uint256 i = left;
        uint256 j = right;
        
        while (i <= j) {
            while (arr[i] > pivotValue) i++;
            while (pivotValue > arr[j]) j--;
            
            if (i <= j) {
                (arr[i], arr[j]) = (arr[j], arr[i]);
                i++;
                if (j > 0) j--;
            }
        }
        
        if (left < j) _quickSort(arr, left, j);
        if (i < right) _quickSort(arr, i, right);
    }

    /**
     * @notice Get settlement details
     * @param settlementId Settlement ID
     * @return Settlement details
     */
    function getSettlement(uint256 settlementId) external view returns (Settlement memory) {
        return settlements[settlementId];
    }

    /**
     * @notice Get queued settlements count
     * @return count Number of queued settlements
     */
    function getQueuedCount() external view returns (uint256 count) {
        return queuedSettlements.length();
    }

    /**
     * @notice Get processing settlements count
     * @return count Number of processing settlements
     */
    function getProcessingCount() external view returns (uint256 count) {
        return processingSettlements.length();
    }

    /**
     * @notice Get settlements by status
     * @param status Status to filter by
     * @param offset Starting index
     * @param limit Maximum results
     * @return settlementIds Array of settlement IDs
     */
    function getSettlementsByStatus(
        SettlementStatus status,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory settlementIds) {
        uint256 count = 0;
        uint256 index = 0;
        
        // Count total matching settlements
        for (uint256 i = 1; i < _nextSettlementId; i++) {
            if (settlements[i].status == status) count++;
        }
        
        // Prepare result array
        uint256 resultSize = count - offset;
        if (resultSize > limit) resultSize = limit;
        settlementIds = new uint256[](resultSize);
        
        // Collect results
        for (uint256 i = 1; i < _nextSettlementId && index < resultSize; i++) {
            if (settlements[i].status == status) {
                if (count >= offset) {
                    settlementIds[index++] = i;
                }
                count++;
            }
        }
    }

    /**
     * @notice Emergency pause
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Resume operations
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Emergency token recovery
     * @param token Token to recover
     * @param amount Amount to recover
     * @param to Recipient address
     */
    function emergencyRecover(
        address token,
        uint256 amount,
        address to
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert InvalidSettlement();
        IERC20(token).safeTransfer(to, amount);
    }
}