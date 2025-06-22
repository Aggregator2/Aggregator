#!/usr/bin/env node

/**
 * Standalone Health Service for Event Listener
 * Can be run independently to provide health monitoring
 */

const { HealthService } = require('./healthService');
const { EscrowEventListener } = require('./escrowEventListener');

async function main() {
    const port = process.env.HEALTH_PORT || 3002;
    const healthService = new HealthService(port);
    
    try {
        // Try to initialize event listener for monitoring
        const listener = new EscrowEventListener();
        healthService.setListener(listener);
        
        console.log('🎧 Event listener initialized for health monitoring');
        
        // Start the health service
        await healthService.start();
        
        // Set up graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            healthService.stop();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            healthService.stop();
            process.exit(0);
        });
        
    } catch (error) {
        console.error('❌ Failed to start health service:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Health service crashed:', error);
        process.exit(1);
    });
}

module.exports = { main };
