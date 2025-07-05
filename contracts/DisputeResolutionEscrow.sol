// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/**
 * @title DisputeResolutionEscrow
 * @notice Escrow contract with specialized dispute resolution logic that defaults to Uniswap settlement
 * @dev Implements a depositor-solver escrow with automatic Uniswap settlement fallback for unresolved disputes
 */
contract DisputeResolutionEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Contract states
    enum State { 
        AWAITING_DEPOSIT,      // Initial state, waiting for deposit
        AWAITING_SOLUTION,     // Deposit made, waiting for solver to provide solution
        SOLUTION_PROVIDED,     // Solver has provided solution, awaiting acceptance
        COMPLETED,             // Escrow successfully completed
        DISPUTED,              // Dispute raised, awaiting resolution
        REFUNDED,              // Funds returned to depositor
        SETTLED_VIA_UNISWAP    // Dispute settled via Uniswap
    }

    // Dispute resolution preferences
    enum DisputeResolution {
        DEFAULT_UNISWAP,       // Default: settle via Uniswap
        RETURN_TO_DEPOSITOR,   // UI override: return funds to depositor
        PENDING                // No resolution specified yet
    }

    // State variables
    State public currentState;
    DisputeResolution public disputeResolution;
    
    address public immutable depositor;
    address public immutable solver;
    address public immutable depositToken;
    address public immutable settlementToken;
    address public immutable uniswapRouter;
    
    uint256 public depositAmount;
    uint256 public depositTimestamp;
    uint256 public disputeDeadline;
    uint256 public constant DISPUTE_TIMEOUT = 7 days;
    uint256 public constant SOLVER_TIMEOUT = 7 days;
    
    // UI input tracking
    bool public uiOverrideSet;
    DisputeResolution public uiOverride;
    
    // Events
    event Deposited(address indexed depositor, uint256 amount);
    event SolutionProvided(address indexed solver);
    event SolutionAccepted(address indexed depositor);
    event DisputeRaised(address indexed raiser, uint256 deadline);
    event DisputeResolved(DisputeResolution resolution);
    event FundsRefunded(address indexed depositor, uint256 amount);
    event SettledViaUniswap(uint256 amountIn, uint256 amountOut);
    event UIOverrideSet(DisputeResolution override_);

    // Modifiers
    modifier onlyDepositor() {
        require(msg.sender == depositor, "Only depositor can call");
        _;
    }

    modifier onlySolver() {
        require(msg.sender == solver, "Only solver can call");
        _;
    }

    modifier onlyParticipants() {
        require(msg.sender == depositor || msg.sender == solver, "Only participants can call");
        _;
    }

    /**
     * @notice Initialize the escrow contract
     * @param _depositor Address of the depositor
     * @param _solver Address of the solver/service provider
     * @param _depositToken Token to be deposited (address(0) for ETH)
     * @param _settlementToken Token for Uniswap settlement if needed
     * @param _uniswapRouter Uniswap V2 router address
     */
    constructor(
        address _depositor,
        address _solver,
        address _depositToken,
        address _settlementToken,
        address _uniswapRouter
    ) {
        require(_depositor != address(0), "Invalid depositor");
        require(_solver != address(0), "Invalid solver");
        require(_uniswapRouter != address(0), "Invalid router");
        
        depositor = _depositor;
        solver = _solver;
        depositToken = _depositToken;
        settlementToken = _settlementToken;
        uniswapRouter = _uniswapRouter;
        
        currentState = State.AWAITING_DEPOSIT;
        disputeResolution = DisputeResolution.DEFAULT_UNISWAP; // Default preference
    }

    /**
     * @notice Deposit funds into escrow
     * @param amount Amount to deposit (ignored if depositing ETH)
     */
    function deposit(uint256 amount) external payable onlyDepositor nonReentrant {
        require(currentState == State.AWAITING_DEPOSIT, "Invalid state for deposit");
        
        if (depositToken == address(0)) {
            // ETH deposit
            require(msg.value > 0, "ETH amount required");
            depositAmount = msg.value;
        } else {
            // ERC20 deposit
            require(amount > 0, "Amount must be > 0");
            require(msg.value == 0, "ETH not accepted for token deposit");
            
            IERC20(depositToken).safeTransferFrom(msg.sender, address(this), amount);
            depositAmount = amount;
        }
        
        currentState = State.AWAITING_SOLUTION;
        depositTimestamp = block.timestamp;
        emit Deposited(depositor, depositAmount);
    }

    /**
     * @notice Solver provides solution/completion
     * @dev TODO: Add solution verification logic based on your requirements
     */
    function provideSolution() external onlySolver {
        require(currentState == State.AWAITING_SOLUTION, "Invalid state for solution");
        
        // TODO: Add solution verification logic here
        // This is where solver would submit proof of work, solution hash, etc.
        
        currentState = State.SOLUTION_PROVIDED;
        emit SolutionProvided(solver);
    }

    /**
     * @notice Depositor accepts the solution
     */
    function acceptSolution() external onlyDepositor nonReentrant {
        require(currentState == State.SOLUTION_PROVIDED, "No solution to accept");
        
        // Transfer funds to solver
        _transferFunds(solver, depositAmount);
        
        currentState = State.COMPLETED;
        emit SolutionAccepted(depositor);
    }

    /**
     * @notice Raise a dispute
     * @dev Can be called by either party under specific conditions
     */
    function raiseDispute() external onlyParticipants {
        require(
            currentState == State.AWAITING_SOLUTION || 
            currentState == State.SOLUTION_PROVIDED,
            "Cannot raise dispute in current state"
        );
        
        currentState = State.DISPUTED;
        disputeDeadline = block.timestamp + DISPUTE_TIMEOUT;
        
        emit DisputeRaised(msg.sender, disputeDeadline);
    }

    /**
     * @notice Set UI override for dispute resolution
     * @param resolution The resolution preference from UI
     * @dev This represents UI input that overrides default behavior
     */
    function setUIOverride(DisputeResolution resolution) external onlyDepositor {
        require(currentState == State.DISPUTED, "No active dispute");
        require(resolution != DisputeResolution.PENDING, "Invalid resolution");
        
        uiOverrideSet = true;
        uiOverride = resolution;
        
        emit UIOverrideSet(resolution);
    }

    /**
     * @notice Resolve the dispute based on preferences and state
     * @dev TODO: Thoroughly test all paths - UI override, timeout, default behavior
     */
    function resolveDispute() external nonReentrant {
        require(currentState == State.DISPUTED, "No dispute to resolve");
        
        // Check if UI has provided explicit override
        if (uiOverrideSet) {
            if (uiOverride == DisputeResolution.RETURN_TO_DEPOSITOR) {
                _returnFundsToDepositor();
            } else if (uiOverride == DisputeResolution.DEFAULT_UNISWAP) {
                _settleViaUniswap();
            }
        } 
        // Check if solver cannot finalize (timeout reached)
        else if (block.timestamp >= disputeDeadline) {
            // Default behavior: settle via Uniswap
            _settleViaUniswap();
        }
        // Dispute still pending
        else {
            revert("Dispute still pending resolution");
        }
        
        emit DisputeResolved(uiOverrideSet ? uiOverride : DisputeResolution.DEFAULT_UNISWAP);
    }

    /**
     * @notice Return funds directly to depositor
     * @dev TODO: Test with both ETH and token deposits
     */
    function _returnFundsToDepositor() private {
        uint256 amount = depositAmount;
        depositAmount = 0;
        
        _transferFunds(depositor, amount);
        
        currentState = State.REFUNDED;
        emit FundsRefunded(depositor, amount);
    }

    /**
     * @notice Settle dispute via Uniswap
     * @dev TODO: Test swap paths, slippage, deadlines, and edge cases
     * TODO: Add configurable swap parameters (slippage tolerance, paths)
     * TODO: Consider implementing a price oracle for fair settlement
     */
    function _settleViaUniswap() private {
        require(depositToken != address(0), "Cannot swap ETH directly");
        require(settlementToken != address(0), "Settlement token not set");
        
        uint256 amountIn = depositAmount;
        depositAmount = 0;
        
        // Approve Uniswap router
        IERC20(depositToken).safeApprove(uniswapRouter, 0);
        IERC20(depositToken).safeApprove(uniswapRouter, amountIn);
        
        // TODO: Make these parameters configurable
        uint256 amountOutMin = 0; // TODO: Calculate based on oracle or user input
        address[] memory path = new address[](2);
        path[0] = depositToken;
        path[1] = settlementToken;
        uint256 deadline = block.timestamp + 300; // 5 minutes
        
        // Execute swap
        uint256[] memory amounts = IUniswapV2Router02(uniswapRouter).swapExactTokensForTokens(
            amountIn,
            amountOutMin,
            path,
            depositor, // Send to depositor as default recipient
            deadline
        );
        
        currentState = State.SETTLED_VIA_UNISWAP;
        emit SettledViaUniswap(amountIn, amounts[amounts.length - 1]);
    }

    /**
     * @notice Transfer funds (ETH or ERC20)
     * @param to Recipient address
     * @param amount Amount to transfer
     */
    function _transferFunds(address to, uint256 amount) private {
        if (depositToken == address(0)) {
            // Transfer ETH
            (bool success, ) = payable(to).call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            // Transfer ERC20
            IERC20(depositToken).safeTransfer(to, amount);
        }
    }

    /**
     * @notice Emergency withdrawal by depositor
     * @dev Only available in specific failure states
     * TODO: Test emergency scenarios thoroughly
     */
    function emergencyWithdraw() external onlyDepositor nonReentrant {
        require(
            currentState == State.AWAITING_SOLUTION && 
            depositTimestamp > 0 &&
            block.timestamp > depositTimestamp + SOLVER_TIMEOUT + DISPUTE_TIMEOUT,
            "Emergency withdrawal not available"
        );
        
        _returnFundsToDepositor();
    }

    /**
     * @notice Get current contract status
     * @return state Current state of the escrow
     * @return deadline Dispute deadline timestamp
     * @return resolution Current dispute resolution preference
     * @return hasUIOverride Whether UI override has been set
     */
    function getStatus() external view returns (
        State state,
        uint256 deadline,
        DisputeResolution resolution,
        bool hasUIOverride
    ) {
        return (currentState, disputeDeadline, disputeResolution, uiOverrideSet);
    }

    // TODO: CRITICAL TESTING REQUIREMENTS
    // 1. Test all dispute paths:
    //    - Normal completion without disputes
    //    - Dispute with UI override to return funds
    //    - Dispute with UI override to Uniswap settlement
    //    - Dispute timeout leading to default Uniswap settlement
    //    - Emergency withdrawal scenarios
    //
    // 2. Test edge cases:
    //    - Zero amounts
    //    - Failed token transfers
    //    - Uniswap swap failures
    //    - Reentrancy attacks
    //    - State transition validations
    //
    // 3. Test with different tokens:
    //    - ETH deposits
    //    - Standard ERC20 tokens
    //    - Fee-on-transfer tokens
    //    - Rebasing tokens
    //
    // 4. Gas optimization testing:
    //    - Measure gas costs for all functions
    //    - Optimize storage layout if needed
    //
    // 5. Security testing:
    //    - Access control for all functions
    //    - Integer overflow/underflow
    //    - Front-running vulnerabilities
    //    - Signature replay attacks (if signatures added)
}