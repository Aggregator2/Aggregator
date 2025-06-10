// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title Fixed Escrow Contract
 * @notice Facilitates token escrow, trade execution, and refunds without problematic inheritance
 */
contract FixedEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    enum State { AWAITING_DEPOSIT, AWAITING_CONFIRMATION, COMPLETE, REFUNDED }

    State public currentState;
    address public immutable depositor;
    address public immutable token;
    address public immutable counterparty;
    address public immutable arbiter;
    bytes32 public immutable tradeHash;
    address public immutable uniswapRouter;
    uint256 private amount;

    mapping(bytes32 => bool) public usedSignatures;

    event Deposited(address indexed depositor, uint256 amount);
    event Confirmed(address indexed sender);
    event Refunded(address indexed depositor, uint256 amount);
    event FundsReleased(address indexed to, uint256 amount);
    event TradeExecuted(address indexed sender, uint256 amountOutMin, address[] path, uint256 deadline);

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

    constructor(
        address _depositor,
        address _token,
        uint256 _amount,
        address _counterparty,
        address _arbiter,
        bytes32 _tradeHash,
        address _uniswapRouter
    ) {
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

    function deposit() external payable onlyDepositor {
        require(currentState == State.AWAITING_DEPOSIT, "Invalid state");
        require(msg.value > 0, "Deposit amount must be greater than 0");

        amount = msg.value;
        currentState = State.AWAITING_CONFIRMATION;

        emit Deposited(msg.sender, msg.value);
    }

    function confirmTrade() external onlyCounterparty {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");
        
        currentState = State.COMPLETE;
        emit Confirmed(msg.sender);
    }

    function refund() external onlyArbiter nonReentrant {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");
        
        uint256 refundAmount = address(this).balance;
        currentState = State.REFUNDED;
        
        (bool success, ) = payable(depositor).call{value: refundAmount}("");
        require(success, "Refund transfer failed");
        
        emit Refunded(depositor, refundAmount);
    }

    function executeTrade(
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external onlyDepositor nonReentrant {
        require(currentState == State.AWAITING_CONFIRMATION, "Invalid state");
        require(path.length >= 2, "Invalid path");
        require(deadline >= block.timestamp, "Deadline has passed");
        
        uint256 amountIn = address(this).balance;
        require(amountIn > 0, "No funds to trade");
        
        IUniswapV2Router02 router = IUniswapV2Router02(uniswapRouter);
        
        router.swapExactETHForTokens{value: amountIn}(
            amountOutMin,
            path,
            address(this),
            deadline
        );
        
        currentState = State.COMPLETE;
        emit TradeExecuted(msg.sender, amountOutMin, path, deadline);
    }

    function releaseWithSignature(
        address to,
        address signer,
        uint256 releaseAmount,
        bytes calldata signature
    ) external nonReentrant {
        require(currentState == State.COMPLETE, "Invalid state");
        require(to != address(0), "Invalid recipient address");
        require(signer == arbiter, "Invalid signer");
        
        bytes32 messageHash = keccak256(abi.encodePacked(to, releaseAmount, address(this)));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        
        require(!usedSignatures[ethSignedMessageHash], "Signature already used");
        require(ethSignedMessageHash.recover(signature) == signer, "Invalid signature");
        
        usedSignatures[ethSignedMessageHash] = true;
        
        if (releaseAmount > 0) {
            IERC20(token).safeTransfer(to, releaseAmount);
        }
        
        emit FundsReleased(to, releaseAmount);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getTokenBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function getAmount() external view returns (uint256) {
        return amount;
    }
}
