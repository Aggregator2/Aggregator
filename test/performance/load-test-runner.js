/**
 * @fileoverview Load Test Runner Script
 * @author SwappiQ Protocol
 * @description Executable script to run database load tests with various scenarios
 */

const { DatabaseLoadTestFramework } = require('./DatabaseLoadTestFramework');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .option('scenario', {
        alias: 's',
        describe: 'Test scenario to run',
        choices: ['all', 'orderPlacement', 'orderMatching', 'settlement', 'queries', 'connectionExhaustion', 'mixed'],
        default: 'all'
    })
    .option('duration', {
        alias: 'd',
        describe: 'Test duration in seconds',
        type: 'number',
        default: 60
    })
    .option('rate', {
        alias: 'r',
        describe: 'Target operations per second',
        type: 'number',
        default: 10000
    })
    .option('connections', {
        alias: 'c',
        describe: 'Max database connections',
        type: 'number',
        default: 100
    })
    .option('verbose', {
        alias: 'v',
        describe: 'Verbose output',
        type: 'boolean',
        default: false
    })
    .option('save', {
        describe: 'Save results to file',
        type: 'boolean',
        default: true
    })
    .help()
    .argv;

// Load test configuration
const config = {
    database: {
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT) || 5432,
        database: process.env.TEST_DB_NAME || 'swappiq_test',
        user: process.env.TEST_DB_USER || 'swappiq_test',
        password: process.env.TEST_DB_PASSWORD || 'test_password',
        max: argv.connections,
        min: Math.floor(argv.connections / 5),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    },
    loadTest: {
        warmupDuration: 10000,
        testDuration: argv.duration * 1000,
        cooldownDuration: 10000,
        orderPlacementRate: argv.rate,
        orderMatchingRate: Math.floor(argv.rate / 2),
        settlementRate: Math.floor(argv.rate / 10),
        queryRate: argv.rate * 2,
        maxConcurrentOrders: 1000,
        maxConcurrentQueries: 2000,
        maxConcurrentSettlements: 100
    },
    monitoring: {
        metricsInterval: 1000,
        detailedMetrics: true,
        realTimeUpdates: true,
        saveResults: argv.save,
        resultsPath: './test-results'
    },
    thresholds: {
        maxLatency: 100,
        p95Latency: 50,
        p99Latency: 80,
        errorRate: 0.01,
        minThroughput: argv.rate * 0.8
    },
    verbose: argv.verbose
};

