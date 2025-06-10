#!/usr/bin/env node

/**
 * Emergency Order State Fixer
 * Manually updates stuck orders with proper logging and validation
 */

const { createClient } = require('@supabase/supabase-js');
const { ethers } = require('ethers');

// Initialize Supabase client
let supabase = null;
try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    } else {
        console.warn('⚠️ SUPABASE_URL and SUPABASE_KEY environment variables not set');
    }
} catch (error) {
    console.error('❌ Failed to initialize Supabase client:', error.message);
}

class EmergencyOrderFixer {
    constructor() {
        this.logFile = `logs/emergency-fixes-${new Date().toISOString().split('T')[0]}.log`;
        this.dryRun = process.argv.includes('--dry-run');
    }

    async log(message, data = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            message,
            data,
            operator: process.env.USER || 'unknown'
        };
        
        console.log(`📝 ${message}`, data);
        
        // Write to log file
        const fs = require('fs').promises;
        await fs.appendFile(this.logFile, JSON.stringify(logEntry) + '\n');
    }    async checkStuckOrders(hoursAgo = 2) {
        if (!supabase) {
            throw new Error('Supabase client not initialized. Please set SUPABASE_URL and SUPABASE_KEY environment variables.');
        }

        const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
        
        const { data: stuckOrders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('state', 'PENDING')
            .lt('created_at', cutoffTime)
            .order('created_at', { ascending: false });

        if (error) {
            throw new Error(`Database query failed: ${error.message}`);
        }

        await this.log(`Found ${stuckOrders.length} stuck orders older than ${hoursAgo} hours`);
        return stuckOrders;
    }

    async verifyOrderOnChain(order) {
        try {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            const contract = new ethers.Contract(
                process.env.ESCROW_CONTRACT_ADDRESS,
                require('./artifacts/contracts/Escrow.sol/Escrow.json').abi,
                provider
            );

            // Check if order was actually settled on-chain
            const filter = contract.filters.EscrowReleased(order.id);
            const events = await contract.queryFilter(filter, order.block_number || 0);

            return {
                hasOnChainEvent: events.length > 0,
                latestEvent: events[events.length - 1] || null,
                blockNumber: events[0]?.blockNumber || null,
                transactionHash: events[0]?.transactionHash || null
            };
        } catch (error) {
            await this.log(`Error verifying order ${order.id} on-chain: ${error.message}`);
            return { hasOnChainEvent: false, error: error.message };
        }
    }

    async fixSingleOrder(orderId, newState, reason) {
        await this.log(`Attempting to fix order ${orderId}`, { newState, reason });

        // Get current order state
        const { data: order, error: fetchError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError) {
            throw new Error(`Could not fetch order ${orderId}: ${fetchError.message}`);
        }

        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        await this.log(`Current order state`, order);

        // Verify on-chain if possible
        const onChainStatus = await this.verifyOrderOnChain(order);
        await this.log(`On-chain verification for ${orderId}`, onChainStatus);

        if (this.dryRun) {
            await this.log(`DRY RUN: Would update order ${orderId} from ${order.state} to ${newState}`);
            return { success: true, dryRun: true };
        }

        // Update order with audit trail
        const updateData = {
            state: newState,
            updated_at: new Date().toISOString(),
            notes: `${order.notes || ''} [EMERGENCY FIX: ${new Date().toISOString()} - ${reason} - by ${process.env.USER || 'system'}]`.trim(),
            emergency_fix_applied: true,
            emergency_fix_reason: reason,
            emergency_fix_timestamp: new Date().toISOString(),
            on_chain_verified: onChainStatus.hasOnChainEvent
        };

        const { error: updateError } = await supabase
            .from('orders')
            .update(updateData)
            .eq('id', orderId);

        if (updateError) {
            throw new Error(`Failed to update order ${orderId}: ${updateError.message}`);
        }

        await this.log(`Successfully updated order ${orderId}`, { oldState: order.state, newState, onChainStatus });
        return { success: true, oldState: order.state, newState, onChainVerified: onChainStatus.hasOnChainEvent };
    }

    async bulkFixStuckOrders(hoursAgo = 2, newState = 'SETTLED', reason = 'bulk_emergency_fix') {
        const stuckOrders = await this.checkStuckOrders(hoursAgo);
        
        if (stuckOrders.length === 0) {
            await this.log('No stuck orders found');
            return { fixed: 0, errors: 0 };
        }

        await this.log(`Starting bulk fix for ${stuckOrders.length} orders`);
        
        const results = {
            fixed: 0,
            errors: 0,
            details: []
        };

        for (const order of stuckOrders) {
            try {
                const result = await this.fixSingleOrder(order.id, newState, reason);
                results.fixed++;
                results.details.push({ orderId: order.id, status: 'success', ...result });
            } catch (error) {
                results.errors++;
                results.details.push({ orderId: order.id, status: 'error', error: error.message });
                await this.log(`Error fixing order ${order.id}: ${error.message}`);
            }
        }

        await this.log(`Bulk fix completed`, results);
        return results;
    }

    async generateReport() {
        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

        // Get order state distribution
        const { data: stateDistribution } = await supabase
            .from('orders')
            .select('state')
            .gte('created_at', oneDayAgo);

        const stateCounts = stateDistribution.reduce((acc, order) => {
            acc[order.state] = (acc[order.state] || 0) + 1;
            return acc;
        }, {});

        // Get recently fixed orders
        const { data: recentFixes } = await supabase
            .from('orders')
            .select('*')
            .eq('emergency_fix_applied', true)
            .gte('emergency_fix_timestamp', oneDayAgo);

        const report = {
            timestamp: now.toISOString(),
            orderStateLast24h: stateCounts,
            emergencyFixesLast24h: recentFixes?.length || 0,
            recentFixes: recentFixes || [],
            healthStatus: stateCounts.PENDING > 10 ? 'WARNING' : 'HEALTHY'
        };

        console.log('\n📊 EMERGENCY FIXES REPORT');
        console.log('=========================');
        console.log(JSON.stringify(report, null, 2));

        return report;
    }
}

