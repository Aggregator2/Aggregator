const { ethers } = require('ethers');
const fs = require('fs');
require('dotenv').config({path: '.env.local'}); // Load from .env.local file

async function healthCheck() {
    console.log('🔍 Meta Aggregator Health Check Starting...\n');
    
    const results = {
        timestamp: new Date().toISOString(),
        overall: 'healthy',
        services: {}
    };    // Check environment variables
    console.log('📋 Checking Environment Configuration...');
    const requiredEnvVars = ['PRIVATE_KEY', 'API_URL', 'ZEROX_API_KEY'];
    let envOk = true;
    
    for (const envVar of requiredEnvVars) {
        const exists = !!process.env[envVar];
        console.log(`  ${envVar}: ${exists ? '✅' : '❌'} (value: ${exists ? 'SET' : 'NOT SET'})`);
        if (!exists) envOk = false;
    }
    results.services.environment = envOk ? 'healthy' : 'unhealthy';// Check database connectivity
    console.log('\n💾 Checking Database Connectivity...');
    try {
        const Database = require('better-sqlite3');
        const db = new Database('offchain_dex.db');
        const result = db.prepare('SELECT COUNT(*) as count FROM sqlite_master WHERE type=?').get('table');
        console.log(`  Database tables: ${result.count} ✅`);
        db.close();
        results.services.database = 'healthy';
    } catch (error) {
        console.log('  Database: ❌', error.message);
        results.services.database = 'unhealthy';
        results.overall = 'unhealthy';
    }

    // Check smart contract connectivity
    console.log('\n🔗 Checking Smart Contract Connectivity...');
    try {
        const configPath = './frontend/src/config/escrowAddress.js';
        if (fs.existsSync(configPath)) {
            const configContent = fs.readFileSync(configPath, 'utf8');
            const addressMatch = configContent.match(/0x[a-fA-F0-9]{40}/);
            
            if (addressMatch) {
                const contractAddress = addressMatch[0];
                console.log(`  Contract Address: ${contractAddress} ✅`);
                  // Try to connect to the contract
                const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
                const contractCode = await provider.getCode(contractAddress);
                
                if (contractCode !== '0x') {
                    console.log('  Contract Code: Deployed ✅');
                    results.services.smartContract = 'healthy';
                } else {
                    console.log('  Contract Code: Not found ❌');
                    results.services.smartContract = 'unhealthy';
                    results.overall = 'unhealthy';
                }
            } else {
                console.log('  Contract Address: Not found ❌');
                results.services.smartContract = 'unhealthy';
                results.overall = 'unhealthy';
            }
        } else {
            console.log('  Contract Config: File not found ❌');
            results.services.smartContract = 'unhealthy';
            results.overall = 'unhealthy';
        }
    } catch (error) {
        console.log('  Smart Contract: ❌', error.message);
        results.services.smartContract = 'unhealthy';
        results.overall = 'unhealthy';
    }

    // Check API endpoints
    console.log('\n🌐 Checking API Endpoints...');
    try {
        const axios = require('axios');
          // Check if server is running locally
        try {
            const response = await axios.get('http://localhost:3001/api/orders', { timeout: 5000 });
            console.log(`  Local API: ${response.status} ✅`);
            results.services.localApi = 'healthy';
        } catch (error) {
            console.log('  Local API: Not running or error ❌');
            results.services.localApi = 'unhealthy';
        }
    } catch (error) {
        console.log('  API Check: ❌', error.message);
        results.services.api = 'unhealthy';
    }

    // Check external dependencies
    console.log('\n🔌 Checking External Dependencies...');
    try {
        const axios = require('axios');
        
        // Check 0x API
        try {
            const response = await axios.get('https://api.0x.org/swap/v1/sources', { timeout: 10000 });
            console.log('  0x API: ✅');
            results.services.zeroXApi = 'healthy';
        } catch (error) {
            console.log('  0x API: ❌');
            results.services.zeroXApi = 'unhealthy';
        }
    } catch (error) {
        console.log('  External Dependencies: ❌', error.message);
    }

    // Generate report
    console.log('\n📊 Health Check Summary');
    console.log('========================');
    console.log(`Overall Status: ${results.overall === 'healthy' ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
    console.log(`Timestamp: ${results.timestamp}`);
    console.log('\nService Details:');
    
    for (const [service, status] of Object.entries(results.services)) {
        console.log(`  ${service}: ${status === 'healthy' ? '✅' : '❌'} ${status}`);
    }

    // Save results to file
    fs.writeFileSync('health-check-results.json', JSON.stringify(results, null, 2));
    console.log('\n💾 Results saved to health-check-results.json');

    return results;
}

// Run if called directly
if (require.main === module) {
    healthCheck()
        .then(results => {
            process.exit(results.overall === 'healthy' ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Health check failed:', error);
            process.exit(1);
        });
}

module.exports = { healthCheck };
