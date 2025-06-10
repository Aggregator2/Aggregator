#!/usr/bin/env node

/**
 * Check Stuck Orders - Operational Diagnostic Tool
 * Identifies and analyzes orders that may be stuck in processing
 */

const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL || 'your-supabase-url',
    process.env.SUPABASE_KEY || 'your-supabase-key'
);

class StuckOrderChecker {
    constructor(options = {}) {
        this.hoursAgo = options.hoursAgo || 2;
        this.includeOnChainCheck = options.includeOnChainCheck || false;
        this.verbose = options.verbose || false;
    }

    async checkStuckOrders() {
        console.log('🔍 Analyzing stuck orders...');
        console.log(`⏰ Looking for orders older than ${this.hoursAgo} hours`);
        
        const cutoffTime = new Date(Date.now() - this.hoursAgo * 60 * 60 * 1000).toISOString();
        
        // Get potentially stuck orders
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .in('state', ['PENDING', 'PROCESSING', 'CREATED'])
            .lt('created_at', cutoffTime)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }

        console.log(`📊 Found ${orders.length} potentially stuck orders`);

        // Analyze each order
        const analysis = {
            summary: {
                total: orders.length,
                byState: {},
                byAge: {
                    '2-6h': 0,
                    '6-24h': 0,
                    '1-7d': 0,
                    '7d+': 0
                },
                criticalCount: 0,
                recommendations: []
            },
            orders: []
        };

        for (const order of orders) {
            const orderAnalysis = await this.analyzeOrder(order);
            analysis.orders.push(orderAnalysis);

            // Update summary stats
            const state = order.state;
            analysis.summary.byState[state] = (analysis.summary.byState[state] || 0) + 1;

            // Age classification
            const ageHours = (Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
            if (ageHours < 6) analysis.summary.byAge['2-6h']++;
            else if (ageHours < 24) analysis.summary.byAge['6-24h']++;
            else if (ageHours < 168) analysis.summary.byAge['1-7d']++;
            else analysis.summary.byAge['7d+']++;

            if (orderAnalysis.severity === 'critical') {
                analysis.summary.criticalCount++;
            }
        }

        // Generate recommendations
        analysis.summary.recommendations = this.generateRecommendations(analysis);

        return analysis;
    }

    async analyzeOrder(order) {
        const ageHours = (Date.now() - new Date(order.created_at).getTime()) / (1000 * 60 * 60);
        const ageMinutes = Math.round(ageHours * 60);
        
        let severity = 'normal';
        let issues = [];
        let recommendations = [];
        let onChainStatus = null;

        // Determine severity based on age and state
        if (order.state === 'PENDING' && ageHours > 24) {
            severity = 'critical';
            issues.push('Order pending for >24 hours');
            recommendations.push('Immediate manual intervention required');
        } else if (order.state === 'PENDING' && ageHours > 6) {
            severity = 'warning';
            issues.push('Order pending for >6 hours');
            recommendations.push('Check event listener health');
        } else if (order.state === 'PROCESSING' && ageHours > 2) {
            severity = 'warning';
            issues.push('Order processing for unusually long time');
            recommendations.push('Check blockchain connectivity');
        }

        // Check for missing required fields
        if (!order.block_number && order.state !== 'CREATED') {
            issues.push('Missing block number');
            recommendations.push('May need manual blockchain verification');
        }

        // On-chain verification if requested
        if (this.includeOnChainCheck) {
            try {
                onChainStatus = await this.verifyOnChain(order);
                if (onChainStatus.hasEvent && order.state === 'PENDING') {
                    severity = 'critical';
                    issues.push('On-chain event exists but order still pending');
                    recommendations.push('Emergency state update required');
                }
            } catch (error) {
                issues.push('On-chain verification failed');
            }
        }

        return {
            orderId: order.id,
            state: order.state,
            age: {
                hours: Math.round(ageHours * 100) / 100,
                minutes: ageMinutes,
                humanReadable: this.formatAge(ageHours)
            },
            createdAt: order.created_at,
            updatedAt: order.updated_at,
            severity,
            issues,
            recommendations,
            onChainStatus,
            details: {
                amount: order.amount,
                blockNumber: order.block_number,
                transactionHash: order.transaction_hash,
                notes: order.notes
            }
        };
    }

