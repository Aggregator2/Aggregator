#!/usr/bin/env node

/**
 * Check Recent Events - Blockchain Event Diagnostic Tool
 * Verifies recent blockchain events and compares with database state
 */

const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL || 'your-supabase-url',
    process.env.SUPABASE_KEY || 'your-supabase-key'
);

class EventChecker {
    constructor(options = {}) {
        this.contractType = options.contract || 'escrow';
        this.hoursAgo = options.hours || 1;
        this.verbose = options.verbose || false;
        this.includeComparison = options.includeComparison || false;
    }

    async getProvider() {
        const rpcUrl = process.env.RPC_URL;
        if (!rpcUrl) {
            throw new Error('RPC_URL environment variable not set');
        }
        return new ethers.JsonRpcProvider(rpcUrl);
    }

    async getContract() {
        const provider = await this.getProvider();
        const contractAddress = process.env.ESCROW_CONTRACT_ADDRESS;
        
        if (!contractAddress) {
            throw new Error('ESCROW_CONTRACT_ADDRESS environment variable not set');
        }

        // Basic contract ABI for common events
        const abi = [
            "event EscrowCreated(string indexed orderId, uint256 amount, address indexed buyer, address indexed seller)",
            "event EscrowReleased(string indexed orderId, uint256 amount)",
            "event EscrowRefunded(string indexed orderId, uint256 amount)",
            "event EscrowCancelled(string indexed orderId)",
            // Add other events as needed
        ];

        return new ethers.Contract(contractAddress, abi, provider);
    }

    async checkRecentEvents() {
        console.log(`🔍 Checking recent ${this.contractType} events...`);
        console.log(`⏰ Looking back ${this.hoursAgo} hours`);

        const contract = await this.getContract();
        const provider = await this.getProvider();
        
        // Calculate block range
        const currentBlock = await provider.getBlockNumber();
        const avgBlockTime = 2; // seconds (adjust for your network)
        const blocksAgo = Math.floor((this.hoursAgo * 3600) / avgBlockTime);
        const fromBlock = Math.max(0, currentBlock - blocksAgo);

        console.log(`📊 Scanning blocks ${fromBlock} to ${currentBlock} (${blocksAgo} blocks)`);

        const results = {
            timeRange: {
                hours: this.hoursAgo,
                fromBlock,
                toBlock: currentBlock,
                totalBlocks: blocksAgo
            },
            events: {
                EscrowCreated: [],
                EscrowReleased: [],
                EscrowRefunded: [],
                EscrowCancelled: []
            },
            summary: {
                totalEvents: 0,
                eventTypeCounts: {},
                uniqueOrders: new Set(),
                timeDistribution: {}
            },
            issues: [],
            databaseComparison: null
        };

        // Get all events by type
        const eventTypes = ['EscrowCreated', 'EscrowReleased', 'EscrowRefunded', 'EscrowCancelled'];
        
        for (const eventType of eventTypes) {
            try {
                console.log(`🔍 Fetching ${eventType} events...`);
                
                const filter = contract.filters[eventType]();
                const events = await contract.queryFilter(filter, fromBlock, currentBlock);
                
                const processedEvents = await this.processEvents(events, eventType);
                results.events[eventType] = processedEvents;
                results.summary.totalEvents += events.length;
                results.summary.eventTypeCounts[eventType] = events.length;
                
                // Track unique orders
                events.forEach(event => {
                    if (event.args && event.args.orderId) {
                        results.summary.uniqueOrders.add(event.args.orderId);
                    }
                });

                console.log(`   Found ${events.length} ${eventType} events`);
                
            } catch (error) {
                console.log(`⚠️  Error fetching ${eventType} events: ${error.message}`);
                results.issues.push({
                    type: 'event_fetch_error',
                    eventType,
                    error: error.message
                });
            }
        }

        results.summary.uniqueOrders = results.summary.uniqueOrders.size;

        // Database comparison if requested
        if (this.includeComparison) {
            results.databaseComparison = await this.compareWithDatabase(results);
        }

        return results;
    }

    async processEvents(events, eventType) {
        const processed = [];

        for (const event of events) {
            try {
                const block = await event.getBlock();
                const receipt = await event.getTransactionReceipt();
                
                const processedEvent = {
                    orderId: event.args.orderId,
                    amount: event.args.amount?.toString(),
                    blockNumber: event.blockNumber,
                    transactionHash: event.transactionHash,
                    timestamp: new Date(block.timestamp * 1000).toISOString(),
                    gasUsed: receipt.gasUsed.toString(),
                    eventType,
                    logIndex: event.logIndex
                };

                // Add event-specific data
                if (event.args.buyer) processedEvent.buyer = event.args.buyer;
                if (event.args.seller) processedEvent.seller = event.args.seller;

                processed.push(processedEvent);
            } catch (error) {
                console.log(`⚠️  Error processing event ${event.transactionHash}: ${error.message}`);
            }
        }

        return processed.sort((a, b) => b.blockNumber - a.blockNumber);
    }

