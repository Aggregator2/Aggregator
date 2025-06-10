# Meta Aggregator 2.0 - Operational Incident Response Runbook

## 🚨 **EMERGENCY CONTACT INFORMATION**

**Primary On-Call:** @Joseph (Senior Developer)  
**Secondary:** Senior Development Team  
**Infrastructure:** Chain Provider Support (Alchemy/Moralis)  
**Database:** Supabase Support  
**Monitoring:** Logtail/Grafana/Sentry Alerts  

---

## 🔍 **1. FAILURE DETECTION METHODS**

### **A. State Transition Failures**
```
SYMPTOMS:
- Orders stuck in PENDING state (should → SETTLED)
- Frontend shows "Processing..." indefinitely
- No status updates after blockchain confirmation
```

**Detection Commands:**
```powershell
# Check stuck orders
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
supabase.from('orders').select('*').eq('state', 'PENDING').then(console.log);
"

# Check last 24h orders by state
node scripts/check-order-states.js --hours=24
```

### **B. Event Listener Failures**
```
SYMPTOMS:
- No logs from event listeners in past X minutes
- Contract events emitted but not processed
- Backend process shows as running but no activity
```

**Detection Commands:**
```powershell
# Check if listener process is running
Get-Process -Name "node" | Where-Object { $_.CommandLine -like "*listener*" }

# Check recent logs
Get-Content -Path "logs/event-listener.log" -Tail 50

# Test event listener connection
node scripts/test-event-connection.js
```

### **C. Frontend Polling Timeouts**
```
SYMPTOMS:
- Frontend shows connection errors
- Polling requests timing out
- WebSocket connections dropping
```

**Detection Commands:**
```powershell
# Check API health
curl http://localhost:3001/health

# Test WebSocket connection
node scripts/test-websocket.js

# Check frontend polling logs
Get-Content -Path "logs/frontend-polling.log" -Tail 20
```

### **D. Monitoring Tool Alerts**
```
ALERT SOURCES:
- Logtail: Error rate spikes, missing log patterns
- Grafana: Response time/throughput anomalies
- Sentry: JavaScript/Node.js exceptions
- Custom: Key rotation health checks
```

---

## ⚡ **2. IMMEDIATE ACTIONS (First 5 Minutes)**

### **Priority 1: Service Restart**
```powershell
# Restart backend listener service
pm2 restart listener

# If no PM2, restart manually
Stop-Process -Name "node" -Force
Start-Process -FilePath "node" -ArgumentList "Backend server/index.js"

# Restart key rotation monitoring
node security/key-rotation/orchestrator.js stop
node security/key-rotation/orchestrator.js start
```

### **Priority 2: Quick Health Check**
```powershell
# System health overview
node security/key-rotation/orchestrator.js report

# Database connectivity
node -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
supabase.from('orders').select('count').limit(1).then(r => console.log('DB OK:', r));
"

# Blockchain connectivity
node -e "
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
provider.getBlockNumber().then(n => console.log('Block:', n));
"
```

### **Priority 3: Check Recent Events**
```powershell
# Check if events were actually emitted on-chain
node scripts/check-recent-events.js --contract=escrow --hours=1

# Verify Supabase received updates
node scripts/check-recent-db-updates.js --minutes=30
```

---

## 🔧 **3. DIAGNOSTIC STEPS (Next 15 Minutes)**

### **A. Contract Verification**
```powershell
# Verify contract address matches deployed version
node scripts/verify-contract-deployment.js

# Check contract ABI version
node -e "
const fs = require('fs');
const abi = JSON.parse(fs.readFileSync('artifacts/contracts/Escrow.sol/Escrow.json'));
console.log('ABI Hash:', require('crypto').createHash('md5').update(JSON.stringify(abi.abi)).digest('hex'));
"

# Test contract call manually
node scripts/manual-contract-test.js
```

### **B. Network Configuration Check**
```powershell
# Verify network ID
node -e "
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
provider.getNetwork().then(n => console.log('Network:', n));
"

# Test RPC endpoint health
curl -X POST $env:RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check if using correct contract address for network
node scripts/verify-network-contracts.js
```

### **C. Manual Event Testing**
```powershell
# Test event emission via Hardhat console
npx hardhat console --network polygon
# In console:
# > const escrow = await ethers.getContractAt("Escrow", "CONTRACT_ADDRESS");
# > await escrow.testEmitEvent();

# Test event listener manually
node scripts/manual-event-test.js --event=EscrowReleased --timeout=60
```

