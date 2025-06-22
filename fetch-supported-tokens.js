#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// Create temp directory for results
const tempDir = path.join(__dirname, 'temp-token-data');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Helper function to fetch data
function fetchData(url, filename) {
  return new Promise((resolve, reject) => {
    console.log(`\nFetching tokens from: ${url}`);
    
    https.get(url, (res) => {
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
  
  try {
    // 1. Fetch from 0x API (Ethereum)
    await fetchData(
      'https://api.0x.org/swap/v1/tokens',
      '0x-ethereum-tokens.json'
    );
    
    // 2. Fetch from Jupiter API (Solana)
    await fetchData(
      'https://token.jup.ag/all',
      'jupiter-solana-tokens.json'
    );
    
    // 3. Fetch from OpenOcean (BSC as example)
    // Note: OpenOcean requires chain parameter
    await fetchData(
      'https://open-api.openocean.finance/v3/bsc/tokenList',
      'openocean-bsc-tokens.json'
    );
    
    // Also fetch from OpenOcean for Ethereum for comparison
    await fetchData(
      'https://open-api.openocean.finance/v3/eth/tokenList',
      'openocean-ethereum-tokens.json'
    );
    
    console.log('\n✅ All token lists fetched successfully!');
    console.log(`\nAnalyze the results in: ${tempDir}`);
    
    // Create a summary file
    const summary = {
      fetchedAt: new Date().toISOString(),
      apis: [
        { name: '0x', url: 'https://api.0x.org/swap/v1/tokens', file: '0x-ethereum-tokens.json' },
        { name: 'Jupiter', url: 'https://token.jup.ag/all', file: 'jupiter-solana-tokens.json' },
        { name: 'OpenOcean BSC', url: 'https://open-api.openocean.finance/v3/bsc/tokenList', file: 'openocean-bsc-tokens.json' },
        { name: 'OpenOcean Ethereum', url: 'https://open-api.openocean.finance/v3/eth/tokenList', file: 'openocean-ethereum-tokens.json' }
      ]
    };
    
    fs.writeFileSync(
      path.join(tempDir, 'fetch-summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
  } catch (error) {
    console.error('\n❌ Error fetching tokens:', error.message);
    process.exit(1);
  }
}

// Run the script
main();