const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config();

async function checkEscrowStatus() {
    console.log('🔍 Checking Escrow Contract Status...\n');
    
    try {
        // Read contract address from config
        const configPath = './frontend/src/config/escrowAddress.js';
        if (!fs.existsSync(configPath)) {
            console.log('❌ Contract address config file not found');
            return { status: 'error', message: 'Config file not found' };
        }

        const configContent = fs.readFileSync(configPath, 'utf8');
        const addressMatch = configContent.match(/0x[a-fA-F0-9]{40}/);
        
        if (!addressMatch) {
            console.log('❌ Contract address not found in config');
            return { status: 'error', message: 'Address not found' };
        }

        const contractAddress = addressMatch[0];
        console.log(`📍 Contract Address: ${contractAddress}`);

        // Connect to network
        const provider = new ethers.JsonRpcProvider(process.env.API_URL || 'http://127.0.0.1:8545');
        
        // Check if contract is deployed
        const contractCode = await provider.getCode(contractAddress);
        if (contractCode === '0x') {
            console.log('❌ Contract not deployed at this address');
            return { status: 'error', message: 'Contract not deployed' };
        }

        console.log('✅ Contract is deployed');

        // Create contract instance (using minimal ABI)
        const escrowAbi = [
            "function state() view returns (uint8)",
            "function depositor() view returns (address)",
            "function counterparty() view returns (address)",
            "function arbiter() view returns (address)",
            "function token() view returns (address)",
            "function amount() view returns (uint256)",
            "function getBalance() view returns (uint256)",
            "function paused() view returns (bool)"
        ];

        const contract = new ethers.Contract(contractAddress, escrowAbi, provider);

        // Get contract state
        console.log('\n📊 Contract State Information:');
        
        try {
            const state = await contract.state();
            const stateNames = ['AWAITING_DEPOSIT', 'AWAITING_CONFIRMATION', 'FUNDS_RELEASED', 'FUNDS_REFUNDED'];
            console.log(`  State: ${stateNames[state]} (${state})`);
        } catch (error) {
            console.log('  State: Unable to read');
        }

        try {
            const depositor = await contract.depositor();
            console.log(`  Depositor: ${depositor}`);
        } catch (error) {
            console.log('  Depositor: Unable to read');
        }

        try {
            const counterparty = await contract.counterparty();
            console.log(`  Counterparty: ${counterparty}`);
        } catch (error) {
            console.log('  Counterparty: Unable to read');
        }

        try {
            const arbiter = await contract.arbiter();
            console.log(`  Arbiter: ${arbiter}`);
        } catch (error) {
            console.log('  Arbiter: Unable to read');
        }

        try {
            const token = await contract.token();
            console.log(`  Token: ${token}`);
        } catch (error) {
            console.log('  Token: Unable to read');
        }

        try {
            const amount = await contract.amount();
            console.log(`  Amount: ${ethers.formatEther(amount)} ETH`);
        } catch (error) {
            console.log('  Amount: Unable to read');
        }

        try {
            const balance = await contract.getBalance();
            console.log(`  Current Balance: ${ethers.formatEther(balance)} ETH`);
        } catch (error) {
            console.log('  Current Balance: Unable to read');
        }

        try {
            const paused = await contract.paused();
            console.log(`  Paused: ${paused ? 'Yes ⚠️' : 'No ✅'}`);
        } catch (error) {
            console.log('  Paused: Unable to read (contract may not be pausable)');
        }

        // Check ETH balance at contract address
        console.log('\n💰 Balance Information:');
        const ethBalance = await provider.getBalance(contractAddress);
        console.log(`  ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

        // Check recent transactions
        console.log('\n📈 Recent Activity:');
        try {
            const currentBlock = await provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 1000); // Last 1000 blocks
            
            const logs = await provider.getLogs({
                address: contractAddress,
                fromBlock,
                toBlock: currentBlock
            });

            console.log(`  Recent events: ${logs.length} in last 1000 blocks`);
            
            if (logs.length > 0) {
                console.log(`  Latest event block: ${logs[logs.length - 1].blockNumber}`);
            }
        } catch (error) {
            console.log('  Recent activity: Unable to fetch');
        }

        const result = {
            status: 'healthy',
            address: contractAddress,
            deployed: true,
            ethBalance: ethers.formatEther(ethBalance),
            timestamp: new Date().toISOString()
        };

        console.log('\n✅ Escrow contract status check completed');
        
        // Save results
        fs.writeFileSync('escrow-status.json', JSON.stringify(result, null, 2));
        console.log('💾 Results saved to escrow-status.json');

        return result;

    } catch (error) {
        console.log('❌ Error checking escrow status:', error.message);
        return { status: 'error', message: error.message };
    }
}

// Run if called directly
if (require.main === module) {
    checkEscrowStatus()
        .then(result => {
            process.exit(result.status === 'healthy' ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Escrow status check failed:', error);
            process.exit(1);
        });
}

module.exports = { checkEscrowStatus };