// CLI Interface
async function main() {
    const fixer = new EmergencyOrderFixer();

    try {
        const command = process.argv[2];

        switch (command) {
            case 'fix-order':
                const orderId = process.argv[3];
                const newState = process.argv[4] || 'SETTLED';
                const reason = process.argv[5] || 'manual_emergency_fix';
                
                if (!orderId) {
                    console.error('❌ Please provide order ID: node emergency-order-fix.js fix-order ORDER_ID [STATE] [REASON]');
                    process.exit(1);
                }
                
                const result = await fixer.fixSingleOrder(orderId, newState, reason);
                console.log('✅ Fix result:', result);
                break;

            case 'bulk-fix':
                const hours = parseInt(process.argv[3]) || 2;
                const bulkState = process.argv[4] || 'SETTLED';
                const bulkReason = process.argv[5] || 'bulk_emergency_fix';
                
                const bulkResult = await fixer.bulkFixStuckOrders(hours, bulkState, bulkReason);
                console.log('✅ Bulk fix result:', bulkResult);
                break;

            case 'check-stuck':
                const checkHours = parseInt(process.argv[3]) || 2;
                const stuckOrders = await fixer.checkStuckOrders(checkHours);
                console.log(`📋 Found ${stuckOrders.length} stuck orders:`);
                stuckOrders.forEach(order => {
                    console.log(`- ${order.id}: ${order.state} (created: ${order.created_at})`);
                });
                break;

            case 'report':
                await fixer.generateReport();
                break;

            case 'verify-order':
                const verifyOrderId = process.argv[3];
                if (!verifyOrderId) {
                    console.error('❌ Please provide order ID: node emergency-order-fix.js verify-order ORDER_ID');
                    process.exit(1);
                }
                
                const { data: orderToVerify } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('id', verifyOrderId)
                    .single();
                
                if (orderToVerify) {
                    const verification = await fixer.verifyOrderOnChain(orderToVerify);
                    console.log('🔍 On-chain verification result:', verification);
                } else {
                    console.log('❌ Order not found');
                }
                break;

            default:
                console.log('Meta Aggregator 2.0 - Emergency Order Fixer');
                console.log('');
                console.log('USAGE: node emergency-order-fix.js <command> [options]');
                console.log('');
                console.log('COMMANDS:');
                console.log('  fix-order <order-id> [state] [reason]  Fix a single order');
                console.log('  bulk-fix [hours] [state] [reason]      Fix all stuck orders');
                console.log('  check-stuck [hours]                    List stuck orders');
                console.log('  verify-order <order-id>                Verify order on-chain');
                console.log('  report                                  Generate status report');
                console.log('');
                console.log('OPTIONS:');
                console.log('  --dry-run                              Show what would be done without making changes');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node emergency-order-fix.js fix-order order123 SETTLED "event_listener_failure"');
                console.log('  node emergency-order-fix.js bulk-fix 4 SETTLED "system_restart" --dry-run');
                console.log('  node emergency-order-fix.js check-stuck 1');
                console.log('  node emergency-order-fix.js report');
        }
    } catch (error) {
        console.error('❌ Emergency fix failed:', error.message);
        await fixer.log('Emergency fix error', { error: error.message, stack: error.stack });
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = EmergencyOrderFixer;
