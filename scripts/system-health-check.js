#!/usr/bin/env node

/**
 * System Health Checker and Recovery Tool
 * Comprehensive diagnostics for Meta Aggregator 2.0
 */

const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

class SystemHealthChecker {
    constructor() {
        this.results = {
            timestamp: new Date().toISOString(),
            overallHealth: 'unknown',
            components: {},
            recommendations: [],
            alerts: []
        };
    }

    async checkDatabaseHealth() {
        console.log('🔍 Checking database connectivity...');
        
        try {
            const supabase = createClient(
                process.env.SUPABASE_URL || 'your-supabase-url',
                process.env.SUPABASE_KEY || 'your-supabase-key'
            );

            // Test basic connectivity
            const startTime = Date.now();
            const { data, error } = await supabase
                .from('orders')
                .select('count')
                .limit(1);

            const responseTime = Date.now() - startTime;

            if (error) {
                throw new Error(`Database query failed: ${error.message}`);
            }

            // Check recent activity
            const { data: recentOrders } = await supabase
                .from('orders')
                .select('created_at, state')
                .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
                .order('created_at', { ascending: false })
                .limit(100);

            const stateDistribution = recentOrders.reduce((acc, order) => {
                acc[order.state] = (acc[order.state] || 0) + 1;
                return acc;
            }, {});

            this.results.components.database = {
                status: 'healthy',
                responseTime: `${responseTime}ms`,
                recentOrdersCount: recentOrders.length,
                stateDistribution,
                alerts: responseTime > 1000 ? ['High response time'] : []
            };

            if (responseTime > 1000) {
                this.results.alerts.push({
                    component: 'database',
                    severity: 'warning',
                    message: `Database response time is ${responseTime}ms (>1000ms)`
                });
            }

            console.log('✅ Database: Healthy');
            return true;

        } catch (error) {
            this.results.components.database = {
                status: 'unhealthy',
                error: error.message,
                alerts: ['Database connectivity failed']
            };

            this.results.alerts.push({
                component: 'database',
                severity: 'critical',
                message: `Database check failed: ${error.message}`
            });

            console.log('❌ Database: Failed -', error.message);
            return false;
        }
    }

    async checkBlockchainHealth() {
        console.log('🔍 Checking blockchain connectivity...');
        
        try {
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            
            // Test basic connectivity
            const startTime = Date.now();
            const blockNumber = await provider.getBlockNumber();
            const network = await provider.getNetwork();
            const responseTime = Date.now() - startTime;

            // Test contract connectivity
            let contractStatus = 'unknown';
            let contractError = null;
            
            try {
                if (process.env.ESCROW_CONTRACT_ADDRESS) {
                    const contract = new ethers.Contract(
                        process.env.ESCROW_CONTRACT_ADDRESS,
                        ['function owner() view returns (address)'], // Basic ABI
                        provider
                    );
                    await contract.owner();
                    contractStatus = 'accessible';
                }
            } catch (error) {
                contractStatus = 'inaccessible';
                contractError = error.message;
            }

            this.results.components.blockchain = {
                status: 'healthy',
                network: network.name,
                chainId: Number(network.chainId),
                currentBlock: blockNumber,
                responseTime: `${responseTime}ms`,
                contractStatus,
                contractError,
                alerts: responseTime > 2000 ? ['High RPC response time'] : []
            };

            if (responseTime > 2000) {
                this.results.alerts.push({
                    component: 'blockchain',
                    severity: 'warning',
                    message: `RPC response time is ${responseTime}ms (>2000ms)`
                });
            }

            if (contractStatus === 'inaccessible') {
                this.results.alerts.push({
                    component: 'blockchain',
                    severity: 'warning',
                    message: `Contract not accessible: ${contractError}`
                });
            }

            console.log(`✅ Blockchain: Healthy (Block: ${blockNumber})`);
            return true;

        } catch (error) {
            this.results.components.blockchain = {
                status: 'unhealthy',
                error: error.message,
                alerts: ['Blockchain connectivity failed']
            };

            this.results.alerts.push({
                component: 'blockchain',
                severity: 'critical',
                message: `Blockchain check failed: ${error.message}`
            });

            console.log('❌ Blockchain: Failed -', error.message);
            return false;
        }
    }

