# Meta Aggregator 2.0 - Quick Commands Reference

## 🚀 Essential Commands for Meta Aggregator 2.0

### 1. Start Development Environment

```bash
# Start local blockchain (keep running in background)
npx hardhat node

# In a new terminal - deploy working contract
npx hardhat run scripts/deployFixedEscrow.js --network localhost

# Start frontend application
npm run dev
```

## 🚨 **OPERATIONAL COMMANDS (Production)**

### **Emergency Response (First 5 Minutes)**
```powershell
# Quick health check
node scripts\system-health-check.js quick

# Restart all services
.\scripts\restart-all-services.ps1

# Check for stuck orders
node scripts\emergency-order-fix.js check-stuck 1
```

### **System Diagnostics**
```powershell
# Full system health check
node scripts\system-health-check.js full

# Test all connections
node scripts\test-all-connections.js

# Verify contract deployment
node scripts\verify-contract-deployment.js full

# Manual contract testing
node scripts\manual-contract-test.js full
```

### **Emergency Order Management**
```powershell
# Check stuck orders (last 2 hours)
node scripts\emergency-order-fix.js check-stuck 2

# Fix single order (dry run first)
node scripts\emergency-order-fix.js fix-order ORDER_ID SETTLED "reason" --dry-run

# Fix single order (execute)
node scripts\emergency-order-fix.js fix-order ORDER_ID SETTLED "reason"

# Bulk fix stuck orders (dry run)
node scripts\emergency-order-fix.js bulk-fix 4 SETTLED "system_restart" --dry-run

# Verify order on blockchain
node scripts\emergency-order-fix.js verify-order ORDER_ID

# Generate emergency report
node scripts\emergency-order-fix.js report
```

### **Key Rotation System**
```powershell
# Check key rotation status
node security\key-rotation\orchestrator.js status

# Emergency key rotation
node security\key-rotation\orchestrator.js emergency PRIVATE_KEY "incident_reason"
```

### **Targeted Health Checks**
```powershell
# Database connectivity
node scripts\system-health-check.js database

# Blockchain connectivity
node scripts\system-health-check.js blockchain

# Event listener status
node scripts\system-health-check.js events

# Key rotation system
node scripts\system-health-check.js keys

# System resources
node scripts\system-health-check.js resources
```

### **Event and Activity Monitoring**
```powershell
# Check recent blockchain events
node scripts\check-recent-events.js --contract=escrow --hours=1

# Check recent database updates
node scripts\check-recent-db-updates.js --minutes=30
```

### 2. Testing Commands

```bash
# Run complete end-to-end test
npx hardhat run scripts/endToEndTest.js --network localhost

# Run frontend integration test  
npx hardhat run scripts/frontendIntegrationTest.js --network localhost

# Run simple contract test
npx hardhat run scripts/testSimpleContract.js --network localhost
```

### 3. Contract Deployment

```bash
# Deploy FixedEscrow to local network
npx hardhat run scripts/deployFixedEscrow.js --network localhost

# Compile contracts (if needed)
npx hardhat compile --force

# Check contract status
npx hardhat run scripts/checkEscrowStatus.js --network localhost
```

### 4. Troubleshooting

```bash
# If port 8545 is busy, kill existing Hardhat processes
taskkill /f /im node.exe

# Clean and recompile contracts
npx hardhat clean
npx hardhat compile

# Debug contract deployment
npx hardhat run scripts/debugContract.js --network localhost
```

## 📁 Key File Locations

### Smart Contracts:
- **Working Contract**: `contracts/FixedEscrow.sol`
- **ABI Location**: `artifacts/contracts/FixedEscrow.sol/FixedEscrow.json`

### Frontend Configuration:
- **Contract Address**: `frontend/src/config/escrowAddress.js`
- **Main Component**: `components/SwapWidget.tsx`

### Test Scripts:
- **End-to-End**: `scripts/endToEndTest.js`
- **Frontend Integration**: `scripts/frontendIntegrationTest.js`
- **Deployment**: `scripts/deployFixedEscrow.js`

## 🎯 Current Status

- ✅ **FixedEscrow Contract**: Fully functional
- ✅ **Frontend Integration**: Complete
- ✅ **Testing Suite**: All tests passing
- ✅ **Local Development**: Ready

## 🚀 Ready for Production

The Meta Aggregator 2.0 escrow system is now fully operational and ready for:
- Frontend UI testing
- Testnet deployment  
- Production deployment
- Full platform integration

**All critical contract issues have been resolved!**