    async compareWithDatabase(eventResults) {
        console.log('🔄 Comparing events with database state...');
        
        const comparison = {
            matchedOrders: 0,
            mismatchedOrders: 0,
            missingInDatabase: [],
            missingOnChain: [],
            stateDiscrepancies: []
        };

        try {
            // Get database orders from the same time period
            const timeAgo = new Date(Date.now() - this.hoursAgo * 60 * 60 * 1000).toISOString();
            const { data: dbOrders, error } = await supabase
                .from('orders')
                .select('*')
                .gte('created_at', timeAgo);

            if (error) {
                throw new Error(`Database query failed: ${error.message}`);
            }

            // Create maps for comparison
            const chainOrders = new Map();
            Object.values(eventResults.events).flat().forEach(event => {
                if (event.orderId) {
                    chainOrders.set(event.orderId, event);
                }
            });

            const dbOrderMap = new Map();
            dbOrders.forEach(order => {
                dbOrderMap.set(order.id, order);
            });

            // Find orders in database but not on chain
            dbOrders.forEach(dbOrder => {
                if (!chainOrders.has(dbOrder.id)) {
                    comparison.missingOnChain.push({
                        orderId: dbOrder.id,
                        dbState: dbOrder.state,
                        createdAt: dbOrder.created_at
                    });
                    comparison.mismatchedOrders++;
                }
            });

            // Find orders on chain but not in database
            chainOrders.forEach((chainEvent, orderId) => {
                if (!dbOrderMap.has(orderId)) {
                    comparison.missingInDatabase.push({
                        orderId,
                        eventType: chainEvent.eventType,
                        blockNumber: chainEvent.blockNumber,
                        timestamp: chainEvent.timestamp
                    });
                    comparison.mismatchedOrders++;
                } else {
                    // Check for state discrepancies
                    const dbOrder = dbOrderMap.get(orderId);
                    const expectedState = this.getExpectedState(chainEvent.eventType);
                    
                    if (dbOrder.state !== expectedState) {
                        comparison.stateDiscrepancies.push({
                            orderId,
                            dbState: dbOrder.state,
                            expectedState,
                            chainEventType: chainEvent.eventType
                        });
                    } else {
                        comparison.matchedOrders++;
                    }
                }
            });

            console.log(`📊 Database comparison: ${comparison.matchedOrders} matched, ${comparison.mismatchedOrders} mismatched`);

        } catch (error) {
            console.log(`⚠️  Database comparison failed: ${error.message}`);
            comparison.error = error.message;
        }

        return comparison;
    }

    getExpectedState(eventType) {
        const stateMapping = {
            'EscrowCreated': 'PENDING',
            'EscrowReleased': 'SETTLED',
            'EscrowRefunded': 'REFUNDED',
            'EscrowCancelled': 'CANCELLED'
        };
        return stateMapping[eventType] || 'UNKNOWN';
    }

