import { ethers } from 'ethers';
import { spawn, ChildProcess } from 'child_process';

export interface TestInfrastructure {
  provider: ethers.JsonRpcProvider;
  signer: ethers.Wallet;
  accounts: string[];
  cleanup: () => Promise<void>;
}

// Hardhat default test accounts (publicly known, safe for testing)
export const TEST_ACCOUNTS = [
  {
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  },
  {
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
  },
  {
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'
  }
];

let hardhatProcess: ChildProcess | null = null;

/**
 * Start a local Hardhat node for testing
 */
export async function startHardhatNode(): Promise<void> {
  return new Promise((resolve, reject) => {
    hardhatProcess = spawn('npx', ['hardhat', 'node'], {
      stdio: 'pipe',
      shell: true
    });

    let started = false;

    hardhatProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Started HTTP') && !started) {
        started = true;
        // Give it a bit more time to fully initialize
        setTimeout(() => resolve(), 2000);
      }
    });

    hardhatProcess.stderr?.on('data', (data) => {
      console.error('Hardhat stderr:', data.toString());
    });

    hardhatProcess.on('error', (error) => {
      reject(error);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!started) {
        reject(new Error('Hardhat node failed to start within 30 seconds'));
      }
    }, 30000);
  });
}

/**
 * Stop the Hardhat node
 */
export async function stopHardhatNode(): Promise<void> {
  if (hardhatProcess) {
    hardhatProcess.kill();
    hardhatProcess = null;
    // Wait a bit for the process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Setup test infrastructure with proper provider and signers
 */
export async function setupTestInfrastructure(): Promise<TestInfrastructure> {
  // Try to connect to existing Hardhat node first
  let provider = new ethers.JsonRpcProvider('http://localhost:8545');
  
  try {
    // Test if provider is working
    await provider.getNetwork();
  } catch (error) {
    console.log('No existing Hardhat node found, starting one...');
    await startHardhatNode();
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // Verify it's working now
    await provider.getNetwork();
  }

  // Create signers from test accounts
  const signer = new ethers.Wallet(TEST_ACCOUNTS[0].privateKey, provider);
  
  // Fund test accounts if needed
  const accounts = TEST_ACCOUNTS.map(acc => acc.address);
  
  return {
    provider,
    signer,
    accounts,
    cleanup: async () => {
      // Don't stop the node here as it might be used by other tests
      // This should be done in global teardown
    }
  };
}

/**
 * Deploy a mock settlement contract for testing
 */
export async function deployMockSettlementContract(signer: ethers.Wallet): Promise<string> {
  const MockSettlement = {
    abi: [
      'function batchSettle(address[] calldata users, address[] calldata tokens, int256[] calldata amounts) external',
      'function multiTokenSettle(address user, address[] calldata tokens, int256[] calldata amounts) external',
      'function getSettlementStatus(bytes32 settlementId) external view returns (uint8)',
      'function emergencyPause() external',
      'function unpause() external',
      'event SettlementExecuted(bytes32 indexed settlementId, address indexed user, address token, int256 amount)',
      'event BatchSettlementExecuted(bytes32 indexed batchId, uint256 settlementCount)'
    ],
    bytecode: '0x608060405234801561001057600080fd5b50610500806100206000396000f3fe608060405234801561001057600080fd5b506004361061004c5760003560e01c80633f4ba83a146100515780635c975abb146100595780638456cb5914610061578063b3f00674146100695780639d8e21771461007c575b600080fd5b61005961008f565b61005961009b565b6100596100a5565b61007a610077366004610200565b50565b005b61007a61008a366004610250565b6100ae565b6100996000541590565b005b6100a3600180555050565b005b60005460ff1690565b805182511461011e576040517f08c379a000000000000000000000000000000000000000000000000000000000815260206004820152601660248201527f417272617920'
  };

  const factory = new ethers.ContractFactory(MockSettlement.abi, MockSettlement.bytecode, signer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  
  return await contract.getAddress();
}

/**
 * Fund a test account with ETH
 */
export async function fundAccount(
  provider: ethers.JsonRpcProvider,
  address: string,
  amountEth: string = '100'
): Promise<void> {
  const signer = new ethers.Wallet(TEST_ACCOUNTS[0].privateKey, provider);
  const tx = await signer.sendTransaction({
    to: address,
    value: ethers.parseEther(amountEth)
  });
  await tx.wait();
}

/**
 * Deploy test ERC20 tokens
 */
export async function deployTestTokens(signer: ethers.Wallet): Promise<{
  USDC: string;
  ETH: string;
  USDT: string;
}> {
  // For testing, we'll use mock addresses
  // In a real test, you would deploy actual ERC20 contracts
  return {
    USDC: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    ETH: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    USDT: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0'
  };
}

/**
 * Mock balance for testing
 */
export function mockBalance(token: string, user: string): bigint {
  // Return mock balances for testing
  const balances: Record<string, bigint> = {
    'USDC': BigInt(10000 * 1e6), // 10,000 USDC
    'ETH': BigInt(10 * 1e18),    // 10 ETH
    'USDT': BigInt(10000 * 1e6)  // 10,000 USDT
  };
  
  return balances[token] || BigInt(0);
}