    async checkEventListenerHealth() {
        console.log('🔍 Checking event listener status...');
        
        try {
            // Check if listener process is running (simplified check)
            const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            const listenerCount = provider.listenerCount();

            // Check recent event logs
            let recentEventLogs = [];
            try {
                const logPath = path.join(process.cwd(), 'logs', 'event-listener.log');
                const logContent = await fs.readFile(logPath, 'utf8');
                const lines = logContent.split('\n').filter(line => line.trim());
                recentEventLogs = lines.slice(-10); // Last 10 log entries
            } catch (error) {
                // Log file might not exist
                recentEventLogs = ['No log file found'];
            }

            // Check for recent event processing (look for timestamp patterns)
            const now = Date.now();
            const recentActivity = recentEventLogs.some(log => {
                try {
                    const logTime = new Date(log.split(' ')[0]).getTime();
                    return (now - logTime) < 60 * 60 * 1000; // Within last hour
                } catch {
                    return false;
                }
            });

            this.results.components.eventListener = {
                status: listenerCount > 0 ? 'active' : 'inactive',
                listenerCount,
                recentActivity,
                recentLogs: recentEventLogs.slice(-3), // Last 3 entries
                alerts: listenerCount === 0 ? ['No active event listeners'] : []
            };

            if (listenerCount === 0) {
                this.results.alerts.push({
                    component: 'eventListener',
                    severity: 'critical',
                    message: 'No active event listeners detected'
                });
            }

            if (!recentActivity) {
                this.results.alerts.push({
                    component: 'eventListener',
                    severity: 'warning',
                    message: 'No recent event listener activity in logs'
                });
            }

            console.log(`✅ Event Listener: ${listenerCount > 0 ? 'Active' : 'Inactive'} (${listenerCount} listeners)`);
            return listenerCount > 0;

        } catch (error) {
            this.results.components.eventListener = {
                status: 'error',
                error: error.message,
                alerts: ['Event listener check failed']
            };

            this.results.alerts.push({
                component: 'eventListener',
                severity: 'warning',
                message: `Event listener check failed: ${error.message}`
            });

            console.log('⚠️ Event Listener: Check failed -', error.message);
            return false;
        }
    }

    async checkKeyRotationHealth() {
        console.log('🔍 Checking key rotation system...');
        
        try {
            // Check if key rotation files exist
            const keyRotationPath = path.join(process.cwd(), 'security', 'key-rotation');
            const keyStorePath = path.join(process.cwd(), 'security', 'keys');
            
            const requiredFiles = [
                'KeyRotationManager.js',
                'orchestrator.js',
                'monitoring.js'
            ];

            const missingFiles = [];
            for (const file of requiredFiles) {
                try {
                    await fs.access(path.join(keyRotationPath, file));
                } catch {
                    missingFiles.push(file);
                }
            }

            // Check key files
            let keyFiles = [];
            try {
                const files = await fs.readdir(keyStorePath);
                keyFiles = files.filter(f => f.endsWith('.json'));
            } catch {
                // Keys directory might not exist
            }

            // Try to run a quick health check
            let rotationHealthy = false;
            let healthCheckError = null;
            
            try {
                const { spawn } = require('child_process');
                const healthCheck = spawn('node', [
                    path.join(keyRotationPath, 'orchestrator.js'),
                    'status'
                ], { timeout: 10000 });
                
                rotationHealthy = true; // If it runs without immediate error
            } catch (error) {
                healthCheckError = error.message;
            }

            this.results.components.keyRotation = {
                status: missingFiles.length === 0 ? 'installed' : 'incomplete',
                missingFiles,
                keyFilesCount: keyFiles.length,
                keyFiles: keyFiles.slice(0, 5), // First 5 key files
                healthCheckStatus: rotationHealthy ? 'responsive' : 'unresponsive',
                healthCheckError,
                alerts: missingFiles.length > 0 ? ['Missing key rotation files'] : []
            };

            if (missingFiles.length > 0) {
                this.results.alerts.push({
                    component: 'keyRotation',
                    severity: 'warning',
                    message: `Missing key rotation files: ${missingFiles.join(', ')}`
                });
            }

            console.log(`✅ Key Rotation: ${missingFiles.length === 0 ? 'Complete' : 'Incomplete'} (${keyFiles.length} key files)`);
            return missingFiles.length === 0;

        } catch (error) {
            this.results.components.keyRotation = {
                status: 'error',
                error: error.message,
                alerts: ['Key rotation check failed']
            };

            this.results.alerts.push({
                component: 'keyRotation',
                severity: 'warning',
                message: `Key rotation check failed: ${error.message}`
            });

            console.log('⚠️ Key Rotation: Check failed -', error.message);
            return false;
        }
    }

