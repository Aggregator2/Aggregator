// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ZKProofVerifier.sol";
import "./BLSSignatureVerifier.sol";

contract FraudProofVerifier {
    enum FraudType {
        DOUBLE_SPEND,
        INVALID_BALANCE,
        SIGNATURE_FORGERY,
        PRICE_MANIPULATION,
        VOLUME_INFLATION,
        MERKLE_PROOF_INVALID,
        COMMITMENT_MISMATCH,
        THRESHOLD_VIOLATION
    }

    struct FraudProof {
        FraudType fraudType;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 evidenceHash;
        bytes proofData;
        address reporter;
    }

    struct FraudChallenge {
        bytes32 proofHash;
        address challenger;
        uint256 challengeDeadline;
        uint256 stake;
        bool resolved;
    }

    ZKProofVerifier public immutable zkVerifier;
    BLSSignatureVerifier public immutable blsVerifier;
    
    mapping(bytes32 => FraudProof) public fraudProofs;
    mapping(bytes32 => FraudChallenge) public challenges;
    mapping(address => uint256) public reporterRewards;
    mapping(address => bool) public slashedAddresses;
    
    uint256 public constant CHALLENGE_PERIOD = 1 days;
    uint256 public constant MIN_STAKE = 0.1 ether;
    uint256 public constant FRAUD_REWARD = 1 ether;
    
    event FraudProofSubmitted(
        bytes32 indexed proofHash,
        FraudType indexed fraudType,
        address indexed reporter,
        bytes32 evidenceHash
    );
    
    event FraudProofChallenged(
        bytes32 indexed proofHash,
        address indexed challenger,
        uint256 stake
    );
    
    event FraudProofConfirmed(
        bytes32 indexed proofHash,
        address indexed reporter,
        uint256 reward
    );
    
    event AddressSlashed(
        address indexed violator,
        FraudType fraudType,
        uint256 amount
    );
    
    error InvalidProof();
    error ProofAlreadyExists();
    error InsufficientStake();
    error ChallengePeriodActive();
    error NotAuthorized();
    error AlreadySlashed();

    constructor(address _zkVerifier, address _blsVerifier) {
        zkVerifier = ZKProofVerifier(_zkVerifier);
        blsVerifier = BLSSignatureVerifier(_blsVerifier);
    }

    function submitFraudProof(
        FraudType fraudType,
        bytes calldata proofData,
        bytes32 evidenceHash
    ) external payable returns (bytes32) {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        
        bytes32 proofHash = keccak256(abi.encode(
            fraudType,
            block.timestamp,
            block.number,
            evidenceHash,
            proofData,
            msg.sender
        ));
        
        if (fraudProofs[proofHash].timestamp != 0) revert ProofAlreadyExists();
        
        // Verify proof based on type
        bool isValid = verifyFraudProof(fraudType, proofData, evidenceHash);
        if (!isValid) revert InvalidProof();
        
        fraudProofs[proofHash] = FraudProof({
            fraudType: fraudType,
            timestamp: block.timestamp,
            blockNumber: block.number,
            evidenceHash: evidenceHash,
            proofData: proofData,
            reporter: msg.sender
        });
        
        emit FraudProofSubmitted(proofHash, fraudType, msg.sender, evidenceHash);
        
        return proofHash;
    }

    function challengeFraudProof(bytes32 proofHash) external payable {
        FraudProof memory proof = fraudProofs[proofHash];
        if (proof.timestamp == 0) revert InvalidProof();
        
        if (block.timestamp > proof.timestamp + CHALLENGE_PERIOD) {
            revert ChallengePeriodActive();
        }
        
        if (msg.value < MIN_STAKE * 2) revert InsufficientStake();
        
        challenges[proofHash] = FraudChallenge({
            proofHash: proofHash,
            challenger: msg.sender,
            challengeDeadline: block.timestamp + CHALLENGE_PERIOD,
            stake: msg.value,
            resolved: false
        });
        
        emit FraudProofChallenged(proofHash, msg.sender, msg.value);
    }

    function resolveFraudProof(bytes32 proofHash) external {
        FraudProof memory proof = fraudProofs[proofHash];
        FraudChallenge storage challenge = challenges[proofHash];
        
        if (proof.timestamp == 0) revert InvalidProof();
        
        // If challenged, wait for challenge period
        if (challenge.challenger != address(0) && !challenge.resolved) {
            if (block.timestamp < challenge.challengeDeadline) {
                revert ChallengePeriodActive();
            }
        } else {
            // No challenge, wait for standard period
            if (block.timestamp < proof.timestamp + CHALLENGE_PERIOD) {
                revert ChallengePeriodActive();
            }
        }
        
        // Fraud proof is valid, reward reporter
        reporterRewards[proof.reporter] += FRAUD_REWARD;
        
        // Slash the violator based on fraud type
        executeSlashing(proof);
        
        // If there was a challenge, slash the challenger
        if (challenge.challenger != address(0)) {
            challenge.resolved = true;
            // Reporter gets challenger's stake
            payable(proof.reporter).transfer(challenge.stake);
        }
        
        emit FraudProofConfirmed(proofHash, proof.reporter, FRAUD_REWARD);
    }

    function verifyFraudProof(
        FraudType fraudType,
        bytes calldata proofData,
        bytes32 evidenceHash
    ) internal view returns (bool) {
        if (fraudType == FraudType.DOUBLE_SPEND) {
            return verifyDoubleSpendProof(proofData, evidenceHash);
        } else if (fraudType == FraudType.INVALID_BALANCE) {
            return verifyInvalidBalanceProof(proofData, evidenceHash);
        } else if (fraudType == FraudType.SIGNATURE_FORGERY) {
            return verifySignatureForgeryProof(proofData, evidenceHash);
        } else if (fraudType == FraudType.PRICE_MANIPULATION) {
            return verifyPriceManipulationProof(proofData, evidenceHash);
        }
        
        return false;
    }

    function verifyDoubleSpendProof(
        bytes calldata proofData,
        bytes32 evidenceHash
    ) internal pure returns (bool) {
        // Decode proof data
        (bytes32 utxo, bytes32 tx1Hash, bytes32 tx2Hash) = abi.decode(
            proofData,
            (bytes32, bytes32, bytes32)
        );
        
        // Verify evidence hash matches
        bytes32 computedHash = keccak256(abi.encode(utxo, tx1Hash, tx2Hash));
        
        return computedHash == evidenceHash;
    }

    function verifyInvalidBalanceProof(
        bytes calldata proofData,
        bytes32 evidenceHash
    ) internal pure returns (bool) {
        // Decode proof data
        (
            address account,
            uint256 claimedBalance,
            uint256 actualBalance,
            bytes32[] memory merkleProof
        ) = abi.decode(proofData, (address, uint256, uint256, bytes32[]));
        
        // Verify balances don't match
        if (claimedBalance == actualBalance) return false;
        
        // Additional merkle proof verification would go here
        
        return true;
    }

    function verifySignatureForgeryProof(
        bytes calldata proofData,
        bytes32 evidenceHash
    ) internal pure returns (bool) {
        // Decode proof data
        (
            bytes32 messageHash,
            bytes memory signature,
            address claimedSigner,
            address actualSigner
        ) = abi.decode(proofData, (bytes32, bytes, address, address));
        
        // Verify claimed signer doesn't match actual
        return claimedSigner != actualSigner;
    }

    function verifyPriceManipulationProof(
        bytes calldata proofData,
        bytes32 evidenceHash
    ) internal pure returns (bool) {
        // Decode proof data
        (
            uint256[] memory prices,
            uint256[] memory volumes,
            uint256 referencePrice,
            uint256 deviationThreshold
        ) = abi.decode(proofData, (uint256[], uint256[], uint256, uint256));
        
        // Check for price deviations
        for (uint i = 0; i < prices.length; i++) {
            uint256 deviation = prices[i] > referencePrice 
                ? ((prices[i] - referencePrice) * 100) / referencePrice
                : ((referencePrice - prices[i]) * 100) / referencePrice;
                
            if (deviation > deviationThreshold) {
                return true;
            }
        }
        
        return false;
    }

    function executeSlashing(FraudProof memory proof) internal {
        // Extract violator address from proof data
        address violator = extractViolatorAddress(proof);
        
        if (violator == address(0)) return;
        if (slashedAddresses[violator]) revert AlreadySlashed();
        
        slashedAddresses[violator] = true;
        
        // Amount to slash depends on fraud type
        uint256 slashAmount = calculateSlashAmount(proof.fraudType);
        
        emit AddressSlashed(violator, proof.fraudType, slashAmount);
    }

    function extractViolatorAddress(
        FraudProof memory proof
    ) internal pure returns (address) {
        if (proof.fraudType == FraudType.SIGNATURE_FORGERY) {
            (, , address claimedSigner,) = abi.decode(
                proof.proofData,
                (bytes32, bytes, address, address)
            );
            return claimedSigner;
        } else if (proof.fraudType == FraudType.INVALID_BALANCE) {
            (address account, , ,) = abi.decode(
                proof.proofData,
                (address, uint256, uint256, bytes32[])
            );
            return account;
        }
        
        return address(0);
    }

    function calculateSlashAmount(
        FraudType fraudType
    ) internal pure returns (uint256) {
        if (fraudType == FraudType.DOUBLE_SPEND) return 10 ether;
        if (fraudType == FraudType.SIGNATURE_FORGERY) return 5 ether;
        if (fraudType == FraudType.INVALID_BALANCE) return 3 ether;
        if (fraudType == FraudType.PRICE_MANIPULATION) return 7 ether;
        
        return 1 ether;
    }

    function claimRewards() external {
        uint256 rewards = reporterRewards[msg.sender];
        if (rewards == 0) revert NotAuthorized();
        
        reporterRewards[msg.sender] = 0;
        payable(msg.sender).transfer(rewards);
    }

    receive() external payable {}
}