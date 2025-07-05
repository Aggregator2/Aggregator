// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

import "./security/CircuitBreaker.sol";
import "./security/MEVProtection.sol";
import "./security/GasProtection.sol";
import "./security/SignatureVerifier.sol";
import "./interfaces/IPriceOracle.sol";

/**
 * @title SecureEscrowV2
 * @notice Production-ready escrow with comprehensive security measures
 * @dev Implements multiple security patterns to prevent common attack vectors
 */
contract SecureEscrowV2 is 
    ReentrancyGuard,
    Pausable,
    AccessControl,
    CircuitBreaker,
    MEVProtection,
    GasProtection,
    SignatureVerifier
{
    using SafeERC20 for IERC20;
    
    // Roles
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant ORACLE_OPERATOR_ROLE = keccak256("ORACLE_OPERATOR_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");
    
    // State
    enum EscrowState {
        AWAITING_DEPOSIT,
        DEPOSITED,
        COMMITTED,
        EXECUTED,
        DISPUTED,
        REFUNDED,
        EMERGENCY_WITHDRAWN
    }
    
    struct EscrowData {
        address depositor;
        address beneficiary;
        address token;
        uint256 amount;
        uint256 depositTime;
        uint256 deadline;
        bytes32 tradeId;
        EscrowState state;
    }
    
    // Storage
    mapping(bytes32 => EscrowData) public escrows;
    mapping(address => uint256) public userEscrowCount;
    
    // Security parameters
    IPriceOracle public priceOracle;
    uint256 public constant MAX_SLIPPAGE_BPS = 300; // 3%
    uint256 public constant DISPUTE_WINDOW = 1 hours;
    uint256 public constant MAX_ESCROW_DURATION = 30 days;
    
    // Events
    event EscrowCreated(bytes32 indexed escrowId, address indexed depositor, uint256 amount);
    event EscrowDeposited(bytes32 indexed escrowId, uint256 amount);
    event EscrowExecuted(bytes32 indexed escrowId, address indexed beneficiary, uint256 amount);
    event EscrowRefunded(bytes32 indexed escrowId, address indexed depositor, uint256 amount);
    event DisputeRaised(bytes32 indexed escrowId, address indexed raiser);
    event OracleUpdated(address indexed newOracle);
    
    constructor(
        address _priceOracle
    ) EIP712("SecureEscrowV2", "1") {
        require(_priceOracle != address(0), "Invalid oracle");
        
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(ARBITER_ROLE, msg.sender);
        _setupRole(EMERGENCY_ROLE, msg.sender);
        
        priceOracle = IPriceOracle(_priceOracle);
    }
    
    /**
     * @notice Create a new escrow with commit-reveal pattern
     * @param commitHash Hash of escrow parameters
     */
    function commitEscrow(bytes32 commitHash) 
        external 
        whenNotPaused 
        whenOperational
        preventSameBlockAction 
    {
        _commitAction(commitHash);
    }
    
    /**
     * @notice Reveal and create escrow
     * @param depositor Address of depositor
     * @param beneficiary Address of beneficiary
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to escrow
     * @param deadline Escrow deadline
     * @param salt Random salt used in commit
     */
    function revealAndCreateEscrow(
        address depositor,
        address beneficiary,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes32 salt
    ) 
        external 
        whenNotPaused 
        whenOperational
        preventFlashLoan
        returns (bytes32 escrowId) 
    {
        // Verify commit-reveal
        bytes32 commitHash = keccak256(abi.encode(
            depositor, beneficiary, token, amount, deadline, salt
        ));
        _revealAction(commitHash);
        
        // Validations
        require(depositor != address(0), "Invalid depositor");
        require(beneficiary != address(0), "Invalid beneficiary");
        require(amount > 0, "Invalid amount");
        require(deadline > block.timestamp, "Invalid deadline");
        require(deadline <= block.timestamp + MAX_ESCROW_DURATION, "Deadline too far");
        
        // Check circuit breaker thresholds
        if (token == address(0)) {
            _checkCircuitBreaker(amount);
        }
        
        // Generate escrow ID
        escrowId = keccak256(abi.encode(
            depositor, beneficiary, token, amount, deadline, block.timestamp
        ));
        
        require(escrows[escrowId].depositor == address(0), "Escrow exists");
        
        // Create escrow
        escrows[escrowId] = EscrowData({
            depositor: depositor,
            beneficiary: beneficiary,
            token: token,
            amount: amount,
            depositTime: block.timestamp,
            deadline: deadline,
            tradeId: escrowId,
            state: EscrowState.AWAITING_DEPOSIT
        });
        
        userEscrowCount[depositor]++;
        _clearCommitment(commitHash);
        
        emit EscrowCreated(escrowId, depositor, amount);
        
        return escrowId;
    }
    
    /**
     * @notice Deposit funds into escrow
     * @param escrowId The escrow identifier
     */
    function deposit(bytes32 escrowId) 
        external 
        payable 
        nonReentrant 
        whenNotPaused
        whenOperational
        ensureGasReserve 
    {
        EscrowData storage escrow = escrows[escrowId];
        require(escrow.state == EscrowState.AWAITING_DEPOSIT, "Invalid state");
        require(msg.sender == escrow.depositor, "Not depositor");
        require(block.timestamp < escrow.deadline, "Deadline passed");
        
        if (escrow.token == address(0)) {
            // ETH deposit
            require(msg.value == escrow.amount, "Incorrect ETH amount");
        } else {
            // Token deposit
            require(msg.value == 0, "ETH not expected");
            IERC20(escrow.token).safeTransferFrom(
                msg.sender, 
                address(this), 
                escrow.amount
            );
        }
        
        escrow.state = EscrowState.DEPOSITED;
        emit EscrowDeposited(escrowId, escrow.amount);
    }
    
    /**
     * @notice Execute escrow with signature verification
     * @param escrowId The escrow identifier
     * @param signature Arbiter signature
     * @param deadline Signature deadline
     * @param nonce Signature nonce
     */
    function executeWithSignature(
        bytes32 escrowId,
        bytes memory signature,
        uint256 deadline,
        uint256 nonce
    ) 
        external 
        nonReentrant 
        whenNotPaused
        whenOperational 
    {
        EscrowData storage escrow = escrows[escrowId];
        require(escrow.state == EscrowState.DEPOSITED, "Invalid state");
        
        // Create typed data hash
        bytes32 structHash = keccak256(abi.encode(
            keccak256("ExecuteEscrow(bytes32 escrowId,address beneficiary,uint256 amount,uint256 deadline,uint256 nonce)"),
            escrowId,
            escrow.beneficiary,
            escrow.amount,
            deadline,
            nonce
        ));
        
        bytes32 digest = _createTypedDataHash(structHash);
        
        // Verify arbiter signature
        address signer = ECDSA.recover(digest, signature);
        require(hasRole(ARBITER_ROLE, signer), "Invalid arbiter");
        
        _verifySignature(signer, digest, signature, deadline, nonce);
        
        // Execute transfer
        _executeTransfer(escrow);
        
        escrow.state = EscrowState.EXECUTED;
        emit EscrowExecuted(escrowId, escrow.beneficiary, escrow.amount);
    }
    
    /**
     * @notice Execute swap via Uniswap with oracle protection
     * @param escrowId The escrow identifier
     * @param path Swap path
     * @param expectedAmountOut Expected output from oracle
     */
    function executeSwapWithOracle(
        bytes32 escrowId,
        address[] calldata path,
        uint256 expectedAmountOut
    ) 
        external 
        nonReentrant 
        whenNotPaused
        whenOperational
        preventSameBlockAction 
    {
        EscrowData storage escrow = escrows[escrowId];
        require(escrow.state == EscrowState.DEPOSITED, "Invalid state");
        require(msg.sender == escrow.depositor, "Not depositor");
        require(escrow.token != address(0), "Cannot swap ETH");
        require(path.length >= 2, "Invalid path");
        require(path[0] == escrow.token, "Invalid input token");
        
        // Get oracle price and calculate minimum output
        uint256 oraclePrice = priceOracle.getPrice(path[0], path[path.length - 1]);
        uint256 calculatedOutput = (escrow.amount * oraclePrice) / 1e18;
        
        // Verify expected amount is within acceptable range
        require(
            _isWithinPriceRange(expectedAmountOut, calculatedOutput, MAX_SLIPPAGE_BPS),
            "Price deviation too high"
        );
        
        uint256 minAmountOut = _calculateMinOutput(
            escrow.amount,
            expectedAmountOut,
            MAX_SLIPPAGE_BPS
        );
        
        // Execute swap
        IERC20(escrow.token).safeApprove(address(uniswapRouter), escrow.amount);
        
        IUniswapV2Router02(uniswapRouter).swapExactTokensForTokens(
            escrow.amount,
            minAmountOut,
            path,
            escrow.beneficiary,
            block.timestamp + 300
        );
        
        escrow.state = EscrowState.EXECUTED;
        emit EscrowExecuted(escrowId, escrow.beneficiary, escrow.amount);
    }
    
    /**
     * @notice Raise dispute
     * @param escrowId The escrow identifier
     */
    function raiseDispute(bytes32 escrowId) 
        external 
        whenNotPaused 
    {
        EscrowData storage escrow = escrows[escrowId];
        require(
            escrow.state == EscrowState.DEPOSITED || 
            escrow.state == EscrowState.COMMITTED,
            "Cannot dispute"
        );
        require(
            msg.sender == escrow.depositor || 
            msg.sender == escrow.beneficiary ||
            hasRole(ARBITER_ROLE, msg.sender),
            "Not authorized"
        );
        
        escrow.state = EscrowState.DISPUTED;
        
        // Record suspicious activity if raised by non-participants
        if (msg.sender != escrow.depositor && msg.sender != escrow.beneficiary) {
            _recordSuspiciousActivity(msg.sender, "Dispute by non-participant");
        }
        
        emit DisputeRaised(escrowId, msg.sender);
    }
    
    /**
     * @notice Refund escrow
     * @param escrowId The escrow identifier
     */
    function refund(bytes32 escrowId) 
        external 
        nonReentrant 
        whenNotPaused
        onlyRole(ARBITER_ROLE) 
    {
        EscrowData storage escrow = escrows[escrowId];
        require(
            escrow.state == EscrowState.DEPOSITED || 
            escrow.state == EscrowState.DISPUTED,
            "Cannot refund"
        );
        
        escrow.state = EscrowState.REFUNDED;
        
        if (escrow.token == address(0)) {
            _safeTransferETH(escrow.depositor, escrow.amount);
        } else {
            IERC20(escrow.token).safeTransfer(escrow.depositor, escrow.amount);
        }
        
        emit EscrowRefunded(escrowId, escrow.depositor, escrow.amount);
    }
    
    /**
     * @notice Emergency withdrawal
     * @param escrowId The escrow identifier
     */
    function emergencyWithdraw(bytes32 escrowId) 
        external 
        nonReentrant
        onlyRole(EMERGENCY_ROLE) 
    {
        EscrowData storage escrow = escrows[escrowId];
        require(escrow.amount > 0, "No funds");
        
        uint256 amount = escrow.amount;
        escrow.amount = 0;
        escrow.state = EscrowState.EMERGENCY_WITHDRAWN;
        
        // Use pull pattern for safety
        _recordPendingWithdrawal(escrow.depositor, amount);
    }
    
    /**
     * @notice Update price oracle
     * @param newOracle New oracle address
     */
    function updatePriceOracle(address newOracle) 
        external 
        onlyRole(ORACLE_OPERATOR_ROLE) 
    {
        require(newOracle != address(0), "Invalid oracle");
        priceOracle = IPriceOracle(newOracle);
        emit OracleUpdated(newOracle);
    }
    
    /**
     * @notice Internal transfer execution
     */
    function _executeTransfer(EscrowData storage escrow) private {
        if (escrow.token == address(0)) {
            _safeTransferETH(escrow.beneficiary, escrow.amount);
        } else {
            IERC20(escrow.token).safeTransfer(escrow.beneficiary, escrow.amount);
        }
    }
    
    // Required overrides
    function _msgSender() internal view override(Context) returns (address) {
        return msg.sender;
    }
    
    function _msgData() internal pure override(Context) returns (bytes calldata) {
        return msg.data;
    }
}