    async checkSystemResources() {
        console.log('🔍 Checking system resources...');
        
        try {
            const os = require('os');
            
            // Memory usage
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const usedMemory = totalMemory - freeMemory;
            const memoryUsagePercent = (usedMemory / totalMemory) * 100;

            // CPU load average (Unix-like systems)
            const loadAvg = os.loadavg();

            // Disk space check (for log files)
            let diskSpace = {};
            try {
                const { execSync } = require('child_process');
                // Windows command to check disk space
                const diskInfo = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf8' });
                diskSpace = { info: 'Disk space check available on Windows', raw: diskInfo };
            } catch {
                diskSpace = { info: 'Disk space check not available' };
            }

            this.results.components.systemResources = {
                status: memoryUsagePercent < 90 ? 'healthy' : 'stressed',
                memory: {
                    total: `${Math.round(totalMemory / 1024 / 1024 / 1024)}GB`,
                    used: `${Math.round(usedMemory / 1024 / 1024 / 1024)}GB`,
                    free: `${Math.round(freeMemory / 1024 / 1024 / 1024)}GB`,
                    usagePercent: Math.round(memoryUsagePercent)
                },
                cpu: {
                    loadAverage: loadAvg,
                    cores: os.cpus().length
                },
                uptime: `${Math.round(os.uptime() / 3600)}h`,
                platform: `${os.type()} ${os.release()}`,
                alerts: memoryUsagePercent > 90 ? ['High memory usage'] : []
            };

            if (memoryUsagePercent > 90) {
                this.results.alerts.push({
                    component: 'systemResources',
                    severity: 'warning',
                    message: `High memory usage: ${Math.round(memoryUsagePercent)}%`
                });
            }

            console.log(`✅ System Resources: ${memoryUsagePercent < 90 ? 'Healthy' : 'Stressed'} (${Math.round(memoryUsagePercent)}% memory)`);
            return true;

        } catch (error) {
            this.results.components.systemResources = {
                status: 'error',
                error: error.message,
                alerts: ['System resource check failed']
            };

            console.log('⚠️ System Resources: Check failed -', error.message);
            return false;
        }
    }

    generateRecommendations() {
        const recommendations = [];

        // Check each component for issues
        if (this.results.components.database?.status === 'unhealthy') {
            recommendations.push({
                priority: 'critical',
                component: 'database',
                action: 'Check database connection and credentials',
                details: 'Verify SUPABASE_URL and SUPABASE_KEY environment variables'
            });
        }

        if (this.results.components.blockchain?.status === 'unhealthy') {
            recommendations.push({
                priority: 'critical',
                component: 'blockchain',
                action: 'Check RPC endpoint and network connectivity',
                details: 'Verify RPC_URL environment variable and network status'
            });
        }

        if (this.results.components.eventListener?.listenerCount === 0) {
            recommendations.push({
                priority: 'high',
                component: 'eventListener',
                action: 'Restart event listener service',
                details: 'Run: pm2 restart listener or node Backend\\ server/index.js'
            });
        }

        if (this.results.components.keyRotation?.status === 'incomplete') {
            recommendations.push({
                priority: 'medium',
                component: 'keyRotation',
                action: 'Complete key rotation system setup',
                details: 'Run: node security/setup-key-rotation.js'
            });
        }

        if (this.results.components.systemResources?.memory?.usagePercent > 90) {
            recommendations.push({
                priority: 'medium',
                component: 'systemResources',
                action: 'Investigate high memory usage',
                details: 'Check for memory leaks in Node.js processes'
            });
        }

        // High-level recommendations
        if (this.results.alerts.length > 3) {
            recommendations.push({
                priority: 'high',
                component: 'overall',
                action: 'Multiple system issues detected',
                details: 'Consider full system restart and detailed diagnostics'
            });
        }

        this.results.recommendations = recommendations;
    }

    calculateOverallHealth() {
        const criticalComponents = ['database', 'blockchain'];
        const criticalIssues = criticalComponents.filter(comp => 
            this.results.components[comp]?.status === 'unhealthy'
        ).length;

        const totalIssues = this.results.alerts.length;
        const criticalAlerts = this.results.alerts.filter(alert => 
            alert.severity === 'critical'
        ).length;

        if (criticalIssues > 0 || criticalAlerts > 0) {
            this.results.overallHealth = 'critical';
        } else if (totalIssues > 2) {
            this.results.overallHealth = 'degraded';
        } else if (totalIssues > 0) {
            this.results.overallHealth = 'warning';
        } else {
            this.results.overallHealth = 'healthy';
        }
    }

