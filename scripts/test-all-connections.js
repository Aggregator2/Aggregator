#!/usr/bin/env node

/**
 * Test All Connections - Comprehensive Connectivity Checker
 * Tests all external dependencies and services
 */

const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');
const http = require('http');
const https = require('https');
const { URL } = require('url');

class ConnectionTester {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            summary: {
                total: 0,
                passed: 0,
                failed: 0,
                warnings: 0
            },
            tests: [],
            recommendations: []
        };
    }

    async runTest(name, testFunction, critical = true) {
        this.results.summary.total++;
        const startTime = Date.now();
        
        console.log(`🔍 Testing ${name}...`);
        
        try {
            const result = await testFunction();
            const duration = Date.now() - startTime;
            
            const testResult = {
                name,
                status: 'passed',
                critical,
                duration: `${duration}ms`,
                details: result,
                timestamp: new Date().toISOString()
            };

            // Check for warnings in passed tests
            if (result && result.warning) {
                testResult.status = 'warning';
                this.results.summary.warnings++;
                console.log(`⚠️  ${name}: PASSED with warnings (${duration}ms)`);
                if (result.warning) console.log(`   Warning: ${result.warning}`);
            } else {
                this.results.summary.passed++;
                console.log(`✅ ${name}: PASSED (${duration}ms)`);
            }

            this.results.tests.push(testResult);
            return testResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            
            const testResult = {
                name,
                status: 'failed',
                critical,
                duration: `${duration}ms`,
                error: error.message,
                timestamp: new Date().toISOString()
            };

            this.results.summary.failed++;
            console.log(`❌ ${name}: FAILED (${duration}ms)`);
            console.log(`   Error: ${error.message}`);

            this.results.tests.push(testResult);
            return testResult;
        }
    }

    async testDatabase() {
        const supabase = createClient(
            process.env.SUPABASE_URL || 'missing-url',
            process.env.SUPABASE_KEY || 'missing-key'
        );

        // Test basic connectivity
        const startTime = Date.now();
        const { data, error } = await supabase
            .from('orders')
            .select('count')
            .limit(1);

        if (error) {
            throw new Error(`Database connection failed: ${error.message}`);
        }

        const responseTime = Date.now() - startTime;

        // Test write capability
        const testData = {
            id: `test-${Date.now()}`,
            state: 'TEST',
            amount: '0',
            created_at: new Date().toISOString()
        };

        const { error: insertError } = await supabase
            .from('orders')
            .insert(testData);

        // Clean up test data
        if (!insertError) {
            await supabase
                .from('orders')
                .delete()
                .eq('id', testData.id);
        }

        const result = {
            responseTime: `${responseTime}ms`,
            readAccess: true,
            writeAccess: !insertError
        };

        if (responseTime > 1000) {
            result.warning = `High response time: ${responseTime}ms`;
        }

        if (insertError) {
            result.warning = `Write access failed: ${insertError.message}`;
        }

        return result;
    }

    async testBlockchain() {
        const rpcUrl = process.env.RPC_URL;
        if (!rpcUrl) {
            throw new Error('RPC_URL environment variable not set');
        }

        const provider = new ethers.JsonRpcProvider(rpcUrl);

        // Test basic connectivity
        const startTime = Date.now();
        const blockNumber = await provider.getBlockNumber();
        const network = await provider.getNetwork();
        const responseTime = Date.now() - startTime;

        // Test contract connectivity if available
        let contractStatus = 'not-configured';
        let contractError = null;

        if (process.env.ESCROW_CONTRACT_ADDRESS) {
            try {
                const contract = new ethers.Contract(
                    process.env.ESCROW_CONTRACT_ADDRESS,
                    ['function owner() view returns (address)'],
                    provider
                );
                
                const contractStartTime = Date.now();
                await contract.owner();
                const contractResponseTime = Date.now() - contractStartTime;
                
                contractStatus = 'accessible';
                contractResponseTime;
            } catch (error) {
                contractStatus = 'inaccessible';
                contractError = error.message;
            }
        }

        // Test recent block (ensure not stale)
        const currentTime = Math.floor(Date.now() / 1000);
        const block = await provider.getBlock(blockNumber);
        const blockAge = currentTime - block.timestamp;

        const result = {
            network: network.name,
            chainId: Number(network.chainId),
            currentBlock: blockNumber,
            responseTime: `${responseTime}ms`,
            contractStatus,
            contractError,
            blockAge: `${blockAge}s`,
            rpcUrl: rpcUrl.replace(/\/[^\/]*$/, '/***') // Hide API key
        };

        if (responseTime > 2000) {
            result.warning = `High RPC response time: ${responseTime}ms`;
        }

        if (blockAge > 300) { // More than 5 minutes old
            result.warning = `Stale blockchain data: block is ${blockAge}s old`;
        }

        if (contractStatus === 'inaccessible') {
            result.warning = `Contract inaccessible: ${contractError}`;
        }

        return result;
    }

    async testHttpEndpoint(url, name = null) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const client = parsedUrl.protocol === 'https:' ? https : http;
            
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout: ${url} did not respond within 10 seconds`));
            }, 10000);

            const startTime = Date.now();
            
            const req = client.get(url, (res) => {
                clearTimeout(timeout);
                const responseTime = Date.now() - startTime;
                
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    const result = {
                        url: url,
                        statusCode: res.statusCode,
                        responseTime: `${responseTime}ms`,
                        contentLength: body.length
                    };

                    if (res.statusCode >= 400) {
                        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
                    } else {
                        if (responseTime > 5000) {
                            result.warning = `Slow response: ${responseTime}ms`;
                        }
                        resolve(result);
                    }
                });
            });

            req.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error(`Request timeout: ${url}`));
            });
        });
    }

    async testLocalServices() {
        const services = [
            { name: 'Local Backend', url: 'http://localhost:3001/health', critical: true },
            { name: 'Local Frontend', url: 'http://localhost:3000', critical: false }
        ];

        const results = {};
        
        for (const service of services) {
            try {
                const result = await this.testHttpEndpoint(service.url);
                results[service.name] = {
                    status: 'accessible',
                    ...result
                };
            } catch (error) {
                results[service.name] = {
                    status: 'inaccessible',
                    error: error.message,
                    critical: service.critical
                };

                if (service.critical) {
                    throw new Error(`Critical service ${service.name} inaccessible: ${error.message}`);
                }
            }
        }

        return results;
    }

    async testExternalAPIs() {
        const apis = [
            { name: 'CoinGecko', url: 'https://api.coingecko.com/api/v3/ping' },
            { name: 'GitHub', url: 'https://api.github.com' }
        ];

        const results = {};
        
        for (const api of apis) {
            try {
                const result = await this.testHttpEndpoint(api.url);
                results[api.name] = {
                    status: 'accessible',
                    ...result
                };
            } catch (error) {
                results[api.name] = {
                    status: 'inaccessible',
                    error: error.message
                };
            }
        }

        return results;
    }

    async testDNSResolution() {
        const { promisify } = require('util');
        const dns = require('dns');
        const lookup = promisify(dns.lookup);

        const domains = [
            'supabase.com',
            'polygon.technology',
            'ethereum.org'
        ];

        const results = {};
        
        for (const domain of domains) {
            try {
                const startTime = Date.now();
                const result = await lookup(domain);
                const responseTime = Date.now() - startTime;
                
                results[domain] = {
                    resolved: true,
                    address: result.address,
                    family: result.family,
                    responseTime: `${responseTime}ms`
                };
            } catch (error) {
                results[domain] = {
                    resolved: false,
                    error: error.message
                };
            }
        }

        return results;
    }

    generateRecommendations() {
        const recommendations = [];
        const failedCritical = this.results.tests.filter(t => t.status === 'failed' && t.critical);
        const warnings = this.results.tests.filter(t => t.status === 'warning');

        if (failedCritical.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                action: `${failedCritical.length} critical services failed`,
                details: failedCritical.map(t => t.name).join(', '),
                command: 'Check environment variables and service status'
            });
        }

        if (warnings.length > 0) {
            recommendations.push({
                priority: 'WARNING',
                action: `${warnings.length} services have performance issues`,
                details: warnings.map(t => `${t.name}: ${t.details?.warning || 'performance issue'}`).join('; ')
            });
        }

        if (this.results.summary.failed === 0 && this.results.summary.warnings === 0) {
            recommendations.push({
                priority: 'INFO',
                action: 'All connections healthy',
                details: 'System connectivity is optimal'
            });
        }

        this.results.recommendations = recommendations;
    }

    async runAllTests() {
        console.log('🌐 Meta Aggregator 2.0 - Connection Test Suite');
        console.log('=' * 50);

        // Core system tests
        await this.runTest('Database Connection', () => this.testDatabase(), true);
        await this.runTest('Blockchain RPC', () => this.testBlockchain(), true);
        
        // Local services
        await this.runTest('Local Services', () => this.testLocalServices(), false);
        
        // External dependencies
        await this.runTest('External APIs', () => this.testExternalAPIs(), false);
        
        // Network infrastructure
        await this.runTest('DNS Resolution', () => this.testDNSResolution(), false);

        this.generateRecommendations();
        this.printReport();

        return this.results;
    }

    printReport() {
        console.log('\n📊 CONNECTION TEST RESULTS');
        console.log('=' * 30);
        
        console.log(`\n📋 SUMMARY:`);
        console.log(`   Total tests: ${this.results.summary.total}`);
        console.log(`   ✅ Passed: ${this.results.summary.passed}`);
        console.log(`   ⚠️  Warnings: ${this.results.summary.warnings}`);
        console.log(`   ❌ Failed: ${this.results.summary.failed}`);

        const overallStatus = this.results.summary.failed === 0 ? 
            (this.results.summary.warnings === 0 ? 'HEALTHY' : 'DEGRADED') : 
            'UNHEALTHY';
        
        const emoji = overallStatus === 'HEALTHY' ? '✅' : 
                     overallStatus === 'DEGRADED' ? '⚠️' : '❌';
        
        console.log(`\n🎯 OVERALL STATUS: ${emoji} ${overallStatus}`);

        // Failed tests
        const failed = this.results.tests.filter(t => t.status === 'failed');
        if (failed.length > 0) {
            console.log(`\n❌ FAILED TESTS:`);
            failed.forEach(test => {
                const criticality = test.critical ? '🚨 CRITICAL' : '⚠️  NON-CRITICAL';
                console.log(`   ${criticality}: ${test.name}`);
                console.log(`      Error: ${test.error}`);
            });
        }

        // Warnings
        const warnings = this.results.tests.filter(t => t.status === 'warning');
        if (warnings.length > 0) {
            console.log(`\n⚠️  WARNINGS:`);
            warnings.forEach(test => {
                console.log(`   ${test.name}: ${test.details?.warning || 'Performance issue'}`);
            });
        }

        // Recommendations
        if (this.results.recommendations.length > 0) {
            console.log(`\n💡 RECOMMENDATIONS:`);
            this.results.recommendations.forEach(rec => {
                const emoji = rec.priority === 'CRITICAL' ? '🚨' : 
                             rec.priority === 'WARNING' ? '⚠️' : 'ℹ️';
                console.log(`   ${emoji} ${rec.priority}: ${rec.action}`);
                if (rec.details) console.log(`      Details: ${rec.details}`);
                if (rec.command) console.log(`      Command: ${rec.command}`);
            });
        }
    }
}

// CLI Interface
async function main() {
    try {
        const tester = new ConnectionTester();
        const results = await tester.runAllTests();

        // Exit with appropriate code
        if (results.summary.failed > 0) {
            const criticalFailed = results.tests.some(t => t.status === 'failed' && t.critical);
            process.exit(criticalFailed ? 2 : 1);
        } else if (results.summary.warnings > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (error) {
        console.error('❌ Connection test suite failed:', error.message);
        process.exit(3);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = ConnectionTester;