### **D. Event Listener Subscription Check**
```powershell
# Check if listener is properly subscribed
node -e "
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
console.log('Listeners:', provider.listenerCount());
console.log('WebSocket status:', provider._websocket?.readyState);
"

# Test subscription health
node scripts/test-event-subscription.js
```

---

## 🛠️ **4. ROLLBACK & MANUAL FIXES**

### **A. Emergency State Update (High Priority Orders)**
```sql
-- Update stuck order state manually (LOG THIS ACTION)
UPDATE orders 
SET state = 'SETTLED', 
    updated_at = NOW(),
    notes = CONCAT(COALESCE(notes, ''), ' [MANUAL FIX: ', NOW(), ']')
WHERE id = 'ORDER_ID_HERE' 
AND state = 'PENDING';

-- Check impact
SELECT state, COUNT(*) FROM orders 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY state;
```

**Execution Script:**
```powershell
# Create manual fix script
node scripts/emergency-order-fix.js --order-id=ORDER_ID --new-state=SETTLED --reason="Event listener failure"

# Bulk fix for multiple orders
node scripts/bulk-order-fix.js --stuck-since="2 hours ago" --dry-run
node scripts/bulk-order-fix.js --stuck-since="2 hours ago" --execute
```

### **B. Fake Event Trigger (Development/Testing)**
```powershell
# Emit fake event on testnet to retrigger listener
node scripts/emit-fake-event.js --network=testnet --order-id=ORDER_ID

# Local development event simulation
node scripts/simulate-event.js --event=EscrowReleased --data='{"orderId":"123","amount":"1000"}'
```

### **C. Service Recovery**
```powershell
# Full service restart sequence
./scripts/restart-all-services.ps1

# Key rotation emergency procedures
node security/key-rotation/orchestrator.js emergency PRIVATE_KEY "event_listener_failure"

# Database connection pool reset
node scripts/reset-db-pool.js
```

---

## 📞 **5. ESCALATION PROTOCOL**

### **Level 1: Development Team (0-30 mins)**
```
TRIGGER: Basic service restart doesn't resolve issue
ACTION: Contact @Joseph or senior developers
INFO TO PROVIDE:
- Error messages from logs
- Affected order count
- Timeline of failure
- Steps already attempted
```

### **Level 2: Infrastructure Support (30-60 mins)**
```
TRIGGER: Network or RPC issues suspected
ACTION: Contact chain infrastructure provider
PROVIDERS:
- Alchemy Support: support@alchemy.com
- Moralis Support: help@moralis.io
- Polygon Support: support@polygon.technology

INFO TO PROVIDE:
- RPC endpoint being used
- Error codes/messages
- Expected vs actual behavior
- Traffic volume during failure
```

### **Level 3: Database Support (Critical Data Issues)**
```
TRIGGER: Supabase connectivity or data corruption
ACTION: Contact Supabase Support
EMAIL: support@supabase.com
PRIORITY: Critical production issue

INFO TO PROVIDE:
- Project ID
- Error logs
- Affected table/query
- Data consistency issues
```

### **Level 4: Emergency Maintenance (Service Down)**
```
TRIGGER: Complete service unavailability
ACTION: Declare maintenance window
STEPS:
1. Update status page
2. Notify users via Discord/Twitter
3. Implement temporary workaround
4. Full system diagnostic
```

---

## 🛡️ **6. PREVENTION & MONITORING SETUP**

### **A. Cron Fallback System**
```powershell
# Setup fallback event checker (runs every 5 minutes)
# Add to Windows Task Scheduler or use PM2 cron

# Content of fallback-event-checker.js:
node scripts/fallback-event-checker.js --interval=300 --max-delay=600
```

**Fallback Script Template:**
```javascript
// scripts/fallback-event-checker.js
const { ethers } = require('ethers');
const { createClient } = require('@supabase/supabase-js');

async function checkMissingEvents() {
    // Get orders in PENDING state for > 10 minutes
    const stuckOrders = await supabase
        .from('orders')
        .select('*')
        .eq('state', 'PENDING')
        .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());

    for (const order of stuckOrders.data) {
        // Check if blockchain event exists but wasn't processed
        const events = await contract.queryFilter(
            contract.filters.EscrowReleased(order.id),
            order.block_number
        );
        
        if (events.length > 0) {
            console.log(`Found missing event for order ${order.id}, processing...`);
            await processEvent(events[0]);
        }
    }
}
```

