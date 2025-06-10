// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title Escrow Contract
 * @notice Facilitates token escrow, trade execution, and refunds.
 * @dev Secure and optimized for Hardhat verification.
 */
contract Escrow is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    /**
     * @notice Represents the state of the escrow.
     * @dev Enum values:
     * - AWAITING_DEPOSIT: Waiting for the depositor to deposit funds.
     * - AWAITING_CONFIRMATION: Waiting for the counterparty to confirm the trade.
     * - COMPLETE: Trade is confirmed and complete.
     * - REFUNDED: Funds have been refunded to the depositor.
     */
    enum State { AWAITING_DEPOSIT, AWAITING_CONFIRMATION, COMPLETE, REFUNDED }

    /// @notice Current state of the escrow.
    State public currentState;

    /// @notice Address of the depositor who initiates the escrow.
    address public immutable depositor;

    /// @notice Address of the ERC20 token being escrowed.
    address public immutable token;

    /// @notice Address of the counterparty who confirms the trade.
    address public immutable counterparty;

    /// @notice Address of the arbiter who can refund the depositor.
    address public immutable arbiter;

    /// @notice Unique hash to identify the trade.
    bytes32 public immutable tradeHash;

    /// @notice Address of the Uniswap V2 router used for token swaps.
    address public immutable uniswapRouter;

    /// @dev Amount of tokens or Ether held in escrow. Made private for security.
    uint256 private amount;

    mapping(bytes32 => bool) public usedSignatures;

    /// @notice Emitted when the depositor deposits funds into the escrow.
    /// @param depositor Address of the depositor.
    /// @param amount Amount of funds deposited.
    event Deposited(address indexed depositor, uint256 amount);    /// @notice Emitted when the counterparty confirms the trade.
    /// @param sender Address of the counterparty who confirmed the trade.
    event Confirmed(address indexed sender);
    
    /// @notice Emitted when the arbiter refunds the depositor.
    /// @param depositor Address of the depositor.
    /// @param amount Amount of funds refunded.
    event Refunded(address indexed depositor, uint256 amount);

    /// @notice Emitted when funds are released with a valid signature.
    /// @param to Address of the recipient.
    /// @param amount Amount of funds released.
    event FundsReleased(address indexed to, uint256 amount);

    /// @notice Emitted when a trade is executed via Uniswap V2.
    /// @param sender Address of the depositor who executed the trade.
    /// @param amountOutMin Minimum amount of output tokens expected.
    /// @param path Array of token addresses for the swap path.
    /// @param deadline Deadline for the swap transaction.
    event TradeExecuted(address indexed sender, uint256 amountOutMin, address[] path, uint256 deadline);

    /// @notice Restricts access to the depositor.
    modifier onlyDepositor() {
        require(msg.sender == depositor, "Only the depositor can call this function");
        _;
    }

    /// @notice Restricts access to the counterparty.
    modifier onlyCounterparty() {
        require(msg.sender == counterparty, "Only the counterparty can call this function");
        _;
    }

    /// @notice Restricts access to the arbiter.
    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Only the arbiter can call this function");
        _;
    }

    /**
     * @notice Constructor to initialize the escrow contract.
     * @dev Sets the initial state to AWAITING_DEPOSIT.
     * @param _depositor The address of the depositor.
     * @param _token The address of the ERC20 token being escrowed.
     * @param _amount The amount of tokens to be escrowed.
     * @param _counterparty The address of the counterparty.
     * @param _arbiter The address of the arbiter.
     * @param _tradeHash A unique hash to identify the trade.
     * @param _uniswapRouter The address of the Uniswap V2 router.
     */
    constructor(
        address _depositor,
        address _token,
        uint256 _amount,
        address _counterparty,
        address _arbiter,
        bytes32 _tradeHash,
        address _uniswapRouter
    )
        EIP712("Escrow", "1")
    {
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
        uniswapRouter = _uniswapRouter;
        currentState = State.AWAITING_DEPOSIT;
    }

    /**
     * @notice Deposits the escrowed tokens into the contract.
     * @dev Only callable by the depositor. Emits a Deposited event.
     */
    function deposit() external payable onlyDepositor {
        require(currentState == State.AWAITING_DEPOSIT, "Invalid state");
        require(msg.value > 0, "Deposit amount must be greater than 0");

        amount = msg.value;
        currentState = State.AWAITING_CONFIRMATION;

        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Confirms the trade, changing the state to COMPLETE.
     * @dev Only callable by the counterparty. Emits a Confirmed event.
     */
    function confirmTrade() external onlyCounterparty {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");

        currentState = State.COMPLETE;

        emit Confirmed(msg.sender);
    }

    /**
     * @notice Refunds the escrowed tokens back to the depositor.
     * @dev Only callable by the arbiter. Emits a Refunded event.
     */
    function refund() external onlyArbiter nonReentrant {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");

        (bool success, ) = payable(depositor).call{value: amount}("");
        require(success, "Refund failed");
        currentState = State.REFUNDED;

        emit Refunded(depositor, amount);
    }

    /**
     * @notice Performs token swap via Uniswap V2.
     * @dev Approves the Uniswap router to spend the input token, performs the swap, and transfers the output token to the recipient.
     * Emits a TradeExecuted event.
     * @param amountOutMin The minimum acceptable amount of output tokens to receive.
     * @param path The swap path (array of token addresses).
     * @param deadline The deadline for the swap transaction.
     */
    function executeTrade(uint256 amountOutMin, address[] calldata path, uint256 deadline) external onlyDepositor {
        require(currentState == State.COMPLETE, "Invalid state");
        require(path.length >= 2, "Invalid path");

        IERC20(token).safeApprove(uniswapRouter, 0);
        IERC20(token).safeApprove(uniswapRouter, amount);

        IUniswapV2Router02(uniswapRouter).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount,
            amountOutMin,
            path,
            depositor,
            deadline
        );

        emit TradeExecuted(msg.sender, amountOutMin, path, deadline);
    }    /**
     * @notice Releases funds to the counterparty if a valid arbiter signature is provided.
     * @param to The recipient address.
     * @param token_ The token address.
     * @param amount_ The amount to release.
     * @param signature The arbiter's signature.
     */
    function releaseWithSignature(
        address to,
        address token_,
        uint256 amount_,
        bytes calldata signature
    ) external nonReentrant {
        require(currentState == State.AWAITING_CONFIRMATION || currentState == State.COMPLETE, "Invalid state");
        require(to != address(0), "Invalid recipient address");
        require(amount_ > 0, "Amount must be greater than zero");
        require(amount_ <= amount, "Amount exceeds escrow balance");
        
        // Create the digest for signature verification
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(
                keccak256("Release(address escrowAddress,address to,address token,uint256 amount)"),
                address(this),
                to,
                token_,
                amount_
            ))
        );
        
        // Verify the signature is from the arbiter
        address signer = ECDSA.recover(digest, signature);
        require(signer == arbiter, "Invalid signature");
        
        // Prevent signature replay attacks
        require(!usedSignatures[digest], "Signature already used");
        usedSignatures[digest] = true;
        
        // Release the funds
        if (token_ == address(0)) {
            // Release ETH
            (bool success, ) = payable(to).call{value: amount_}("");
            require(success, "ETH transfer failed");
        } else {
            // Release ERC20 tokens
            IERC20(token_).safeTransfer(to, amount_);
        }
        
        // Update the escrow balance
        amount -= amount_;
        
        // Update state if all funds have been released
        if (amount == 0) {
            currentState = State.COMPLETE;
        }
        
        emit FundsReleased(to, amount_);
    }
}


