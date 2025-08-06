// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SettlementWithProofsV2
 * @author DEX Team
 * @notice Optimized settlement contract using Merkle proofs for batch settlements
 * @dev Implements gas-efficient settlement distribution with enhanced security features
 * 
 * Key improvements:
 * - Gas optimization through packed structs and efficient storage
 * - Enhanced security with pausability and claim expiration
 * - Improved error handling with custom errors
 * - Better documentation and event logging
 */
contract SettlementWithProofsV2 is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // Custom errors for gas efficiency
    error BatchAlreadyExists();
    error InvalidMerkleRoot();
    error BatchDoesNotExist();
    error BatchNotFinalized();
    error BatchExpired();
    error AlreadyClaimed();
    error InvalidProof();
    error InsufficientContractBalance();
    error InvalidCaller();
    error NotAuthorized();
    error InvalidAmount();
    error InvalidToken();
    error InvalidRecipient();
    error ClaimDeadlinePassed();
    error BatchAlreadyFinalized();
    error InvalidEpochId();
    error TooManySettlements();

    /// @notice Maximum settlements per batch to prevent DOS
    uint256 public constant MAX_SETTLEMENTS_PER_BATCH = 10000;
    
    /// @notice Minimum time before a batch can be emergency withdrawn
    uint256 public constant EMERGENCY_WITHDRAWAL_DELAY = 90 days;
    
    /// @notice Maximum claim deadline after batch finalization
    uint256 public constant MAX_CLAIM_DEADLINE = 365 days;

    /**
     * @notice Packed struct for gas efficiency
     * @dev Uses single storage slot for multiple values
     */
    struct SettlementBatch {
        bytes32 merkleRoot;          // 32 bytes
        uint128 timestamp;           // 16 bytes - sufficient until year 10889
        uint64 totalSettlements;     // 8 bytes - max ~18.4 quintillion
        uint32 claimDeadline;        // 4 bytes - timestamp in days since epoch
        bool finalized;              // 1 byte
        bool emergencyWithdrawn;     // 1 byte
        // Total: 62 bytes (fits in 2 storage slots)
    }

    /// @notice Mapping of epoch ID to settlement batch
    mapping(bytes32 => SettlementBatch) public settlementBatches;
    
    /// @notice Tracks claimed settlements per batch per user
    /// @dev Double mapping for gas efficiency when checking claims
    mapping(bytes32 => mapping(address => bool)) public hasClaimed;
    
    /// @notice Token balance tracking with overflow protection
    mapping(address => uint256) public tokenBalances;
    
    /// @notice Authorized settlement engines
    mapping(address => bool) public authorizedEngines;

    /// @notice Tracks total value locked per token for transparency
    mapping(address => uint256) public totalValueLocked;

    // Events with indexed parameters for efficient filtering
    event SettlementBatchCreated(
        bytes32 indexed epochIdHash,
        string epochId,
        bytes32 indexed merkleRoot,
        uint256 totalSettlements,
        uint256 claimDeadline
    );

    event SettlementClaimed(
        bytes32 indexed epochIdHash,
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event SettlementBatchFinalized(
        bytes32 indexed epochIdHash,
        bytes32 merkleRoot
    );

    event TokensDeposited(
        address indexed depositor,
        address indexed token,
        uint256 amount
    );

    event EmergencyWithdrawal(
        address indexed token,
        uint256 amount,
        address indexed recipient
    );

    event EngineAuthorizationChanged(
        address indexed engine,
        bool authorized
    );

    modifier onlyAuthorized() {
        if (!authorizedEngines[msg.sender] && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    /**
     * @notice Contract constructor
     * @dev Authorizes deployer as initial engine
     */
    constructor() {
        authorizedEngines[msg.sender] = true;
        emit EngineAuthorizationChanged(msg.sender, true);
    }

    /**
     * @notice Authorize or revoke a settlement engine
     * @param engine Address to update authorization
     * @param authorized Whether to authorize or revoke
     */
    function setEngineAuthorization(address engine, bool authorized) 
        external 
        onlyOwner 
    {
        if (engine == address(0)) revert InvalidRecipient();
        authorizedEngines[engine] = authorized;
        emit EngineAuthorizationChanged(engine, authorized);
    }

    /**
     * @notice Create a new settlement batch
     * @param epochId Unique identifier for the settlement epoch
     * @param merkleRoot Root of the Merkle tree containing all settlements
     * @param totalSettlements Total number of settlements in the batch
     * @param claimDeadlineDays Number of days users have to claim (max 365)
     */
    function createSettlementBatch(
        string calldata epochId,
        bytes32 merkleRoot,
        uint256 totalSettlements,
        uint256 claimDeadlineDays
    ) external onlyAuthorized whenNotPaused {
        if (bytes(epochId).length == 0) revert InvalidEpochId();
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (totalSettlements == 0 || totalSettlements > MAX_SETTLEMENTS_PER_BATCH) {
            revert TooManySettlements();
        }
        if (claimDeadlineDays == 0 || claimDeadlineDays > MAX_CLAIM_DEADLINE / 1 days) {
            revert InvalidAmount();
        }

        bytes32 epochIdHash = keccak256(bytes(epochId));
        
        if (settlementBatches[epochIdHash].merkleRoot != bytes32(0)) {
            revert BatchAlreadyExists();
        }

        uint256 deadline = block.timestamp + (claimDeadlineDays * 1 days);
        
        settlementBatches[epochIdHash] = SettlementBatch({
            merkleRoot: merkleRoot,
            timestamp: uint128(block.timestamp),
            totalSettlements: uint64(totalSettlements),
            claimDeadline: uint32(deadline / 1 days),
            finalized: false,
            emergencyWithdrawn: false
        });

        emit SettlementBatchCreated(
            epochIdHash,
            epochId,
            merkleRoot,
            totalSettlements,
            deadline
        );
    }

    /**
     * @notice Finalize a settlement batch
     * @param epochId Epoch to finalize
     */
    function finalizeSettlementBatch(string calldata epochId) 
        external 
        onlyAuthorized 
        whenNotPaused 
    {
        bytes32 epochIdHash = keccak256(bytes(epochId));
        SettlementBatch storage batch = settlementBatches[epochIdHash];
        
        if (batch.merkleRoot == bytes32(0)) revert BatchDoesNotExist();
        if (batch.finalized) revert BatchAlreadyFinalized();
        
        batch.finalized = true;
        
        emit SettlementBatchFinalized(epochIdHash, batch.merkleRoot);
    }

    /**
     * @notice Claim settlement using Merkle proof
     * @param epochId Settlement epoch ID
     * @param token Token address to claim
     * @param amount Settlement amount
     * @param merkleProof Proof that this settlement is in the Merkle tree
     */
    function claimSettlement(
        string calldata epochId,
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant whenNotPaused {
        bytes32 epochIdHash = keccak256(bytes(epochId));
        SettlementBatch memory batch = settlementBatches[epochIdHash];
        
        // Validations
        if (batch.merkleRoot == bytes32(0)) revert BatchDoesNotExist();
        if (!batch.finalized) revert BatchNotFinalized();
        if (batch.emergencyWithdrawn) revert BatchExpired();
        if (block.timestamp > uint256(batch.claimDeadline) * 1 days) {
            revert ClaimDeadlinePassed();
        }
        if (hasClaimed[epochIdHash][msg.sender]) revert AlreadyClaimed();
        if (token == address(0)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        // Verify Merkle proof
        bytes32 leaf = keccak256(abi.encode(msg.sender, token, amount));
        if (!MerkleProof.verify(merkleProof, batch.merkleRoot, leaf)) {
            revert InvalidProof();
        }

        // Mark as claimed before transfer (checks-effects-interactions)
        hasClaimed[epochIdHash][msg.sender] = true;

        // Check balance
        if (tokenBalances[token] < amount) {
            revert InsufficientContractBalance();
        }

        // Update balances
        unchecked {
            tokenBalances[token] -= amount;
            totalValueLocked[token] -= amount;
        }

        // Transfer tokens
        IERC20(token).safeTransfer(msg.sender, amount);

        emit SettlementClaimed(epochIdHash, msg.sender, token, amount);
    }

    /**
     * @notice Optimized batch claim for multiple settlements
     * @param claims Array of claim data
     * @dev Skips already claimed settlements instead of reverting
     */
    function batchClaimSettlements(ClaimData[] calldata claims) 
        external 
        nonReentrant 
        whenNotPaused 
    {
        uint256 claimsLength = claims.length;
        
        for (uint256 i; i < claimsLength;) {
            ClaimData calldata claim = claims[i];
            bytes32 epochIdHash = keccak256(bytes(claim.epochId));
            
            // Skip if already claimed
            if (!hasClaimed[epochIdHash][msg.sender]) {
                // Process claim
                _processClaim(
                    claim.epochId,
                    epochIdHash,
                    claim.token,
                    claim.amount,
                    claim.merkleProof
                );
            }
            
            unchecked { ++i; }
        }
    }

    /**
     * @notice Internal function to process a single claim
     * @dev Extracted for code reuse and gas optimization
     */
    function _processClaim(
        string calldata epochId,
        bytes32 epochIdHash,
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) private {
        SettlementBatch memory batch = settlementBatches[epochIdHash];
        
        // Validations
        if (batch.merkleRoot == bytes32(0)) revert BatchDoesNotExist();
        if (!batch.finalized) revert BatchNotFinalized();
        if (batch.emergencyWithdrawn) revert BatchExpired();
        if (block.timestamp > uint256(batch.claimDeadline) * 1 days) {
            revert ClaimDeadlinePassed();
        }
        if (token == address(0)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();

        // Verify proof
        bytes32 leaf = keccak256(abi.encode(msg.sender, token, amount));
        if (!MerkleProof.verify(merkleProof, batch.merkleRoot, leaf)) {
            revert InvalidProof();
        }

        // Mark as claimed
        hasClaimed[epochIdHash][msg.sender] = true;

        // Check balance
        if (tokenBalances[token] < amount) {
            revert InsufficientContractBalance();
        }

        // Update balances
        unchecked {
            tokenBalances[token] -= amount;
            totalValueLocked[token] -= amount;
        }

        // Transfer
        IERC20(token).safeTransfer(msg.sender, amount);

        emit SettlementClaimed(epochIdHash, msg.sender, token, amount);
    }

    /**
     * @notice Verify a Merkle proof without claiming
     * @param epochId Settlement epoch ID
     * @param user User address to verify
     * @param token Token address
     * @param amount Settlement amount
     * @param merkleProof Merkle proof array
     * @return valid Whether the proof is valid
     */
    function verifyProof(
        string calldata epochId,
        address user,
        address token,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external view returns (bool valid) {
        bytes32 epochIdHash = keccak256(bytes(epochId));
        SettlementBatch memory batch = settlementBatches[epochIdHash];
        
        if (batch.merkleRoot == bytes32(0)) return false;
        
        bytes32 leaf = keccak256(abi.encode(user, token, amount));
        return MerkleProof.verify(merkleProof, batch.merkleRoot, leaf);
    }

    /**
     * @notice Check if a user has claimed from a specific epoch
     * @param epochId Settlement epoch ID
     * @param user User address to check
     * @return claimed Whether the user has claimed
     */
    function hasUserClaimed(
        string calldata epochId,
        address user
    ) external view returns (bool claimed) {
        bytes32 epochIdHash = keccak256(bytes(epochId));
        return hasClaimed[epochIdHash][user];
    }

    /**
     * @notice Get detailed settlement batch information
     * @param epochId Epoch to query
     * @return merkleRoot The Merkle root
     * @return timestamp When the batch was created
     * @return totalSettlements Number of settlements
     * @return claimDeadline Deadline for claims (timestamp)
     * @return finalized Whether the batch is finalized
     * @return emergencyWithdrawn Whether emergency withdrawal occurred
     */
    function getSettlementBatch(string calldata epochId) 
        external 
        view 
        returns (
            bytes32 merkleRoot,
            uint256 timestamp,
            uint256 totalSettlements,
            uint256 claimDeadline,
            bool finalized,
            bool emergencyWithdrawn
        ) 
    {
        bytes32 epochIdHash = keccak256(bytes(epochId));
        SettlementBatch memory batch = settlementBatches[epochIdHash];
        
        return (
            batch.merkleRoot,
            batch.timestamp,
            batch.totalSettlements,
            uint256(batch.claimDeadline) * 1 days,
            batch.finalized,
            batch.emergencyWithdrawn
        );
    }

    /**
     * @notice Deposit tokens for settlement distribution
     * @param token Token to deposit
     * @param amount Amount to deposit
     * @dev Requires approval from caller
     */
    function depositTokens(
        address token,
        uint256 amount
    ) external onlyAuthorized whenNotPaused {
        if (token == address(0)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        
        // Update balances before transfer
        tokenBalances[token] += amount;
        totalValueLocked[token] += amount;
        
        // Transfer tokens
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        
        emit TokensDeposited(msg.sender, token, amount);
    }

    /**
     * @notice Emergency withdrawal after claim deadline
     * @param token Token to withdraw
     * @param epochId Epoch that has expired
     * @param recipient Address to receive tokens
     * @dev Only callable after emergency delay period
     */
    function emergencyWithdraw(
        address token,
        string calldata epochId,
        address recipient
    ) external onlyOwner {
        if (recipient == address(0)) revert InvalidRecipient();
        
        bytes32 epochIdHash = keccak256(bytes(epochId));
        SettlementBatch storage batch = settlementBatches[epochIdHash];
        
        if (batch.merkleRoot == bytes32(0)) revert BatchDoesNotExist();
        if (batch.emergencyWithdrawn) revert BatchExpired();
        
        // Check if emergency withdrawal period has passed
        uint256 emergencyTime = uint256(batch.claimDeadline) * 1 days + EMERGENCY_WITHDRAWAL_DELAY;
        if (block.timestamp < emergencyTime) {
            revert ClaimDeadlinePassed();
        }
        
        batch.emergencyWithdrawn = true;
        
        // Withdraw remaining balance
        uint256 balance = tokenBalances[token];
        if (balance > 0) {
            tokenBalances[token] = 0;
            totalValueLocked[token] = 0;
            IERC20(token).safeTransfer(recipient, balance);
            
            emit EmergencyWithdrawal(token, balance, recipient);
        }
    }

    /**
     * @notice Calculate the leaf hash for a settlement
     * @param user User address
     * @param token Token address
     * @param amount Settlement amount
     * @return leaf Keccak256 hash of the settlement data
     */
    function getLeafHash(
        address user,
        address token,
        uint256 amount
    ) public pure returns (bytes32 leaf) {
        return keccak256(abi.encode(user, token, amount));
    }

    /**
     * @notice Pause the contract
     * @dev Only callable by owner in emergency situations
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     * @dev Only callable by owner after emergency resolution
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Get multiple batch statuses efficiently
     * @param epochIds Array of epoch IDs to check
     * @return statuses Array of batch existence flags
     */
    function getBatchStatuses(string[] calldata epochIds) 
        external 
        view 
        returns (bool[] memory statuses) 
    {
        uint256 length = epochIds.length;
        statuses = new bool[](length);
        
        for (uint256 i; i < length;) {
            bytes32 epochIdHash = keccak256(bytes(epochIds[i]));
            statuses[i] = settlementBatches[epochIdHash].merkleRoot != bytes32(0);
            unchecked { ++i; }
        }
    }

    /// @notice Struct for batch claim data
    struct ClaimData {
        string epochId;
        address token;
        uint256 amount;
        bytes32[] merkleProof;
    }
}