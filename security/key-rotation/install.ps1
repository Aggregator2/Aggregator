# Key Rotation System Installation Script for Windows PowerShell

param(
    [string]$Environment = "development",
    [switch]$SkipDependencies = $false,
    [switch]$TestInstallation = $false
)

Write-Host "🚀 Installing Meta Aggregator 2.0 Key Rotation System" -ForegroundColor Green
Write-Host "Environment: $Environment" -ForegroundColor Yellow

# Check if running as Administrator for production installations
if ($Environment -eq "production") {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Warning "Production installation should be run as Administrator for proper permissions"
        $continue = Read-Host "Continue anyway? (y/N)"
        if ($continue -ne "y" -and $continue -ne "Y") {
            exit 1
        }
    }
}

# Set working directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Split-Path -Parent $scriptPath
Set-Location $rootPath

Write-Host "📁 Working directory: $rootPath" -ForegroundColor Cyan

# Install Node.js dependencies
if (-not $SkipDependencies) {
    Write-Host "📦 Installing Node.js dependencies..." -ForegroundColor Yellow
    
    # Check if package.json exists in security/key-rotation
    $keyRotationPackage = Join-Path $scriptPath "package.json"
    if (-not (Test-Path $keyRotationPackage)) {
        Write-Host "📝 Creating package.json for key rotation system..." -ForegroundColor Yellow
        
        $packageJson = @{
            name = "meta-aggregator-key-rotation"
            version = "1.0.0"
            description = "Key rotation system for Meta Aggregator 2.0"
            main = "orchestrator.js"
            scripts = @{
                start = "node orchestrator.js start"
                stop = "node orchestrator.js stop"
                status = "node orchestrator.js status"
                test = "node test-suite.js run"
                report = "node orchestrator.js report"
                init = "node orchestrator.js init"
                "rotate:private" = "node orchestrator.js rotate PRIVATE_KEY"
                "rotate:arbiter" = "node orchestrator.js rotate ARBITER_PRIVATE_KEY"
                "emergency:private" = "node orchestrator.js emergency PRIVATE_KEY"
                "emergency:arbiter" = "node orchestrator.js emergency ARBITER_PRIVATE_KEY"
                "monitor:start" = "node monitoring.js start"
                "monitor:check" = "node monitoring.js check"
                "scheduled:start" = "node scheduled-rotation.js start"
                "scheduled:status" = "node scheduled-rotation.js status"
                "manual:rotate" = "node manual-rotation.js"
                "validate:keys" = "node validate-keys.js validate"
                "test:comprehensive" = "node test-suite.js run"
            }
            dependencies = @{
                ethers = "^6.8.0"
                "node-cron" = "^3.0.3"
                crypto = "^1.0.1"
                fs = "^0.0.1-security"
                path = "^0.12.7"
                events = "^3.3.0"
            }
            devDependencies = @{
                "@types/node" = "^20.0.0"
                typescript = "^5.0.0"
            }
            engines = @{
                node = ">=18.0.0"
                npm = ">=8.0.0"
            }
            keywords = @("security", "key-rotation", "ethereum", "blockchain", "escrow")
            author = "Meta Aggregator 2.0 Team"
            license = "MIT"
        }
        
        $packageJson | ConvertTo-Json -Depth 10 | Set-Content $keyRotationPackage -Encoding UTF8
        Write-Host "✅ Created package.json" -ForegroundColor Green
    }
    
    # Install dependencies
    Push-Location $scriptPath
    try {
        npm install
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Dependencies installed successfully" -ForegroundColor Green
        } else {
            Write-Error "❌ Failed to install dependencies"
            exit 1
        }
    } finally {
        Pop-Location
    }
}

# Create directory structure
Write-Host "📁 Creating directory structure..." -ForegroundColor Yellow

$directories = @(
    "security\keys",
    "security\backups", 
    "security\logs",
    "security\test-keys",
    "security\test-backups"
)

foreach ($dir in $directories) {
    $fullPath = Join-Path $rootPath $dir
    if (-not (Test-Path $fullPath)) {
        New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
        Write-Host "  ✅ Created: $dir" -ForegroundColor Green
    } else {
        Write-Host "  ℹ️ Exists: $dir" -ForegroundColor Gray
    }
}

# Set proper permissions for security directories
Write-Host "🔒 Setting directory permissions..." -ForegroundColor Yellow

$securityPath = Join-Path $rootPath "security"
try {
    # Remove inheritance and set restrictive permissions
    $acl = Get-Acl $securityPath
    $acl.SetAccessRuleProtection($true, $false)
    
    # Add current user with full control
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $accessRule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
    $acl.SetAccessRule($accessRule)
    
    # Add SYSTEM with full control
    $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
    $acl.SetAccessRule($systemRule)
    
    Set-Acl -Path $securityPath -AclObject $acl
    Write-Host "✅ Security permissions configured" -ForegroundColor Green
} catch {
    Write-Warning "⚠️ Could not set restrictive permissions: $($_.Exception.Message)"
}

