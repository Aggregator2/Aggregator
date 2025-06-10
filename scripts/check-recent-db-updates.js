#!/usr/bin/env node

/**
 * Check Recent Database Updates - Database Activity Monitor
 * Verifies recent database activity and order state changes
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL || 'your-supabase-url',
    process.env.SUPABASE_KEY || 'your-supabase-key'
);

class DatabaseUpdateChecker {
    constructor(options = {}) {
        this.minutesAgo = options.minutes || 30;
        this.verbose = options.verbose || false;
        this.includeDetails = options.includeDetails || false;
    }

    async checkRecentUpdates() {
        console.log('🔍 Checking recent database updates...');
        console.log(`⏰ Looking back ${this.minutesAgo} minutes`);

        const cutoffTime = new Date(Date.now() - this.minutesAgo * 60 * 1000).toISOString();
        
        const results = {
            timeRange: {
                minutes: this.minutesAgo,
                cutoffTime,
                checkTime: new Date().toISOString()
            },
            updates: {
                recent: [],
                byState: {},
                byAction: {}
            },
            summary: {
                totalUpdates: 0,
                newOrders: 0,
                stateChanges: 0,
                emergencyFixes: 0
            },
            analysis: {
                activityLevel: 'unknown',
                issues: [],
                recommendations: []
            }
        };

        try {
            // Get recently created orders
            const { data: newOrders, error: newError } = await supabase
                .from('orders')
                .select('*')
                .gte('created_at', cutoffTime)
                .order('created_at', { ascending: false });

            if (newError) throw new Error(`New orders query failed: ${newError.message}`);

            // Get recently updated orders
            const { data: updatedOrders, error: updateError } = await supabase
                .from('orders')
                .select('*')
                .gte('updated_at', cutoffTime)
                .neq('created_at', supabase.raw('updated_at')) // Only orders that were actually updated
                .order('updated_at', { ascending: false });

            if (updateError) throw new Error(`Updated orders query failed: ${updateError.message}`);

            // Process new orders
            results.summary.newOrders = newOrders.length;
            results.updates.recent.push(...newOrders.map(order => ({
                type: 'new_order',
                orderId: order.id,
                state: order.state,
                amount: order.amount,
                timestamp: order.created_at,
                details: order
            })));

            // Process updated orders
            results.summary.stateChanges = updatedOrders.length;
            results.updates.recent.push(...updatedOrders.map(order => ({
                type: 'state_change',
                orderId: order.id,
                state: order.state,
                amount: order.amount,
                timestamp: order.updated_at,
                isEmergencyFix: order.emergency_fix_applied || false,
                notes: order.notes,
                details: order
            })));

            // Count emergency fixes
            results.summary.emergencyFixes = results.updates.recent.filter(
                update => update.isEmergencyFix
            ).length;

            // Sort all updates by timestamp
            results.updates.recent.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
            );

            results.summary.totalUpdates = results.updates.recent.length;

            // Analyze by state
            results.updates.recent.forEach(update => {
                const state = update.state;
                results.updates.byState[state] = (results.updates.byState[state] || 0) + 1;
                
                const action = update.type;
                results.updates.byAction[action] = (results.updates.byAction[action] || 0) + 1;
            });

            // Activity analysis
            await this.analyzeActivity(results);

        } catch (error) {
            results.analysis.issues.push({
                type: 'database_error',
                message: error.message,
                severity: 'critical'
            });
        }

        return results;
    }

    async analyzeActivity(results) {
        const { totalUpdates, newOrders, stateChanges, emergencyFixes } = results.summary;
        const { minutes } = results.timeRange;

        // Determine activity level
        const updatesPerMinute = totalUpdates / minutes;
        
        if (updatesPerMinute > 2) {
            results.analysis.activityLevel = 'high';
        } else if (updatesPerMinute > 0.5) {
            results.analysis.activityLevel = 'normal';
        } else if (totalUpdates > 0) {
            results.analysis.activityLevel = 'low';
        } else {
            results.analysis.activityLevel = 'none';
        }

        // Check for issues
        if (emergencyFixes > 0) {
            results.analysis.issues.push({
                type: 'emergency_fixes_detected',
                message: `${emergencyFixes} emergency fixes applied in the last ${minutes} minutes`,
                severity: 'warning',
                count: emergencyFixes
            });
        }

        if (totalUpdates === 0) {
            results.analysis.issues.push({
                type: 'no_activity',
                message: `No database activity in the last ${minutes} minutes`,
                severity: 'info'
            });
        }

        // Check for unusual patterns
        const pendingRatio = (results.updates.byState.PENDING || 0) / Math.max(totalUpdates, 1);
        if (pendingRatio > 0.8 && totalUpdates > 5) {
            results.analysis.issues.push({
                type: 'high_pending_ratio',
                message: `${Math.round(pendingRatio * 100)}% of recent updates are PENDING orders`,
                severity: 'warning'
            });
        }

        // Generate recommendations
        this.generateRecommendations(results);
    }

    generateRecommendations(results) {
        const recommendations = [];
        const { totalUpdates, emergencyFixes } = results.summary;
        const { activityLevel, issues } = results.analysis;

        if (emergencyFixes > 0) {
            recommendations.push({
                priority: 'HIGH',
                action: 'Review emergency fixes',
                reason: `${emergencyFixes} emergency fixes detected`,
                command: 'node scripts/emergency-order-fix.js report'
            });
        }

        if (activityLevel === 'none') {
            recommendations.push({
                priority: 'MEDIUM',
                action: 'Check system health',
                reason: 'No recent database activity detected',
                command: 'node scripts/system-health-check.js full'
            });
        }

        if (activityLevel === 'high') {
            recommendations.push({
                priority: 'INFO',
                action: 'Monitor system performance',
                reason: 'High database activity detected',
                command: 'node scripts/check-stuck-orders.js --hours 1'
            });
        }

        const criticalIssues = issues.filter(issue => issue.severity === 'critical');
        if (criticalIssues.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                action: 'Address critical database issues',
                reason: `${criticalIssues.length} critical issues detected`,
                command: 'node scripts/test-all-connections.js'
            });
        }

        results.analysis.recommendations = recommendations;
    }

    async checkOrderStateFlow() {
        console.log('📊 Analyzing order state flow...');
        
        const cutoffTime = new Date(Date.now() - this.minutesAgo * 60 * 1000).toISOString();
        
        try {
            // Get state distribution for recent orders
            const { data: stateFlow, error } = await supabase
                .from('orders')
                .select('state, created_at, updated_at')
                .gte('created_at', cutoffTime);

            if (error) throw new Error(`State flow query failed: ${error.message}`);

            const flow = {
                states: {},
                transitions: {},
                avgProcessingTime: null
            };

            stateFlow.forEach(order => {
                flow.states[order.state] = (flow.states[order.state] || 0) + 1;
                
                // Calculate processing time for settled orders
                if (order.state === 'SETTLED' && order.updated_at !== order.created_at) {
                    const processingTime = new Date(order.updated_at) - new Date(order.created_at);
                    flow.transitions[order.state] = flow.transitions[order.state] || [];
                    flow.transitions[order.state].push(processingTime / 1000 / 60); // minutes
                }
            });

            // Calculate average processing time
            if (flow.transitions.SETTLED && flow.transitions.SETTLED.length > 0) {
                const times = flow.transitions.SETTLED;
                flow.avgProcessingTime = times.reduce((a, b) => a + b, 0) / times.length;
            }

            return flow;
        } catch (error) {
            return { error: error.message };
        }
    }

    async printReport(results) {
        console.log('\n📊 DATABASE ACTIVITY REPORT');
        console.log('===========================');

        // Summary
        console.log(`\n📋 SUMMARY (Last ${results.timeRange.minutes} minutes):`);
        console.log(`   Total updates: ${results.summary.totalUpdates}`);
        console.log(`   New orders: ${results.summary.newOrders}`);
        console.log(`   State changes: ${results.summary.stateChanges}`);
        console.log(`   Emergency fixes: ${results.summary.emergencyFixes}`);
        console.log(`   Activity level: ${results.analysis.activityLevel.toUpperCase()}`);

        // State distribution
        if (Object.keys(results.updates.byState).length > 0) {
            console.log(`\n📈 UPDATES BY STATE:`);
            Object.entries(results.updates.byState)
                .sort(([,a], [,b]) => b - a)
                .forEach(([state, count]) => {
                    const emoji = state === 'PENDING' ? '⏳' : 
                                 state === 'SETTLED' ? '✅' : 
                                 state === 'CANCELLED' ? '❌' : '📝';
                    console.log(`   ${emoji} ${state}: ${count}`);
                });
        }

        // Recent updates details
        if (this.verbose && results.updates.recent.length > 0) {
            console.log(`\n📋 RECENT UPDATES (Last 10):`);
            results.updates.recent.slice(0, 10).forEach(update => {
                const emoji = update.type === 'new_order' ? '🆕' : '🔄';
                const fixFlag = update.isEmergencyFix ? ' 🚨' : '';
                console.log(`   ${emoji} ${update.orderId}: ${update.state}${fixFlag}`);
                console.log(`      Time: ${update.timestamp}`);
                if (update.amount) console.log(`      Amount: ${update.amount}`);
                if (update.notes && this.includeDetails) {
                    console.log(`      Notes: ${update.notes.substring(0, 100)}...`);
                }
            });
        }

        // Order state flow
        if (this.includeDetails) {
            const stateFlow = await this.checkOrderStateFlow();
            if (!stateFlow.error) {
                console.log(`\n📊 ORDER STATE FLOW:`);
                Object.entries(stateFlow.states).forEach(([state, count]) => {
                    console.log(`   ${state}: ${count} orders`);
                });
                if (stateFlow.avgProcessingTime) {
                    console.log(`   Average processing time: ${Math.round(stateFlow.avgProcessingTime)} minutes`);
                }
            }
        }

        // Issues
        if (results.analysis.issues.length > 0) {
            console.log(`\n⚠️  ISSUES DETECTED:`);
            results.analysis.issues.forEach(issue => {
                const emoji = issue.severity === 'critical' ? '🚨' : 
                             issue.severity === 'warning' ? '⚠️' : 'ℹ️';
                console.log(`   ${emoji} ${issue.type}: ${issue.message}`);
            });
        }

        // Recommendations
        if (results.analysis.recommendations.length > 0) {
            console.log(`\n💡 RECOMMENDATIONS:`);
            results.analysis.recommendations.forEach(rec => {
                const emoji = rec.priority === 'CRITICAL' ? '🚨' : 
                             rec.priority === 'HIGH' ? '🔴' : 
                             rec.priority === 'MEDIUM' ? '🟡' : 'ℹ️';
                console.log(`   ${emoji} ${rec.priority}: ${rec.action}`);
                console.log(`      Reason: ${rec.reason}`);
                if (rec.command) console.log(`      Command: ${rec.command}`);
            });
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const options = {
        minutes: 30,
        verbose: false,
        includeDetails: false
    };

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--minutes':
                options.minutes = parseInt(args[i + 1]) || 30;
                i++;
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--details':
            case '-d':
                options.includeDetails = true;
                break;
            case '--help':
            case '-h':
                console.log('Meta Aggregator 2.0 - Recent Database Updates Checker');
                console.log('');
                console.log('USAGE: node check-recent-db-updates.js [options]');
                console.log('');
                console.log('OPTIONS:');
                console.log('  --minutes <number>      Minutes to look back (default: 30)');
                console.log('  --verbose, -v           Show detailed update information');
                console.log('  --details, -d           Include state flow analysis');
                console.log('  --help, -h              Show this help');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node check-recent-db-updates.js --minutes 60');
                console.log('  node check-recent-db-updates.js --verbose --details');
                console.log('  node check-recent-db-updates.js --minutes 5 -v');
                return;
        }
    }

    try {
        const checker = new DatabaseUpdateChecker(options);
        const results = await checker.checkRecentUpdates();
        await checker.printReport(results);

        // Exit codes
        const criticalIssues = results.analysis.issues.filter(i => i.severity === 'critical');
        const warningIssues = results.analysis.issues.filter(i => i.severity === 'warning');

        if (criticalIssues.length > 0) {
            process.exit(2); // Critical issues
        } else if (warningIssues.length > 0) {
            process.exit(1); // Warnings
        } else {
            process.exit(0); // All good
        }

    } catch (error) {
        console.error('❌ Database update check failed:', error.message);
        process.exit(3);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = DatabaseUpdateChecker;
