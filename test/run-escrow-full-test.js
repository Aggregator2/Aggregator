#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class EscrowTestRunner {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      }
    };
  }

  async runTest(name, command, args = []) {
    console.log(`\n🔄 Running: ${name}`);
    console.log('━'.repeat(60));
    
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        stdio: 'inherit',
        shell: true
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;
        const status = code === 0 ? 'PASSED' : 'FAILED';
        
        this.results.tests.push({
          name,
          status,
          exitCode: code,
          duration: `${duration}ms`
        });

        this.results.summary.total++;
        if (code === 0) {
          this.results.summary.passed++;
          console.log(`\n✅ ${name} - PASSED (${duration}ms)`);
        } else {
          this.results.summary.failed++;
          console.log(`\n❌ ${name} - FAILED (${duration}ms)`);
        }
        
        resolve(code);
      });

      proc.on('error', (error) => {
        this.results.tests.push({
          name,
          status: 'ERROR',
          error: error.message,
          duration: `${Date.now() - startTime}ms`
        });
        this.results.summary.failed++;
        console.error(`\n❌ ${name} - ERROR: ${error.message}`);
        resolve(1);
      });
    });
  }

  async runAllTests() {
    console.log('🚀 ESCROW SYSTEM COMPREHENSIVE TEST SUITE');
    console.log('═'.repeat(60));
    console.log(`Started at: ${this.results.timestamp}\n`);

    // 1. Run JavaScript E2E tests
    await this.runTest(
      'JavaScript E2E Tests',
      'node',
      [path.join(__dirname, 'escrow-system-e2e-test.js')]
    );

    // 2. Run Hardhat contract tests
    const hardhatConfigExists = await this.fileExists(path.join(process.cwd(), 'hardhat.config.js'));
    if (hardhatConfigExists) {
      await this.runTest(
        'Smart Contract Tests',
        'npx',
        ['hardhat', 'test', path.join(__dirname, 'escrow-contract-test.ts')]
      );
    } else {
      console.log('\n⚠️  Skipping Hardhat tests - no hardhat.config.js found');
      this.results.summary.skipped++;
    }

    // 3. Run CrossChain Router tests
    await this.runTest(
      'CrossChain Router Tests',
      'node',
      [path.join(process.cwd(), 'src/services/crossChainRouter/CrossChainRouter.test.ts')]
    );

    // 4. Run dispute resolution simulation
    const disputeTestPath = path.join(__dirname, 'dispute-resolution-simulation.js');
    if (await this.fileExists(disputeTestPath)) {
      await this.runTest(
        'Dispute Resolution Simulation',
        'node',
        [disputeTestPath]
      );
    }

    // 5. Run performance tests
    const perfTestPath = path.join(__dirname, 'performance/escrow-performance-test.js');
    if (await this.fileExists(perfTestPath)) {
      await this.runTest(
        'Performance Tests',
        'node',
        [perfTestPath]
      );
    }

    // Generate final report
    await this.generateReport();
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async generateReport() {
    console.log('\n\n📊 TEST EXECUTION SUMMARY');
    console.log('═'.repeat(60));
    
    const successRate = this.results.summary.total > 0
      ? ((this.results.summary.passed / this.results.summary.total) * 100).toFixed(2)
      : 0;

    console.log(`Total Tests: ${this.results.summary.total}`);
    console.log(`Passed: ${this.results.summary.passed} ✅`);
    console.log(`Failed: ${this.results.summary.failed} ❌`);
    console.log(`Skipped: ${this.results.summary.skipped} ⏭️`);
    console.log(`Success Rate: ${successRate}%`);
    
    console.log('\nTest Details:');
    console.log('─'.repeat(60));
    
    this.results.tests.forEach(test => {
      const statusEmoji = test.status === 'PASSED' ? '✅' : '❌';
      console.log(`${statusEmoji} ${test.name.padEnd(40)} ${test.duration.padStart(10)}`);
    });

    // Save detailed report
    const reportPath = path.join(__dirname, `escrow-test-report-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));
    
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    
    // Exit with appropriate code
    if (this.results.summary.failed > 0) {
      console.log('\n❌ TEST SUITE FAILED');
      process.exit(1);
    } else {
      console.log('\n✅ ALL TESTS PASSED');
      process.exit(0);
    }
  }
}

// Run tests
const runner = new EscrowTestRunner();
runner.runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});