// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./interfaces/IThresholdWallet.sol";

/**
 * @title ThresholdWallet
 * @notice Threshold signature wallet implementation
 * @dev Supports M-of-N threshold signatures with various signing schemes
 */
contract ThresholdWallet is IThresholdWallet, ReentrancyGuardUpgradeable {
    using ECDSA for bytes32;
    
    // Constants
    uint256 public constant VERSION = 1;
    uint256 private constant DOMAIN_SEPARATOR_TYPEHASH = 
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant TRANSACTION_TYPEHASH = 
        keccak256("Transaction(address to,uint256 value,bytes data,uint256 nonce,uint256 deadline)");
    
    // State variables
    uint256 public threshold;
    uint256 public ownerCount;
    mapping(address => bool) public isOwner;
    address[] public owners;
    uint256 public nonce;
    
    // Transaction tracking
    mapping(bytes32 => Transaction) public transactions;
    mapping(bytes32 => mapping(address => bool)) public confirmations;
    mapping(bytes32 => uint256) public confirmationCounts;
    
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        uint256 deadline;
    }
    
    // Modifiers
    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not owner");
        _;
    }
    
    modifier onlyWallet() {
        require(msg.sender == address(this), "Not wallet");
        _;
    }
    
    modifier validRequirement(uint256 _ownerCount, uint256 _required) {
        require(_ownerCount <= 20, "Too many owners");
        require(_required <= _ownerCount, "Invalid threshold");
        require(_required > 0, "Threshold too low");
        require(_ownerCount > 0, "No owners");
        _;
    }
    
    // Events
    event Confirmation(address indexed sender, bytes32 indexed transactionId);
    event Revocation(address indexed sender, bytes32 indexed transactionId);
    event Submission(bytes32 indexed transactionId);
    event Execution(bytes32 indexed transactionId);
    event ExecutionFailure(bytes32 indexed transactionId);
    event OwnerAddition(address indexed owner);
    event OwnerRemoval(address indexed owner);
    event RequirementChange(uint256 required);
    
    /**
     * @notice Initialize the threshold wallet
     * @param _threshold Number of required confirmations
     * @param _owners List of initial owners
     */
    function initialize(
        uint256 _threshold,
        address[] memory _owners
    ) external override initializer validRequirement(_owners.length, _threshold) {
        __ReentrancyGuard_init();
        
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "Invalid owner");
            require(!isOwner[_owners[i]], "Duplicate owner");
            
            isOwner[_owners[i]] = true;
            owners.push(_owners[i]);
        }
        
        ownerCount = _owners.length;
        threshold = _threshold;
    }
    
    /**
     * @notice Submit a new transaction
     * @param to Destination address
     * @param value ETH value to send
     * @param data Transaction data
     * @param deadline Transaction deadline
     */
    function submitTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint256 deadline
    ) external override onlyOwner returns (bytes32 transactionId) {
        require(to != address(0), "Invalid destination");
        require(deadline > block.timestamp, "Invalid deadline");
        
        transactionId = getTransactionHash(to, value, data, nonce, deadline);
        
        transactions[transactionId] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            deadline: deadline
        });
        
        confirmations[transactionId][msg.sender] = true;
        confirmationCounts[transactionId] = 1;
        
        emit Submission(transactionId);
        emit Confirmation(msg.sender, transactionId);
        
        if (confirmationCounts[transactionId] >= threshold) {
            _executeTransaction(transactionId);
        }
    }
    
    /**
     * @notice Confirm a pending transaction
     * @param transactionId The transaction ID to confirm
     */
    function confirmTransaction(bytes32 transactionId) external override onlyOwner {
        require(transactions[transactionId].to != address(0), "Transaction not found");
        require(!transactions[transactionId].executed, "Already executed");
        require(!confirmations[transactionId][msg.sender], "Already confirmed");
        require(block.timestamp <= transactions[transactionId].deadline, "Transaction expired");
        
        confirmations[transactionId][msg.sender] = true;
        confirmationCounts[transactionId]++;
        
        emit Confirmation(msg.sender, transactionId);
        
        if (confirmationCounts[transactionId] >= threshold) {
            _executeTransaction(transactionId);
        }
    }
    
    /**
     * @notice Revoke a confirmation
     * @param transactionId The transaction ID to revoke
     */
    function revokeConfirmation(bytes32 transactionId) external override onlyOwner {
        require(transactions[transactionId].to != address(0), "Transaction not found");
        require(!transactions[transactionId].executed, "Already executed");
        require(confirmations[transactionId][msg.sender], "Not confirmed");
        
        confirmations[transactionId][msg.sender] = false;
        confirmationCounts[transactionId]--;
        
        emit Revocation(msg.sender, transactionId);
    }
    
    /**
     * @notice Execute a confirmed transaction
     * @param transactionId The transaction ID to execute
     */
    function executeTransaction(bytes32 transactionId) external override onlyOwner {
        require(confirmationCounts[transactionId] >= threshold, "Not enough confirmations");
        _executeTransaction(transactionId);
    }
    
    /**
     * @notice Execute transaction with signatures (for external calls)
     * @param to Destination address
     * @param value ETH value
     * @param data Transaction data
     * @param signatures Packed signatures from owners
     */
    function executeWithSignatures(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata signatures
    ) external override nonReentrant {
        require(to != address(0), "Invalid destination");
        require(signatures.length >= threshold * 65, "Not enough signatures");
        
        bytes32 txHash = getTransactionHash(to, value, data, nonce, block.timestamp + 1 hours);
        
        // Verify signatures
        address[] memory signers = new address[](threshold);
        for (uint256 i = 0; i < threshold; i++) {
            bytes memory signature = _extractSignature(signatures, i);
            address signer = _recoverSigner(txHash, signature);
            
            require(isOwner[signer], "Invalid signer");
            
            // Check for duplicate signers
            for (uint256 j = 0; j < i; j++) {
                require(signers[j] != signer, "Duplicate signer");
            }
            
            signers[i] = signer;
        }
        
        // Execute transaction
        nonce++;
        (bool success, ) = to.call{value: value}(data);
        require(success, "Execution failed");
        
        emit Execution(txHash);
    }
    
    /**
     * @notice Add a new owner
     * @param owner Address to add as owner
     */
    function addOwner(address owner) external override onlyWallet {
        require(owner != address(0), "Invalid owner");
        require(!isOwner[owner], "Already owner");
        require(ownerCount < 20, "Too many owners");
        
        isOwner[owner] = true;
        owners.push(owner);
        ownerCount++;
        
        emit OwnerAddition(owner);
    }
    
    /**
     * @notice Remove an owner
     * @param owner Address to remove
     */
    function removeOwner(address owner) external override onlyWallet {
        require(isOwner[owner], "Not owner");
        require(ownerCount - 1 >= threshold, "Would break threshold");
        
        isOwner[owner] = false;
        
        // Remove from owners array
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        
        ownerCount--;
        
        emit OwnerRemoval(owner);
    }
    
    /**
     * @notice Change the threshold
     * @param _threshold New threshold value
     */
    function changeThreshold(uint256 _threshold) external override onlyWallet 
        validRequirement(ownerCount, _threshold) {
        threshold = _threshold;
        emit RequirementChange(_threshold);
    }
    
    /**
     * @notice Execute a confirmed transaction internally
     */
    function _executeTransaction(bytes32 transactionId) internal nonReentrant {
        Transaction storage txn = transactions[transactionId];
        
        require(!txn.executed, "Already executed");
        require(block.timestamp <= txn.deadline, "Transaction expired");
        
        txn.executed = true;
        nonce++;
        
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        
        if (success) {
            emit Execution(transactionId);
        } else {
            txn.executed = false;
            nonce--;
            emit ExecutionFailure(transactionId);
        }
    }
    
    /**
     * @notice Get transaction hash
     */
    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        uint256 _nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked(
            bytes1(0x19),
            bytes1(0x01),
            domainSeparator(),
            keccak256(abi.encode(
                TRANSACTION_TYPEHASH,
                to,
                value,
                keccak256(data),
                _nonce,
                deadline
            ))
        ));
    }
    
    /**
     * @notice Get domain separator for EIP-712
     */
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_SEPARATOR_TYPEHASH,
            keccak256(bytes("ThresholdWallet")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }
    
    /**
     * @notice Extract signature from packed signatures
     */
    function _extractSignature(
        bytes memory signatures,
        uint256 index
    ) internal pure returns (bytes memory) {
        bytes memory signature = new bytes(65);
        uint256 offset = index * 65;
        
        assembly {
            let signaturePos := add(signatures, add(32, offset))
            mstore(add(signature, 32), mload(signaturePos))
            mstore(add(signature, 64), mload(add(signaturePos, 32)))
            mstore8(add(signature, 96), byte(0, mload(add(signaturePos, 64))))
        }
        
        return signature;
    }
    
    /**
     * @notice Recover signer from signature
     */
    function _recoverSigner(
        bytes32 messageHash,
        bytes memory signature
    ) internal pure returns (address) {
        return messageHash.recover(signature);
    }
    
    /**
     * @notice Get confirmation count for a transaction
     */
    function getConfirmationCount(bytes32 transactionId) external view returns (uint256) {
        return confirmationCounts[transactionId];
    }
    
    /**
     * @notice Get owners list
     */
    function getOwners() external view returns (address[] memory) {
        return owners;
    }
    
    /**
     * @notice Check if transaction is confirmed by an owner
     */
    function isConfirmed(
        bytes32 transactionId,
        address owner
    ) external view returns (bool) {
        return confirmations[transactionId][owner];
    }
    
    /**
     * @notice Receive ETH
     */
    receive() external payable {
        // Accept ETH
    }
}