const { healthCheck } = require('./healthCheck');
const fs = require('fs');
require('dotenv').config({path: '.env.local'});

// Alert configuration based on RELEASE_STRATEGY.md
const ALERT_CONFIG = {
    contacts: {
        P0: [
            { name: 'Joeri', phone: '+1-555-0123', email: 'joeri@metaaggregator.com' },
            { name: 'Operations', phone: '+1-555-0100', email: 'operations@metaaggregator.com' },
            { name: 'Security', phone: '+1-555-0911', email: 'security@metaaggregator.com' }
        ],
        P1: [
            { name: 'Development Team', email: 'dev@metaaggregator.com' },
            { name: 'Operations', phone: '+1-555-0100', email: 'operations@metaaggregator.com' }
        ],
        P2: [
            { name: 'Development Team', email: 'dev@metaaggregator.com' }
        ]
    },
    thresholds: {
        critical: {
            overall_health: 'unhealthy',
            service_failures: 3, // 3 or more services failing
            consecutive_failures: 3
        },
        warning: {
            service_failures: 1, // 1 service failing
            consecutive_failures: 2
        }
    }
};

// Simple alert history to track consecutive failures
let alertHistory = {
    consecutiveFailures: 0,
    lastAlertTime: null,
    serviceFailures: {}
};

function loadAlertHistory() {
    try {
        if (fs.existsSync('alert-history.json')) {
            alertHistory = JSON.parse(fs.readFileSync('alert-history.json', 'utf8'));
        }
    } catch (error) {
        console.log('⚠️  Could not load alert history:', error.message);
    }
}

function saveAlertHistory() {
    try {
        fs.writeFileSync('alert-history.json', JSON.stringify(alertHistory, null, 2));
    } catch (error) {
        console.log('⚠️  Could not save alert history:', error.message);
    }
}

function sendAlert(priority, message, services) {
    const timestamp = new Date().toISOString();
    const contacts = ALERT_CONFIG.contacts[priority] || [];
    
    console.log(`\n🚨 ${priority} ALERT - ${timestamp}`);
    console.log(`📋 Message: ${message}`);
    console.log(`🔧 Affected Services: ${services.join(', ')}`);
    console.log(`📞 Contacts to notify:`);
    
    contacts.forEach(contact => {
        console.log(`   - ${contact.name}: ${contact.email}${contact.phone ? ` (${contact.phone})` : ''}`);
    });
    
    // In a real implementation, this would send actual alerts via:
    // - Email (SendGrid, AWS SES, etc.)
    // - SMS (Twilio, AWS SNS, etc.)
    // - Slack/Discord webhooks
    // - PagerDuty API
    
    // Log alert to file for tracking
    const alertLog = {
        timestamp,
        priority,
        message,
        services,
        contacts: contacts.map(c => c.name)
    };
    
    const logFile = 'alerts.log';
    const logEntry = JSON.stringify(alertLog) + '\n';
    fs.appendFileSync(logFile, logEntry);
    
    console.log(`📝 Alert logged to ${logFile}`);
}

