#!/usr/bin/env node

// Load test environment variables first
require('./load-test-env').loadTestEnv();

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

class TestRunner {
  constructor() {
    this.results = {
      unit: { passed: 0, failed: 0, total: 0, duration: 0, output: '' },
      integration: { passed: 0, failed: 0, total: 0, duration: 0, output: '' },
      contracts: { passed: 0, failed: 0, total: 0, duration: 0, output: '' },
      e2e: { passed: 0, failed: 0, total: 0, duration: 0, output: '' }
    };
    this.startTime = Date.now();
  }

  log(message, color = 'white') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  async runCommand(command, cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let output = '';
      let errorOutput = '';

      const proc = spawn('sh', ['-c', command], { 
        cwd, 
        stdio: ['inherit', 'pipe', 'pipe'] 
      });

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        process.stderr.write(text);
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        const fullOutput = output + errorOutput;
        
        resolve({
          code,
          output: fullOutput,
          duration,
          success: code === 0
        });
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  parseJestOutput(output) {
    const lines = output.split('\n');
    let passed = 0;
    let failed = 0;
    let total = 0;

    // Look for Jest summary lines
    for (const line of lines) {
      if (line.includes('Tests:')) {
        const match = line.match(/Tests:\s+(\d+)\s+failed.*?(\d+)\s+passed.*?(\d+)\s+total/);
        if (match) {
          failed = parseInt(match[1]);
          passed = parseInt(match[2]);
          total = parseInt(match[3]);
          break;
        }
        
        // Alternative format
        const altMatch = line.match(/Tests:\s+(\d+)\s+passed.*?(\d+)\s+total/);
        if (altMatch) {
          passed = parseInt(altMatch[1]);
          total = parseInt(altMatch[2]);
          failed = total - passed;
          break;
        }
      }

      // Parse individual test results
      if (line.includes('✓') || line.includes('PASS')) {
        passed++;
      } else if (line.includes('✗') || line.includes('FAIL')) {
        failed++;
      }
    }

    return { passed, failed, total: total || (passed + failed) };
  }

  parseHardhatOutput(output) {
    const lines = output.split('\n');
    let passed = 0;
    let failed = 0;

    for (const line of lines) {
      if (line.includes('✓') || line.includes('passing')) {
        const match = line.match(/(\d+)\s+passing/);
        if (match) {
          passed = parseInt(match[1]);
        }
      } else if (line.includes('✗') || line.includes('failing')) {
        const match = line.match(/(\d+)\s+failing/);
        if (match) {
          failed = parseInt(match[1]);
        }
      }
    }

    return { passed, failed, total: passed + failed };
  }

  async runUnitTests() {
    this.log('\n🧪 Running Unit Tests...', 'cyan');
    this.log('='.repeat(50), 'cyan');

    try {
      const result = await this.runCommand(
        'npx jest --config jest.config.unit.js --testEnvironment=jsdom --testPathPatterns="(__tests__|test/unit)" --passWithNoTests --coverage'
      );

      const stats = this.parseJestOutput(result.output);
      this.results.unit = {
        ...stats,
        duration: result.duration,
        output: result.output,
        success: result.success
      };

      if (result.success) {
        this.log(`✅ Unit tests completed: ${stats.passed}/${stats.total} passed`, 'green');
      } else {
        this.log(`❌ Unit tests failed: ${stats.failed}/${stats.total} failed`, 'red');
      }

    } catch (error) {
      this.log(`❌ Unit tests error: ${error.message}`, 'red');
      this.results.unit.failed = 1;
      this.results.unit.total = 1;
    }
  }

  async runIntegrationTests() {
    this.log('\n🔗 Running Integration Tests...', 'yellow');
    this.log('='.repeat(50), 'yellow');

    try {
      const result = await this.runCommand(
        'npx jest --config jest.config.integration.js --testEnvironment=node --testPathPatterns="tests/integration" --passWithNoTests --runInBand'
      );

      const stats = this.parseJestOutput(result.output);
      this.results.integration = {
        ...stats,
        duration: result.duration,
        output: result.output,
        success: result.success
      };

      if (result.success) {
        this.log(`✅ Integration tests completed: ${stats.passed}/${stats.total} passed`, 'green');
      } else {
        this.log(`❌ Integration tests failed: ${stats.failed}/${stats.total} failed`, 'red');
      }

    } catch (error) {
      this.log(`❌ Integration tests error: ${error.message}`, 'red');
      this.results.integration.failed = 1;
      this.results.integration.total = 1;
    }
  }

  async runContractTests() {
    this.log('\n⛓️  Running Contract Tests...', 'magenta');
    this.log('='.repeat(50), 'magenta');

    try {
      const result = await this.runCommand('hardhat test');

      const stats = this.parseHardhatOutput(result.output);
      this.results.contracts = {
        ...stats,
        duration: result.duration,
        output: result.output,
        success: result.success
      };

      if (result.success) {
        this.log(`✅ Contract tests completed: ${stats.passed}/${stats.total} passed`, 'green');
      } else {
        this.log(`❌ Contract tests failed: ${stats.failed}/${stats.total} failed`, 'red');
      }

    } catch (error) {
      this.log(`❌ Contract tests error: ${error.message}`, 'red');
      this.results.contracts.failed = 1;
      this.results.contracts.total = 1;
    }
  }

  async runE2ETests() {
    this.log('\n🎯 Running End-to-End Tests...', 'blue');
    this.log('='.repeat(50), 'blue');

    try {
      const result = await this.runCommand(
        'npx jest --config jest.config.e2e.js --testEnvironment=node --testPathPatterns="tests/integration/end-to-end" --passWithNoTests --runInBand --forceExit'
      );

      const stats = this.parseJestOutput(result.output);
      this.results.e2e = {
        ...stats,
        duration: result.duration,
        output: result.output,
        success: result.success
      };

      if (result.success) {
        this.log(`✅ E2E tests completed: ${stats.passed}/${stats.total} passed`, 'green');
      } else {
        this.log(`❌ E2E tests failed: ${stats.failed}/${stats.total} failed`, 'red');
      }

    } catch (error) {
      this.log(`❌ E2E tests error: ${error.message}`, 'red');
      this.results.e2e.failed = 1;
      this.results.e2e.total = 1;
    }
  }

  generateSummaryReport() {
    const totalDuration = Date.now() - this.startTime;
    const totalPassed = Object.values(this.results).reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = Object.values(this.results).reduce((sum, r) => sum + r.failed, 0);
    const totalTests = Object.values(this.results).reduce((sum, r) => sum + r.total, 0);

    this.log('\n' + '='.repeat(80), 'bright');
    this.log('📊 TEST SUMMARY REPORT', 'bright');
    this.log('='.repeat(80), 'bright');

    // Individual category results
    Object.entries(this.results).forEach(([category, result]) => {
      const icon = result.failed === 0 ? '✅' : '❌';
      const percentage = result.total > 0 ? Math.round((result.passed / result.total) * 100) : 0;
      const duration = (result.duration / 1000).toFixed(2);
      
      this.log(
        `${icon} ${category.toUpperCase().padEnd(12)} | ${result.passed}/${result.total} passed (${percentage}%) | ${duration}s`,
        result.failed === 0 ? 'green' : 'red'
      );
    });

    this.log('-'.repeat(80), 'bright');

    // Overall results
    const overallPercentage = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
    const overallDuration = (totalDuration / 1000).toFixed(2);
    
    if (totalFailed === 0) {
      this.log(`🎉 ALL TESTS PASSED! ${totalPassed}/${totalTests} (${overallPercentage}%) in ${overallDuration}s`, 'green');
    } else {
      this.log(`⚠️  SOME TESTS FAILED: ${totalPassed}/${totalTests} passed (${overallPercentage}%) in ${overallDuration}s`, 'red');
    }

    // Test categories breakdown
    this.log('\n📋 Test Categories:', 'bright');
    this.log(`   • Unit Tests:        Frontend components, utilities, pure functions`, 'white');
    this.log(`   • Integration Tests: API endpoints, database interactions, services`, 'white');
    this.log(`   • Contract Tests:    Smart contracts, blockchain interactions`, 'white');
    this.log(`   • E2E Tests:         Complete user workflows, trading flows`, 'white');

    // Recommendations
    if (totalFailed > 0) {
      this.log('\n💡 Recommendations:', 'bright');
      Object.entries(this.results).forEach(([category, result]) => {
        if (result.failed > 0) {
          this.log(`   • Fix ${result.failed} failing ${category} test(s)`, 'yellow');
        }
      });
    }

    // Save detailed report
    this.saveDetailedReport();

    return totalFailed === 0;
  }

  saveDetailedReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalPassed: Object.values(this.results).reduce((sum, r) => sum + r.passed, 0),
        totalFailed: Object.values(this.results).reduce((sum, r) => sum + r.failed, 0),
        totalTests: Object.values(this.results).reduce((sum, r) => sum + r.total, 0),
        totalDuration: Date.now() - this.startTime
      },
      categories: this.results
    };

    fs.writeFileSync(
      path.join(process.cwd(), 'test-results.json'),
      JSON.stringify(report, null, 2)
    );

    this.log(`\n📄 Detailed report saved to test-results.json`, 'cyan');
  }

  async run(categories = ['unit', 'integration', 'contracts', 'e2e']) {
    this.log('🚀 Starting Comprehensive Test Suite', 'bright');
    this.log(`📅 ${new Date().toLocaleString()}`, 'bright');
    this.log(`🎯 Running categories: ${categories.join(', ')}`, 'bright');

    // Ensure Jest configs exist
    await this.ensureJestConfigs();

    // Run test categories
    if (categories.includes('unit')) {
      await this.runUnitTests();
    }

    if (categories.includes('integration')) {
      await this.runIntegrationTests();
    }

    if (categories.includes('contracts')) {
      await this.runContractTests();
    }

    if (categories.includes('e2e')) {
      await this.runE2ETests();
    }

    // Generate final report
    const success = this.generateSummaryReport();
    
    process.exit(success ? 0 : 1);
  }

  async ensureJestConfigs() {
    const configs = {
      'jest.config.unit.js': this.generateUnitConfig(),
      'jest.config.integration.js': this.generateIntegrationConfig(),
      'jest.config.e2e.js': this.generateE2EConfig()
    };

    for (const [filename, content] of Object.entries(configs)) {
      const filepath = path.join(process.cwd(), filename);
      if (!fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, content);
        this.log(`📝 Created ${filename}`, 'cyan');
      }
    }
  }

  generateUnitConfig() {
    return `// Jest config for unit tests
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^.+\\.module\\.(css|sass|scss)$': 'identity-obj-proxy',
    '^.+\\.(css|sass|scss)$': '<rootDir>/__mocks__/styleMock.js',
    '^.+\\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$': '<rootDir>/__mocks__/fileMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/components/$1',
    '^@hooks/(.*)$': '<rootDir>/hooks/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
  },
  testMatch: [
    '<rootDir>/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/test/unit/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/src/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/components/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/hooks/**/__tests__/**/*.{js,jsx,ts,tsx}',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/tests/integration/',
    '<rootDir>/test/integration/',
    '<rootDir>/.next/',
  ],
  collectCoverageFrom: [
    'src/components/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    'hooks/**/*.{js,jsx,ts,tsx}',
    'src/utils/**/*.{js,jsx,ts,tsx}',
    'utils/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  testTimeout: 10000,
}

module.exports = createJestConfig(customJestConfig)
`;
  }

  generateIntegrationConfig() {
    return `// Jest config for integration tests
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
  },
  testMatch: [
    '<rootDir>/tests/integration/**/*.{js,ts}',
    '<rootDir>/tests/matching-engine/**/*.{js,ts}',
    '<rootDir>/tests/settlement/**/*.{js,ts}',
    '<rootDir>/tests/websocket/**/*.{js,ts}',
    '<rootDir>/tests/redis/**/*.{js,ts}',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/__tests__/',
    '<rootDir>/test/unit/',
  ],
  collectCoverageFrom: [
    'src/services/**/*.{js,ts}',
    'src/api/**/*.{js,ts}',
    'pages/api/**/*.{js,ts}',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  testTimeout: 30000,
  maxWorkers: 1, // Run integration tests sequentially
  forceExit: true,
  detectOpenHandles: true,
}
`;
  }

  generateE2EConfig() {
    return `// Jest config for end-to-end tests
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
  },
  testMatch: [
    '<rootDir>/tests/integration/end-to-end*.{js,ts}',
    '<rootDir>/tests/e2e/**/*.{js,ts}',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/__tests__/',
    '<rootDir>/test/unit/',
  ],
  testTimeout: 60000,
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
}
`;
  }
}

