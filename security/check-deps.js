#!/usr/bin/env node

// Check if required dependencies are available
const fs = require('fs');

console.log('🔍 Checking dependencies for Key Rotation System...');

const requiredPackages = [
    'ethers',
    'fs',
    'path',
    'crypto',
    'events'
];

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

let allGood = true;

for (const pkg of requiredPackages) {
    if (pkg === 'fs' || pkg === 'path' || pkg === 'crypto' || pkg === 'events') {
        console.log(`✅ ${pkg} (Node.js built-in)`);
    } else if (dependencies[pkg]) {
        console.log(`✅ ${pkg} v${dependencies[pkg]}`);
    } else {
        console.log(`❌ ${pkg} - MISSING`);
        allGood = false;
    }
}

if (allGood) {
    console.log('\n🎉 All dependencies available! Key rotation system ready to use.');
} else {
    console.log('\n⚠️  Some dependencies missing. Install with: npm install ethers');
}
