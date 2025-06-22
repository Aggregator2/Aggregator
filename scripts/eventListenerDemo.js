#!/usr/bin/env node

/**
 * Event Listener Demo Script
 * Compiles contracts, starts Hardhat network, and runs event simulation
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Escrow Event Listener Demo');
console.log('============================\n');

async function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`📝 Running: ${command} ${args.join(' ')}`);
        
        const child = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            ...options
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command failed with exit code ${code}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
}

async function setup() {
    try {
        console.log('1️⃣ Compiling contracts...');
        await runCommand('npx', ['hardhat', 'compile']);
        console.log('✅ Contracts compiled successfully\n');

        console.log('2️⃣ Starting Hardhat network...');
        console.log('   💡 Starting in background - you can run event simulation in another terminal');
        console.log('   💡 Use: npm run simulate-events\n');

        // Start Hardhat network in background
        const hardhatNode = spawn('npx', ['hardhat', 'node'], {
            stdio: 'inherit',
            shell: true,
            detached: false
        });

        // Handle cleanup
        process.on('SIGINT', () => {
            console.log('\n🛑 Shutting down Hardhat network...');
            hardhatNode.kill();
            process.exit(0);
        });

        // Keep the network running
        hardhatNode.on('close', (code) => {
            console.log(`Hardhat network exited with code ${code}`);
        });

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

async function simulateEvents() {
    try {
        console.log('3️⃣ Running event simulation...');
        await runCommand('npx', ['hardhat', 'run', 'scripts/simulateEscrowEvents.js', '--network', 'localhost']);
        console.log('✅ Event simulation completed\n');
    } catch (error) {
        console.error('❌ Event simulation failed:', error.message);
        process.exit(1);
    }
}

async function startListener() {
    try {
        console.log('4️⃣ Starting event listener...');
        console.log('   💡 Press Ctrl+C to stop listening\n');
        await runCommand('node', ['utils/escrowEventListener.js']);
    } catch (error) {
        console.error('❌ Event listener failed:', error.message);
        process.exit(1);
    }
}

// CLI interface
const command = process.argv[2];

switch (command) {
    case 'setup':
        setup();
        break;
    
    case 'simulate':
        simulateEvents();
        break;
    
    case 'listen':
        startListener();
        break;
    
    case 'full-demo':
        (async () => {
            console.log('🎬 Running full demo...\n');
            
            // Compile contracts
            await runCommand('npx', ['hardhat', 'compile']);
            
            // Start network and simulate events in sequence
            console.log('Starting Hardhat network and running simulation...');
            const nodeProcess = spawn('npx', ['hardhat', 'node'], {
                stdio: 'pipe',
                shell: true
            });

            // Wait for network to be ready
            await new Promise(resolve => setTimeout(resolve, 5000));

            try {
                // Run simulation
                await runCommand('npx', ['hardhat', 'run', 'scripts/simulateEscrowEvents.js', '--network', 'localhost']);
                console.log('\n✅ Full demo completed successfully!');
            } finally {
                nodeProcess.kill();
            }
        })();
        break;
    
    default:
        console.log('Usage:');
        console.log('  node scripts/eventListenerDemo.js setup       # Start Hardhat network');
        console.log('  node scripts/eventListenerDemo.js simulate    # Run event simulation');
        console.log('  node scripts/eventListenerDemo.js listen      # Start event listener');
        console.log('  node scripts/eventListenerDemo.js full-demo   # Run complete demo');
        console.log('');
        console.log('Quick start:');
        console.log('  1. Run: node scripts/eventListenerDemo.js setup');
        console.log('  2. In another terminal: node scripts/eventListenerDemo.js simulate');
        console.log('  3. Or run: node scripts/eventListenerDemo.js full-demo');
        break;
}
