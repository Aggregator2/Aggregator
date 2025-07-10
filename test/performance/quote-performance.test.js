"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuotePerformanceTest = void 0;
const perf_hooks_1 = require("perf_hooks");
const axios_1 = require("axios");
class QuotePerformanceTest {
    constructor(baseUrl = 'http://localhost:3000') {
        // Common token pairs for testing
        this.commonPairs = [
            { sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'WETH/USDC' },
            { sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'USDC/USDT' },
            { sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', buyToken: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'WETH/DAI' },
            { sellToken: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', name: 'WBTC/WETH' },
            { sellToken: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', name: 'UNI/WETH' },
        ];
        this.baseUrl = baseUrl;
    }
    async measureQuoteLatency(sellToken, buyToken, sellAmount) {
        const startTime = perf_hooks_1.performance.now();
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/api/quote-profitable`, {
                sellToken,
                buyToken,
                sellAmount,
                chainId: 1
            }, {
                timeout: 5000 // 5 second timeout
            });
            const endTime = perf_hooks_1.performance.now();
            const latency = endTime - startTime;
            if (response.status !== 200) {
                throw new Error(`Quote API returned status ${response.status}`);
            }
            return latency;
        }
        catch (error) {
            const endTime = perf_hooks_1.performance.now();
            console.error(`Quote failed after ${endTime - startTime}ms:`, error.message);
            throw error;
        }
    }
    calculateMetrics(latencies) {
        if (latencies.length === 0) {
            return {
                p50: 0,
                p95: 0,
                p99: 0,
                min: 0,
                max: 0,
                mean: 0,
                count: 0,
                failures: 0
            };
        }
        const sorted = [...latencies].sort((a, b) => a - b);
        const count = sorted.length;
        return {
            p50: sorted[Math.floor(count * 0.5)],
            p95: sorted[Math.floor(count * 0.95)],
            p99: sorted[Math.floor(count * 0.99)],
            min: sorted[0],
            max: sorted[count - 1],
            mean: sorted.reduce((a, b) => a + b, 0) / count,
            count,
            failures: 0
        };
    }
    async testCommonPairs(iterations = 100) {
        const results = [];
        for (const pair of this.commonPairs) {
            console.log(`Testing ${pair.name}...`);
            const latencies = [];
            let failures = 0;
            // Warm up with a few requests
            for (let i = 0; i < 3; i++) {
                try {
                    await this.measureQuoteLatency(pair.sellToken, pair.buyToken, '1000000000000000000' // 1 ETH in wei
                    );
                }
                catch (e) {
                    // Ignore warmup failures
                }
            }
            // Actual test iterations
            for (let i = 0; i < iterations; i++) {
                try {
                    const latency = await this.measureQuoteLatency(pair.sellToken, pair.buyToken, '1000000000000000000');
                    latencies.push(latency);
                    // Progress indicator
                    if ((i + 1) % 10 === 0) {
                        process.stdout.write('.');
                    }
                }
                catch (error) {
                    failures++;
                }
                // Small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            console.log(' Done!');
            const metrics = this.calculateMetrics(latencies);
            metrics.failures = failures;
            results.push({
                tokenPair: pair.name,
                metrics,
                timestamps: latencies
            });
        }
        return results;
    }
    async testConcurrentLoad(concurrentUsers = 100, duration = 30000) {
        console.log(`Testing with ${concurrentUsers} concurrent users for ${duration / 1000} seconds...`);
        const startTime = Date.now();
        const endTime = startTime + duration;
        let totalRequests = 0;
        let successfulRequests = 0;
        let failedRequests = 0;
        const latencies = [];
        // Create concurrent user simulations
        const userPromises = Array.from({ length: concurrentUsers }, async (_, userId) => {
            while (Date.now() < endTime) {
                const pair = this.commonPairs[Math.floor(Math.random() * this.commonPairs.length)];
                try {
                    totalRequests++;
                    const latency = await this.measureQuoteLatency(pair.sellToken, pair.buyToken, Math.floor(Math.random() * 10 + 1) + '000000000000000000' // Random 1-10 ETH
                    );
                    successfulRequests++;
                    latencies.push(latency);
                }
                catch (error) {
                    failedRequests++;
                }
                // Random delay between requests (100-500ms)
                await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 400));
            }
        });
        await Promise.all(userPromises);
        const actualDuration = Date.now() - startTime;
        const avgLatency = latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;
        const maxLatency = latencies.length > 0
            ? Math.max(...latencies)
            : 0;
        return {
            totalRequests,
            successfulRequests,
            failedRequests,
            avgLatency,
            maxLatency,
            requestsPerSecond: (totalRequests / actualDuration) * 1000
        };
    }
    formatMetrics(metrics) {
        return `
    Count: ${metrics.count} requests (${metrics.failures} failures)
    Min: ${metrics.min.toFixed(2)}ms
    Max: ${metrics.max.toFixed(2)}ms
    Mean: ${metrics.mean.toFixed(2)}ms
    P50: ${metrics.p50.toFixed(2)}ms
    P95: ${metrics.p95.toFixed(2)}ms
    P99: ${metrics.p99.toFixed(2)}ms
    Success Rate: ${((metrics.count / (metrics.count + metrics.failures)) * 100).toFixed(2)}%
    `;
    }
    async generateReport() {
        console.log('Starting performance tests...\n');
        // Test common pairs
        console.log('=== Testing Common Token Pairs ===');
        const pairResults = await this.testCommonPairs(50); // 50 iterations per pair
        let report = '# Quote Performance Test Results\n\n';
        report += '## Common Token Pairs Performance\n\n';
        for (const result of pairResults) {
            report += `### ${result.tokenPair}\n`;
            report += this.formatMetrics(result.metrics);
            report += '\n';
            // Check if meets <500ms requirement
            const meetsRequirement = result.metrics.p95 < 500;
            report += `**Meets <500ms requirement:** ${meetsRequirement ? '✅ Yes' : '❌ No'}\n\n`;
        }
        // Test concurrent load
        console.log('\n=== Testing Concurrent Load ===');
        const loadResults = await this.testConcurrentLoad(50, 20000); // 50 users for 20 seconds
        report += '## Concurrent Load Test Results\n\n';
        report += `- Total Requests: ${loadResults.totalRequests}\n`;
        report += `- Successful: ${loadResults.successfulRequests}\n`;
        report += `- Failed: ${loadResults.failedRequests}\n`;
        report += `- Success Rate: ${((loadResults.successfulRequests / loadResults.totalRequests) * 100).toFixed(2)}%\n`;
        report += `- Average Latency: ${loadResults.avgLatency.toFixed(2)}ms\n`;
        report += `- Max Latency: ${loadResults.maxLatency.toFixed(2)}ms\n`;
        report += `- Requests/Second: ${loadResults.requestsPerSecond.toFixed(2)}\n`;
        // Extrapolate to 1000 users
        const estimated1000Users = loadResults.requestsPerSecond * 20; // Assuming 20 req/sec per user
        report += `\n**Estimated capacity for 1000 concurrent users:** ${estimated1000Users.toFixed(0)} req/sec\n`;
        return report;
    }
}
exports.QuotePerformanceTest = QuotePerformanceTest;
// Run tests if executed directly
if (require.main === module) {
    const tester = new QuotePerformanceTest();
    tester.generateReport().then(report => {
        console.log('\n' + report);
        // Save report to file
        require('fs').writeFileSync('performance-report.md', report);
        console.log('\nReport saved to performance-report.md');
    }).catch(error => {
        console.error('Test failed:', error);
        process.exit(1);
    });
}
