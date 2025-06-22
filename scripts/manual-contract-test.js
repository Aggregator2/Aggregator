#!/usr/bin/env node

/**
 * Manual Contract Test Script
 * Performs basic contract function tests for debugging
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

class ManualContractTester {
    constructor() {
        this.provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        this.contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
        this.privateKey = process.env.PRIVATE_KEY;
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

    async testReadOnlyFunctions() {
        console.log('📖 Testing Read-Only Functions');
        console.log('==============================');

        try {
            const abi = await this.loadContractABI();
            if (!abi) return false;

            const contract = new ethers.Contract(this.contractAddress, abi, this.provider);

            // Test owner function
            try {
                const owner = await contract.owner();
                console.log(`✅ owner(): ${owner}`);
            } catch (error) {
                console.error(`❌ owner() failed: ${error.message}`);
            }

            // Test paused function if exists
            try {
                if (contract.paused) {
                    const paused = await contract.paused();
                    console.log(`✅ paused(): ${paused}`);
                }
            } catch (error) {
                console.log('ℹ️ paused() function not available');
            }

            // Test any getter functions for escrows
            try {
                if (contract.escrows) {
                    // Try to get a non-existent escrow (should return default values)
                    const testEscrow = await contract.escrows('test-order-id');
                    console.log(`✅ escrows() test call successful`);
                }
            } catch (error) {
                console.log('ℹ️ escrows() function not available or failed');
            }

            return true;

        } catch (error) {
            console.error('❌ Read-only function tests failed:', error.message);
            return false;
        }
    }

    async testContractState() {
        console.log('\n🔍 Testing Contract State');
        console.log('=========================');

        try {
            const abi = await this.loadContractABI();
            if (!abi) return false;

            const contract = new ethers.Contract(this.contractAddress, abi, this.provider);

            // Get contract balance
            const balance = await this.provider.getBalance(this.contractAddress);
            console.log(`💰 Contract Balance: ${ethers.formatEther(balance)} ETH`);

            // Get current block
            const currentBlock = await this.provider.getBlockNumber();
            console.log(`📦 Current Block: ${currentBlock}`);

            // Test gas estimation for a basic view function
            try {
                const gasEstimate = await contract.owner.estimateGas();
                console.log(`⛽ Gas estimate for owner(): ${gasEstimate.toString()}`);
            } catch (error) {
                console.log('ℹ️ Could not estimate gas for owner()');
            }

            return true;

        } catch (error) {
            console.error('❌ Contract state test failed:', error.message);
            return false;
        }
    }

    async testEventEmission() {
        console.log('\n📡 Testing Event Emission (Mock)');
        console.log('=================================');

        try {
            const abi = await this.loadContractABI();
            if (!abi) return false;

            const contract = new ethers.Contract(this.contractAddress, abi, this.provider);

            // Check recent events
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 100);

            console.log(`🔍 Checking events from block ${fromBlock} to ${currentBlock}`);

            // Get all events
            const events = await contract.queryFilter({}, fromBlock, currentBlock);
            console.log(`📄 Found ${events.length} total events in recent blocks`);

            if (events.length > 0) {
                console.log('Recent events:');
                events.slice(-3).forEach((event, index) => {
                    console.log(`  ${index + 1}. ${event.event || 'Unknown'} at block ${event.blockNumber}`);
                });
            }

            return true;

        } catch (error) {
            console.error('❌ Event emission test failed:', error.message);
            return false;
        }
    }

    async testNetworkConnectivity() {
        console.log('\n🌐 Testing Network Connectivity');
        console.log('===============================');

        try {
            // Test basic RPC calls
            const startTime = Date.now();
            const blockNumber = await this.provider.getBlockNumber();
            const responseTime = Date.now() - startTime;

            console.log(`✅ Current block: ${blockNumber}`);
            console.log(`⏱️ Response time: ${responseTime}ms`);

            if (responseTime > 2000) {
                console.warn('⚠️ High response time detected');
            }

            // Test network info
            const network = await this.provider.getNetwork();
            console.log(`🔗 Network: ${network.name} (Chain ID: ${network.chainId})`);

            // Test gas price
            const gasPrice = await this.provider.getFeeData();
            console.log(`⛽ Gas Price: ${ethers.formatUnits(gasPrice.gasPrice, 'gwei')} gwei`);

            return true;

        } catch (error) {
            console.error('❌ Network connectivity test failed:', error.message);
            return false;
        }
    }

    async runComprehensiveTest() {
        console.log('🧪 Meta Aggregator 2.0 - Manual Contract Test');
        console.log('='.repeat(50));

        const results = {
            timestamp: new Date().toISOString(),
            networkConnectivity: false,
            readOnlyFunctions: false,
            contractState: false,
            eventEmission: false,
            overallStatus: 'FAILED'
        };

        try {
            results.networkConnectivity = await this.testNetworkConnectivity();
            results.readOnlyFunctions = await this.testReadOnlyFunctions();
            results.contractState = await this.testContractState();
            results.eventEmission = await this.testEventEmission();

            // Calculate overall status
            const passedTests = Object.values(results).filter(v => v === true).length;
            const totalTests = 4;

            if (passedTests === totalTests) {
                results.overallStatus = 'PASSED';
            } else if (passedTests > totalTests / 2) {
                results.overallStatus = 'PARTIAL';
            } else {
                results.overallStatus = 'FAILED';
            }

            console.log('\n📊 TEST RESULTS');
            console.log('===============');
            console.log(`Network Connectivity: ${results.networkConnectivity ? '✅' : '❌'}`);
            console.log(`Read-Only Functions: ${results.readOnlyFunctions ? '✅' : '❌'}`);
            console.log(`Contract State: ${results.contractState ? '✅' : '❌'}`);
            console.log(`Event Emission: ${results.eventEmission ? '✅' : '❌'}`);
            console.log(`Overall Status: ${results.overallStatus}`);

            return results;

        } catch (error) {
            console.error('❌ Comprehensive test failed:', error.message);
            results.error = error.message;
            return results;
        }
    }
}

// CLI Interface
async function main() {
    const tester = new ManualContractTester();
    const command = process.argv[2];

    try {
        switch (command) {
            case 'full':
                const results = await tester.runComprehensiveTest();
                process.exit(results.overallStatus === 'PASSED' ? 0 : 1);
                break;

            case 'network':
                const networkOk = await tester.testNetworkConnectivity();
                process.exit(networkOk ? 0 : 1);
                break;

            case 'functions':
                const functionsOk = await tester.testReadOnlyFunctions();
                process.exit(functionsOk ? 0 : 1);
                break;

            case 'state':
                const stateOk = await tester.testContractState();
                process.exit(stateOk ? 0 : 1);
                break;

            case 'events':
                const eventsOk = await tester.testEventEmission();
                process.exit(eventsOk ? 0 : 1);
                break;

            default:
                console.log('Meta Aggregator 2.0 - Manual Contract Tester');
                console.log('');
                console.log('USAGE: node manual-contract-test.js <command>');
                console.log('');
                console.log('COMMANDS:');
                console.log('  full        Run all tests');
                console.log('  network     Test network connectivity only');
                console.log('  functions   Test read-only functions only');
                console.log('  state       Test contract state only');
                console.log('  events      Test event emission only');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node manual-contract-test.js full');
                console.log('  node manual-contract-test.js network');
        }
    } catch (error) {
        console.error('❌ Manual contract test failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ManualContractTester;
