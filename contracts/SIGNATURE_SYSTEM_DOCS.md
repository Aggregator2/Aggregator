# Signature Verification System Documentation

## Overview

The SwappiQ Signature Verification System provides a comprehensive solution for secure order signing and verification with support for multiple signature types, hardware wallets, multi-signature wallets, and cross-chain operations.

## Features

### 🔐 **EIP-712 Structured Data Signing**
- Type-safe signature generation and verification
- Domain separation for security
- Human-readable signature data
- Replay attack protection

### 🏦 **Multi-Signature Wallet Support**
- Configurable signature thresholds
- Up to 20 signers per wallet
- Dynamic signer management
- High-value order protection

### 🔑 **Hardware Wallet Integration**
- Ledger and Trezor support
- Extended deadline handling
- Device registration system
- Enhanced security for cold storage

### ⚡ **Performance Optimization**
- Signature caching with TTL
- Batch operations support
- Gas-efficient verification
- Optimized for high-throughput

### 🚫 **Signature Revocation**
- Individual signature revocation
- Emergency revocation system
- Compromised key protection
- Admin override capabilities

### 🌐 **Cross-Chain Support**
- Multi-chain signature validation
- Bridge integration ready
- Chain-specific configurations
- Unified signature format

## Architecture

### Core Components

```
SignatureVerificationSystem.sol
├── EIP-712 Implementation
├── Multi-Sig Wallet Management
├── Hardware Wallet Registry
├── Signature Caching System
├── Revocation Mechanism
└── Cross-Chain Validation
```

### EIP-712 Type Definitions

#### Standard Order
```solidity
struct Order {
    address trader;
    address baseToken;
    address quoteToken;
    uint8 side;           // 0 = buy, 1 = sell
    uint256 amount;
    uint256 price;
    uint256 deadline;
    uint256 salt;
    uint256 chainId;
}
```

#### Multi-Signature Order
```solidity
struct MultiSigOrder {
    address trader;       // Multi-sig wallet address
    address baseToken;
    address quoteToken;
    uint8 side;
    uint256 amount;
    uint256 price;
    uint256 deadline;
    uint256 salt;
    uint256 chainId;
    uint256 requiredSignatures;
    address[] signers;
}
```

#### Cross-Chain Order
```solidity
struct CrossChainOrder {
    address trader;
    address baseToken;
    address quoteToken;
    uint8 side;
    uint256 amount;
    uint256 price;
    uint256 deadline;
    uint256 salt;
    uint256 sourceChain;
    uint256 targetChain;
    bytes32 bridgeId;
}
```

## Usage Examples

### 1. Standard Order Signing

```javascript
const { SignatureSDK } = require('./sdk/SignatureSDK');

// Initialize SDK
const sdk = new SignatureSDK({
    contractAddress: '0xSignatureVerificationContract',
    provider: new ethers.providers.JsonRpcProvider(RPC_URL),
    chainId: 1
});

// Create and sign order
const signer = new ethers.Wallet(PRIVATE_KEY, provider);
const signedOrder = await sdk.signOrder({
    trader: await signer.getAddress(),
    baseToken: '0xA0b86a33E6441E8C79c3B8A0945F1D1c4a4F6A84', // WETH
    quoteToken: '0xA0b86a33E6441E8C79c3B8A0945F1D1c4a4F6A84', // USDC
    side: 0, // Buy
    amount: ethers.utils.parseEther('1'), // 1 WETH
    price: ethers.utils.parseUnits('2000', 6), // $2000
    deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour
}, signer);

// Verify signature
const verification = await sdk.verifySignature(signedOrder);
console.log('Valid:', verification.isValid);
```

### 2. Multi-Signature Wallet Setup

```javascript
// Register multi-sig wallet
await sdk.registerMultiSigWallet({
    walletAddress: '0xMultiSigWalletAddress',
    requiredSignatures: 3,
    signers: [
        '0xSigner1Address',
        '0xSigner2Address', 
        '0xSigner3Address',
        '0xSigner4Address',
        '0xSigner5Address'
    ]
}, adminSigner);

// Create multi-sig order
const signers = [signer1, signer2, signer3, signer4];
const multiSigOrder = await sdk.signMultiSigOrder({
    trader: '0xMultiSigWalletAddress',
    baseToken: WETH_ADDRESS,
    quoteToken: USDC_ADDRESS,
    side: 1, // Sell
    amount: ethers.utils.parseEther('10'),
    price: ethers.utils.parseUnits('2100', 6)
}, signers, 3); // Requires 3 signatures
```