    printReport(results) {
        console.log('\n📊 RECENT EVENTS ANALYSIS');
        console.log('========================');

        // Summary
        console.log(`\n📋 SUMMARY:`);
        console.log(`   Time range: Last ${results.timeRange.hours} hours`);
        console.log(`   Blocks scanned: ${results.timeRange.fromBlock} - ${results.timeRange.toBlock}`);
        console.log(`   Total events: ${results.summary.totalEvents}`);
        console.log(`   Unique orders: ${results.summary.uniqueOrders}`);

        // Event counts by type
        console.log(`\n📈 EVENTS BY TYPE:`);
        Object.entries(results.summary.eventTypeCounts).forEach(([type, count]) => {
            if (count > 0) {
                const emoji = type.includes('Created') ? '🆕' : 
                             type.includes('Released') ? '✅' : 
                             type.includes('Refunded') ? '↩️' : '❌';
                console.log(`   ${emoji} ${type}: ${count}`);
            }
        });

        // Recent events details
        if (this.verbose && results.summary.totalEvents > 0) {
            console.log(`\n📋 RECENT EVENTS (Last 10):`);
            const allEvents = Object.values(results.events).flat()
                .sort((a, b) => b.blockNumber - a.blockNumber)
                .slice(0, 10);

            allEvents.forEach(event => {
                const emoji = event.eventType.includes('Created') ? '🆕' : 
                             event.eventType.includes('Released') ? '✅' : 
                             event.eventType.includes('Refunded') ? '↩️' : '❌';
                console.log(`   ${emoji} ${event.orderId}: ${event.eventType} (Block: ${event.blockNumber})`);
                console.log(`      Time: ${event.timestamp}`);
                console.log(`      Tx: ${event.transactionHash}`);
                if (event.amount) console.log(`      Amount: ${event.amount}`);
            });
        }

        // Issues
        if (results.issues.length > 0) {
            console.log(`\n⚠️  ISSUES DETECTED:`);
            results.issues.forEach(issue => {
                console.log(`   ❌ ${issue.type}: ${issue.error}`);
            });
        }

        // Database comparison
        if (results.databaseComparison && !results.databaseComparison.error) {
            const comp = results.databaseComparison;
            console.log(`\n🔄 DATABASE COMPARISON:`);
            console.log(`   ✅ Matched orders: ${comp.matchedOrders}`);
            console.log(`   ❌ Mismatched orders: ${comp.mismatchedOrders}`);

            if (comp.missingInDatabase.length > 0) {
                console.log(`   🚨 Missing in database: ${comp.missingInDatabase.length}`);
                if (this.verbose) {
                    comp.missingInDatabase.slice(0, 5).forEach(order => {
                        console.log(`      - ${order.orderId} (${order.eventType})`);
                    });
                }
            }

            if (comp.missingOnChain.length > 0) {
                console.log(`   🚨 Missing on chain: ${comp.missingOnChain.length}`);
                if (this.verbose) {
                    comp.missingOnChain.slice(0, 5).forEach(order => {
                        console.log(`      - ${order.orderId} (DB state: ${order.dbState})`);
                    });
                }
            }

            if (comp.stateDiscrepancies.length > 0) {
                console.log(`   ⚠️  State discrepancies: ${comp.stateDiscrepancies.length}`);
                if (this.verbose) {
                    comp.stateDiscrepancies.slice(0, 5).forEach(order => {
                        console.log(`      - ${order.orderId}: DB=${order.dbState}, Expected=${order.expectedState}`);
                    });
                }
            }
        }

        // Recommendations
        console.log(`\n💡 RECOMMENDATIONS:`);
        if (results.summary.totalEvents === 0) {
            console.log(`   🔍 No events found - check if contract is active`);
            console.log(`   💻 Command: node scripts/test-all-connections.js`);
        } else if (results.databaseComparison && results.databaseComparison.mismatchedOrders > 0) {
            console.log(`   🚨 Database sync issues detected`);
            console.log(`   💻 Command: node scripts/emergency-order-fix.js check-stuck ${this.hoursAgo}`);
        } else {
            console.log(`   ✅ Event flow appears healthy`);
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const options = {
        contract: 'escrow',
        hours: 1,
        verbose: false,
        includeComparison: false
    };

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--contract':
                options.contract = args[i + 1] || 'escrow';
                i++;
                break;
            case '--hours':
                options.hours = parseInt(args[i + 1]) || 1;
                i++;
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--compare':
            case '-c':
                options.includeComparison = true;
                break;
            case '--help':
            case '-h':
                console.log('Meta Aggregator 2.0 - Recent Events Checker');
                console.log('');
                console.log('USAGE: node check-recent-events.js [options]');
                console.log('');
                console.log('OPTIONS:');
                console.log('  --contract <name>       Contract type to check (default: escrow)');
                console.log('  --hours <number>        Hours to look back (default: 1)');
                console.log('  --verbose, -v           Show detailed event information');
                console.log('  --compare, -c           Compare with database state');
                console.log('  --help, -h              Show this help');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node check-recent-events.js --hours 6');
                console.log('  node check-recent-events.js --contract escrow --verbose');
                console.log('  node check-recent-events.js --hours 24 --compare');
                return;
        }
    }

    try {
        const checker = new EventChecker(options);
        const results = await checker.checkRecentEvents();
        checker.printReport(results);

        // Exit codes
        if (results.issues.length > 0) {
            process.exit(2); // Issues detected
        } else if (results.databaseComparison && results.databaseComparison.mismatchedOrders > 0) {
            process.exit(1); // Database sync issues
        } else {
            process.exit(0); // All good
        }

    } catch (error) {
        console.error('❌ Event checking failed:', error.message);
        process.exit(3);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = EventChecker;
