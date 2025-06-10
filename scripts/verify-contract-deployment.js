#!/usr/bin/env node

/**
 * Contract Deployment Verification Script
 * Verifies that the deployed contract matches expected configuration
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

class ContractVerifier {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
    }

    async loadContractABI() {
        try {
            const artifactPath = path.join(process.cwd(), 'artifacts', 'contracts', 'Escrow.sol', 'Escrow.json');
            const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
            return artifact.abi;
        } catch (error) {
            console.error('❌ Could not load contract ABI:', error.message);
            return null;
        }
    }

    async verifyContractDeployment() {
        console.log('🔍 Verifying Contract Deployment');
        console.log('================================');

        if (!this.contractAddress) {
            console.error('❌ ESCROW_CONTRACT_ADDRESS not set in environment');
            return false;
        }

        if (!process.env.RPC_URL) {
            console.error('❌ RPC_URL not set in environment');
            return false;
        }

        console.log(`📍 Contract Address: ${this.contractAddress}`);
        console.log(`🔗 RPC URL: ${process.env.RPC_URL}`);

        try {
            // Check if code exists at address
            const code = await this.provider.getCode(this.contractAddress);
            if (code === '0x') {
                console.error('❌ No contract code found at address');
                return false;
            }

            console.log('✅ Contract code exists at address');
            console.log(`📏 Code size: ${(code.length - 2) / 2} bytes`);

            // Load ABI and create contract instance
            const abi = await this.loadContractABI();
            if (!abi) {
                console.error('❌ Could not load contract ABI');
                return false;
            }

            const contract = new ethers.Contract(this.contractAddress, abi, this.provider);

            // Test basic contract calls
            console.log('\n🧪 Testing Contract Interface...');

            try {
                // Test owner() function
                const owner = await contract.owner();
                console.log(`✅ Contract owner: ${owner}`);
            } catch (error) {
                console.error('⚠️ Could not call owner():', error.message);
            }

            try {
                // Test if contract is paused (if that function exists)
                if (contract.paused) {
                    const paused = await contract.paused();
                    console.log(`✅ Contract paused status: ${paused}`);
                }
            } catch (error) {
                console.log('ℹ️ Contract does not have paused() function');
            }

            // Get network information
            const network = await this.provider.getNetwork();
            console.log(`\n🌐 Network Information:`);
            console.log(`  Chain ID: ${network.chainId}`);
            console.log(`  Network Name: ${network.name}`);

            // Check expected network
            const expectedChainId = process.env.EXPECTED_CHAIN_ID;
            if (expectedChainId && Number(network.chainId) !== Number(expectedChainId)) {
                console.error(`❌ Chain ID mismatch! Expected: ${expectedChainId}, Got: ${network.chainId}`);
                return false;
            }

            console.log('✅ Contract deployment verification passed');
            return true;

        } catch (error) {
            console.error('❌ Contract verification failed:', error.message);
            return false;
        }
    }

    async testContractEvents() {
        console.log('\n📡 Testing Event Subscription...');

        try {
            const abi = await this.loadContractABI();
            if (!abi) return false;

            const contract = new ethers.Contract(this.contractAddress, abi, this.provider);

            // Get recent events
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 1000); // Last 1000 blocks

            console.log(`🔍 Checking events from block ${fromBlock} to ${currentBlock}`);

            // Check for EscrowCreated events
            if (contract.filters.EscrowCreated) {
                const createdEvents = await contract.queryFilter(
                    contract.filters.EscrowCreated(),
                    fromBlock,
                    currentBlock
                );
                console.log(`📄 Found ${createdEvents.length} EscrowCreated events`);
            }

            // Check for EscrowReleased events
            if (contract.filters.EscrowReleased) {
                const releasedEvents = await contract.queryFilter(
                    contract.filters.EscrowReleased(),
                    fromBlock,
                    currentBlock
                );
                console.log(`📄 Found ${releasedEvents.length} EscrowReleased events`);
            }

            return true;

        } catch (error) {
            console.error('❌ Event testing failed:', error.message);
            return false;
        }
    }

    async generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            contractAddress: this.contractAddress,
            rpcUrl: process.env.RPC_URL,
            deploymentValid: false,
            eventsWorking: false,
            errors: []
        };

        try {
            report.deploymentValid = await this.verifyContractDeployment();
            report.eventsWorking = await this.testContractEvents();
        } catch (error) {
            report.errors.push(error.message);
        }

        console.log('\n📊 VERIFICATION REPORT');
        console.log('======================');
        console.log(JSON.stringify(report, null, 2));

        return report;
    }
}

// CLI Interface
async function main() {
    const verifier = new ContractVerifier();
    const command = process.argv[2];

    try {
        switch (command) {
            case 'full':
                await verifier.generateReport();
                break;

            case 'deployment':
                const isValid = await verifier.verifyContractDeployment();
                process.exit(isValid ? 0 : 1);
                break;

            case 'events':
                const eventsWork = await verifier.testContractEvents();
                process.exit(eventsWork ? 0 : 1);
                break;

            default:
                console.log('Meta Aggregator 2.0 - Contract Deployment Verifier');
                console.log('');
                console.log('USAGE: node verify-contract-deployment.js <command>');
                console.log('');
                console.log('COMMANDS:');
                console.log('  full        Run complete verification');
                console.log('  deployment  Verify contract deployment only');
                console.log('  events      Test event querying only');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node verify-contract-deployment.js full');
                console.log('  node verify-contract-deployment.js deployment');
        }
    } catch (error) {
        console.error('❌ Verification failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ContractVerifier;