# Check for existing .env.local file
$envFile = Join-Path $rootPath ".env.local"
Write-Host "🔧 Checking environment configuration..." -ForegroundColor Yellow

if (-not (Test-Path $envFile)) {
    Write-Host "📝 Creating .env.local template..." -ForegroundColor Yellow
    
    $envTemplate = @"
# Meta Aggregator 2.0 - Key Rotation System Configuration
# Generated on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

# Current Keys (will be managed by rotation system)
PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000
ARBITER_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000

# Rotation Configuration
ROTATION_INTERVAL_DAYS=30
ROTATION_SCHEDULE="0 2 * * *"
KEY_ENCRYPTION_PASSWORD=CHANGE_THIS_PASSWORD_TO_SOMETHING_SECURE

# Monitoring Configuration
MONITORING_INTERVAL=60

# Alert Configuration (optional)
ALERT_EMAIL=
ALERT_WEBHOOK=
SLACK_WEBHOOK=

# Blockchain Configuration
RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_INFURA_KEY
TEST_RPC_URL=https://polygon-mumbai.infura.io/v3/YOUR_INFURA_KEY

# Contract Addresses (update with your deployed contracts)
ESCROW_CONTRACT_ADDRESS=
FIXED_ESCROW_CONTRACT_ADDRESS=

# Development/Testing
NODE_ENV=$Environment
DEBUG=key-rotation:*
"@
    
    $envTemplate | Set-Content $envFile -Encoding UTF8
    Write-Host "✅ Created .env.local template" -ForegroundColor Green
    Write-Host "⚠️ IMPORTANT: Update the values in .env.local before running the system!" -ForegroundColor Red
} else {
    Write-Host "ℹ️ .env.local already exists" -ForegroundColor Gray
}

# Make scripts executable (PowerShell equivalent)
Write-Host "🔧 Making scripts executable..." -ForegroundColor Yellow

$scripts = @(
    "orchestrator.js",
    "scheduled-rotation.js",
    "event-rotation.js",
    "monitoring.js",
    "manual-rotation.js",
    "validate-keys.js",
    "test-suite.js"
)

foreach ($script in $scripts) {
    $scriptPath = Join-Path (Join-Path $rootPath "security\key-rotation") $script
    if (Test-Path $scriptPath) {
        # Add executable permissions (Windows doesn't need chmod, but we can verify the file)
        Write-Host "  ✅ Verified: $script" -ForegroundColor Green
    } else {
        Write-Warning "  ⚠️ Missing: $script"
    }
}

# Initialize the key rotation system
Write-Host "🚀 Initializing key rotation system..." -ForegroundColor Yellow

Push-Location (Join-Path $rootPath "security\key-rotation")
try {
    node orchestrator.js init
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Key rotation system initialized" -ForegroundColor Green
    } else {
        Write-Error "❌ Failed to initialize key rotation system"
        exit 1
    }
} finally {
    Pop-Location
}

# Run installation tests if requested
if ($TestInstallation) {
    Write-Host "🧪 Running installation tests..." -ForegroundColor Yellow
    
    Push-Location (Join-Path $rootPath "security\key-rotation")
    try {
        node test-suite.js run
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ All installation tests passed" -ForegroundColor Green
        } else {
            Write-Warning "⚠️ Some tests failed - check output above"
        }
    } finally {
        Pop-Location
    }
}

# Create Windows service script (optional)
Write-Host "🔧 Creating Windows service management scripts..." -ForegroundColor Yellow

$serviceScript = @"
# Meta Aggregator 2.0 Key Rotation Service Management
# Use these commands to manage the key rotation system as a Windows service

# Start the key rotation system
function Start-KeyRotationSystem {
    Set-Location "$rootPath\security\key-rotation"
    Start-Process -FilePath "node" -ArgumentList "orchestrator.js", "start" -NoNewWindow
    Write-Host "🚀 Key rotation system started" -ForegroundColor Green
}