// ASCII Art Banner
function printBanner() {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   SwappiQ Protocol - Database Load Testing Framework          ║
║                                                               ║
║   Testing high-performance trading infrastructure             ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `));
}

// Progress bar for test phases
function createProgressBar(phase, duration) {
    return ora({
        text: `${phase} phase (${duration / 1000}s)`,
        spinner: 'dots',
        color: 'cyan'
    });
}

// Real-time metrics display
function displayMetrics(metrics) {
    console.clear();
    printBanner();
    
    const table = new Table({
        head: ['Metric', 'Value'],
        colWidths: [30, 40],
        style: {
            head: ['cyan']
        }
    });
    
    // Connection pool metrics
    table.push(
        [chalk.yellow('Connection Pool'), ''],
        ['  Active', metrics.connectionPool.active],
        ['  Idle', metrics.connectionPool.idle],
        ['  Waiting', metrics.connectionPool.waiting],
        ['  Total', metrics.connectionPool.total]
    );
    
    // Throughput metrics
    if (metrics.throughput) {
        table.push([chalk.yellow('Throughput (ops/sec)'), '']);
        for (const [op, rate] of Object.entries(metrics.throughput)) {
            table.push([`  ${op}`, Math.round(rate)]);
        }
    }
    
    // Operation counts
    if (metrics.operations) {
        table.push([chalk.yellow('Operations'), '']);
        for (const [op, stats] of Object.entries(metrics.operations)) {
            if (stats.success !== undefined) {
                const total = stats.success + (stats.failure || 0);
                const errorRate = total > 0 ? ((stats.failure || 0) / total * 100).toFixed(2) : 0;
                table.push([
                    `  ${op}`,
                    `Success: ${stats.success}, Errors: ${stats.failure || 0} (${errorRate}%)`
                ]);
            }
        }
    }
    
    console.log(table.toString());
}

// Display final results
function displayResults(results) {
    console.clear();
    printBanner();
    
    console.log(chalk.green('\n📊 Load Test Results\n'));
    
    // Summary table
    const summaryTable = new Table({
        head: ['Metric', 'Value'],
        colWidths: [40, 30],
        style: { head: ['green'] }
    });
    
    summaryTable.push(
        ['Total Duration', `${(results.summary.totalDuration / 1000).toFixed(2)}s`],
        ['Total Operations', results.summary.totalOperations.toLocaleString()],
        ['Successful Operations', results.summary.successfulOperations.toLocaleString()],
        ['Failed Operations', results.summary.failedOperations.toLocaleString()],
        ['Overall Error Rate', `${(results.summary.overallErrorRate * 100).toFixed(2)}%`],
        ['Average Throughput', `${Math.round(results.summary.avgThroughput)} ops/sec`],
        ['Average Latency', `${results.summary.avgLatency.toFixed(2)}ms`],
        ['P95 Latency', `${results.summary.p95Latency.toFixed(2)}ms`],
        ['P99 Latency', `${results.summary.p99Latency.toFixed(2)}ms`]
    );
    
    console.log(summaryTable.toString());
    
    // Operation details
    console.log(chalk.green('\n📈 Operation Details\n'));
    
    const detailsTable = new Table({
        head: ['Operation', 'Count', 'Error Rate', 'Avg Latency', 'P95', 'P99', 'Throughput'],
        colWidths: [20, 12, 12, 12, 10, 10, 15],
        style: { head: ['green'] }
    });
    
    for (const [op, stats] of Object.entries(results.details)) {
        detailsTable.push([
            op,
            stats.count.toLocaleString(),
            `${(stats.errorRate * 100).toFixed(2)}%`,
            `${stats.avgLatency.toFixed(2)}ms`,
            `${stats.p95Latency.toFixed(2)}ms`,
            `${stats.p99Latency.toFixed(2)}ms`,
            `${Math.round(stats.throughput)} ops/s`
        ]);
    }
    
    console.log(detailsTable.toString());
    
    // Bottlenecks
    if (results.bottlenecks.length > 0) {
        console.log(chalk.red('\n⚠️  Bottlenecks Detected\n'));
        
        const bottleneckTable = new Table({
            head: ['Type', 'Severity', 'Details'],
            colWidths: [30, 15, 55],
            style: { head: ['red'] }
        });
        
        for (const bottleneck of results.bottlenecks) {
            const severity = bottleneck.severity === 'CRITICAL' 
                ? chalk.red(bottleneck.severity)
                : bottleneck.severity === 'HIGH'
                ? chalk.yellow(bottleneck.severity)
                : chalk.white(bottleneck.severity);
            
            bottleneckTable.push([
                bottleneck.type,
                severity,
                JSON.stringify(bottleneck.details, null, 2)
            ]);
        }
        
        console.log(bottleneckTable.toString());
    }
    
    // Recommendations
    if (results.recommendations.length > 0) {
        console.log(chalk.blue('\n💡 Recommendations\n'));
        
        for (const rec of results.recommendations) {
            const priority = rec.priority === 'CRITICAL'
                ? chalk.red(`[${rec.priority}]`)
                : rec.priority === 'HIGH'
                ? chalk.yellow(`[${rec.priority}]`)
                : chalk.white(`[${rec.priority}]`);
            
            console.log(`${priority} ${chalk.bold(rec.recommendation)}`);
            if (Array.isArray(rec.details)) {
                rec.details.forEach(detail => {
                    console.log(`  • ${detail}`);
                });
            } else {
                console.log(`  ${JSON.stringify(rec.details, null, 2)}`);
            }
            console.log();
        }
    }
}

// Main execution
async function main() {
    printBanner();
    
    console.log(chalk.blue('\n🚀 Starting Database Load Test\n'));
    console.log(chalk.gray(`Scenario: ${argv.scenario}`));
    console.log(chalk.gray(`Duration: ${argv.duration}s`));
    console.log(chalk.gray(`Target Rate: ${argv.rate} ops/sec`));
    console.log(chalk.gray(`Max Connections: ${argv.connections}`));
    console.log();
    
    const framework = new DatabaseLoadTestFramework(config);
    
    try {
        // Initialize framework
        const initSpinner = ora('Initializing load test framework...').start();
        await framework.initialize();
        initSpinner.succeed('Framework initialized');
        
        // Set up real-time metrics display
        if (config.monitoring.realTimeUpdates) {
            framework.on('metrics', (metrics) => {
                displayMetrics(metrics);
            });
        }
        
        // Handle test phases
        framework.on('phaseStart', (phase) => {
            console.log(chalk.cyan(`\n▶️  Starting ${phase} phase`));
        });
        
        framework.on('phaseEnd', (phase) => {
            console.log(chalk.green(`✓ ${phase} phase completed`));
        });
        
        // Determine scenarios to run
        let scenarios = null;
        if (argv.scenario !== 'all') {
            scenarios = [argv.scenario];
        }
        
        // Run load test
        console.log(chalk.blue('\n📊 Running load test...\n'));
        const results = await framework.runLoadTest(scenarios);
        
        // Display results
        displayResults(results);
        
        // Check if test passed thresholds
        const passed = results.summary.overallErrorRate <= config.thresholds.errorRate &&
                      results.summary.p95Latency <= config.thresholds.p95Latency &&
                      results.summary.avgThroughput >= config.thresholds.minThroughput;
        
        if (passed) {
            console.log(chalk.green('\n✅ Load test PASSED all thresholds!\n'));
        } else {
            console.log(chalk.red('\n❌ Load test FAILED to meet thresholds!\n'));
        }
        
        // Cleanup
        await framework.cleanup();
        
        process.exit(passed ? 0 : 1);
        
    } catch (error) {
        console.error(chalk.red('\n❌ Load test failed:'), error);
        await framework.cleanup();
        process.exit(1);
    }
}

// Error handling
process.on('unhandledRejection', (error) => {
    console.error(chalk.red('\n❌ Unhandled error:'), error);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log(chalk.yellow('\n\n⚠️  Interrupted by user'));
    process.exit(1);
});

// Run the load test
main();