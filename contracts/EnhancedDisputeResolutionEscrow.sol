// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./DisputeResolutionEscrow.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EnhancedDisputeResolutionEscrow
 * @notice Escrow with partial fill support
 */
contract EnhancedDisputeResolutionEscrow is DisputeResolutionEscrow {
    uint256 public filledAmount;
    uint256 public remainingAmount;
    bool public partialFillAccepted;

    event PartialSolutionProvided(uint256 filledAmount, uint256 remainingAmount);
    event PartialSolutionAccepted(address solver, uint256 amount);
    event RemainingRefunded(address depositor, uint256 amount);

    constructor(
        address _depositor,
        address _solver,
        address _depositToken,
        address _settlementToken,
        address _uniswapRouter
    ) DisputeResolutionEscrow(_depositor, _solver, _depositToken, _settlementToken, _uniswapRouter) {}

    function providePartialSolution(uint256 _filledAmount) external onlySolver {
        require(currentState == State.AWAITING_SOLUTION, "Invalid state");
        require(_filledAmount > 0 && _filledAmount < depositAmount, "Invalid partial amount");
        
        filledAmount = _filledAmount;
        remainingAmount = depositAmount - _filledAmount;
        currentState = State.SOLUTION_PROVIDED;
        
        emit PartialSolutionProvided(filledAmount, remainingAmount);
    }

    function acceptPartialSolution() external onlyDepositor nonReentrant {
        require(currentState == State.SOLUTION_PROVIDED, "No solution to accept");
        require(filledAmount > 0, "No partial fill");
        
        partialFillAccepted = true;
        _transferFunds(solver, filledAmount);
        
        emit PartialSolutionAccepted(solver, filledAmount);
    }

    function refundRemaining() external onlyDepositor nonReentrant {
        require(partialFillAccepted, "Partial fill not accepted");
        require(remainingAmount > 0, "No remaining amount");
        
        uint256 toRefund = remainingAmount;
        remainingAmount = 0;
        depositAmount = 0;
        
        _transferFunds(depositor, toRefund);
        currentState = State.COMPLETED;
        
        emit RemainingRefunded(depositor, toRefund);
    }
}

/**
 * @title PausableDisputeResolutionEscrow
 * @notice Escrow with emergency pause functionality
 */
contract PausableDisputeResolutionEscrow is DisputeResolutionEscrow, Pausable {
    address public emergencyAdmin;
    
    event EmergencyWithdrawalDuringPause(address indexed recipient, uint256 amount);

    constructor(
        address _depositor,
        address _solver,
        address _depositToken,
        address _settlementToken,
        address _uniswapRouter,
        address _emergencyAdmin
    ) DisputeResolutionEscrow(_depositor, _solver, _depositToken, _settlementToken, _uniswapRouter) {
        emergencyAdmin = _emergencyAdmin;
    }

    modifier onlyEmergencyAdmin() {
        require(msg.sender == emergencyAdmin, "Not emergency admin");
        _;
    }

    function pause() external onlyEmergencyAdmin {
        _pause();
    }

    function unpause() external onlyEmergencyAdmin {
        _unpause();
    }

    function emergencyWithdrawPaused() external nonReentrant whenPaused {
        require(msg.sender == depositor || msg.sender == solver, "Not participant");
        require(depositAmount > 0, "No funds to withdraw");
        
        uint256 amount = depositAmount;
        depositAmount = 0;
        
        _transferFunds(msg.sender, amount);
        currentState = State.REFUNDED;
        
        emit EmergencyWithdrawalDuringPause(msg.sender, amount);
    }

    // Override functions to add pause check
    function deposit(uint256 amount) external payable override onlyDepositor nonReentrant whenNotPaused {
        super.deposit(amount);
    }

    function acceptSolution() external override onlyDepositor nonReentrant whenNotPaused {
        super.acceptSolution();
    }
}

/**
 * @title MEVProtectedEscrow
 * @notice Escrow with commit-reveal pattern for MEV protection
 */
