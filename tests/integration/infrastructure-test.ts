import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { setupTestInfrastructure, TestInfrastructure, TEST_ACCOUNTS } from '../setup/testHelpers';

describe('Infrastructure Test', () => {
  let infrastructure: TestInfrastructure;

  beforeAll(async () => {
    infrastructure = await setupTestInfrastructure();
  });

  afterAll(async () => {
    await infrastructure.cleanup();
  });

  it('should connect to provider successfully', async () => {
    const network = await infrastructure.provider.getNetwork();
    expect(network.chainId).toBe(31337n); // Hardhat local chainId
  });

  it('should have funded test accounts', async () => {
    for (const account of TEST_ACCOUNTS) {
      const balance = await infrastructure.provider.getBalance(account.address);
      expect(balance).toBeGreaterThan(0n);
      console.log(`Account ${account.address} balance: ${ethers.formatEther(balance)} ETH`);
    }
  });

  it('should create valid signers', async () => {
    const message = 'Test message';
    const signature = await infrastructure.signer.signMessage(message);
    const recoveredAddress = ethers.verifyMessage(message, signature);
    expect(recoveredAddress).toBe(infrastructure.signer.address);
  });

  it('should deploy and interact with a simple contract', async () => {
    // Simple storage contract
    const SimpleStorage = {
      abi: [
        'function set(uint256 value) external',
        'function get() external view returns (uint256)'
      ],
      bytecode: '0x608060405234801561001057600080fd5b50610150806100206000396000f3fe608060405234801561001057600080fd5b50600436106100365760003560e01c806360fe47b11461003b5780636d4ce63c14610057575b600080fd5b610055600480360381019061005091906100be565b610075565b005b61005f61007f565b60405161006c91906100fa565b60405180910390f35b8060008190555050565b60008054905090565b600080fd5b6000819050919050565b6100a08161008d565b81146100ab57600080fd5b50565b6000813590506100bd81610097565b92915050565b6000602082840312156100da576100d9610088565b5b60006100e8848285016100ae565b91505092915050565b6100fa8161008d565b82525050565b600060208201905061011560008301846100f1565b9291505056fea264697066735822122054c24c31fb7a9c3dd15dd2ed07d83c937b74040b8735de1794242a5d17a0de2764736f6c634300081a0033'
    };

    const factory = new ethers.ContractFactory(
      SimpleStorage.abi,
      SimpleStorage.bytecode,
      infrastructure.signer
    );

    const contract = await factory.deploy();
    await contract.waitForDeployment();
    const address = await contract.getAddress();
    expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);

    // Test contract interaction
    const tx = await contract.set(42);
    await tx.wait();

    const value = await contract.get();
    expect(value).toBe(42n);
  });
});