### 3. Hardware Wallet Integration

```javascript
// Connect Ledger
const ledgerConfig = await sdk.connectLedger(transport);

// Register hardware wallet
await sdk.registerHardwareWallet({
    walletAddress: ledgerConfig.address,
    deviceType: 'ledger',
    deviceId: ledgerConfig.deviceId,
    requiresExtendedDeadline: true
}, ownerSigner);

// Sign with hardware wallet (extended deadline automatically applied)
const hwSignedOrder = await sdk.signOrder(orderParams, ledgerSigner);
```

### 4. Cross-Chain Orders

```javascript
// Sign cross-chain order
const crossChainOrder = await sdk.signCrossChainOrder({
    trader: await signer.getAddress(),
    baseToken: WETH_ETHEREUM,
    quoteToken: USDC_POLYGON,
    side: 0,
    amount: ethers.utils.parseEther('1'),
    price: ethers.utils.parseUnits('2000', 6),
    sourceChain: 1, // Ethereum
    targetChain: 137, // Polygon
    bridgeId: ethers.utils.formatBytes32String('wormhole')
}, signer);

// Verify on target chain
const crossChainVerification = await sdk.verifyCrossChainOrder(crossChainOrder);
```

### 5. Delegation System

```javascript
// Grant delegation
const delegation = await sdk.signDelegation(
    '0xDelegateAddress',
    Math.floor(Date.now() / 1000) + 86400, // 24 hours
    ownerSigner
);

// Delegate can now sign orders on behalf of owner
const delegatedOrder = await sdk.signOrder({
    trader: ownerAddress, // Owner's address
    // ... other params
}, delegateSigner);
```

### 6. Signature Revocation

```javascript
// Revoke a specific signature
const revocationTx = await sdk.revokeSignature(
    signatureHash,
    ownerSigner
);

// Emergency revocation (admin only)
await contract.emergencyRevokeSignature(signatureHash);
```

## Security Features

### 1. **Replay Attack Protection**
- Unique salt per order
- Chain ID validation
- Nonce tracking for delegations
- Domain separation

### 2. **Hardware Wallet Security**
- Device registration required
- Owner verification
- Extended deadlines for UX
- Device ID tracking

### 3. **Multi-Sig Protection**
- Threshold requirements
- Signer validation
- Order-specific signature tracking
- Dynamic configuration

### 4. **Signature Validation**
```solidity
function verifyOrderSignature(OrderSignature calldata orderSig) 
    external 
    returns (bool isValid, bytes32 signatureHash) 
{
    // 1. Check cache
    // 2. Validate signature status (not used/revoked)
    // 3. Verify deadline
    // 4. Recover signer from EIP-712 hash
    // 5. Check authorization (owner/delegate/hardware wallet)
    // 6. Cache result
    // 7. Mark as used
}
```

## Performance Optimizations

### 1. **Signature Caching**
```solidity
struct SignatureCache {
    bytes32 structHash;
    address signer;
    uint256 expiryTime;
    bool isValid;
    SignatureType sigType;
}
```

### 2. **Batch Operations**
- Multiple signature verification
- Batch revocation
- Efficient cache management
- Gas-optimized loops

### 3. **Storage Optimization**
- Packed structs
- EnumerableSet for gas efficiency
- Minimal storage reads
- Event-based indexing

## Integration Guide

### 1. **Contract Deployment**
```solidity
// Deploy with EIP-712 domain info
SignatureVerificationSystem verifier = new SignatureVerificationSystem(
    "SwappiQ Protocol", // Domain name
    "1.0.0"            // Version
);
```

### 2. **SDK Integration**
```javascript
// Install dependencies
npm install ethers @ledgerhq/hw-app-eth @trezor/connect-web

// Initialize SDK
const sdk = new SignatureSDK({
    contractAddress: DEPLOYED_CONTRACT_ADDRESS,
    provider: ethersProvider,
    chainId: CHAIN_ID
});
```