    async verifyOnChain(order) {
        const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
        
        try {
            // Basic contract setup - adjust based on your contract
            const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
            if (!contractAddress) {
                return { error: 'Contract address not configured' };
            }

            // Simple ABI for event checking
            const abi = [
                "event EscrowReleased(string indexed orderId, uint256 amount)",
                "event EscrowCreated(string indexed orderId, uint256 amount)"
            ];

            const contract = new ethers.Contract(contractAddress, abi, provider);
            
            // Check for release events
            const releaseFilter = contract.filters.EscrowReleased(order.id);
            const releaseEvents = await contract.queryFilter(releaseFilter, order.block_number || 0);
            
            // Check for creation events
            const createFilter = contract.filters.EscrowCreated(order.id);
            const createEvents = await contract.queryFilter(createFilter, order.block_number || 0);

            return {
                hasEvent: releaseEvents.length > 0 || createEvents.length > 0,
                releaseEvents: releaseEvents.length,
                createEvents: createEvents.length,
                latestBlock: await provider.getBlockNumber()
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    formatAge(hours) {
        if (hours < 1) return `${Math.round(hours * 60)} minutes`;
        if (hours < 24) return `${Math.round(hours * 10) / 10} hours`;
        if (hours < 168) return `${Math.round(hours / 24 * 10) / 10} days`;
        return `${Math.round(hours / 168 * 10) / 10} weeks`;
    }

    generateRecommendations(analysis) {
        const recommendations = [];
        
        if (analysis.summary.criticalCount > 0) {
            recommendations.push({
                priority: 'IMMEDIATE',
                action: `${analysis.summary.criticalCount} orders require immediate attention`,
                command: `node scripts/emergency-order-fix.js bulk-fix ${this.hoursAgo} SETTLED "stuck_order_resolution"`
            });
        }

        if (analysis.summary.byState.PENDING > 5) {
            recommendations.push({
                priority: 'HIGH',
                action: 'Multiple pending orders detected',
                command: 'pm2 restart listener && node scripts/system-health-check.js events'
            });
        }

        if (analysis.summary.byAge['7d+'] > 0) {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Very old orders detected',
                command: 'node scripts/emergency-order-fix.js check-stuck 168'
            });
        }

        return recommendations;
    }

    printReport(analysis) {
        console.log('\n📊 STUCK ORDERS ANALYSIS REPORT');
        console.log('================================');
        
        // Summary
        console.log(`\n📋 SUMMARY:`);
        console.log(`   Total stuck orders: ${analysis.summary.total}`);
        console.log(`   Critical issues: ${analysis.summary.criticalCount}`);
        
        console.log(`\n📈 BY STATE:`);
        Object.entries(analysis.summary.byState).forEach(([state, count]) => {
            const emoji = state === 'PENDING' ? '⏳' : state === 'PROCESSING' ? '⚙️' : '📝';
            console.log(`   ${emoji} ${state}: ${count}`);
        });

        console.log(`\n⏰ BY AGE:`);
        Object.entries(analysis.summary.byAge).forEach(([age, count]) => {
            if (count > 0) {
                const emoji = age === '7d+' ? '🚨' : age === '1-7d' ? '⚠️' : '📅';
                console.log(`   ${emoji} ${age}: ${count}`);
            }
        });

        // Critical orders details
        const criticalOrders = analysis.orders.filter(o => o.severity === 'critical');
        if (criticalOrders.length > 0) {
            console.log(`\n🚨 CRITICAL ORDERS (${criticalOrders.length}):`);
            criticalOrders.forEach(order => {
                console.log(`   📝 ${order.orderId}: ${order.state} (${order.age.humanReadable})`);
                order.issues.forEach(issue => console.log(`      ⚠️  ${issue}`));
                if (this.verbose) {
                    order.recommendations.forEach(rec => console.log(`      💡 ${rec}`));
                }
            });
        }

        // Recommendations
        if (analysis.summary.recommendations.length > 0) {
            console.log(`\n💡 RECOMMENDED ACTIONS:`);
            analysis.summary.recommendations.forEach(rec => {
                const emoji = rec.priority === 'IMMEDIATE' ? '🚨' : rec.priority === 'HIGH' ? '🔴' : '🟡';
                console.log(`   ${emoji} ${rec.priority}: ${rec.action}`);
                if (rec.command) {
                    console.log(`      💻 Command: ${rec.command}`);
                }
            });
        }

        // All orders if verbose
        if (this.verbose && analysis.orders.length > 0) {
            console.log(`\n📋 ALL ORDERS:`);
            analysis.orders.forEach(order => {
                const emoji = order.severity === 'critical' ? '🚨' : order.severity === 'warning' ? '⚠️' : '✅';
                console.log(`   ${emoji} ${order.orderId}: ${order.state} (${order.age.humanReadable})`);
                if (order.issues.length > 0) {
                    order.issues.forEach(issue => console.log(`      - ${issue}`));
                }
            });
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const options = {
        hoursAgo: 2,
        includeOnChainCheck: false,
        verbose: false
    };

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--hours':
                options.hoursAgo = parseInt(args[i + 1]) || 2;
                i++;
                break;
            case '--on-chain':
                options.includeOnChainCheck = true;
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--help':
            case '-h':
                console.log('Meta Aggregator 2.0 - Stuck Orders Checker');
                console.log('');
                console.log('USAGE: node check-stuck-orders.js [options]');
                console.log('');
                console.log('OPTIONS:');
                console.log('  --hours <number>    Hours ago to check from (default: 2)');
                console.log('  --on-chain         Include on-chain verification');
                console.log('  --verbose, -v      Show detailed information');
                console.log('  --help, -h         Show this help');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node check-stuck-orders.js --hours 6');
                console.log('  node check-stuck-orders.js --on-chain --verbose');
                console.log('  node check-stuck-orders.js --hours 24 --on-chain');
                return;
        }
    }

    try {
        const checker = new StuckOrderChecker(options);
        const analysis = await checker.checkStuckOrders();
        checker.printReport(analysis);

        // Exit with appropriate code
        if (analysis.summary.criticalCount > 0) {
            process.exit(2); // Critical issues
        } else if (analysis.summary.total > 10) {
            process.exit(1); // Warning level
        } else {
            process.exit(0); // All good
        }
    } catch (error) {
        console.error('❌ Error checking stuck orders:', error.message);
        process.exit(3);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = StuckOrderChecker;