### **B. Auto-Reconnect Logic**
```javascript
// In event listener code
provider.on('error', (error) => {
    console.error('Provider error:', error);
    setTimeout(() => {
        console.log('Attempting to reconnect...');
        setupEventListeners();
    }, 5000);
});

// WebSocket connection monitoring
setInterval(() => {
    if (provider._websocket?.readyState !== 1) {
        console.log('WebSocket disconnected, reconnecting...');
        provider._websocket?.close();
        setupEventListeners();
    }
}, 30000);
```

### **C. Enhanced Logging**
```javascript
// Event listener with comprehensive logging
contract.on('EscrowReleased', async (orderId, amount, event) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        event: 'EscrowReleased',
        orderId: orderId.toString(),
        amount: amount.toString(),
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
        status: 'received'
    };
    
    console.log('EVENT_LOG:', JSON.stringify(logEntry));
    
    try {
        await processEscrowRelease(orderId, amount);
        console.log('EVENT_LOG:', JSON.stringify({...logEntry, status: 'processed'}));
    } catch (error) {
        console.log('EVENT_LOG:', JSON.stringify({...logEntry, status: 'failed', error: error.message}));
        throw error;
    }
});
```

### **D. Health Check Endpoints**
```javascript
// Express health check route
app.get('/health', async (req, res) => {
    try {
        // Check database
        const dbTest = await supabase.from('orders').select('count').limit(1);
        
        // Check blockchain
        const blockNumber = await provider.getBlockNumber();
        
        // Check event listener
        const listenerCount = provider.listenerCount();
        
        // Check key rotation health
        const keyHealth = await checkKeyRotationHealth();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            database: dbTest.error ? 'unhealthy' : 'healthy',
            blockchain: blockNumber > 0 ? 'healthy' : 'unhealthy',
            eventListeners: listenerCount > 0 ? 'healthy' : 'unhealthy',
            keyRotation: keyHealth.status,
            blockNumber,
            listenerCount
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});
```

---

## 📋 **7. QUICK REFERENCE COMMANDS**

### **Diagnostic Commands**
```powershell
# Quick system status
node security/key-rotation/orchestrator.js status

# Check stuck orders
node scripts/check-stuck-orders.js

# Test all connections
node scripts/test-all-connections.js

# View recent logs
Get-Content -Path "logs/*.log" -Tail 100 | Sort-Object

# Emergency key rotation
node security/key-rotation/orchestrator.js emergency PRIVATE_KEY "system_failure"
```

### **Recovery Commands**
```powershell
# Full service restart
./scripts/restart-all-services.ps1

# Database cleanup
node scripts/cleanup-stuck-orders.js --older-than="1 hour"

# Event resync
node scripts/resync-events.js --from-block=BLOCK_NUMBER

# Manual order fix
node scripts/fix-order.js --order-id=ORDER_ID --new-state=SETTLED
```

### **Monitoring Commands**
```powershell
# Real-time log monitoring
Get-Content -Path "logs/event-listener.log" -Wait

# Performance metrics
node scripts/get-performance-metrics.js

# Alert testing
node scripts/test-alerts.js --type=email --type=webhook

# System health report
node scripts/generate-health-report.js --format=json
```

---

## 🚨 **8. EMERGENCY CONTACTS & PROCEDURES**

### **Critical Failure Response Team**
```
PRIMARY: @Joseph (Development Lead)
BACKUP: Senior Development Team
INFRASTRUCTURE: DevOps Team
EXTERNAL: Chain Provider Support

RESPONSE TIMES:
- P1 (Service Down): 15 minutes
- P2 (Degraded): 1 hour  
- P3 (Non-critical): 4 hours
```

### **Communication Channels**
```
INTERNAL: Development Slack Channel
EXTERNAL: Discord #status-updates
PUBLIC: Twitter @MetaAggregator
STATUS: status.metaaggregator.com
```

### **Decision Matrix**
```
SERVICE DOWN (0-15 min):
- Immediate restart attempt
- Quick diagnostics
- Emergency contact if no resolution

DEGRADED PERFORMANCE (15-60 min):
- Detailed diagnostics
- Manual interventions
- Infrastructure team involvement

DATA CORRUPTION (IMMEDIATE):
- Stop all writes
- Emergency backup restore
- Database team escalation
```

---

**🎯 This runbook should be accessible to all team members and updated after each incident to improve response procedures.**
