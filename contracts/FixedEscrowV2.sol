// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title FixedEscrowV2
 * @author SwappiQ Protocol
 * @notice Secure escrow contract for token trades with enhanced security features
 * @dev Implements MEV protection, signature replay prevention, and gas optimizations
 */
contract FixedEscrowV2 is ReentrancyGuard, Pausable, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    /// @notice Escrow states
    enum State { 
        AWAITING_DEPOSIT,
        AWAITING_CONFIRMATION,
        COMPLETE,
        REFUNDED,
        EXPIRED
    }

    /// @notice Commit structure for MEV protection
    struct TradeCommit {
        bytes32 commitment;
        uint256 revealDeadline;
        bool revealed;
    }

    // Packed storage for gas optimization
    State public currentState;
    uint32 public depositDeadline;
    uint32 public confirmationDeadline;
    bool private initialized;

    // Immutable addresses for gas optimization
    address public immutable depositor;
    address public immutable token;
    address public immutable counterparty;
    address public immutable arbiter;
    address public immutable uniswapRouter;
    bytes32 public immutable tradeHash;
    
    // State variables
    uint256 public escrowAmount;
    uint256 public nonce;
    TradeCommit public tradeCommit;

    // Constants
    uint256 private constant COMMIT_DURATION = 5 minutes;
    uint256 private constant MAX_SLIPPAGE_BPS = 500; // 5%
    bytes32 private constant RELEASE_TYPEHASH = keccak256(
        "Release(address to,uint256 amount,uint256 nonce,uint256 chainId)"
    );

    // Events
    event Deposited(address indexed depositor, uint256 amount, uint256 deadline);
    event TradeConfirmed(address indexed counterparty, uint256 timestamp);
    event Refunded(address indexed depositor, uint256 amount, string reason);
    event FundsReleased(address indexed to, uint256 amount, uint256 nonce);
    event TradeCommitted(bytes32 indexed commitment, uint256 revealDeadline);
    event TradeExecuted(
        address indexed executor,
        uint256 amountIn,
        uint256 amountOut,
        address[] path
    );
    event StateChanged(State from, State to);
    event EmergencyWithdraw(address indexed arbiter, address indexed to, uint256 amount);

    // Custom errors for gas optimization
    error InvalidState(State current, State required);
    error Unauthorized(address caller, address expected);
    error DeadlineExpired(uint256 current, uint256 deadline);
    error InvalidAmount(uint256 provided, uint256 required);
    error TransferFailed(address to, uint256 amount);
    error InvalidSignature();
    error CommitmentMismatch();
    error SlippageExceeded(uint256 expected, uint256 actual);
    error ZeroAddress();
    error AlreadyInitialized();

    modifier onlyDepositor() {
        if (msg.sender != depositor) revert Unauthorized(msg.sender, depositor);
        _;
    }

    modifier onlyCounterparty() {
        if (msg.sender != counterparty) revert Unauthorized(msg.sender, counterparty);
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert Unauthorized(msg.sender, arbiter);
        _;
    }

    modifier inState(State required) {
        if (currentState != required) revert InvalidState(currentState, required);
        _;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired(block.timestamp, deadline);
        _;
    }

    /**
     * @notice Contract constructor
     * @param _depositor Address that will deposit funds
     * @param _token Token address to be traded
     * @param _amount Initial expected amount (can be updated on deposit)
     * @param _counterparty Address of the trading counterparty
     * @param _arbiter Address with dispute resolution rights
     * @param _tradeHash Unique identifier for this trade
     * @param _uniswapRouter Address of Uniswap V2 router
     */
    constructor(
        address _depositor,
        address _token,
        uint256 _amount,
        address _counterparty,
        address _arbiter,
        bytes32 _tradeHash,
        address _uniswapRouter
    ) EIP712("FixedEscrowV2", "2.0.0") {
        if (_depositor == address(0)) revert ZeroAddress();
        if (_token == address(0)) revert ZeroAddress();
        if (_counterparty == address(0)) revert ZeroAddress();
        if (_arbiter == address(0)) revert ZeroAddress();
        if (_uniswapRouter == address(0)) revert ZeroAddress();
        if (_amount == 0) revert InvalidAmount(0, 1);

        depositor = _depositor;
        token = _token;
        escrowAmount = _amount;
        counterparty = _counterparty;
        arbiter = _arbiter;
        tradeHash = _tradeHash;
        uniswapRouter = _uniswapRouter;
        currentState = State.AWAITING_DEPOSIT;
        
        // Set reasonable deadlines
        depositDeadline = uint32(block.timestamp + 1 hours);
        confirmationDeadline = uint32(block.timestamp + 24 hours);
    }

    /**
     * @notice Deposit ETH into escrow
     * @dev Updates state before external calls for security
     */
    function deposit() 
        external 
        payable 
        onlyDepositor 
        inState(State.AWAITING_DEPOSIT)
        checkDeadline(depositDeadline)
        whenNotPaused 
    {
        if (msg.value == 0) revert InvalidAmount(0, 1);
        
        // Update state before any external calls
        escrowAmount = msg.value;
        _changeState(State.AWAITING_CONFIRMATION);
        
        // Update deadline for confirmation
        confirmationDeadline = uint32(block.timestamp + 24 hours);
        
        emit Deposited(msg.sender, msg.value, confirmationDeadline);
    }

    /**
     * @notice Confirm trade readiness
     * @dev Counterparty confirms they're ready to proceed
     */
    function confirmTrade() 
        external 
        onlyCounterparty 
        inState(State.AWAITING_CONFIRMATION)
        checkDeadline(confirmationDeadline)
        whenNotPaused 
    {
        _changeState(State.COMPLETE);
        emit TradeConfirmed(msg.sender, block.timestamp);
    }

    /**
     * @notice Commit to a trade for MEV protection
     * @param commitment Hash of trade parameters
     */
    function commitTrade(bytes32 commitment) 
        external 
        onlyDepositor 
        inState(State.AWAITING_CONFIRMATION)
        whenNotPaused 
    {
        tradeCommit = TradeCommit({
            commitment: commitment,
            revealDeadline: block.timestamp + COMMIT_DURATION,
            revealed: false
        });
        
        emit TradeCommitted(commitment, tradeCommit.revealDeadline);
    }

    /**
     * @notice Execute trade with MEV protection
     * @param amountOutMin Minimum amount of tokens to receive
     * @param path Token swap path
     * @param deadline Transaction deadline
     * @param salt Random value used in commitment
     */
    function executeTrade(
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline,
        uint256 salt
    ) 
        external 
        onlyDepositor 
        inState(State.AWAITING_CONFIRMATION)
        checkDeadline(deadline)
        whenNotPaused
        nonReentrant 
    {
        // Verify commitment if exists
        if (tradeCommit.commitment != bytes32(0)) {
            if (block.timestamp > tradeCommit.revealDeadline) {
                revert DeadlineExpired(block.timestamp, tradeCommit.revealDeadline);
            }
            
            bytes32 calculatedCommit = keccak256(
                abi.encodePacked(amountOutMin, path, deadline, salt, msg.sender)
            );
            
            if (calculatedCommit != tradeCommit.commitment) {
                revert CommitmentMismatch();
            }
            
            tradeCommit.revealed = true;
        }
        
        // Validate inputs
        if (path.length < 2) revert InvalidAmount(path.length, 2);
        if (path[0] != address(0)) revert InvalidAmount(1, 0); // Expecting ETH as input
        
        uint256 amountIn = address(this).balance;
        if (amountIn == 0) revert InvalidAmount(0, 1);
        
        // Calculate maximum slippage protection
        uint256 maxSlippage = (amountIn * MAX_SLIPPAGE_BPS) / 10000;
        if (amountOutMin < amountIn - maxSlippage) {
            revert SlippageExceeded(amountIn - maxSlippage, amountOutMin);
        }
        
        // Execute trade
        IUniswapV2Router02 router = IUniswapV2Router02(uniswapRouter);
        uint256 initialBalance = IERC20(path[path.length - 1]).balanceOf(address(this));
        
        uint256[] memory amounts = router.swapExactETHForTokens{value: amountIn}(
            amountOutMin,
            path,
            address(this),
            deadline
        );
        
        uint256 finalBalance = IERC20(path[path.length - 1]).balanceOf(address(this));
        uint256 amountOut = finalBalance - initialBalance;
        
        _changeState(State.COMPLETE);
        emit TradeExecuted(msg.sender, amountIn, amountOut, path);
    }

    /**
     * @notice Refund deposited funds
     * @param reason Reason for refund
     */
    function refund(string calldata reason) 
        external 
        onlyArbiter 
        whenNotPaused
        nonReentrant 
    {
        if (currentState != State.AWAITING_CONFIRMATION && currentState != State.AWAITING_DEPOSIT) {
            revert InvalidState(currentState, State.AWAITING_CONFIRMATION);
        }
        
        uint256 refundAmount = address(this).balance;
        if (refundAmount == 0) revert InvalidAmount(0, 1);
        
        // Update state before external call
        _changeState(State.REFUNDED);
        
        // Transfer funds
        (bool success, ) = depositor.call{value: refundAmount}("");
        if (!success) revert TransferFailed(depositor, refundAmount);
        
        emit Refunded(depositor, refundAmount, reason);
    }

    /**
     * @notice Release funds with arbiter signature using EIP-712
     * @param to Recipient address
     * @param releaseAmount Amount to release
     * @param signature Arbiter's signature
     */
    function releaseWithSignature(
        address to,
        uint256 releaseAmount,
        bytes calldata signature
    ) 
        external 
        inState(State.COMPLETE)
        whenNotPaused
        nonReentrant 
    {
        if (to == address(0)) revert ZeroAddress();
        
        // Build EIP-712 message
        bytes32 structHash = keccak256(
            abi.encode(
                RELEASE_TYPEHASH,
                to,
                releaseAmount,
                nonce++,
                block.chainid
            )
        );
        
        bytes32 hash = _hashTypedDataV4(structHash);
        address signer = hash.recover(signature);
        
        if (signer != arbiter) revert InvalidSignature();
        
        // Transfer tokens
        if (releaseAmount > 0) {
            IERC20(token).safeTransfer(to, releaseAmount);
        }
        
        emit FundsReleased(to, releaseAmount, nonce - 1);
    }

    /**
     * @notice Check if deposit deadline has expired
     */
    function checkAndExpireDeposit() external {
        if (currentState == State.AWAITING_DEPOSIT && block.timestamp > depositDeadline) {
            _changeState(State.EXPIRED);
        }
    }

    /**
     * @notice Emergency withdrawal by arbiter
     * @param tokenAddress Token to withdraw (address(0) for ETH)
     * @param to Recipient address
     */
    function emergencyWithdraw(
        address tokenAddress,
        address to
    ) 
        external 
        onlyArbiter 
        whenPaused 
    {
        if (to == address(0)) revert ZeroAddress();
        
        if (tokenAddress == address(0)) {
            // Withdraw ETH
            uint256 balance = address(this).balance;
            (bool success, ) = to.call{value: balance}("");
            if (!success) revert TransferFailed(to, balance);
            emit EmergencyWithdraw(msg.sender, to, balance);
        } else {
            // Withdraw tokens
            uint256 balance = IERC20(tokenAddress).balanceOf(address(this));
            IERC20(tokenAddress).safeTransfer(to, balance);
            emit EmergencyWithdraw(msg.sender, to, balance);
        }
    }

    /**
     * @notice Pause contract operations
     */
    function pause() external onlyArbiter {
        _pause();
    }

    /**
     * @notice Unpause contract operations
     */
    function unpause() external onlyArbiter {
        _unpause();
    }

    /**
     * @notice Get contract balance
     * @return ETH balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Get token balance
     * @return Token balance
     */
    function getTokenBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Get escrow details
     * @return Multiple values representing escrow state
     */
    function getEscrowDetails() external view returns (
        State state,
        uint256 amount,
        uint32 depositDL,
        uint32 confirmDL,
        bool isPaused
    ) {
        return (
            currentState,
            escrowAmount,
            depositDeadline,
            confirmationDeadline,
            paused()
        );
    }

    /**
     * @notice Internal function to change state
     * @param newState New state to transition to
     */
    function _changeState(State newState) private {
        emit StateChanged(currentState, newState);
        currentState = newState;
    }

    /**
     * @notice Receive function to accept ETH
     */
    receive() external payable {
        // Only accept ETH from router during swaps
        if (msg.sender != uniswapRouter) {
            revert Unauthorized(msg.sender, uniswapRouter);
        }
    }
}