# Meta Aggregator 2.0 - Environment Setup Guide

## 🔧 **Required Environment Variables**

Before using the operational tools, ensure these environment variables are set:

### **Database Connection**
```powershell
$env:SUPABASE_URL = "https://your-project.supabase.co"
$env:SUPABASE_KEY = "your-anon-key"
```

### **Blockchain Connection**
```powershell
$env:RPC_URL = "https://polygon-mainnet.g.alchemy.com/v2/your-api-key"
$env:ESCROW_CONTRACT_ADDRESS = "0x..."
$env:EXPECTED_CHAIN_ID = "137"  # Polygon Mainnet
```

### **Security (Optional for some operations)**
```powershell
$env:PRIVATE_KEY = "0x..."  # For contract interactions
```

---

## ⚡ **Quick Setup Commands**

### **Set Environment Variables (PowerShell)**
```powershell
# Database Configuration
$env:SUPABASE_URL = "YOUR_SUPABASE_URL_HERE"
$env:SUPABASE_KEY = "YOUR_SUPABASE_KEY_HERE"

# Blockchain Configuration
$env:RPC_URL = "YOUR_RPC_URL_HERE"
$env:ESCROW_CONTRACT_ADDRESS = "YOUR_CONTRACT_ADDRESS_HERE"
$env:EXPECTED_CHAIN_ID = "137"
```

### **Verify Setup**
```powershell
# Test database connection
node scripts\system-health-check.js database

# Test blockchain connection
node scripts\system-health-check.js blockchain

# Full health check
node scripts\system-health-check.js full
```

---

## 🧪 **Testing the Setup**

### **1. Test Emergency Tools (Safe Mode)**
```powershell
# Test emergency fixer (dry run)
node scripts\emergency-order-fix.js check-stuck 24

# Test contract verification
node scripts\verify-contract-deployment.js deployment

# Test all connections
node scripts\test-all-connections.js
```

### **2. Test System Health**
```powershell
# Quick health check
node scripts\system-health-check.js quick

# Full comprehensive check
node scripts\system-health-check.js full
```

### **3. Test Service Management**
```powershell
# Test restart script (will restart services)
.\scripts\restart-all-services.ps1
```

---

## 🚨 **Emergency Quick Start**

If you need to respond to an incident immediately:

### **1. Quick Diagnostic (2 minutes)**
```powershell
# Check system health
node scripts\system-health-check.js quick

# Check for stuck orders
node scripts\emergency-order-fix.js check-stuck 1
```

### **2. Immediate Recovery (5 minutes)**
```powershell
# Restart all services
.\scripts\restart-all-services.ps1

# Verify services are running
node scripts\system-health-check.js events
```

### **3. Manual Order Fix (if needed)**
```powershell
# Fix specific order (dry run first)
node scripts\emergency-order-fix.js fix-order ORDER_ID SETTLED "reason" --dry-run

# Execute fix (remove --dry-run)
node scripts\emergency-order-fix.js fix-order ORDER_ID SETTLED "reason"
```

---

## 📋 **Troubleshooting**

### **"Supabase client not initialized"**
- Set SUPABASE_URL and SUPABASE_KEY environment variables
- Verify URL format: `https://your-project.supabase.co`

### **"Cannot connect to RPC"**
- Set RPC_URL environment variable
- Test: `node scripts\system-health-check.js blockchain`

### **"Contract not found"**
- Set ESCROW_CONTRACT_ADDRESS environment variable
- Verify contract exists: `node scripts\verify-contract-deployment.js deployment`

### **"PM2 not found"**
- Install PM2: `npm install -g pm2`
- Or use direct node commands in restart script

---

## 🔗 **Integration Points**

### **Key Rotation System**
```powershell
# Check key rotation health
node security\key-rotation\orchestrator.js status

# Emergency key rotation
node security\key-rotation\orchestrator.js emergency PRIVATE_KEY "reason"
```

### **Monitoring Systems**
- **Logtail:** Configure log forwarding
- **Grafana:** Set up health check endpoints
- **Sentry:** JavaScript error tracking

---

## 📞 **Support Contacts**

**Development Team:** @Joseph  
**Infrastructure:** Chain Provider Support  
**Database:** Supabase Support  
**Documentation:** `OPERATIONAL_INCIDENT_RESPONSE.md`  

---

**🎯 After setting up environment variables, run `node scripts\system-health-check.js full` to verify everything is working correctly.**
