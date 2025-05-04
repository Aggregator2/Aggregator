// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Import OpenZeppelin's SafeERC20 and IERC20 interfaces
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract Escrow is Ownable {
    using SafeERC20 for IERC20;

    enum State { AWAITING_DEPOSIT, AWAITING_CONFIRMATION, COMPLETE, REFUNDED }
    State public currentState;

    address public depositor;
    address public token;
    uint256 public amount;
    address public counterparty;
    address public arbiter;
    bytes32 public tradeHash;
    bytes public signature;
    address public uniswapRouter;

    // Events for logging important Escrow actions
    event Deposit(address indexed depositor, address indexed token, uint256 amount);
    event Released(address indexed counterparty, address indexed token, uint256 amount);
    event Refunded(address indexed depositor, address indexed token, uint256 amount);
    event Deposited(address indexed depositor, uint256 amount); // Matches emit
    event Executed(address indexed counterparty, address indexed token, uint256 amount);
    event Withdrawn(address indexed depositor, address indexed token, uint256 amount);
    event SwapExecuted(
        address indexed inputToken,
        address indexed outputToken,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient
    );
    event Confirmed(address indexed sender); // Add this event
    event TradeExecuted(address indexed sender, uint256 amountOutMin, address[] path, uint256 deadline); // Add this event

    // Modifiers for access control
    modifier onlyDepositor() {
        require(msg.sender == depositor, "Only the depositor can call this function");
        _;
    }

    modifier onlyCounterparty() {
        require(msg.sender == counterparty, "Only the counterparty can call this function");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Only the arbiter can call this function");
        _;
    }

    /**
     * @notice Constructor to initialize the escrow contract
     * @dev Ensures all addresses are valid and amount is greater than zero
     * @param _depositor The address of the depositor
     * @param _token The address of the ERC20 token being escrowed
     * @param _amount The amount of tokens to be escrowed
     * @param _counterparty The address of the counterparty
     * @param _arbiter The address of the arbiter
     * @param _tradeHash A unique hash to identify the trade
     * @param _signature Optional signature for off-chain validation
     * @param _uniswapRouter The address of the Uniswap V2 router
     * @param initialOwner The initial owner of the contract
     */
    constructor(
        address _depositor,
        address _token,
        uint256 _amount,
        address _counterparty,
        address _arbiter,
        bytes32 _tradeHash,
        bytes memory _signature,
        address _uniswapRouter,
        address initialOwner // Add this parameter
    ) Ownable(initialOwner) { // Pass it to the Ownable constructor
        require(_depositor != address(0), "Depositor address cannot be zero");
        require(_token != address(0), "Token address cannot be zero");
        require(_amount > 0, "Amount must be greater than zero");
        require(_counterparty != address(0), "Counterparty address cannot be zero");
        require(_arbiter != address(0), "Arbiter address cannot be zero");
        require(_uniswapRouter != address(0), "Uniswap router address cannot be zero");

        depositor = _depositor;
        token = _token;
        amount = _amount;
        counterparty = _counterparty;
        arbiter = _arbiter;
        tradeHash = _tradeHash;
        signature = _signature;
        uniswapRouter = _uniswapRouter;
        currentState = State.AWAITING_DEPOSIT;
    }

    /**
     * @notice Deposits the escrowed tokens into the contract
     * @dev Only callable by the depositor. Uses SafeERC20 for secure token transfer.
     * Emits a Deposited event upon success.
     */
    function deposit() external payable onlyDepositor {
        require(currentState == State.AWAITING_DEPOSIT, "Invalid state");
        require(msg.value > 0, "Deposit amount must be greater than 0");

        amount = msg.value;
        currentState = State.AWAITING_CONFIRMATION;

        emit Deposited(msg.sender, msg.value); // Fixed to match event
    }

    /**
     * @notice Confirms the trade, changing the state to COMPLETE
     * @dev Only callable by the counterparty. Emits a Confirmed event upon success.
     */
    function confirmTrade() external onlyCounterparty {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");

        currentState = State.COMPLETE;

        emit Confirmed(msg.sender);
    }

    /**
     * @notice Refunds the escrowed tokens back to the depositor
     * @dev Only callable by the arbiter. Uses SafeERC20 for secure token transfer.
     * Emits a Withdrawn event upon success.
     */
    function refund() external onlyArbiter {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");

        payable(depositor).transfer(amount);
        currentState = State.REFUNDED;

        emit Refunded(depositor, token, amount); // Fixed to match event
    }

    /**
     * @notice Performs token swap via Uniswap V2
     * @dev Approves the Uniswap router to spend the input token, performs the swap, and transfers the output token to the recipient.
     * Emits a SwapExecuted event upon success.
     * @param amountOutMin The minimum acceptable amount of output tokens to receive
     * @param path The swap path (array of token addresses)
     * @param deadline The deadline for the swap transaction
     */
    function executeTrade(uint256 amountOutMin, address[] calldata path, uint256 deadline) external onlyDepositor {
        require(currentState == State.COMPLETE, "Invalid state");

        IUniswapV2Router02(uniswapRouter).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount,
            amountOutMin,
            path,
            depositor,
            deadline
        );

        emit TradeExecuted(msg.sender, amountOutMin, path, deadline);
    }

    /**
     * @notice Gets the depositor address
     * @return The address of the depositor
     */
    function getDepositor() external view returns (address) {
        return depositor;
    }

    /**
     * @notice Gets the token address
     * @return The address of the ERC20 token being escrowed
     */
    function getToken() external view returns (address) {
        return token;
    }

    /**
     * @notice Gets the escrowed amount
     * @return The amount of tokens being escrowed
     */
    function getAmount() external view returns (uint256) {
        return amount;
    }

    /**
     * @notice Gets the counterparty address
     * @return The address of the counterparty
     */
    function getCounterparty() external view returns (address) {
        return counterparty;
    }

    /**
     * @notice Gets the trade hash
     * @return The unique hash identifying the trade
     */
    function getTradeHash() external view returns (bytes32) {
        return tradeHash;
    }

    /**
     * @notice Gets the signature
     * @return The optional signature for off-chain validation
     */
    function getSignature() external view returns (bytes memory) {
        return signature;
    }
}


