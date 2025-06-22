#!/usr/bin/env node

/**
 * Event Listener Demo Script
 * Demonstrates the enhanced escrow event listener with simulation
 */

const EscrowEventListener = require('./escrowEventListener');
const { ethers } = require('ethers');

async function runDemo() {
    console.log('🎬 Starting Escrow Event Listener Demo\n');
    
    // Load environment variables
    require('dotenv').config({ path: '../.env.local' });
    
    // Configuration with validation
    const demoConfig = {
        contractAddress: process.env.ESCROW_CONTRACT_ADDRESS || '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
        providerUrl: process.env.PROVIDER_URL || 'http://127.0.0.1:8545'
    };
    
    // Validate contract address
    if (!ethers.isAddress(demoConfig.contractAddress)) {
        console.error(`❌ Invalid contract address: ${demoConfig.contractAddress}`);
        console.log('💡 Tip: Run "npx hardhat run scripts/deployTestEscrow.js --network localhost" to deploy a test contract');
        process.exit(1);
    }
    
    console.log('📋 Demo Configuration:');
    console.log(`  Contract: ${demoConfig.contractAddress}`);
    console.log(`  Provider: ${demoConfig.providerUrl}\n`);
    
    // Initialize listener
    const listener = new EscrowEventListener(demoConfig);
    
    try {        console.log('🔧 Phase 1: Testing Connection & Setup');
        console.log('=====================================');
        
        // Test basic connection
        const provider = new ethers.JsonRpcProvider(demoConfig.providerUrl);
        
        // Disable ENS resolution for local networks
        provider.network = {
            ...provider.network,
            ensAddress: null
        };
        
        const network = await provider.getNetwork();
        const networkName = network.chainId === 31337n ? 'Hardhat' : 
                           network.chainId === 1337n ? 'Ganache' : 
                           network.name || 'Unknown';
        console.log(`✅ Connected to ${networkName} (chainId: ${network.chainId})`);
        
        const blockNumber = await provider.getBlockNumber();
        console.log(`📦 Current block: ${blockNumber}`);
        
        console.log('\n🎭 Phase 2: Event Simulation');
        console.log('=============================');
        
        // Run event simulation
        await listener.simulateEvents();
        
        console.log('\n📊 Phase 3: Event Summary');
        console.log('=========================');
        
        // Show event summary
        const summary = listener.getEventSummary();
        console.log(`📈 Total events processed: ${summary.totalEvents}`);
        console.log('📋 Event breakdown:');
        Object.entries(summary.eventTypes).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
        });
        
        if (summary.latestEvent) {
            console.log('\n🕐 Latest event:');
            console.log(`  Type: ${summary.latestEvent.eventName}`);
            console.log(`  Time: ${summary.latestEvent.timestamp}`);
        }
        
        console.log('\n🧪 Phase 4: Real-time Monitoring (30 seconds)');
        console.log('===============================================');
        
        // Start real-time monitoring for 30 seconds
        await listener.subscribeToEvents();
        console.log('👂 Listening for real events...');
        
        // Monitor for 30 seconds
        await new Promise(resolve => {
            let countdown = 30;
            const timer = setInterval(() => {
                console.log(`⏰ Monitoring... ${countdown--} seconds remaining`);
                if (countdown < 0) {
                    clearInterval(timer);
                    resolve();
                }
            }, 1000);
        });
        
        console.log('\n🏁 Phase 5: Demo Complete');
        console.log('=========================');
        
        await listener.shutdown();
        
        // Final summary
        const finalSummary = listener.getEventSummary();
        console.log(`✅ Demo completed successfully!`);
        console.log(`📊 Final event count: ${finalSummary.totalEvents}`);
        console.log(`📁 Logs saved to: ${listener.logFile}`);
        
        if (finalSummary.totalEvents > summary.totalEvents) {
            console.log(`🎉 Detected ${finalSummary.totalEvents - summary.totalEvents} real-time events!`);
        }
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
        console.error('Stack trace:', error.stack);
        
        // Ensure cleanup
        await listener.shutdown();
        process.exit(1);
    }
}

// Handle script interruption
process.on('SIGINT', () => {
    console.log('\n\n⚠️ Demo interrupted by user');
    process.exit(0);
});

// Run the demo
if (require.main === module) {
    runDemo().catch(console.error);
}
