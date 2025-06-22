#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create temp directory for results
const tempDir = path.join(__dirname, 'temp-token-data');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to fetch data
function fetchData(url, filename, headers = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\nFetching tokens from: ${url}`);
    
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        ...headers
      }
    };
    
    protocol.get(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const filePath = path.join(tempDir, filename);
          
          // Save raw response
          fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2));
          console.log(`✓ Saved to: ${filePath}`);
          
          // Log summary
          if (Array.isArray(parsed)) {
            console.log(`  Total tokens: ${parsed.length}`);
          } else if (parsed.records) {
            console.log(`  Total tokens: ${parsed.records.length}`);
          } else if (parsed.tokens) {
            console.log(`  Total tokens: ${Object.keys(parsed.tokens).length}`);
          } else if (parsed.data && Array.isArray(parsed.data)) {
            console.log(`  Total tokens: ${parsed.data.length}`);
          } else {
            console.log(`  Response received (structure: ${Object.keys(parsed).join(', ')})`);
          }
          
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Failed to parse JSON: ${error.message}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('Fetching supported tokens from various DEX aggregators...');
  console.log(`Results will be saved to: ${tempDir}`);
  
  const results = [];
  
  try {
    // 1. Jupiter API (Solana) - Working
    try {
      await fetchData(
        'https://token.jup.ag/all',
        'jupiter-solana-tokens.json'
      );
      results.push({ api: 'Jupiter', status: 'success' });
    } catch (error) {
      console.error(`Jupiter error: ${error.message}`);
      results.push({ api: 'Jupiter', status: 'failed', error: error.message });
    }
    
    // 2. OpenOcean - Multiple chains
    const openOceanChains = [
      { chain: 'eth', name: 'Ethereum' },
      { chain: 'bsc', name: 'BSC' },
      { chain: 'polygon', name: 'Polygon' },
      { chain: 'avalanche', name: 'Avalanche' },
      { chain: 'arbitrum', name: 'Arbitrum' },
      { chain: 'optimism', name: 'Optimism' }
    ];
    
    for (const { chain, name } of openOceanChains) {
      try {
        await fetchData(
          `https://open-api.openocean.finance/v3/${chain}/tokenList`,
          `openocean-${chain}-tokens.json`
        );
        results.push({ api: `OpenOcean ${name}`, status: 'success' });
      } catch (error) {
        console.error(`OpenOcean ${name} error: ${error.message}`);
        results.push({ api: `OpenOcean ${name}`, status: 'failed', error: error.message });
      }
    }
    
    // 3. Try 0x API with price endpoint (since tokens endpoint doesn't work)
    // We'll fetch a sample quote to see the token format
    try {
      const zeroXParams = new URLSearchParams({
        sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // ETH
        buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        sellAmount: '1000000000000000000' // 1 ETH
      });
      
      const zeroXHeaders = {};
      if (process.env.ZEROX_API_KEY) {
        zeroXHeaders['0x-api-key'] = process.env.ZEROX_API_KEY;
      }
      
      await fetchData(
        `https://api.0x.org/swap/v1/price?${zeroXParams}`,
        '0x-sample-price.json',
        zeroXHeaders
      );
      results.push({ api: '0x Price Sample', status: 'success' });
    } catch (error) {
      console.error(`0x API error: ${error.message}`);
      results.push({ api: '0x Price Sample', status: 'failed', error: error.message });
    }
    
    // 4. Try Uniswap token list
    try {
      await fetchData(
        'https://tokens.uniswap.org',
        'uniswap-tokens.json'
      );
      results.push({ api: 'Uniswap Token List', status: 'success' });
    } catch (error) {
      console.error(`Uniswap error: ${error.message}`);
      results.push({ api: 'Uniswap Token List', status: 'failed', error: error.message });
    }
    
    // 5. Try CoinGecko token list (Ethereum)
    try {
      await fetchData(
        'https://tokens.coingecko.com/ethereum/all.json',
        'coingecko-ethereum-tokens.json'
      );
      results.push({ api: 'CoinGecko Ethereum', status: 'success' });
    } catch (error) {
      console.error(`CoinGecko error: ${error.message}`);
      results.push({ api: 'CoinGecko Ethereum', status: 'failed', error: error.message });
    }
    
    console.log('\n✅ Token fetching complete!');
    console.log(`\nResults saved to: ${tempDir}`);
    
    // Create a summary file
    const summary = {
      fetchedAt: new Date().toISOString(),
      results: results,
      successCount: results.filter(r => r.status === 'success').length,
      failedCount: results.filter(r => r.status === 'failed').length
    };
    
    fs.writeFileSync(
      path.join(tempDir, 'fetch-summary-v2.json'),
      JSON.stringify(summary, null, 2)
    );
    
    // Show summary
    console.log('\n=== Fetch Summary ===');
    results.forEach(r => {
      console.log(`${r.status === 'success' ? '✓' : '✗'} ${r.api}${r.error ? ': ' + r.error : ''}`);
    });
    
  } catch (error) {
    console.error('\n❌ Error in main process:', error.message);
    process.exit(1);
  }
}

// Run the script
main();