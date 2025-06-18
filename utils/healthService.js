/**
 * Health Check Service for Event Listener
 * Provides HTTP endpoint and health monitoring for the event listener service
 */

const express = require('express');
const { EscrowEventListener } = require('./escrowEventListener');
const fs = require('fs');
const path = require('path');

class HealthService {
    constructor(port = 3002) {
        this.port = port;
        this.app = express();
        this.listener = null;
        this.startTime = Date.now();
        
        this.setupRoutes();
    }

    /**
     * Setup health check routes
     */
    setupRoutes() {
        this.app.use(express.json());
        
        // Main health endpoint
        this.app.get('/health/listener', async (req, res) => {
            try {
                const healthStatus = await this.getHealthStatus();
                
                if (healthStatus.status === 'ok') {
                    res.status(200).json(healthStatus);
                } else {
                    res.status(503).json(healthStatus);
                }
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Detailed health endpoint
        this.app.get('/health/listener/detailed', async (req, res) => {
            try {
                const detailedStatus = await this.getDetailedHealthStatus();
                res.status(200).json(detailedStatus);
            } catch (error) {
                res.status(500).json({
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });

        // Basic ping endpoint
        this.app.get('/ping', (req, res) => {
            res.status(200).json({
                status: 'pong',
                timestamp: new Date().toISOString(),
                uptime: Date.now() - this.startTime
            });
        });
    }

    /**
     * Get basic health status
     */
    async getHealthStatus() {
        const status = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            service: 'escrow-event-listener'
        };

        try {
            // Check if listener is connected
            const isConnected = this.listener ? this.listener.isConnected : false;
            
            // Check recent activity
            const recentActivity = await this.checkRecentActivity();
            
            // Check log file accessibility
            const logsAccessible = this.checkLogFiles();
            
            if (!isConnected) {
                status.status = 'degraded';
                status.issues = ['Event listener not connected'];
            } else if (!recentActivity) {
                status.status = 'warning';
                status.issues = ['No recent event activity'];
            } else if (!logsAccessible) {
                status.status = 'warning';
                status.issues = ['Log files not accessible'];
            }

            status.connected = isConnected;
            status.recentActivity = recentActivity;
            status.logsAccessible = logsAccessible;

        } catch (error) {
            status.status = 'error';
            status.error = error.message;
        }

        return status;
    }

    /**
     * Get detailed health status
     */
    async getDetailedHealthStatus() {
        const basic = await this.getHealthStatus();
        
        const detailed = {
            ...basic,
            details: {
                listener: this.getListenerStatus(),
                provider: await this.getProviderStatus(),
                logs: this.getLogStatus(),
                events: await this.getEventStatus(),
                performance: this.getPerformanceMetrics()
            }
        };

        return detailed;
    }

    /**
     * Get listener connection status
     */
    getListenerStatus() {
        if (!this.listener) {
            return {
                status: 'not_initialized',
                connected: false,
                reconnectAttempts: 0
            };
        }

        return {
            status: this.listener.isConnected ? 'connected' : 'disconnected',
            connected: this.listener.isConnected,
            reconnectAttempts: this.listener.reconnectAttempts || 0,
            maxReconnectAttempts: this.listener.maxReconnectAttempts || 10,
            contractAddress: this.listener.contractAddress,
            providerUrl: this.listener.providerUrl
        };
    }

    /**
     * Get provider connection status
     */
    async getProviderStatus() {
        if (!this.listener || !this.listener.provider) {
            return {
                status: 'not_available',
                connected: false
            };
        }

        try {
            const network = await this.listener.provider.getNetwork();
            const blockNumber = await this.listener.provider.getBlockNumber();
            
            return {
                status: 'connected',
                connected: true,
                network: {
                    name: network.name,
                    chainId: Number(network.chainId)
                },
                blockNumber: blockNumber,
                lastChecked: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'error',
                connected: false,
                error: error.message,
                lastChecked: new Date().toISOString()
            };
        }
    }

    /**
     * Get log file status
     */
    getLogStatus() {
        const logDir = path.join(__dirname, '..', 'logs');
        const eventLogPath = path.join(logDir, 'escrow-events.log');
        const errorLogPath = path.join(logDir, 'escrow-errors.log');

        const status = {
            directory: {
                exists: fs.existsSync(logDir),
                path: logDir
            },
            eventLog: {
                exists: fs.existsSync(eventLogPath),
                path: eventLogPath,
                size: 0,
                lastModified: null
            },
            errorLog: {
                exists: fs.existsSync(errorLogPath),
                path: errorLogPath,
                size: 0,
                lastModified: null
            }
        };

        // Get file stats if files exist
        if (status.eventLog.exists) {
            const stats = fs.statSync(eventLogPath);
            status.eventLog.size = stats.size;
            status.eventLog.lastModified = stats.mtime;
        }

        if (status.errorLog.exists) {
            const stats = fs.statSync(errorLogPath);
            status.errorLog.size = stats.size;
            status.errorLog.lastModified = stats.mtime;
        }

        return status;
    }

    /**
     * Get event processing status
     */
    async getEventStatus() {
        if (!this.listener) {
            return {
                status: 'listener_not_available',
                totalEvents: 0,
                eventBreakdown: {}
            };
        }

        try {
            const summary = this.listener.getEventSummary();
            
            return {
                status: 'available',
                totalEvents: summary.totalEvents,
                eventBreakdown: summary.eventCounts,
                latestEvent: summary.latestEvent,
                lastChecked: new Date().toISOString()
            };
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                lastChecked: new Date().toISOString()
            };
        }
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        const process = require('process');
        
        return {
            uptime: Date.now() - this.startTime,
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            nodeVersion: process.version,
            platform: process.platform,
            pid: process.pid
        };
    }

    /**
     * Check for recent event activity
     */
    async checkRecentActivity() {
        const logPath = path.join(__dirname, '..', 'logs', 'escrow-events.log');
        
        if (!fs.existsSync(logPath)) {
            return false;
        }

        try {
            const stats = fs.statSync(logPath);
            const now = Date.now();
            const lastModified = stats.mtime.getTime();
            const hourAgo = now - (60 * 60 * 1000); // 1 hour ago
            
            return lastModified > hourAgo;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check log file accessibility
     */
    checkLogFiles() {
        const logDir = path.join(__dirname, '..', 'logs');
        
        try {
            // Check if log directory exists and is writable
            if (!fs.existsSync(logDir)) {
                return false;
            }

            // Try to write a test file
            const testPath = path.join(logDir, 'health-test.tmp');
            fs.writeFileSync(testPath, 'test');
            fs.unlinkSync(testPath);
            
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Set the event listener instance
     */
    setListener(listener) {
        this.listener = listener;
    }

    /**
     * Start the health service
     */
    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`🏥 Health service running on http://localhost:${this.port}`);
                console.log(`📊 Health endpoint: http://localhost:${this.port}/health/listener`);
                resolve();
            });
        });
    }

    /**
     * Stop the health service
     */
    stop() {
        if (this.server) {
            this.server.close();
            console.log('🏥 Health service stopped');
        }
    }
}

module.exports = { HealthService };
