const axios = require('axios');
require('dotenv').config();

async function checkExternalApis() {
    console.log('🔌 Checking External API Dependencies...\n');
    
    const apis = [
        {
            name: '0x API',
            url: 'https://api.0x.org/swap/v1/sources',
            timeout: 10000,
            critical: true
        },
        {
            name: '0x Quote API',
            url: 'https://api.0x.org/swap/v1/quote?sellToken=ETH&buyToken=DAI&sellAmount=1000000000000000000',
            timeout: 15000,
            critical: true
        },
        {
            name: 'CoinGecko API',
            url: 'https://api.coingecko.com/api/v3/ping',
            timeout: 10000,
            critical: false
        },
        {
            name: 'Ethereum Mainnet RPC',
            url: 'https://cloudflare-eth.com',
            method: 'POST',
            data: {
                jsonrpc: '2.0',
                method: 'eth_blockNumber',
                params: [],
                id: 1
            },
            timeout: 15000,
            critical: true
        }
    ];

    const results = [];
    let overallHealth = 'healthy';

    for (const api of apis) {
        console.log(`Testing ${api.name}...`);
        
        try {
            const startTime = Date.now();
            
            const config = {
                timeout: api.timeout,
                headers: {
                    'User-Agent': 'MetaAggregator/1.0'
                }
            };

            if (api.name === '0x Quote API' && process.env.ZEROX_API_KEY) {
                config.headers['0x-api-key'] = process.env.ZEROX_API_KEY;
            }

            let response;
            if (api.method === 'POST') {
                response = await axios.post(api.url, api.data, config);
            } else {
                response = await axios.get(api.url, config);
            }
            
            const responseTime = Date.now() - startTime;
            
            const result = {
                name: api.name,
                status: 'healthy',
                responseTime: `${responseTime}ms`,
                statusCode: response.status,
                critical: api.critical
            };

            console.log(`  ✅ ${api.name}: ${response.status} (${responseTime}ms)`);
            results.push(result);
            
        } catch (error) {
            const result = {
                name: api.name,
                status: 'unhealthy',
                error: error.message,
                critical: api.critical
            };
            
            console.log(`  ❌ ${api.name}: ${error.message}`);
            results.push(result);
            
            if (api.critical) {
                overallHealth = 'unhealthy';
            }
        }
        
        // Add delay between requests to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n📊 External API Health Summary');
    console.log('===============================');
    console.log(`Overall Status: ${overallHealth === 'healthy' ? '✅ HEALTHY' : '❌ UNHEALTHY'}\n`);

    const criticalApis = results.filter(r => r.critical);
    const nonCriticalApis = results.filter(r => !r.critical);

    console.log('Critical APIs:');
    criticalApis.forEach(api => {
        console.log(`  ${api.name}: ${api.status === 'healthy' ? '✅' : '❌'} ${api.status}`);
        if (api.responseTime) console.log(`    Response time: ${api.responseTime}`);
        if (api.error) console.log(`    Error: ${api.error}`);
    });

    if (nonCriticalApis.length > 0) {
        console.log('\nNon-Critical APIs:');
        nonCriticalApis.forEach(api => {
            console.log(`  ${api.name}: ${api.status === 'healthy' ? '✅' : '❌'} ${api.status}`);
            if (api.responseTime) console.log(`    Response time: ${api.responseTime}`);
            if (api.error) console.log(`    Error: ${api.error}`);
        });
    }

    // Save results
    const report = {
        timestamp: new Date().toISOString(),
        overallHealth,
        results
    };

    const fs = require('fs');
    fs.writeFileSync('external-api-check.json', JSON.stringify(report, null, 2));
    console.log('\n💾 Results saved to external-api-check.json');

    return report;
}

// Run if called directly
if (require.main === module) {
    checkExternalApis()
        .then(report => {
            process.exit(report.overallHealth === 'healthy' ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ External API check failed:', error);
            process.exit(1);
        });
}

module.exports = { checkExternalApis };
