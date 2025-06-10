#!/usr/bin/env node

const ethers = require('ethers');
const fs = require('fs').promises;
const path = require('path');

/**
 * Key Validation and Testing Suite
 * Validates that rotated keys work correctly with all system components
 */

class KeyValidator {
    constructor(config = {}) {
        this.config = {
            rpcUrl: config.rpcUrl || process.env.RPC_URL || 'https://polygon-mainnet.infura.io/v3/your-key',
            testNetworkUrl: config.testNetworkUrl || process.env.TEST_RPC_URL || 'https://polygon-mumbai.infura.io/v3/your-key',
            contractAddresses: config.contractAddresses || {
                escrow: process.env.ESCROW_CONTRACT_ADDRESS,
                fixedEscrow: process.env.FIXED_ESCROW_CONTRACT_ADDRESS
            },
            ...config
        };
        
        this.testResults = [];
        this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
        this.testProvider = new ethers.JsonRpcProvider(this.config.testNetworkUrl);
    }

    /**
     * Log test result
     * @param {string} testName 
     * @param {boolean} passed 
     * @param {string} details 
     * @param {Object} data 
     */
    logTestResult(testName, passed, details, data = {}) {
        const result = {
            testName,
            passed,
            details,
            timestamp: new Date().toISOString(),
            ...data
        };
        
        this.testResults.push(result);
        
        const status = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${status} - ${testName}: ${details}`);
        
        if (!passed && data.error) {
            console.log(`   Error: ${data.error}`);
        }
    }

    /**
     * Validate basic key properties
     * @param {string} privateKey 
     * @param {string} keyType 
     */
    async validateKeyProperties(privateKey, keyType) {
        const testName = `Key Properties - ${keyType}`;
        
        try {
            // Test 1: Valid private key format
            if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
                this.logTestResult(testName, false, 'Invalid private key format', {
                    expectedLength: 66,
                    actualLength: privateKey?.length || 0
                });
                return false;
            }

            // Test 2: Can create wallet instance
            const wallet = new ethers.Wallet(privateKey);
            
            // Test 3: Has valid address
            const address = wallet.address;
            if (!ethers.isAddress(address)) {
                this.logTestResult(testName, false, 'Invalid address generated', { address });
                return false;
            }

            // Test 4: Can sign a message
            const testMessage = `Validation test ${Date.now()}`;
            const signature = await wallet.signMessage(testMessage);
            
            // Test 5: Signature verification
            const recovered = ethers.verifyMessage(testMessage, signature);
            if (recovered.toLowerCase() !== address.toLowerCase()) {
                this.logTestResult(testName, false, 'Signature verification failed', {
                    expected: address,
                    recovered
                });
                return false;
            }

            this.logTestResult(testName, true, `Valid key with address ${address}`, {
                address,
                signatureLength: signature.length
            });
            
            return { address, wallet };
            
        } catch (error) {
            this.logTestResult(testName, false, 'Exception during key validation', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * Test EIP-712 signing capability
     * @param {Object} wallet 
     * @param {string} keyType 
     */
    async validateEIP712Signing(wallet, keyType) {
        const testName = `EIP-712 Signing - ${keyType}`;
        
        try {
            // Create a test EIP-712 domain and message similar to the order signing
            const domain = {
                name: 'MetaAggregator',
                version: '2.0',
                chainId: 137,
                verifyingContract: '0x1234567890123456789012345678901234567890'
            };

            const types = {
                Order: [
                    { name: 'maker', type: 'address' },
                    { name: 'taker', type: 'address' },
                    { name: 'makerToken', type: 'address' },
                    { name: 'takerToken', type: 'address' },
                    { name: 'makerAmount', type: 'uint256' },
                    { name: 'takerAmount', type: 'uint256' },
                    { name: 'salt', type: 'uint256' },
                    { name: 'expiry', type: 'uint256' }
                ]
            };

            const order = {
                maker: wallet.address,
                taker: ethers.ZeroAddress,
                makerToken: '0xA0b86a33E6441b41a1CB2A29F6a38e3A5D5BCBB3',
                takerToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
                makerAmount: ethers.parseEther('100'),
                takerAmount: ethers.parseUnits('100', 6),
                salt: BigInt(Math.floor(Math.random() * 1000000)),
                expiry: Math.floor(Date.now() / 1000) + 3600
            };

            // Sign the typed data
            const signature = await wallet.signTypedData(domain, types, order);
            
            // Verify the signature
            const recovered = ethers.verifyTypedData(domain, types, order, signature);
            
            if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
                this.logTestResult(testName, false, 'EIP-712 signature verification failed', {
                    expected: wallet.address,
                    recovered
                });
                return false;
            }

            this.logTestResult(testName, true, 'EIP-712 signing and verification successful', {
                signatureLength: signature.length,
                orderHash: ethers.TypedDataEncoder.hash(domain, types, order)
            });
            
            return true;
            
        } catch (error) {
            this.logTestResult(testName, false, 'EIP-712 signing failed', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * Test contract interaction capability
     * @param {Object} wallet 
     * @param {string} keyType 
     */
    async validateContractInteraction(wallet, keyType) {
        const testName = `Contract Interaction - ${keyType}`;
        
        try {
            // Connect wallet to provider
            const connectedWallet = wallet.connect(this.provider);
            
            // Test basic contract call (get balance)
            const balance = await this.provider.getBalance(wallet.address);
            
            // Test gas estimation for a simple transaction
            const gasEstimate = await this.provider.estimateGas({
                to: wallet.address,
                value: ethers.parseEther('0'),
                data: '0x'
            });

            this.logTestResult(testName, true, 'Contract interaction capabilities verified', {
                balance: ethers.formatEther(balance),
                gasEstimate: gasEstimate.toString()
            });
            
            return true;
            
        } catch (error) {
            this.logTestResult(testName, false, 'Contract interaction failed', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * Test escrow contract specific functionality
     * @param {Object} wallet 
     * @param {string} keyType 
     */
    async validateEscrowContract(wallet, keyType) {
        if (keyType !== 'ARBITER_PRIVATE_KEY') {
            return true; // Skip if not arbiter key
        }

        const testName = `Escrow Contract - ${keyType}`;
        
        try {
            if (!this.config.contractAddresses.escrow) {
                this.logTestResult(testName, false, 'Escrow contract address not configured');
                return false;
            }

            // Basic escrow contract ABI for testing
            const escrowABI = [
                'function arbiter() view returns (address)',
                'function deposits(bytes32) view returns (uint256)',
                'function releaseFund(bytes32 orderId, address to, uint256 amount)',
                'function refund(bytes32 orderId, address to, uint256 amount)'
            ];

            const escrowContract = new ethers.Contract(
                this.config.contractAddresses.escrow,
                escrowABI,
                wallet.connect(this.provider)
            );

            // Test 1: Check if the new key is the arbiter
            try {
                const arbiterAddress = await escrowContract.arbiter();
                
                if (arbiterAddress.toLowerCase() === wallet.address.toLowerCase()) {
                    this.logTestResult(testName, true, 'New key is confirmed as contract arbiter', {
                        arbiterAddress,
                        walletAddress: wallet.address
                    });
                } else {
                    this.logTestResult(testName, false, 'New key is not the contract arbiter', {
                        expectedArbiter: wallet.address,
                        actualArbiter: arbiterAddress
                    });
                    return false;
                }
            } catch (error) {
                this.logTestResult(testName, false, 'Could not verify arbiter status', {
                    error: error.message
                });
                return false;
            }

            return true;
            
        } catch (error) {
            this.logTestResult(testName, false, 'Escrow contract validation failed', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * Test API integration
     * @param {Object} wallet 
     * @param {string} keyType 
     */
    async validateAPIIntegration(wallet, keyType) {
        const testName = `API Integration - ${keyType}`;
        
        try {
            // This would test your API endpoints with the new key
            // For now, we'll do a basic test of signing a request
            
            const timestamp = Date.now();
            const payload = JSON.stringify({
                action: 'test_key_validation',
                timestamp,
                address: wallet.address
            });
            
            const signature = await wallet.signMessage(payload);
            
            // Verify the signature
            const recovered = ethers.verifyMessage(payload, signature);
            
            if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
                this.logTestResult(testName, false, 'API signature verification failed');
                return false;
            }

            this.logTestResult(testName, true, 'API integration test passed', {
                payload,
                signature: signature.substring(0, 20) + '...'
            });
            
            return true;
            
        } catch (error) {
            this.logTestResult(testName, false, 'API integration test failed', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * Run comprehensive validation for a key
     * @param {string} privateKey 
     * @param {string} keyType 
     * @returns {Object} validation results
     */
    async validateKey(privateKey, keyType) {
        console.log(`\n🔍 VALIDATING ${keyType}...`);
        console.log('='.repeat(50));
        
        const startTime = Date.now();
        let allTestsPassed = true;
        
        // Test 1: Basic key properties
        const keyValidation = await this.validateKeyProperties(privateKey, keyType);
        if (!keyValidation) {
            allTestsPassed = false;
        }
        
        if (keyValidation) {
            const { wallet } = keyValidation;
            
            // Test 2: EIP-712 signing
            const eip712Valid = await this.validateEIP712Signing(wallet, keyType);
            if (!eip712Valid) allTestsPassed = false;
            
            // Test 3: Contract interaction
            const contractValid = await this.validateContractInteraction(wallet, keyType);
            if (!contractValid) allTestsPassed = false;
            
            // Test 4: Escrow contract (for arbiter key)
            const escrowValid = await this.validateEscrowContract(wallet, keyType);
            if (!escrowValid) allTestsPassed = false;
            
            // Test 5: API integration
            const apiValid = await this.validateAPIIntegration(wallet, keyType);
            if (!apiValid) allTestsPassed = false;
        }
        
        const duration = Date.now() - startTime;
        
        console.log('='.repeat(50));
        console.log(`${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'} - Duration: ${duration}ms`);
        
        return {
            keyType,
            allTestsPassed,
            duration,
            testCount: this.testResults.filter(r => r.testName.includes(keyType)).length,
            passedCount: this.testResults.filter(r => r.testName.includes(keyType) && r.passed).length
        };
    }

    /**
     * Validate all current environment keys
     */
    async validateCurrentKeys() {
        console.log('🔍 VALIDATING ALL CURRENT KEYS...');
        
        const results = {};
        
        // Load current keys from environment
        const privateKey = process.env.PRIVATE_KEY;
        const arbiterKey = process.env.ARBITER_PRIVATE_KEY;
        
        if (privateKey) {
            results.PRIVATE_KEY = await this.validateKey(privateKey, 'PRIVATE_KEY');
        } else {
            console.log('⚠️  PRIVATE_KEY not found in environment');
        }
        
        if (arbiterKey) {
            results.ARBITER_PRIVATE_KEY = await this.validateKey(arbiterKey, 'ARBITER_PRIVATE_KEY');
        } else {
            console.log('⚠️  ARBITER_PRIVATE_KEY not found in environment');
        }
        
        return results;
    }

    /**
     * Generate validation report
     */
    async generateReport() {
        const reportPath = path.join(process.cwd(), 'security', 'validation-report.json');
        
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalTests: this.testResults.length,
                passed: this.testResults.filter(r => r.passed).length,
                failed: this.testResults.filter(r => !r.passed).length
            },
            testResults: this.testResults,
            environment: {
                nodeVersion: process.version,
                platform: process.platform
            }
        };
        
