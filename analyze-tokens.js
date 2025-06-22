#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const tempDir = path.join(__dirname, 'temp-token-data');

function analyzeTokenFile(filename) {
  console.log(`\n=== ${filename} ===`);
  
  try {
    const filePath = path.join(tempDir, filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Determine structure and count
    let tokens = [];
    let count = 0;
    
    if (Array.isArray(data)) {
      tokens = data;
      count = data.length;
    } else if (data.records && Array.isArray(data.records)) {
      tokens = data.records;
      count = data.records.length;
    } else if (data.tokens && typeof data.tokens === 'object') {
      tokens = Object.values(data.tokens);
      count = Object.keys(data.tokens).length;
    } else if (data.data && Array.isArray(data.data)) {
      tokens = data.data;
      count = data.data.length;
    } else {
      console.log('Unknown structure:', Object.keys(data));
      return;
    }
    
    console.log(`Total tokens: ${count}`);
    console.log('\nSample tokens (first 5):');
    
    tokens.slice(0, 5).forEach((token, index) => {
      console.log(`${index + 1}. ${token.symbol || token.name || 'Unknown'}`);
      console.log(`   Name: ${token.name || 'N/A'}`);
      console.log(`   Address: ${token.address || token.mint || token.contract || 'N/A'}`);
      console.log(`   Decimals: ${token.decimals || 'N/A'}`);
      if (token.chainId) console.log(`   Chain ID: ${token.chainId}`);
      if (token.logoURI || token.logo || token.icon) console.log(`   Logo: Available`);
    });
    
    // Show unique properties
    if (tokens.length > 0) {
      const sampleToken = tokens[0];
      console.log('\nAvailable properties:', Object.keys(sampleToken).join(', '));
    }
    
  } catch (error) {
    console.error(`Error reading ${filename}:`, error.message);
  }
}

// Analyze each file
const files = [
  '0x-ethereum-tokens.json',
  'jupiter-solana-tokens.json',
  'openocean-bsc-tokens.json',
  'openocean-ethereum-tokens.json'
];

console.log('Token List Analysis');
console.log('==================');

files.forEach(file => {
  if (fs.existsSync(path.join(tempDir, file))) {
    analyzeTokenFile(file);
  }
});

// Summary statistics
console.log('\n=== Summary ===');
files.forEach(file => {
  const filePath = path.join(tempDir, file);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      let count = 0;
      
      if (Array.isArray(data)) count = data.length;
      else if (data.records) count = data.records.length;
      else if (data.tokens) count = Object.keys(data.tokens).length;
      else if (data.data) count = data.data.length;
      
      console.log(`${file}: ${count} tokens`);
    } catch (error) {
      console.log(`${file}: Error reading file`);
    }
  }
});