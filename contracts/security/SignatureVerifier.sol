// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title SignatureVerifier
 * @notice Enhanced signature verification with multiple security measures
 */
abstract contract SignatureVerifier is EIP712 {
    using ECDSA for bytes32;
    
    // Nonce management for replay protection
    mapping(address => uint256) public nonces;
    
    // Signature expiry
    uint256 public constant SIGNATURE_VALIDITY_PERIOD = 30 minutes;
    
    // Used signatures tracking (additional layer)
    mapping(bytes32 => bool) public usedSignatures;
    
    // Signature struct for complex operations
    struct SignatureData {
        uint8 v;
        bytes32 r;
        bytes32 s;
        uint256 deadline;
        uint256 nonce;
    }
    
    event SignatureUsed(bytes32 indexed hash, address indexed signer);
    event NonceIncremented(address indexed user, uint256 newNonce);
    
    /**
     * @notice Verify signature with comprehensive checks
     * @param signer Expected signer address
     * @param digest Message digest
     * @param signature Signature bytes
     * @param deadline Signature expiry timestamp
     * @param nonce Expected nonce
     */
    function _verifySignature(
        address signer,
        bytes32 digest,
        bytes memory signature,
        uint256 deadline,
        uint256 nonce
    ) internal {
        // Check deadline
        require(block.timestamp <= deadline, "Signature expired");
        
        // Check nonce
        require(nonce == nonces[signer], "Invalid nonce");
        
        // Check if signature was already used
        bytes32 sigHash = keccak256(abi.encode(digest, nonce, deadline));
        require(!usedSignatures[sigHash], "Signature already used");
        
        // Verify signer
        address recoveredSigner = ECDSA.recover(digest, signature);
        require(recoveredSigner == signer, "Invalid signature");
        
        // Prevent signature malleability
        require(
            uint256(bytes32(signature[64:65])) < 2,
            "Invalid signature 's' value"
        );
        
        // Mark signature as used
        usedSignatures[sigHash] = true;
        nonces[signer]++;
        
        emit SignatureUsed(sigHash, signer);
        emit NonceIncremented(signer, nonces[signer]);
    }
    
    /**
     * @notice Create typed data hash for EIP-712
     * @param structHash The struct hash to sign
     */
    function _createTypedDataHash(bytes32 structHash) internal view returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }
    
    /**
     * @notice Batch signature verification for multi-sig scenarios
     * @param signers Array of expected signers
     * @param digest Message digest
     * @param signatures Array of signatures
     * @param threshold Minimum required signatures
     */
    function _verifyMultipleSignatures(
        address[] memory signers,
        bytes32 digest,
        bytes[] memory signatures,
        uint256 threshold
    ) internal view returns (bool) {
        require(signatures.length >= threshold, "Insufficient signatures");
        
        uint256 validSignatures = 0;
        address lastSigner = address(0);
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address recoveredSigner = ECDSA.recover(digest, signatures[i]);
            
            // Check if signer is authorized
            bool isValidSigner = false;
            for (uint256 j = 0; j < signers.length; j++) {
                if (signers[j] == recoveredSigner) {
                    isValidSigner = true;
                    break;
                }
            }
            
            if (isValidSigner && recoveredSigner > lastSigner) {
                validSignatures++;
                lastSigner = recoveredSigner;
            }
            
            if (validSignatures >= threshold) {
                return true;
            }
        }
        
        return false;
    }
}