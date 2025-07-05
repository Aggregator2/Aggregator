// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library BLS12381 {
    // BLS12-381 curve parameters
    uint256 constant FIELD_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001;
    uint256 constant CURVE_ORDER = 0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab;
    
    struct G1Point {
        uint256 x;
        uint256 y;
    }
    
    struct G2Point {
        uint256[2] x;
        uint256[2] y;
    }
}

interface IBLSPrecompile {
    function pairing(
        BLS12381.G1Point[] memory g1Points,
        BLS12381.G2Point[] memory g2Points
    ) external view returns (bool);
}

contract BLSSignatureVerifier {
    using BLS12381 for *;
    
    struct AggregatedSignature {
        BLS12381.G2Point signature;
        BLS12381.G1Point publicKey;
        address[] signers;
    }
    
    struct SignatureBatch {
        BLS12381.G2Point[] signatures;
        BLS12381.G1Point[] publicKeys;
        bytes32[] messageHashes;
    }
    
    IBLSPrecompile constant BLS_PRECOMPILE = IBLSPrecompile(address(0x0a));
    
    mapping(bytes32 => bool) public verifiedBatches;
    mapping(address => BLS12381.G1Point) public registeredPublicKeys;
    mapping(address => bool) public authorizedAggregators;
    
    event SignatureVerified(
        address indexed signer,
        bytes32 indexed messageHash
    );
    
    event BatchVerified(
        bytes32 indexed batchHash,
        uint256 numSignatures
    );
    
    event PublicKeyRegistered(
        address indexed account,
        BLS12381.G1Point publicKey
    );
    
    error InvalidSignature();
    error UnauthorizedAggregator();
    error PublicKeyNotRegistered();
    error BatchAlreadyVerified();
    error InvalidBatchSize();
    
    modifier onlyAuthorizedAggregator() {
        if (!authorizedAggregators[msg.sender]) {
            revert UnauthorizedAggregator();
        }
        _;
    }
    
    constructor() {
        authorizedAggregators[msg.sender] = true;
    }
    
    function registerPublicKey(BLS12381.G1Point calldata publicKey) external {
        registeredPublicKeys[msg.sender] = publicKey;
        emit PublicKeyRegistered(msg.sender, publicKey);
    }
    
    function verifySignature(
        BLS12381.G2Point calldata signature,
        BLS12381.G1Point calldata publicKey,
        bytes32 messageHash
    ) public view returns (bool) {
        // Hash message to curve point
        BLS12381.G2Point memory hashedMessage = hashToCurve(messageHash);
        
        // Prepare pairing check: e(H(m), pk) = e(sig, G1)
        BLS12381.G1Point[] memory g1Points = new BLS12381.G1Point[](2);
        BLS12381.G2Point[] memory g2Points = new BLS12381.G2Point[](2);
        
        // First pairing: e(H(m), pk)
        g1Points[0] = publicKey;
        g2Points[0] = hashedMessage;
        
        // Second pairing: e(-sig, G1) - negated for equation check
        g1Points[1] = negateG1(getG1Generator());
        g2Points[1] = signature;
        
        return BLS_PRECOMPILE.pairing(g1Points, g2Points);
    }
    
    function verifyAggregatedSignature(
        AggregatedSignature calldata aggSig,
        bytes32[] calldata messageHashes
    ) external returns (bool) {
        if (aggSig.signers.length != messageHashes.length) {
            revert InvalidBatchSize();
        }
        
        // Verify each signer has registered public key
        BLS12381.G1Point memory aggregatedPubKey = BLS12381.G1Point(0, 0);
        for (uint256 i = 0; i < aggSig.signers.length; i++) {
            BLS12381.G1Point memory pk = registeredPublicKeys[aggSig.signers[i]];
            if (pk.x == 0 && pk.y == 0) {
                revert PublicKeyNotRegistered();
            }
            aggregatedPubKey = addG1(aggregatedPubKey, pk);
        }
        
        // Verify aggregated signature
        bool isValid = verifySignature(
            aggSig.signature,
            aggregatedPubKey,
            keccak256(abi.encode(messageHashes))
        );
        
        if (!isValid) {
            revert InvalidSignature();
        }
        
        for (uint256 i = 0; i < aggSig.signers.length; i++) {
            emit SignatureVerified(aggSig.signers[i], messageHashes[i]);
        }
        
        return true;
    }
    
    function verifyBatch(
        SignatureBatch calldata batch
    ) external onlyAuthorizedAggregator returns (bool) {
        uint256 batchSize = batch.signatures.length;
        if (batchSize != batch.publicKeys.length || batchSize != batch.messageHashes.length) {
            revert InvalidBatchSize();
        }
        
        bytes32 batchHash = keccak256(abi.encode(batch));
        if (verifiedBatches[batchHash]) {
            revert BatchAlreadyVerified();
        }
        
        // Aggregate verification using multi-pairing
        BLS12381.G1Point[] memory g1Points = new BLS12381.G1Point[](batchSize * 2);
        BLS12381.G2Point[] memory g2Points = new BLS12381.G2Point[](batchSize * 2);
        
        for (uint256 i = 0; i < batchSize; i++) {
            // e(H(m_i), pk_i)
            g1Points[i * 2] = batch.publicKeys[i];
            g2Points[i * 2] = hashToCurve(batch.messageHashes[i]);
            
            // e(-sig_i, G1)
            g1Points[i * 2 + 1] = negateG1(getG1Generator());
            g2Points[i * 2 + 1] = batch.signatures[i];
        }
        
        bool isValid = BLS_PRECOMPILE.pairing(g1Points, g2Points);
        
        if (!isValid) {
            revert InvalidSignature();
        }
        
        verifiedBatches[batchHash] = true;
        emit BatchVerified(batchHash, batchSize);
        
        return true;
    }
    
    function addAuthorizedAggregator(address aggregator) external {
        require(msg.sender == address(this), "Only contract can add aggregators");
        authorizedAggregators[aggregator] = true;
    }
    
    function removeAuthorizedAggregator(address aggregator) external {
        require(msg.sender == address(this), "Only contract can remove aggregators");
        authorizedAggregators[aggregator] = false;
    }
    
    // Helper functions
    function hashToCurve(bytes32 message) internal pure returns (BLS12381.G2Point memory) {
        // Simplified hash-to-curve for demonstration
        // In production, use proper hash-to-curve algorithm
        uint256 x = uint256(keccak256(abi.encode(message, "x"))) % BLS12381.FIELD_MODULUS;
        uint256 y = uint256(keccak256(abi.encode(message, "y"))) % BLS12381.FIELD_MODULUS;
        
        return BLS12381.G2Point([x, 0], [y, 0]);
    }
    
    function getG1Generator() internal pure returns (BLS12381.G1Point memory) {
        // BLS12-381 G1 generator point
        return BLS12381.G1Point(
            0x17f1d3a73197d7942695638c4fa9ac0fc3688c4f9774b905a14e3a3f171bac586c55e83ff97a1aeffb3af00adb22c6bb,
            0x08b3f481e3aaa0f1a09e30ed741d8ae4fcf5e095d5d00af600db18cb2c04b3edd03cc744a2888ae40caa232946c5e7e1
        );
    }
    
    function negateG1(BLS12381.G1Point memory point) internal pure returns (BLS12381.G1Point memory) {
        return BLS12381.G1Point(point.x, BLS12381.FIELD_MODULUS - point.y);
    }
    
    function addG1(
        BLS12381.G1Point memory p1,
        BLS12381.G1Point memory p2
    ) internal pure returns (BLS12381.G1Point memory) {
        // Simplified point addition for demonstration
        // In production, use proper elliptic curve point addition
        if (p1.x == 0 && p1.y == 0) return p2;
        if (p2.x == 0 && p2.y == 0) return p1;
        
        // This is a placeholder - implement actual EC point addition
        return BLS12381.G1Point(
            addmod(p1.x, p2.x, BLS12381.FIELD_MODULUS),
            addmod(p1.y, p2.y, BLS12381.FIELD_MODULUS)
        );
    }
}