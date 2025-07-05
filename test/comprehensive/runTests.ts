#!/usr/bin/env ts-node

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TestSuite {
  name: string;
  path: string;
  timeout?: number;
}

const testSuites: TestSuite[] = [
  {
    name: "State Channel Lifecycle Tests",
    path: "./stateChannels/channelLifecycle.test.ts",
    timeout: 60000
  },
  {
    name: "EIP-712 Signature Handling Tests",
    path: "./eip712/signatureHandling.test.ts",
    timeout: 45000
  },
  {
    name: "Security and Fraud Proof Tests",
    path: "./security/fraudProofTests.test.ts",
    timeout: 45000
  },
  {
    name: "Full System Integration Tests",
    path: "./integration/fullSystemTests.test.ts",
    timeout: 90000
  }
];

async function runTest(suite: TestSuite): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${suite.name}`);
    console.log(`${'='.repeat(60)}\n`);

    const testPath = path.join(__dirname, suite.path);
    
    const hardhatTest = spawn('npx', [
      'hardhat',
      'test',
      testPath,
      '--no-compile'
    ], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' }
    });

    let output = '';

    hardhatTest.stdout.on('data', (data) => {
      const str = data.toString();
      output += str;
      process.stdout.write(str);
    });

    hardhatTest.stderr.on('data', (data) => {
      const str = data.toString();
      output += str;
      process.stderr.write(str);
    });

    hardhatTest.on('close', (code) => {
      resolve({
        success: code === 0,
        output
      });
    });

    // Set timeout
    if (suite.timeout) {
      setTimeout(() => {
        hardhatTest.kill();
        resolve({
          success: false,
          output: output + '\n\nTest timed out'
        });
      }, suite.timeout);
    }
  });
}

async function generateReport(results: Array<{ suite: TestSuite; result: { success: boolean; output: string } }>) {
  const timestamp = new Date().toISOString();
  const reportPath = path.join(__dirname, `test-report-${timestamp.replace(/:/g, '-')}.md`);
  
  let report = `# Comprehensive Test Report\n\n`;
  report += `**Generated:** ${timestamp}\n\n`;
  report += `## Summary\n\n`;
  
  const totalSuites = results.length;
  const passedSuites = results.filter(r => r.result.success).length;
  const failedSuites = totalSuites - passedSuites;
  
  report += `- **Total Test Suites:** ${totalSuites}\n`;
  report += `- **Passed:** ${passedSuites}\n`;
  report += `- **Failed:** ${failedSuites}\n\n`;
  
  report += `## Test Results\n\n`;
  
  for (const { suite, result } of results) {
    const status = result.success ? '✅ PASSED' : '❌ FAILED';
    report += `### ${suite.name} ${status}\n\n`;
    
    // Extract test statistics from output
    const statsMatch = result.output.match(/(\d+) passing/);
    const failuresMatch = result.output.match(/(\d+) failing/);
    const timeMatch = result.output.match(/\((\d+(?:\.\d+)?[ms]+)\)/);
    
    if (statsMatch) {
      report += `- **Tests Passed:** ${statsMatch[1]}\n`;
    }
    if (failuresMatch) {
      report += `- **Tests Failed:** ${failuresMatch[1]}\n`;
    }
    if (timeMatch) {
      report += `- **Duration:** ${timeMatch[1]}\n`;
    }
    
    report += `\n`;
    
    // Add failure details if any
    if (!result.success && result.output.includes('AssertionError')) {
      report += `#### Failure Details\n\n`;
      report += '```\n';
      const failureSection = result.output.split('failing')[1]?.split('passing')[0] || '';
      report += failureSection.trim().substring(0, 1000); // Limit output
      report += '\n```\n\n';
    }
  }
  
  // Add performance metrics if available
  report += `## Performance Metrics\n\n`;
  
  const hftMetrics = results.find(r => r.suite.name.includes('Integration'))?.result.output;
  if (hftMetrics) {
    const metricsMatch = hftMetrics.match(/HFT Performance:.*?TPS\)/s);
    if (metricsMatch) {
      report += '```\n';
      report += metricsMatch[0];
      report += '\n```\n\n';
    }
  }
  
  fs.writeFileSync(reportPath, report);
  console.log(`\n📊 Test report generated: ${reportPath}`);
  
  return { passedSuites, failedSuites, reportPath };
}

async function main() {
  console.log(`🧪 Running Comprehensive Test Suite for State Channels and EIP-712`);
  console.log(`📁 Test Directory: ${__dirname}\n`);
  
  const results: Array<{ suite: TestSuite; result: { success: boolean; output: string } }> = [];
  
  // Compile contracts first
  console.log('📦 Compiling contracts...\n');
  const compile = spawn('npx', ['hardhat', 'compile'], { cwd: process.cwd() });
  await new Promise((resolve) => compile.on('close', resolve));
  
  // Run each test suite
  for (const suite of testSuites) {
    const result = await runTest(suite);
    results.push({ suite, result });
    
    // Add delay between suites
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Generate report
  const { passedSuites, failedSuites, reportPath } = await generateReport(results);
  
  // Final summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`FINAL RESULTS`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Passed: ${passedSuites}/${testSuites.length}`);
  console.log(`❌ Failed: ${failedSuites}/${testSuites.length}`);
  console.log(`📊 Report: ${reportPath}`);
  console.log(`${'='.repeat(60)}\n`);
  
  // Exit with appropriate code
  process.exit(failedSuites > 0 ? 1 : 0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

// Run tests
main().catch((error) => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});