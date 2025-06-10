#!/usr/bin/env node

// Meta Aggregator 2.0 Key Rotation Startup Script
const { spawn } = require('child_process');
const path = require('path');

console.log('🔐 Meta Aggregator 2.0 Key Rotation System');
console.log('==========================================');

const command = process.argv[2];

switch (command) {
    case 'init':
        console.log('🔧 Initializing key rotation system...');
        const orchestrator = require('./security/key-rotation/orchestrator.js');
        const manager = new orchestrator();
        manager.initialize().then(() => {
            console.log('✅ System initialized successfully');
        }).catch(console.error);
        break;

    case 'rotate':
        const keyType = process.argv[3];
        if (!keyType) {
            console.log('❌ Please specify key type: PRIVATE_KEY or ARBITER_PRIVATE_KEY');
            process.exit(1);
        }
        console.log(`🔄 Rotating ${keyType}...`);
        // Manual rotation code here
        break;

    case 'test':
        console.log('🧪 Running key rotation tests...');
        const testScript = spawn('node', ['security/key-rotation/test-suite.js', 'run'], {
            stdio: 'inherit'
        });
        break;

    case 'monitor':
        console.log('📊 Starting monitoring...');
        const monitorScript = spawn('node', ['security/key-rotation/monitoring.js', 'start'], {
            stdio: 'inherit'
        });
        break;

    default:
        console.log('USAGE: node key-rotation.js <command>');
        console.log('');
        console.log('COMMANDS:');
        console.log('  init     Initialize the key rotation system');
        console.log('  rotate   Rotate a specific key');
        console.log('  test     Run system tests');
        console.log('  monitor  Start monitoring service');
        console.log('');
        console.log('EXAMPLES:');
        console.log('  node key-rotation.js init');
        console.log('  node key-rotation.js rotate PRIVATE_KEY');
        console.log('  node key-rotation.js test');
        console.log('  node key-rotation.js monitor');
}
