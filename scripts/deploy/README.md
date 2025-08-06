# Deployment Scripts

This directory contains comprehensive deployment scripts for deploying the off-chain DEX smart contracts to multiple networks.

## Overview

The deployment system is modular and supports:
- Multi-network deployment (Mainnet, Arbitrum, Polygon, Optimism, and testnets)
- Automatic contract verification on Etherscan
- Role-based access control setup
- Parameter initialization
- Deployment validation

## Scripts

### 1. `deploy-all.js`
Complete deployment script that runs all steps sequentially:
```bash
npx hardhat run scripts/deploy/deploy-all.js --network <network-name>
```

### 2. Individual Deployment Scripts

#### `01-deploy-core-contracts.js`
Deploys core contracts:
- SecureEscrowV2
- StateChannelFactory
- SettlementWithProofs

#### `02-deploy-security-modules.js`
Deploys security modules:
- CircuitBreaker
- MEVProtection
- GasProtection
- SignatureVerifier

#### `03-deploy-verification-contracts.js`
Deploys verification contracts:
- ZKProofVerifier
- BLSSignatureVerifier
- FraudProofVerifier

### 3. `verify-contracts.js`
Verifies all deployed contracts on Etherscan:
```bash
npx hardhat run scripts/deploy/verify-contracts.js --network <network-name>
```

### 4. `initialize-contracts.js`
Sets up roles, parameters, and fee recipients:
```bash
npx hardhat run scripts/deploy/initialize-contracts.js --network <network-name>
```

### 5. `validate-deployment.js`
Validates the entire deployment:
```bash
npx hardhat run scripts/deploy/validate-deployment.js --network <network-name>
```

## Configuration

### Environment Variables
Create a `.env` file with:
```env
# RPC URLs
MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
OPTIMISM_RPC_URL=https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY

# Testnet RPC URLs
GOERLI_RPC_URL=https://eth-goerli.g.alchemy.com/v2/YOUR_KEY
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY

# Private Key
PRIVATE_KEY=your_private_key_here

# Etherscan API Keys
ETHERSCAN_API_KEY=your_etherscan_api_key
ARBISCAN_API_KEY=your_arbiscan_api_key
POLYGONSCAN_API_KEY=your_polygonscan_api_key
OPTIMISM_API_KEY=your_optimism_api_key

# Contract Configuration
FEE_RECIPIENT_ADDRESS=0x...
EMERGENCY_ADMIN_ADDRESS=0x...
OPERATOR_ADDRESS=0x...
ARBITER_ADDRESS=0x...
TREASURY_ADDRESS=0x...
PRICE_ORACLE_ADDRESS=0x...
```

### Deployment Configuration
Edit `deployment/deployment-config.json` to customize:
- Network-specific settings
- Contract parameters
- Gas settings
- Role definitions

## Usage Examples

### Deploy to Mainnet
```bash
# Full deployment
npx hardhat run scripts/deploy/deploy-all.js --network mainnet

# Or step by step
npx hardhat run scripts/deploy/01-deploy-core-contracts.js --network mainnet
npx hardhat run scripts/deploy/02-deploy-security-modules.js --network mainnet
npx hardhat run scripts/deploy/03-deploy-verification-contracts.js --network mainnet
npx hardhat run scripts/deploy/verify-contracts.js --network mainnet
npx hardhat run scripts/deploy/initialize-contracts.js --network mainnet
npx hardhat run scripts/deploy/validate-deployment.js --network mainnet
```

### Deploy to Testnet
```bash
# Deploy to Goerli
npx hardhat run scripts/deploy/deploy-all.js --network goerli

# Deploy to Sepolia
npx hardhat run scripts/deploy/deploy-all.js --network sepolia
```

### Deploy to L2s
```bash
# Deploy to Arbitrum
npx hardhat run scripts/deploy/deploy-all.js --network arbitrum

# Deploy to Polygon
npx hardhat run scripts/deploy/deploy-all.js --network polygon

# Deploy to Optimism
npx hardhat run scripts/deploy/deploy-all.js --network optimism
```

## Deployment Outputs

All deployment artifacts are saved to `deployments/<network-name>/`:

- `core-contracts.json` - Core contract addresses and constructor args
- `security-modules.json` - Security module addresses
- `verification-contracts.json` - Verification contract addresses
- `deployment-summary.json` - Combined deployment data
- `initialization-results.json` - Role and parameter setup results
- `verification-results.json` - Etherscan verification status
- `validation-results.json` - Deployment validation report
- `abis/` - Contract ABI files

## Post-Deployment Checklist

### For Mainnet Deployments:
1. ✅ Transfer ownership to multisig wallet
2. ✅ Revoke unnecessary admin roles from deployer
3. ✅ Set up monitoring and alerts
4. ✅ Document all contract addresses
5. ✅ Run integration tests
6. ✅ Prepare incident response procedures

### For Testnet Deployments:
1. ✅ Test all contract interactions
2. ✅ Verify gas costs
3. ✅ Test upgrade procedures
4. ✅ Stress test with high volume

## Troubleshooting

### Common Issues:

1. **Insufficient funds**: Ensure deployer has enough ETH/tokens for gas
2. **RPC errors**: Check RPC URL and rate limits
3. **Verification fails**: Ensure API keys are correct and contracts are indexed
4. **Role setup fails**: Check that deployer has admin roles

### Debug Mode:
Add console logs by setting:
```bash
export DEBUG=true
npx hardhat run scripts/deploy/deploy-all.js --network goerli
```

## Security Considerations

1. **Never commit private keys** - Use environment variables
2. **Test on testnets first** - Always deploy to testnet before mainnet
3. **Use hardware wallets** - For mainnet deployments
4. **Multi-sig setup** - Transfer ownership to multi-sig after deployment
5. **Audit deployments** - Run validation script after each deployment

## Gas Optimization

The scripts include gas optimization features:
- Batch operations where possible
- Optimal gas price settings per network
- Confirmation waiting to avoid failed transactions

## Support

For issues or questions:
1. Check deployment logs in `deployments/<network>/`
2. Run validation script to identify issues
3. Review contract verification status
4. Check network status and gas prices