# Stop the key rotation system
function Stop-KeyRotationSystem {
    Get-Process -Name "node" | Where-Object { `$_.CommandLine -like "*orchestrator.js*" } | Stop-Process -Force
    Write-Host "🛑 Key rotation system stopped" -ForegroundColor Yellow
}

# Check system status
function Get-KeyRotationStatus {
    Set-Location "$rootPath\security\key-rotation"
    node orchestrator.js status
}

# Rotate a specific key
function Invoke-KeyRotation {
    param([string]`$KeyType)
    Set-Location "$rootPath\security\key-rotation"
    node orchestrator.js rotate `$KeyType
}

# Emergency key rotation
function Invoke-EmergencyRotation {
    param([string]`$KeyType, [string]`$Reason = "manual_emergency")
    Set-Location "$rootPath\security\key-rotation"
    node orchestrator.js emergency `$KeyType `$Reason
}

# Generate health report
function Get-KeyRotationReport {
    Set-Location "$rootPath\security\key-rotation"
    node orchestrator.js report
}

# Export functions
Export-ModuleMember -Function Start-KeyRotationSystem, Stop-KeyRotationSystem, Get-KeyRotationStatus, Invoke-KeyRotation, Invoke-EmergencyRotation, Get-KeyRotationReport

Write-Host "Key Rotation PowerShell Module Loaded" -ForegroundColor Green
Write-Host "Available commands:" -ForegroundColor Cyan
Write-Host "  Start-KeyRotationSystem" -ForegroundColor White
Write-Host "  Stop-KeyRotationSystem" -ForegroundColor White
Write-Host "  Get-KeyRotationStatus" -ForegroundColor White
Write-Host "  Invoke-KeyRotation -KeyType PRIVATE_KEY" -ForegroundColor White
Write-Host "  Invoke-EmergencyRotation -KeyType PRIVATE_KEY -Reason security_breach" -ForegroundColor White
Write-Host "  Get-KeyRotationReport" -ForegroundColor White
"@

$moduleScript = Join-Path $rootPath "security\KeyRotationModule.psm1"
$serviceScript | Set-Content $moduleScript -Encoding UTF8
Write-Host "✅ Created PowerShell module: security\KeyRotationModule.psm1" -ForegroundColor Green

# Create startup script
$startupScript = @"
# Meta Aggregator 2.0 Key Rotation System Startup Script
# Run this script to start the key rotation system

param(
    [string]`$Environment = "production"
)

# Import the key rotation module
Import-Module "$moduleScript" -Force

Write-Host "🚀 Starting Meta Aggregator 2.0 Key Rotation System" -ForegroundColor Green
Write-Host "Environment: `$Environment" -ForegroundColor Yellow

# Set environment variable
`$env:NODE_ENV = `$Environment

# Start the system
Start-KeyRotationSystem

# Keep script running and monitor
while (`$true) {
    Start-Sleep -Seconds 300  # Check every 5 minutes
    
    # Check if the process is still running
    `$process = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { `$_.CommandLine -like "*orchestrator.js*" }
    
    if (-not `$process) {
        Write-Warning "⚠️ Key rotation system process not found. Restarting..."
        Start-KeyRotationSystem
    }
}
"@

$startupScriptPath = Join-Path $rootPath "security\start-key-rotation.ps1"
$startupScript | Set-Content $startupScriptPath -Encoding UTF8
Write-Host "✅ Created startup script: security\start-key-rotation.ps1" -ForegroundColor Green

# Final summary
Write-Host ""
Write-Host "🎉 Installation Complete!" -ForegroundColor Green
Write-Host "=" * 50
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Yellow
Write-Host "1. Edit .env.local with your actual keys and configuration" -ForegroundColor White
Write-Host "2. Update RPC URLs and contract addresses" -ForegroundColor White
Write-Host "3. Set a secure KEY_ENCRYPTION_PASSWORD" -ForegroundColor White
Write-Host "4. Configure alert channels (email, webhook, Slack)" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Quick Start Commands:" -ForegroundColor Cyan
Write-Host "# Import PowerShell module"
Write-Host "Import-Module .\security\KeyRotationModule.psm1" -ForegroundColor White
Write-Host ""
Write-Host "# Start the system"
Write-Host "Start-KeyRotationSystem" -ForegroundColor White
Write-Host ""
Write-Host "# Or use Node.js directly"
Write-Host "cd security\key-rotation" -ForegroundColor White
Write-Host "node orchestrator.js start" -ForegroundColor White
Write-Host ""
Write-Host "🧪 Test the installation:" -ForegroundColor Cyan
Write-Host "cd security\key-rotation" -ForegroundColor White
Write-Host "node test-suite.js run" -ForegroundColor White
Write-Host ""
Write-Host "📊 Check system status:" -ForegroundColor Cyan
Write-Host "cd security\key-rotation" -ForegroundColor White
Write-Host "node orchestrator.js status" -ForegroundColor White
Write-Host ""
Write-Host "📖 Documentation: security\key-rotation\README.md" -ForegroundColor Cyan
Write-Host ""

if ($Environment -eq "production") {
    Write-Host "⚠️ PRODUCTION DEPLOYMENT CHECKLIST:" -ForegroundColor Red
    Write-Host "□ Secure the .env.local file with proper permissions" -ForegroundColor Yellow
    Write-Host "□ Test key rotation in staging environment first" -ForegroundColor Yellow
    Write-Host "□ Configure monitoring and alerting" -ForegroundColor Yellow
    Write-Host "□ Set up backup procedures" -ForegroundColor Yellow
    Write-Host "□ Create incident response procedures" -ForegroundColor Yellow
    Write-Host "□ Schedule regular security reviews" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "✅ Meta Aggregator 2.0 Key Rotation System is ready!" -ForegroundColor Green
