#!/usr/bin/env node

const { execSync } = require('child_process');
// const Redis = require('redis'); // Temporarily disabled due to dependency issue
const fs = require('fs');
const path = require('path');

async function verifyStartup() {
  console.log('🔍 Verifying SwappiQ startup requirements...\n');

  let issues = [];
  let warnings = [];

  try {
    // Check Node version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    console.log(`✅ Node.js ${nodeVersion}`);
    
    if (majorVersion < 18) {
      warnings.push(`⚠️  Node.js version ${nodeVersion} - recommended: v18+ for better compatibility`);
    }

    // Check environment files
    const envFiles = ['.env', '.env.local', '.env.development'];
    envFiles.forEach(envFile => {
      const envPath = path.join(process.cwd(), envFile);
      if (fs.existsSync(envPath)) {
        console.log(`✅ ${envFile} exists`);
      } else {
        warnings.push(`⚠️  ${envFile} not found - some features may not work`);
      }
    });

    // Check critical dependencies
    console.log('\n📦 Checking dependencies...');
    try {
      require('redis');
      console.log('✅ Redis package available');
    } catch (error) {
      warnings.push('⚠️  Redis package not found - some features may not work');
    }

    try {
      require('ethers');
      console.log('✅ Ethers package available');
    } catch (error) {
      warnings.push('⚠️  Ethers package not found - blockchain features may be limited');
    }

    try {
      require('@lifi/sdk');
      console.log('✅ LiFi SDK available');
    } catch (error) {
      warnings.push('⚠️  LiFi SDK not found - external liquidity features may not work');
    }

    // Check Redis connection (temporarily disabled due to dependency issue)
    console.log('\n🔴 Checking Redis...');
    console.log('⚠️  Redis check temporarily disabled due to dependency issue');

    // Check Hardhat node
    console.log('\n⛏️  Checking Hardhat node...');
    try {
      execSync('curl -s -f http://localhost:8545 -X POST -H "Content-Type: application/json" -d \'{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}\'', { 
        stdio: 'pipe',
        timeout: 5000 
      });
      console.log('✅ Hardhat node is running');
    } catch (error) {
      issues.push('❌ Hardhat node is not running - run: npx hardhat node');
    }

    // Check for port conflicts
    console.log('\n🔌 Checking port availability...');
    const ports = [3000, 3001, 3002];
    
    for (const port of ports) {
      try {
        // Try to check if port is in use (works on Unix systems)
        execSync(`lsof -i :${port}`, { stdio: 'ignore' });
        if (port === 3000) {
          issues.push(`❌ Port ${port} is already in use - kill existing process or use different port`);
        } else {
          warnings.push(`⚠️  Port ${port} is in use - may cause conflicts`);
        }
      } catch (error) {
        console.log(`✅ Port ${port} is available`);
      }
    }

    // Check database files
    console.log('\n🗄️  Checking database...');
    const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
    if (fs.existsSync(dbPath)) {
      console.log('✅ SQLite database exists');
    } else {
      warnings.push('⚠️  SQLite database not found - run: npx prisma migrate dev');
    }

    // Check Prisma schema
    const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
    if (fs.existsSync(schemaPath)) {
      console.log('✅ Prisma schema exists');
    } else {
      issues.push('❌ Prisma schema not found - check prisma/schema.prisma');
    }

    // Check log directory
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log('✅ Created logs directory');
      } catch (error) {
        warnings.push('⚠️  Could not create logs directory - logging may fail');
      }
    } else {
      console.log('✅ Logs directory exists');
    }

    // Check for essential config files
    console.log('\n⚙️  Checking configuration files...');
    const configFiles = [
      'next.config.js',
      'hardhat.config.js',
      'package.json',
      'tsconfig.json'
    ];

    configFiles.forEach(configFile => {
      const configPath = path.join(process.cwd(), configFile);
      if (fs.existsSync(configPath)) {
        console.log(`✅ ${configFile} exists`);
      } else {
        if (configFile === 'package.json') {
          issues.push(`❌ ${configFile} missing - critical file`);
        } else {
          warnings.push(`⚠️  ${configFile} missing - some features may not work`);
        }
      }
    });

    // Check SwappiQ-specific services
    console.log('\n🔧 Checking SwappiQ services...');
    
    // Check TokenAggregator
    const tokenAggregatorPath = path.join(process.cwd(), 'src', 'services', 'tokenAggregator.ts');
    if (fs.existsSync(tokenAggregatorPath)) {
      console.log('✅ TokenAggregator service available');
      
      // Check if it has our fixes
      const content = fs.readFileSync(tokenAggregatorPath, 'utf8');
      if (content.includes('loadTokensFromLifi') && content.includes('isLoading')) {
        console.log('✅ TokenAggregator fixes applied');
      } else {
        warnings.push('⚠️  TokenAggregator may have issues - consider running verify:token-aggregator');
      }
    } else {
      issues.push('❌ TokenAggregator service missing');
    }

    // Check LiFi Service
    const lifiServicePath = path.join(process.cwd(), 'src', 'services', 'lifiService.ts');
    if (fs.existsSync(lifiServicePath)) {
      console.log('✅ LiFi service available');
    } else {
      warnings.push('⚠️  LiFi service not found - external liquidity may not work');
    }

    // Check Matching Engine
    const matchingEnginePath = path.join(process.cwd(), 'src', 'services', 'matchingEngine');
    if (fs.existsSync(matchingEnginePath)) {
      console.log('✅ Matching Engine available');
    } else {
      issues.push('❌ Matching Engine missing - core trading functionality unavailable');
    }

    // Check Settlement Engine
    const settlementEnginePath = path.join(process.cwd(), 'src', 'services', 'settlement');
    if (fs.existsSync(settlementEnginePath)) {
      console.log('✅ Settlement Engine available');
    } else {
      warnings.push('⚠️  Settlement Engine not found - settlement features may not work');
    }

    // Check memory and system resources
    console.log('\n💾 Checking system resources...');
    const totalMem = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
    console.log(`✅ Node.js heap: ${totalMem}MB`);
    
    if (totalMem < 100) {
      warnings.push('⚠️  Low memory available - performance may be affected');
    }

    // Final summary
    console.log('\n' + '='.repeat(50));
    
    if (issues.length > 0) {
      console.log('\n🚫 Critical issues found:');
      issues.forEach(issue => console.log(issue));
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      warnings.forEach(warning => console.log(warning));
    }

    if (issues.length === 0) {
      console.log('\n✅ All critical checks passed! SwappiQ is ready to start');
      console.log('\n🚀 To start the application:');
      console.log('   npm run dev     # Start development server');
      console.log('   npm run build   # Build for production');
      console.log('   npm run start   # Start production server');
      
      if (warnings.length > 0) {
        console.log('\n💡 Note: Warnings above are non-critical but should be addressed for optimal performance.');
      }
      
      process.exit(0);
    } else {
      console.log('\n❌ Please fix the critical issues above before starting SwappiQ');
      console.log('\n🔧 Quick fixes:');
      console.log('   Redis: redis-server &');
      console.log('   Hardhat: npx hardhat node &');
      console.log('   Dependencies: npm install');
      console.log('   Database: npx prisma migrate dev');
      
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Verification script failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Verification cancelled');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run verification
verifyStartup().catch(error => {
  console.error('💥 Startup verification failed:', error.message);
  process.exit(1);
});