contract MEVProtectedEscrow {
    struct Commitment {
        bytes32 hash;
        uint256 timestamp;
        bool revealed;
    }

    mapping(address => Commitment) public commitments;
    uint256 public constant REVEAL_WINDOW = 300; // 5 minutes
    
    address public immutable depositor;
    address public immutable solver;
    uint256 public depositAmount;
    
    event DepositCommitted(address indexed depositor, bytes32 commitment);
    event DepositRevealed(address indexed depositor, uint256 amount);

    constructor(address _depositor, address _solver) {
        depositor = _depositor;
        solver = _solver;
    }

    function commitDeposit(bytes32 _commitment) external {
        require(msg.sender == depositor, "Only depositor");
        require(commitments[msg.sender].timestamp == 0, "Already committed");
        
        commitments[msg.sender] = Commitment({
            hash: _commitment,
            timestamp: block.timestamp,
            revealed: false
        });
        
        emit DepositCommitted(msg.sender, _commitment);
    }

    function revealDeposit(uint256 _amount, bytes32 _secret) external payable {
        require(msg.sender == depositor, "Only depositor");
        Commitment storage commitment = commitments[msg.sender];
        require(commitment.timestamp > 0, "No commitment");
        require(!commitment.revealed, "Already revealed");
        require(block.timestamp >= commitment.timestamp + REVEAL_WINDOW, "Still in commit phase");
        
        bytes32 hash = keccak256(abi.encode(_amount, _secret));
        require(hash == commitment.hash, "Invalid reveal");
        require(msg.value == _amount, "Incorrect ETH amount");
        
        commitment.revealed = true;
        depositAmount = _amount;
        
        emit DepositRevealed(msg.sender, _amount);
    }
}

/**
 * @title MultiSigDisputeResolutionEscrow
 * @notice Escrow requiring multi-signature approval for large releases
 */
contract MultiSigDisputeResolutionEscrow is DisputeResolutionEscrow {
    uint256 public constant LARGE_AMOUNT_THRESHOLD = 100 ether;
    
    address[] public signers;
    uint256 public requiredSignatures;
    mapping(address => mapping(uint256 => bool)) public approvals;
    uint256 public approvalNonce;
    uint256 public approvalCount;
    
    event LargeReleaseInitiated(uint256 indexed nonce, uint256 amount);
    event LargeReleaseApproved(address indexed recipient, uint256 amount);
    event SignerApproved(address indexed signer, uint256 indexed nonce);

    constructor(
        address _depositor,
        address _solver,
        address[] memory _signers,
        uint256 _requiredSignatures
    ) DisputeResolutionEscrow(_depositor, _solver, address(0), address(0), address(0)) {
        require(_signers.length >= _requiredSignatures, "Not enough signers");
        require(_requiredSignatures > 0, "Invalid required signatures");
        
        signers = _signers;
        requiredSignatures = _requiredSignatures;
    }

    function acceptSolution() external override onlyDepositor nonReentrant {
        require(currentState == State.SOLUTION_PROVIDED, "No solution to accept");
        
        if (depositAmount >= LARGE_AMOUNT_THRESHOLD) {
            approvalNonce++;
            emit LargeReleaseInitiated(approvalNonce, depositAmount);
        } else {
            _transferFunds(solver, depositAmount);
            currentState = State.COMPLETED;
            emit SolutionAccepted(depositor);
        }
    }

    function approveLargeRelease() external {
        require(isValidSigner(msg.sender), "Not a valid signer");
        require(depositAmount >= LARGE_AMOUNT_THRESHOLD, "Not a large release");
        require(!approvals[msg.sender][approvalNonce], "Already approved");
        require(approvalNonce > 0, "No pending approval");
        
        approvals[msg.sender][approvalNonce] = true;
        approvalCount++;
        
        emit SignerApproved(msg.sender, approvalNonce);
        
        if (approvalCount >= requiredSignatures) {
            uint256 amount = depositAmount;
            depositAmount = 0;
            approvalCount = 0;
            
            _transferFunds(solver, amount);
            currentState = State.COMPLETED;
            
            emit LargeReleaseApproved(solver, amount);
        }
    }

    function isValidSigner(address _address) public view returns (bool) {
        for (uint i = 0; i < signers.length; i++) {
            if (signers[i] == _address) {
                return true;
            }
        }
        return false;
    }
}