function analyzeHealthResults(results) {
    loadAlertHistory();
    
    const unhealthyServices = [];
    let serviceCount = 0;
    
    // Count unhealthy services
    for (const [service, status] of Object.entries(results.services)) {
        serviceCount++;
        if (status === 'unhealthy') {
            unhealthyServices.push(service);
        }
    }
    
    const isOverallUnhealthy = results.overall === 'unhealthy';
    const unhealthyCount = unhealthyServices.length;
    
    // Update failure tracking
    if (isOverallUnhealthy) {
        alertHistory.consecutiveFailures++;
    } else {
        alertHistory.consecutiveFailures = 0;
    }
    
    // Track per-service failures
    for (const service of unhealthyServices) {
        alertHistory.serviceFailures[service] = (alertHistory.serviceFailures[service] || 0) + 1;
    }
    
    // Reset counters for healthy services
    for (const [service, status] of Object.entries(results.services)) {
        if (status === 'healthy') {
            alertHistory.serviceFailures[service] = 0;
        }
    }
    
    saveAlertHistory();
    
    // Determine alert priority and send if needed
    let alertPriority = null;
    let alertMessage = null;
    
    // P0 - Critical Alerts
    if (unhealthyCount >= ALERT_CONFIG.thresholds.critical.service_failures) {
        alertPriority = 'P0';
        alertMessage = `CRITICAL: ${unhealthyCount} services failing - Immediate response required`;
    } else if (alertHistory.consecutiveFailures >= ALERT_CONFIG.thresholds.critical.consecutive_failures) {
        alertPriority = 'P0';
        alertMessage = `CRITICAL: ${alertHistory.consecutiveFailures} consecutive health check failures`;
    }
    // P1 - Warning Alerts
    else if (unhealthyCount >= ALERT_CONFIG.thresholds.warning.service_failures) {
        alertPriority = 'P1';
        alertMessage = `WARNING: ${unhealthyCount} service(s) failing - Response within 1 hour`;
    } else if (alertHistory.consecutiveFailures >= ALERT_CONFIG.thresholds.warning.consecutive_failures) {
        alertPriority = 'P1';
        alertMessage = `WARNING: ${alertHistory.consecutiveFailures} consecutive failures detected`;
    }
    
    // Send alert if needed (but not more than once every 5 minutes for same priority)
    if (alertPriority) {
        const now = Date.now();
        const lastAlert = alertHistory.lastAlertTime || 0;
        const timeSinceLastAlert = now - lastAlert;
        const minAlertInterval = 5 * 60 * 1000; // 5 minutes
        
        if (timeSinceLastAlert > minAlertInterval) {
            sendAlert(alertPriority, alertMessage, unhealthyServices);
            alertHistory.lastAlertTime = now;
            saveAlertHistory();
        } else {
            console.log(`⏳ Alert suppressed - last alert was ${Math.round(timeSinceLastAlert/1000/60)} minutes ago`);
        }
    }
    
    return {
        alertTriggered: !!alertPriority,
        priority: alertPriority,
        message: alertMessage,
        unhealthyServices,
        consecutiveFailures: alertHistory.consecutiveFailures
    };
}

async function runMonitoring() {
    console.log('🔍 Starting monitoring check...');
    
    try {
        const healthResults = await healthCheck();
        const alertAnalysis = analyzeHealthResults(healthResults);
        
        console.log('\n📊 Monitoring Summary:');
        console.log(`   Overall Status: ${healthResults.overall === 'healthy' ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
        console.log(`   Consecutive Failures: ${alertAnalysis.consecutiveFailures}`);
        console.log(`   Unhealthy Services: ${alertAnalysis.unhealthyServices.length}`);
        
        if (alertAnalysis.alertTriggered) {
            console.log(`   🚨 Alert Triggered: ${alertAnalysis.priority} - ${alertAnalysis.message}`);
        } else {
            console.log(`   ✅ No alerts triggered`);
        }
        
        return alertAnalysis;
        
    } catch (error) {
        console.error('❌ Monitoring check failed:', error);
        
        // Send critical alert for monitoring system failure
        sendAlert('P0', `CRITICAL: Monitoring system failure - ${error.message}`, ['monitoring']);
        
        return {
            alertTriggered: true,
            priority: 'P0',
            message: `Monitoring system failure: ${error.message}`,
            error: error.message
        };
    }
}

// Run if called directly
if (require.main === module) {
    runMonitoring()
        .then(result => {
            process.exit(result.alertTriggered && result.priority === 'P0' ? 1 : 0);
        })
        .catch(error => {
            console.error('❌ Monitoring failed:', error);
            process.exit(1);
        });
}

module.exports = { runMonitoring, analyzeHealthResults, ALERT_CONFIG };