    async runFullHealthCheck() {
        console.log('🏥 Starting comprehensive system health check...');
        console.log('='.repeat(50));

        const checks = [
            this.checkDatabaseHealth(),
            this.checkBlockchainHealth(),
            this.checkEventListenerHealth(),
            this.checkKeyRotationHealth(),
            this.checkSystemResources()
        ];

        await Promise.all(checks);

        this.generateRecommendations();
        this.calculateOverallHealth();

        console.log('\n' + '='.repeat(50));
        console.log(`🏥 Overall System Health: ${this.getHealthEmoji()} ${this.results.overallHealth.toUpperCase()}`);
        console.log(`📊 Total Alerts: ${this.results.alerts.length}`);
        console.log(`💡 Recommendations: ${this.results.recommendations.length}`);

        return this.results;
    }

    getHealthEmoji() {
        switch (this.results.overallHealth) {
            case 'healthy': return '✅';
            case 'warning': return '⚠️';
            case 'degraded': return '🟡';
            case 'critical': return '🔴';
            default: return '❓';
        }
    }

    async saveReport(filePath) {
        const reportPath = filePath || `logs/health-check-${new Date().toISOString().split('T')[0]}.json`;
        await fs.writeFile(reportPath, JSON.stringify(this.results, null, 2));
        console.log(`📄 Health report saved to: ${reportPath}`);
        return reportPath;
    }

    printSummary() {
        console.log('\n📋 HEALTH CHECK SUMMARY');
        console.log('='.repeat(30));
        
        Object.entries(this.results.components).forEach(([component, data]) => {
            const status = data.status;
            const emoji = status === 'healthy' || status === 'active' || status === 'installed' ? '✅' : 
                         status === 'unhealthy' || status === 'error' ? '❌' : '⚠️';
            console.log(`${emoji} ${component}: ${status}`);
        });

        if (this.results.alerts.length > 0) {
            console.log('\n🚨 ACTIVE ALERTS:');
            this.results.alerts.forEach(alert => {
                const emoji = alert.severity === 'critical' ? '🔴' : 
                             alert.severity === 'warning' ? '🟡' : 'ℹ️';
                console.log(`  ${emoji} ${alert.component}: ${alert.message}`);
            });
        }

        if (this.results.recommendations.length > 0) {
            console.log('\n💡 RECOMMENDATIONS:');
            this.results.recommendations.forEach(rec => {
                const emoji = rec.priority === 'critical' ? '🔴' : 
                             rec.priority === 'high' ? '🟡' : 'ℹ️';
                console.log(`  ${emoji} ${rec.component}: ${rec.action}`);
                console.log(`     → ${rec.details}`);
            });
        }
    }
}

// CLI Interface
async function main() {
    const checker = new SystemHealthChecker();
    const command = process.argv[2];

    try {
        switch (command) {
            case 'full':
            case 'all':
                await checker.runFullHealthCheck();
                checker.printSummary();
                await checker.saveReport();
                break;

            case 'quick':
                await checker.checkDatabaseHealth();
                await checker.checkBlockchainHealth();
                checker.calculateOverallHealth();
                console.log(`\n🏥 Quick Health Check: ${checker.getHealthEmoji()} ${checker.results.overallHealth.toUpperCase()}`);
                break;

            case 'database':
                await checker.checkDatabaseHealth();
                console.log('Database check result:', checker.results.components.database);
                break;

            case 'blockchain':
                await checker.checkBlockchainHealth();
                console.log('Blockchain check result:', checker.results.components.blockchain);
                break;

            case 'events':
                await checker.checkEventListenerHealth();
                console.log('Event listener check result:', checker.results.components.eventListener);
                break;

            case 'keys':
                await checker.checkKeyRotationHealth();
                console.log('Key rotation check result:', checker.results.components.keyRotation);
                break;

            case 'resources':
                await checker.checkSystemResources();
                console.log('System resources check result:', checker.results.components.systemResources);
                break;

            default:
                console.log('Meta Aggregator 2.0 - System Health Checker');
                console.log('');
                console.log('USAGE: node system-health-check.js <command>');
                console.log('');
                console.log('COMMANDS:');
                console.log('  full        Run comprehensive health check');
                console.log('  quick       Run quick database and blockchain check');
                console.log('  database    Check database connectivity');
                console.log('  blockchain  Check blockchain connectivity');
                console.log('  events      Check event listener status');
                console.log('  keys        Check key rotation system');
                console.log('  resources   Check system resources');
                console.log('');
                console.log('EXAMPLES:');
                console.log('  node system-health-check.js full');
                console.log('  node system-health-check.js quick');
                console.log('  node system-health-check.js database');
        }
    } catch (error) {
        console.error('❌ Health check failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = SystemHealthChecker;