// CLI interface
function main() {
  const args = process.argv.slice(2);
  const runner = new TestRunner();

  if (args.length === 0) {
    // Run all test categories
    runner.run();
  } else if (args[0] === '--help' || args[0] === '-h') {
    console.log(`
🧪 Comprehensive Test Runner

Usage:
  node scripts/run-tests.js [categories...]
  
Categories:
  unit         Unit tests (components, utils, pure functions)
  integration  Integration tests (APIs, services, database)
  contracts    Smart contract tests (Hardhat)
  e2e          End-to-end tests (complete workflows)
  
Examples:
  node scripts/run-tests.js                    # Run all tests
  node scripts/run-tests.js unit integration  # Run only unit and integration
  node scripts/run-tests.js contracts         # Run only contract tests
  node scripts/run-tests.js --help            # Show this help
    `);
  } else {
    // Run specific categories
    const validCategories = ['unit', 'integration', 'contracts', 'e2e'];
    const requestedCategories = args.filter(arg => validCategories.includes(arg));
    
    if (requestedCategories.length === 0) {
      console.error('❌ Invalid categories. Valid options: unit, integration, contracts, e2e');
      process.exit(1);
    }
    
    runner.run(requestedCategories);
  }
}

if (require.main === module) {
  main();
}

module.exports = TestRunner;