/**
 * Health Check Endpoint for Event Listener Service
 * Returns HTTP 200 and status: "ok" if connected and syncing, else error
 */

import { EscrowEventListener } from '../../../utils/escrowEventListener';

// Global listener instance for health checks
let listenerInstance = null;

/**
 * Initialize or get existing listener instance
 */
function getListenerInstance() {
    if (!listenerInstance) {
        try {
            listenerInstance = new EscrowEventListener();
        } catch (error) {
            console.error('Failed to initialize listener for health check:', error);
            return null;
        }
    }
    return listenerInstance;
}

export default async function handler(req, res) {
    // Only allow GET requests
    if (req.method !== 'GET') {
        return res.status(405).json({
            status: 'error',
            message: 'Method not allowed',
            timestamp: new Date().toISOString()
        });
    }

    try {
        const listener = getListenerInstance();
        
        if (!listener) {
            return res.status(503).json({
                status: 'error',
                message: 'Event listener not initialized',
                timestamp: new Date().toISOString(),
                details: {
                    connected: false,
                    reconnectAttempts: 0,
                    lastError: 'Initialization failed'
                }
            });
        }

        // Check connection status
        const isConnected = listener.isConnected;
        const reconnectAttempts = listener.reconnectAttempts || 0;
        const maxAttempts = listener.maxReconnectAttempts || 10;

        // Get provider network info if connected
        let networkInfo = null;
        let latestBlock = null;
        let providerStatus = 'disconnected';

        if (isConnected && listener.provider) {
            try {
                // Test provider with timeout
                const networkPromise = listener.provider.getNetwork();
                const blockPromise = listener.provider.getBlockNumber();
                
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Provider timeout')), 5000)
                );

                const [network, blockNumber] = await Promise.race([
                    Promise.all([networkPromise, blockPromise]),
                    timeoutPromise
                ]);

                networkInfo = {
                    chainId: network.chainId.toString(),
                    name: network.name
                };
                latestBlock = blockNumber;
                providerStatus = 'connected';
            } catch (error) {
                console.warn('Provider health check failed:', error.message);
                providerStatus = 'error';
            }
        }

        // Determine overall health status
        const isHealthy = isConnected && 
                         providerStatus === 'connected' && 
                         reconnectAttempts < maxAttempts;

        const healthData = {
            status: isHealthy ? 'ok' : 'error',
            timestamp: new Date().toISOString(),
            service: 'event-listener',
            version: process.env.npm_package_version || '1.0.0',
            details: {
                connected: isConnected,
                providerStatus,
                reconnectAttempts,
                maxReconnectAttempts: maxAttempts,
                contractAddress: listener.contractAddress,
                providerUrl: listener.providerUrl,
                networkInfo,
                latestBlock,
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                environment: process.env.NODE_ENV || 'development'
            }
        };

        // Return appropriate HTTP status
        const statusCode = isHealthy ? 200 : 503;
        res.status(statusCode).json(healthData);

    } catch (error) {
        console.error('Health check error:', error);
        
        res.status(500).json({
            status: 'error',
            message: 'Internal health check error',
            timestamp: new Date().toISOString(),
            details: {
                error: error.message,
                connected: false,
                reconnectAttempts: 0
            }
        });
    }
}