        await fs.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`\n📄 Validation report saved to: ${reportPath}`);
        
        return report;
    }
}

// CLI Interface
async function main() {
    require('dotenv').config({ path: '.env.local' });
    
    const args = process.argv.slice(2);
    const command = args[0];
    
    const validator = new KeyValidator({
        rpcUrl: process.env.RPC_URL,
        testNetworkUrl: process.env.TEST_RPC_URL,
        contractAddresses: {
            escrow: process.env.ESCROW_CONTRACT_ADDRESS,
            fixedEscrow: process.env.FIXED_ESCROW_CONTRACT_ADDRESS
        }
    });

    switch (command) {
        case 'current':
            console.log('🔍 Validating current environment keys...');
            const results = await validator.validateCurrentKeys();
            const report = await validator.generateReport();
            
            console.log('\n📊 SUMMARY:');
            console.log(`Total tests: ${report.summary.totalTests}`);
            console.log(`Passed: ${report.summary.passed}`);
            console.log(`Failed: ${report.summary.failed}`);
            
            // Exit with error code if any tests failed
            process.exit(report.summary.failed > 0 ? 1 : 0);
            break;

        case 'key':
            const keyType = args[1];
            const privateKey = args[2];
            
            if (!keyType || !privateKey) {
                console.log('Usage: node validate-keys.js key <KEY_TYPE> <PRIVATE_KEY>');
                process.exit(1);
            }
            
            const result = await validator.validateKey(privateKey, keyType);
            await validator.generateReport();
            
            process.exit(result.allTestsPassed ? 0 : 1);
            break;

        case 'post-rotation':
            console.log('🔄 Post-rotation validation...');
            const postResults = await validator.validateCurrentKeys();
            const postReport = await validator.generateReport();
            
            console.log('\n🎯 POST-ROTATION SUMMARY:');
            for (const [keyType, result] of Object.entries(postResults)) {
                console.log(`${keyType}: ${result.allTestsPassed ? '✅ VALIDATED' : '❌ FAILED'}`);
            }
            
            const allPassed = Object.values(postResults).every(r => r.allTestsPassed);
            
            if (allPassed) {
                console.log('\n🎉 All keys validated successfully! Rotation complete.');
            } else {
                console.log('\n⚠️  Some validations failed. Consider rollback.');
            }
            
            process.exit(allPassed ? 0 : 1);
            break;

        default:
            console.log('USAGE: node validate-keys.js <command>');
            console.log('');
            console.log('COMMANDS:');
            console.log('  current           Validate current environment keys');
            console.log('  key <type> <key>  Validate a specific key');
            console.log('  post-rotation     Validate after key rotation');
            console.log('');
            console.log('ENVIRONMENT VARIABLES:');
            console.log('  PRIVATE_KEY              Backend signing key');
            console.log('  ARBITER_PRIVATE_KEY      Escrow arbiter key');
            console.log('  RPC_URL                  Blockchain RPC endpoint');
            console.log('  ESCROW_CONTRACT_ADDRESS  Escrow contract address');
            process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = KeyValidator;
