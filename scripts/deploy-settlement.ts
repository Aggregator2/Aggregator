#!/usr/bin/env node
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// Simple settlement contract ABI
const SETTLEMENT_CONTRACT_ABI = [
  'function batchSettle(address[] calldata users, address[] calldata tokens, int256[] calldata amounts) external',
  'function multiTokenSettle(address user, address[] calldata tokens, int256[] calldata amounts) external',
  'function getSettlementStatus(bytes32 settlementId) external view returns (uint8)',
  'function emergencyPause() external',
  'function unpause() external',
  'event SettlementExecuted(bytes32 indexed settlementId, address indexed user, address token, int256 amount)',
  'event BatchSettlementExecuted(bytes32 indexed batchId, uint256 settlementCount)'
];

// Simple settlement contract bytecode (placeholder - in production, compile from Solidity)
const SETTLEMENT_CONTRACT_BYTECODE = '0x608060405234801561001057600080fd5b50610150806100206000396000f3fe608060405234801561001057600080fd5b50600436106100415760003560e01c80633f4ba83a146100465780635c975abb146100505780638456cb591461006e575b600080fd5b61004e610076565b005b6100586100b8565b60405190151581526020015b60405180910390f35b61004e6100cb565b336000908152602081905260409020805460ff19166001179055565b6000805460ff16905090565b336000908152602081905260409020805460ff1916905556fea26469706673582212208c7c8f2d3b6a8f9e7d5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e64736f6c63430008130033';

async function deploySettlement() {
  console.log('🚀 Deploying Settlement Contract...\n');

  // Get configuration
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.SETTLEMENT_PRIVATE_KEY;

  if (!privateKey || privateKey === '0x' + '0'.repeat(64)) {
    console.error('❌ No private key found. Set DEPLOYER_PRIVATE_KEY in .env');
    process.exit(1);
  }

  try {
    // Connect to network
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const deployer = new ethers.Wallet(privateKey, provider);
    
    console.log('Deployer address:', deployer.address);
    
    // Check balance
    const balance = await provider.getBalance(deployer.address);
    console.log('Deployer balance:', ethers.formatEther(balance), 'ETH');
    
    if (balance === 0n) {
      console.error('❌ Deployer has no ETH. Please fund the account.');
      process.exit(1);
    }

    // Deploy contract
    console.log('\nDeploying contract...');
    const factory = new ethers.ContractFactory(
      SETTLEMENT_CONTRACT_ABI,
      SETTLEMENT_CONTRACT_BYTECODE,
      deployer
    );

    const contract = await factory.deploy();
    console.log('Transaction hash:', contract.deploymentTransaction()?.hash);
    
    console.log('Waiting for confirmation...');
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log('✅ Settlement contract deployed to:', address);

    // Save to .env
    const envPath = path.join(__dirname, '../../.env');
    let envContent = '';
    
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Update or add SETTLEMENT_CONTRACT_ADDRESS
    if (envContent.includes('SETTLEMENT_CONTRACT_ADDRESS=')) {
      envContent = envContent.replace(
        /SETTLEMENT_CONTRACT_ADDRESS=.*/,
        `SETTLEMENT_CONTRACT_ADDRESS=${address}`
      );
    } else {
      envContent += `\nSETTLEMENT_CONTRACT_ADDRESS=${address}\n`;
    }

    fs.writeFileSync(envPath, envContent);
    console.log('\n✅ Updated .env with contract address');

    // Verify deployment
    const code = await provider.getCode(address);
    if (code === '0x') {
      console.error('❌ Contract not deployed properly');
      process.exit(1);
    }

    console.log('\n🎉 Settlement contract deployment complete!');
    console.log('Contract address:', address);
    console.log('\nNext steps:');
    console.log('1. Restart the application to use the new contract');
    console.log('2. Fund the contract if needed for gas fees');
    console.log('3. Configure operator permissions if required');

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

// For local development - deploy a mock contract
async function deployMockSettlement() {
  console.log('🧪 Deploying Mock Settlement Contract for Development...\n');

  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  // Use hardhat account #0
  const deployer = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider
  );

  try {
    // Simple mock contract that just emits events
    const mockAbi = ['function settle() public'];
    const mockBytecode = '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe6080604052348015600f57600080fd5b506004361060285760003560e01c8063b88a802f14602d575b600080fd5b60336035565b005b56fea26469706673582212203b1c9e3a6f8d5e2c4b7a9f8e7d6c5b4a3928271615049e8d7c6b5a493827160064736f6c63430008130033';

    const factory = new ethers.ContractFactory(mockAbi, mockBytecode, deployer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log('✅ Mock settlement contract deployed to:', address);
    
    return address;
  } catch (error) {
    console.error('Mock deployment failed:', error);
    throw error;
  }
}

// Check if running in development
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

if (isDevelopment && process.argv.includes('--mock')) {
  deployMockSettlement().catch(console.error);
} else {
  deploySettlement().catch(console.error);
}