#!/usr/bin/env node

const KeyRotationManager = require('./KeyRotationManager');
const readline = require('readline');

/**
 * Manual Key Rotation Script
 * Provides interactive CLI for manual key rotation
 */

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function prompt(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function main() {
    console.log('='.repeat(60));
    console.log('    META AGGREGATOR 2.0 - MANUAL KEY ROTATION');
    console.log('='.repeat(60));
    
    const rotationManager = new KeyRotationManager({
        rotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    try {
        // Show current status
        console.log('\n📊 CURRENT KEY STATUS:');
        const status = await rotationManager.getRotationStatus();
        
        for (const [keyType, info] of Object.entries(status)) {
            console.log(`  ${keyType}:`);
            console.log(`    Version: ${info.currentVersion}`);
            console.log(`    Key ID: ${info.keyId}`);
            console.log(`    Rotation Due: ${info.isDue ? '⚠️  YES' : '✅ NO'}`);
            console.log('');
        }

        // Ask which key to rotate
        console.log('🔄 SELECT KEY TO ROTATE:');
        console.log('1. PRIVATE_KEY (Backend Signing)');
        console.log('2. ARBITER_PRIVATE_KEY (Escrow Arbiter)');
        console.log('3. Both Keys');
        console.log('4. Exit');
        
        const choice = await prompt('\nSelect option (1-4): ');
        
        let keysToRotate = [];
        switch (choice) {
            case '1':
                keysToRotate = ['PRIVATE_KEY'];
                break;
            case '2':
                keysToRotate = ['ARBITER_PRIVATE_KEY'];
                break;
            case '3':
                keysToRotate = ['PRIVATE_KEY', 'ARBITER_PRIVATE_KEY'];
                break;
            case '4':
                console.log('Exiting...');
                process.exit(0);
            default:
                console.log('Invalid choice. Exiting...');
                process.exit(1);
        }

        // Get rotation reason
        const reason = await prompt('\n📝 Enter rotation reason (optional): ') || 'manual_rotation';
        
        // Get operator name
        const operator = await prompt('👤 Enter your name/ID: ') || 'unknown_operator';

        // Confirm rotation
        console.log('\n⚠️  ROTATION CONFIRMATION:');
        console.log(`Keys to rotate: ${keysToRotate.join(', ')}`);
        console.log(`Reason: ${reason}`);
        console.log(`Operator: ${operator}`);
        
        const confirm = await prompt('\nProceed with rotation? (yes/no): ');
        
        if (confirm.toLowerCase() !== 'yes') {
            console.log('Rotation cancelled.');
            process.exit(0);
        }

        // Perform rotations
        console.log('\n🔄 STARTING KEY ROTATION...\n');
        
        for (const keyType of keysToRotate) {
            console.log(`Rotating ${keyType}...`);
            
            try {
                const result = await rotationManager.rotateKey(keyType, {
                    trigger: 'manual',
                    rotatedBy: operator,
                    reason: reason
                });

                console.log(`✅ ${keyType} rotation successful!`);
                console.log(`   New Version: ${result.newVersion}`);
                console.log(`   New Address: ${result.newAddress}`);
                console.log('');
                
            } catch (error) {
                console.error(`❌ ${keyType} rotation failed:`, error.message);
                console.log('');
            }
        }

        console.log('🎉 ROTATION PROCESS COMPLETE!');
        
        // Show updated status
        console.log('\n📊 UPDATED STATUS:');
        const updatedStatus = await rotationManager.getRotationStatus();
        
        for (const [keyType, info] of Object.entries(updatedStatus)) {
            if (keysToRotate.includes(keyType)) {
                console.log(`  ${keyType}:`);
                console.log(`    Version: ${info.currentVersion}`);
                console.log(`    Key ID: ${info.keyId}`);
                console.log('');
            }
        }

        console.log('⚠️  IMPORTANT REMINDERS:');
        console.log('1. Restart all services that use these keys');
        console.log('2. Update any hardcoded addresses in smart contracts');
        console.log('3. Notify team members of the rotation');
        console.log('4. Test all functionality before deploying');
        
    } catch (error) {
        console.error('❌ Rotation process failed:', error.message);
        process.exit(1);
    } finally {
        rl.close();
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\nRotation interrupted. Exiting...');
    rl.close();
    process.exit(0);
});

if (require.main === module) {
    main();
}

module.exports = { main };
