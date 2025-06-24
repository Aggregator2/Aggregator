// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CircuitBreaker
 * @notice Emergency pause mechanism with time-based and threshold-based triggers
 */
abstract contract CircuitBreaker is Ownable {
    // Circuit breaker states
    enum BreakerState { OPERATIONAL, PAUSED, EMERGENCY }
    
    BreakerState public breakerState;
    
    // Thresholds
    uint256 public maxDailyVolume = 1000 ether;
    uint256 public maxTransactionAmount = 100 ether;
    uint256 public suspiciousActivityThreshold = 10; // Number of suspicious activities
    
    // Tracking
    uint256 public dailyVolume;
    uint256 public lastResetTimestamp;
    uint256 public suspiciousActivityCount;
    
    // Cool-down period after emergency
    uint256 public constant EMERGENCY_COOLDOWN = 24 hours;
    uint256 public emergencyTimestamp;
    
    // Authorized addresses that can trigger emergency
    mapping(address => bool) public emergencyOperators;
    
    event CircuitBreakerTriggered(BreakerState newState, string reason);
    event CircuitBreakerReset();
    event ThresholdUpdated(string thresholdType, uint256 newValue);
    event SuspiciousActivityDetected(address actor, string reason);
    
    modifier whenOperational() {
        require(breakerState == BreakerState.OPERATIONAL, "Circuit breaker: not operational");
        _;
    }
    
    modifier checkCircuitBreaker(uint256 amount) {
        _checkDailyVolume(amount);
        _checkTransactionAmount(amount);
        _;
    }
    
    constructor() {
        breakerState = BreakerState.OPERATIONAL;
        lastResetTimestamp = block.timestamp;
    }
    
    function _checkDailyVolume(uint256 amount) internal {
        // Reset daily volume if new day
        if (block.timestamp >= lastResetTimestamp + 1 days) {
            dailyVolume = 0;
            lastResetTimestamp = block.timestamp;
        }
        
        if (dailyVolume + amount > maxDailyVolume) {
            _triggerCircuitBreaker(BreakerState.PAUSED, "Daily volume exceeded");
        }
        
        dailyVolume += amount;
    }
    
    function _checkTransactionAmount(uint256 amount) internal view {
        require(amount <= maxTransactionAmount, "Transaction amount too large");
    }
    
    function _recordSuspiciousActivity(address actor, string memory reason) internal {
        suspiciousActivityCount++;
        emit SuspiciousActivityDetected(actor, reason);
        
        if (suspiciousActivityCount >= suspiciousActivityThreshold) {
            _triggerCircuitBreaker(BreakerState.EMERGENCY, "Suspicious activity threshold reached");
        }
    }
    
    function _triggerCircuitBreaker(BreakerState newState, string memory reason) internal {
        breakerState = newState;
        if (newState == BreakerState.EMERGENCY) {
            emergencyTimestamp = block.timestamp;
        }
        emit CircuitBreakerTriggered(newState, reason);
    }
    
    // Admin functions
    function resetCircuitBreaker() external onlyOwner {
        require(breakerState != BreakerState.OPERATIONAL, "Already operational");
        
        if (breakerState == BreakerState.EMERGENCY) {
            require(
                block.timestamp >= emergencyTimestamp + EMERGENCY_COOLDOWN,
                "Emergency cooldown not finished"
            );
        }
        
        breakerState = BreakerState.OPERATIONAL;
        suspiciousActivityCount = 0;
        emit CircuitBreakerReset();
    }
    
    function updateMaxDailyVolume(uint256 newLimit) external onlyOwner {
        maxDailyVolume = newLimit;
        emit ThresholdUpdated("maxDailyVolume", newLimit);
    }
    
    function updateMaxTransactionAmount(uint256 newLimit) external onlyOwner {
        maxTransactionAmount = newLimit;
        emit ThresholdUpdated("maxTransactionAmount", newLimit);
    }
    
    function updateSuspiciousActivityThreshold(uint256 newThreshold) external onlyOwner {
        suspiciousActivityThreshold = newThreshold;
        emit ThresholdUpdated("suspiciousActivityThreshold", newThreshold);
    }
    
    function addEmergencyOperator(address operator) external onlyOwner {
        emergencyOperators[operator] = true;
    }
    
    function removeEmergencyOperator(address operator) external onlyOwner {
        emergencyOperators[operator] = false;
    }
    
    function triggerEmergency(string calldata reason) external {
        require(
            emergencyOperators[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _triggerCircuitBreaker(BreakerState.EMERGENCY, reason);
    }
}