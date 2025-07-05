// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IVerifier {
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[4] memory input
    ) external view returns (bool);
}

contract ZKProofVerifier {
    struct Proof {
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    struct PublicInputs {
        bytes32 commitment;
        uint256 minPrice;
        uint256 maxPrice;
        uint256 totalVolume;
    }

    IVerifier public immutable groth16Verifier;
    
    mapping(bytes32 => bool) public verifiedCommitments;
    mapping(address => mapping(uint256 => bytes32)) public userCommitments;
    
    event ProofVerified(
        address indexed trader,
        bytes32 indexed commitment,
        uint256 totalVolume
    );
    
    event BatchProofVerified(
        bytes32 indexed merkleRoot,
        uint256 totalVolume,
        uint256 numTrades
    );

    error InvalidProof();
    error CommitmentAlreadyUsed();
    error InvalidPublicInputs();

    constructor(address _groth16Verifier) {
        groth16Verifier = IVerifier(_groth16Verifier);
    }

    function verifyTradeProof(
        Proof calldata proof,
        PublicInputs calldata publicInputs
    ) external returns (bool) {
        // Check if commitment has already been used
        if (verifiedCommitments[publicInputs.commitment]) {
            revert CommitmentAlreadyUsed();
        }

        // Validate public inputs
        if (publicInputs.minPrice > publicInputs.maxPrice) {
            revert InvalidPublicInputs();
        }

        // Prepare inputs for verifier
        uint256[4] memory inputs = [
            uint256(publicInputs.commitment),
            publicInputs.minPrice,
            publicInputs.maxPrice,
            publicInputs.totalVolume
        ];

        // Verify the proof
        bool isValid = groth16Verifier.verifyProof(
            proof.a,
            proof.b,
            proof.c,
            inputs
        );

        if (!isValid) {
            revert InvalidProof();
        }

        // Mark commitment as used
        verifiedCommitments[publicInputs.commitment] = true;
        
        // Store user commitment
        uint256 nonce = uint256(keccak256(abi.encode(msg.sender, block.timestamp)));
        userCommitments[msg.sender][nonce] = publicInputs.commitment;

        emit ProofVerified(
            msg.sender,
            publicInputs.commitment,
            publicInputs.totalVolume
        );

        return true;
    }

    function verifyBatchProof(
        Proof calldata proof,
        bytes32 merkleRoot,
        uint256 totalVolume,
        uint256 numTrades,
        uint256[2] calldata volumeRange
    ) external returns (bool) {
        // Validate inputs
        if (volumeRange[0] > volumeRange[1]) {
            revert InvalidPublicInputs();
        }

        if (totalVolume < volumeRange[0] || totalVolume > volumeRange[1]) {
            revert InvalidPublicInputs();
        }

        // Prepare inputs for batch verification
        uint256[4] memory inputs = [
            uint256(merkleRoot),
            totalVolume,
            volumeRange[0],
            volumeRange[1]
        ];

        // Verify the proof
        bool isValid = groth16Verifier.verifyProof(
            proof.a,
            proof.b,
            proof.c,
            inputs
        );

        if (!isValid) {
            revert InvalidProof();
        }

        emit BatchProofVerified(merkleRoot, totalVolume, numTrades);

        return true;
    }

    function getCommitmentStatus(bytes32 commitment) external view returns (bool) {
        return verifiedCommitments[commitment];
    }
}