### 3. **Frontend Integration**
```typescript
import { SignatureSDK } from '@swappiq/signature-sdk';

class OrderManager {
    private sdk: SignatureSDK;
    
    async signOrder(orderParams: OrderParams): Promise<SignedOrder> {
        // Detect wallet type
        const walletType = await this.detectWalletType();
        
        if (walletType === 'hardware') {
            return this.signWithHardwareWallet(orderParams);
        } else if (walletType === 'multisig') {
            return this.signWithMultiSig(orderParams);
        } else {
            return this.sdk.signOrder(orderParams, this.signer);
        }
    }
}
```

## Testing

### Unit Tests
```javascript
describe('SignatureVerificationSystem', () => {
    it('should verify standard order signatures', async () => {
        const signedOrder = await sdk.signOrder(orderParams, signer);
        const verification = await verifier.verifyOrderSignature(signedOrder);
        expect(verification.isValid).to.be.true;
    });
    
    it('should prevent signature replay', async () => {
        await verifier.verifyOrderSignature(signedOrder);
        await expect(
            verifier.verifyOrderSignature(signedOrder)
        ).to.be.revertedWith('SignatureAlreadyUsed');
    });
});
```

### Integration Tests
```javascript
describe('Hardware Wallet Integration', () => {
    it('should handle Ledger signatures with extended deadline', async () => {
        await verifier.registerHardwareWallet(
            ledgerAddress, 
            'ledger', 
            deviceId, 
            true
        );
        
        const signedOrder = await sdk.signOrder(orderParams, ledgerSigner);
        expect(signedOrder.deadline).to.be.gt(baseDeadline + 300);
    });
});
```

## Error Handling

### Common Errors
```solidity
error InvalidSignature();           // Signature verification failed
error SignatureExpired();          // Past deadline
error SignatureRevoked();          // Manually revoked
error SignatureAlreadyUsed();      // Replay attempt
error InsufficientSignatures();    // Multi-sig threshold not met
error UnauthorizedSigner();        // Not authorized to sign
error HardwareWalletNotRegistered(); // Device not registered
```

### Error Recovery
```javascript
try {
    const verification = await sdk.verifySignature(signedOrder);
} catch (error) {
    if (error.message.includes('SignatureExpired')) {
        // Re-sign with new deadline
        const newOrder = await sdk.signOrder({
            ...orderParams,
            deadline: Math.floor(Date.now() / 1000) + 3600
        }, signer);
    } else if (error.message.includes('SignatureRevoked')) {
        // Signature was revoked, cannot use
        throw new Error('Order signature has been revoked');
    }
}
```

## Best Practices

### 1. **Security**
- Always validate signatures on-chain
- Use hardware wallets for high-value orders
- Implement proper access controls
- Monitor for unusual signing patterns

### 2. **Performance**
- Enable signature caching for frequently verified orders
- Use batch operations when possible
- Clear expired cache entries regularly
- Optimize gas usage with packed structs

### 3. **UX Considerations**
- Provide clear signing prompts
- Handle hardware wallet delays gracefully
- Show signature status in UI
- Implement retry mechanisms

### 4. **Monitoring**
- Track signature verification rates
- Monitor revocation patterns
- Alert on failed verifications
- Log cross-chain activities

## Deployment Checklist

- [ ] Deploy SignatureVerificationSystem contract
- [ ] Configure supported chains
- [ ] Set up access control roles
- [ ] Initialize hardware wallet support
- [ ] Deploy SDK to npm
- [ ] Configure monitoring and alerts
- [ ] Test all signature types
- [ ] Verify cross-chain functionality
- [ ] Document integration patterns
- [ ] Set up emergency procedures

## Support and Resources

- **Contract Address**: `0x...` (to be deployed)
- **SDK Package**: `@swappiq/signature-sdk`
- **Documentation**: https://docs.swappiq.com/signatures
- **GitHub**: https://github.com/swappiq/signature-system
- **Discord**: https://discord.gg/swappiq

The SignatureVerificationSystem provides enterprise-grade security and performance for decentralized trading applications while maintaining excellent developer experience and user adoption.