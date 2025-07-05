# SwappiQ Startup Verification

This document describes the startup verification system for SwappiQ.

## Overview

The `verify-startup.js` script performs comprehensive checks to ensure all services and dependencies are properly configured before starting the SwappiQ application.

## Usage

```bash
# Manual verification
npm run verify:startup

# Automatic verification before dev start
npm run dev  # Runs verify:startup automatically via predev hook

# Direct script execution
node scripts/verify-startup.js
```

## What It Checks

### Critical Requirements ❌ (Will prevent startup)

1. **Node.js Version**: Ensures compatible Node.js version is installed
2. **Redis Server**: Verifies Redis is running and responsive
3. **Hardhat Node**: Checks if local Ethereum node is running
4. **Essential Dependencies**: Confirms core packages are installed
5. **Port Availability**: Ensures port 3000 is available for the main app
6. **Configuration Files**: Verifies critical config files exist
7. **Prisma Schema**: Ensures database schema is present

### Warnings ⚠️ (Non-critical issues)

1. **Environment Files**: Missing .env files
2. **Optional Dependencies**: LiFi SDK and other optional packages
3. **Secondary Ports**: Port conflicts on non-critical ports
4. **System Resources**: Low memory warnings
5. **Database**: Missing database file (can be auto-created)

## Prerequisites Setup

Before running SwappiQ, ensure these services are running:

### 1. Redis Server
```bash
# Start Redis server
redis-server

# Or as background daemon
redis-server --daemonize yes

# Check if running
redis-cli ping
```

### 2. Hardhat Local Node
```bash
# Start Hardhat node in separate terminal
npx hardhat node

# Verify it's running
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://localhost:8545
```

### 3. Database Setup
```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Optional: Seed database
npx prisma db seed
```

### 4. Environment Configuration
```bash
# Copy example environment file
cp .env.example .env

# Edit with your configuration
nano .env
```

## Script Features

### Graceful Error Handling
- Continues checking all services even if some fail
- Provides specific error messages and solutions
- Separates critical issues from warnings

### System Resource Monitoring
- Checks available memory
- Monitors port conflicts
- Validates directory permissions

### Dependency Validation
- Verifies all required packages are installed
- Checks for optional dependencies
- Validates configuration files

### Detailed Reporting
- Color-coded output for easy reading
- Comprehensive error messages
- Quick-fix suggestions for common issues

## Exit Codes

- `0`: All checks passed, ready to start
- `1`: Critical issues found, cannot start safely

## Troubleshooting

### Common Issues

#### Redis Not Running
```bash
# Install Redis (Ubuntu/Debian)
sudo apt-get install redis-server

# Install Redis (macOS)
brew install redis

# Start Redis
redis-server
```

#### Hardhat Node Issues
```bash
# Kill existing Hardhat processes
pkill -f "hardhat node"

# Start fresh Hardhat node
npx hardhat node --reset
```

#### Port Conflicts
```bash
# Find process using port 3000
lsof -i :3000

# Kill process by PID
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev
```

#### Missing Dependencies
```bash
# Reinstall all dependencies
rm -rf node_modules package-lock.json
npm install

# Or update dependencies
npm update
```

### Database Issues
```bash
# Reset database
npx prisma migrate reset

# Generate fresh schema
npx prisma generate

# Apply migrations
npx prisma migrate deploy
```

## Integration with Development Workflow

The verification script is integrated into the development workflow:

1. **Pre-Development**: Runs automatically before `npm run dev`
2. **CI/CD**: Can be used in deployment pipelines
3. **Manual Checks**: Available as standalone command
4. **Health Monitoring**: Can be adapted for production health checks

## Customization

You can modify the script to:

- Add custom service checks
- Modify warning/error thresholds
- Add environment-specific validations
- Integrate with monitoring systems

## Example Output

```
🔍 Verifying SwappiQ startup requirements...

✅ Node.js v20.19.2
✅ Redis is running and responsive
✅ Hardhat node is running
✅ Port 3000 is available
✅ All dependencies installed
✅ Database schema valid

⚠️  Warnings:
⚠️  .env.development not found - some features may not work

✅ All critical checks passed! SwappiQ is ready to start

🚀 To start the application:
   npm run dev     # Start development server
```

This verification system ensures a smooth development experience by catching configuration issues early and providing clear guidance for resolution.