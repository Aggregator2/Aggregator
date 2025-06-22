#!/usr/bin/env node

// Simple Key Rotation Setup Script
// Creates the key rotation system without additional dependencies

const fs = require('fs').promises;
const path = require('path');

async function createKeyRotationSetup() {
    console.log('🚀 Setting up Meta Aggregator 2.0 Key Rotation System...');
    
    try {
        // 1. Create directory structure
        const dirs = [
            'security/keys',
            'security/backups',
            'security/logs'
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
            console.log(`✅ Created directory: ${dir}`);
        }
        
        // 2. Create environment template
        const envTemplate = `# Meta Aggregator 2.0 Key Rotation Configuration
# Copy this to .env.local and update values

# Current Keys (will be rotated)
PRIVATE_KEY=your_private_key_here
ARBITER_PRIVATE_KEY=your_arbiter_private_key_here

# Key Rotation Settings
KEY_ENCRYPTION_PASSWORD=your_secure_encryption_password
ROTATION_INTERVAL_DAYS=30
ROTATION_SCHEDULE="0 2 * * *"

# Monitoring Settings
MONITORING_INTERVAL=60
ALERT_EMAIL=your_email@example.com
ALERT_WEBHOOK=https://your-webhook-url.com
SLACK_WEBHOOK=https://hooks.slack.com/your-webhook

# Network Settings
RPC_URL=https://polygon-mainnet.infura.io/v3/your-key
TEST_RPC_URL=https://polygon-mumbai.infura.io/v3/your-key

# Contract Addresses
ESCROW_CONTRACT_ADDRESS=your_escrow_contract_address
FIXED_ESCROW_CONTRACT_ADDRESS=your_fixed_escrow_contract_address
`;
        
        await fs.writeFile('security/.env.template', envTemplate);
        console.log('✅ Created environment template: security/.env.template');
        
        // 3. Create startup script
        const startupScript = `#!/usr/bin/env node

// Meta Aggregator 2.0 Key Rotation Startup Script
const { spawn } = require('child_process');
const path = require('path');

console.log('🔐 Meta Aggregator 2.0 Key Rotation System');
console.log('==========================================');

const command = process.argv[2];

switch (command) {
    case 'init':
        console.log('🔧 Initializing key rotation system...');
        const orchestrator = require('./security/key-rotation/orchestrator.js');
        const manager = new orchestrator();
        manager.initialize().then(() => {
            console.log('✅ System initialized successfully');
        }).catch(console.error);
        break;

    case 'rotate':
        const keyType = process.argv[3];
        if (!keyType) {
            console.log('❌ Please specify key type: PRIVATE_KEY or ARBITER_PRIVATE_KEY');
            process.exit(1);
        }
        console.log(\`🔄 Rotating \${keyType}...\`);
        // Manual rotation code here
        break;

    case 'test':
        console.log('🧪 Running key rotation tests...');
        const testScript = spawn('node', ['security/key-rotation/test-suite.js', 'run'], {
            stdio: 'inherit'
        });
        break;

    case 'monitor':
        console.log('📊 Starting monitoring...');
        const monitorScript = spawn('node', ['security/key-rotation/monitoring.js', 'start'], {
            stdio: 'inherit'
        });
        break;

    default:
        console.log('USAGE: node key-rotation.js <command>');
        console.log('');
        console.log('COMMANDS:');
        console.log('  init     Initialize the key rotation system');
        console.log('  rotate   Rotate a specific key');
        console.log('  test     Run system tests');
        console.log('  monitor  Start monitoring service');
        console.log('');
        console.log('EXAMPLES:');
        console.log('  node key-rotation.js init');
        console.log('  node key-rotation.js rotate PRIVATE_KEY');
        console.log('  node key-rotation.js test');
        console.log('  node key-rotation.js monitor');
}
`;
        
        await fs.writeFile('key-rotation.js', startupScript);
        console.log('✅ Created startup script: key-rotation.js');
        
        // 4. Create README
        const readme = `# Meta Aggregator 2.0 Key Rotation System

## Quick Setup

1. **Copy environment template:**
   \`\`\`bash
   copy security\\.env.template .env.local
   \`\`\`

2. **Edit .env.local with your actual values:**
   - Update PRIVATE_KEY and ARBITER_PRIVATE_KEY
   - Set a secure KEY_ENCRYPTION_PASSWORD
   - Configure alert settings (optional)

3. **Initialize the system:**
   \`\`\`bash
   node key-rotation.js init
   \`\`\`

4. **Test the system:**
   \`\`\`bash
   node key-rotation.js test
   \`\`\`

## Key Rotation Commands

### Manual Rotation
\`\`\`bash
# Rotate backend signing key
node security/key-rotation/orchestrator.js rotate PRIVATE_KEY

# Rotate escrow arbiter key  
node security/key-rotation/orchestrator.js rotate ARBITER_PRIVATE_KEY
\`\`\`

### Emergency Rotation
\`\`\`bash
# Emergency rotation due to security breach
node security/key-rotation/orchestrator.js emergency PRIVATE_KEY security_breach
\`\`\`

### Start Automated Services
\`\`\`bash
# Start scheduled rotation (runs in background)
node security/key-rotation/scheduled-rotation.js start

# Start monitoring service
node security/key-rotation/monitoring.js start

# Start complete orchestrator
node security/key-rotation/orchestrator.js start
\`\`\`

### System Status
\`\`\`bash
# Check system status
node security/key-rotation/orchestrator.js status

# Generate health report
node security/key-rotation/orchestrator.js report

# Run tests
node security/key-rotation/test-suite.js run
\`\`\`

## File Structure

\`\`\`
security/
├── key-rotation/
│   ├── KeyRotationManager.js     # Core rotation logic
│   ├── orchestrator.js           # Main orchestrator
│   ├── scheduled-rotation.js     # Automated scheduling
│   ├── event-rotation.js         # Event-based rotation
│   ├── monitoring.js             # Health monitoring
│   ├── validate-keys.js          # Key validation
│   ├── manual-rotation.js        # Manual rotation interface
│   └── test-suite.js             # Comprehensive tests
├── keys/                         # Encrypted key storage
├── backups/                      # Key backups
├── logs/                         # Rotation logs
└── .env.template                 # Environment template
\`\`\`

## Security Features

- ✅ **AES-256-CBC Encryption** - All keys encrypted at rest
- ✅ **Versioned Key Storage** - Track key versions and history
- ✅ **Automated Backups** - Old keys safely backed up before rotation
- ✅ **Comprehensive Validation** - Test keys before activation
- ✅ **Event-Based Triggers** - React to security events
- ✅ **Scheduled Rotation** - Automatic 30-day rotation cycle
- ✅ **Emergency Procedures** - Fast rotation for security breaches
- ✅ **Health Monitoring** - Continuous system health checks
- ✅ **Alert System** - Email/Webhook/Slack notifications
- ✅ **Audit Logging** - Complete rotation history

## Production Deployment

1. Set NODE_ENV=production in environment
2. Configure proper alert channels
3. Set up monitoring dashboards
4. Test emergency procedures
5. Document incident response procedures

## Troubleshooting

### Common Issues

1. **Permission Errors**: Ensure proper file permissions for security/ directory
2. **Encryption Errors**: Verify KEY_ENCRYPTION_PASSWORD is set correctly
3. **Network Errors**: Check RPC_URL configuration
4. **Key Validation Fails**: Ensure keys are valid Ethereum private keys

### Support

- Check logs in security/logs/
- Run diagnostic: \`node security/key-rotation/test-suite.js run\`
- Validate configuration: \`node security/key-rotation/orchestrator.js status\`
`;

        await fs.writeFile('security/KEY_ROTATION_README.md', readme);
        console.log('✅ Created documentation: security/KEY_ROTATION_README.md');
        
        // 5. Create simplified dependencies check
        const depsCheck = `#!/usr/bin/env node

// Check if required dependencies are available
const fs = require('fs');

console.log('🔍 Checking dependencies for Key Rotation System...');

const requiredPackages = [
    'ethers',
    'fs',
    'path',
    'crypto',
    'events'
];

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

let allGood = true;

for (const pkg of requiredPackages) {
    if (pkg === 'fs' || pkg === 'path' || pkg === 'crypto' || pkg === 'events') {
        console.log(\`✅ \${pkg} (Node.js built-in)\`);
    } else if (dependencies[pkg]) {
        console.log(\`✅ \${pkg} v\${dependencies[pkg]}\`);
    } else {
        console.log(\`❌ \${pkg} - MISSING\`);
        allGood = false;
    }
}

if (allGood) {
    console.log('\\n🎉 All dependencies available! Key rotation system ready to use.');
} else {
    console.log('\\n⚠️  Some dependencies missing. Install with: npm install ethers');
}
`;

        await fs.writeFile('security/check-deps.js', depsCheck);
        console.log('✅ Created dependency checker: security/check-deps.js');
        
        console.log('\n🎉 Key Rotation System Setup Complete!');
        console.log('\n📋 Next Steps:');
        console.log('1. Run: node security/check-deps.js');
        console.log('2. Copy: security/.env.template to .env.local');
        console.log('3. Edit .env.local with your keys and settings');
        console.log('4. Run: node key-rotation.js init');
        console.log('5. Test: node key-rotation.js test');
        console.log('\n📖 Full documentation: security/KEY_ROTATION_README.md');
        
    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    createKeyRotationSetup().catch(console.error);
}

module.exports = createKeyRotationSetup;
