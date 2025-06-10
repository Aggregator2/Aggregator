# Meta Aggregator 2.0 - Service Restart Script
# Emergency service restart for all critical components

param(
    [switch]$Force,
    [switch]$SkipHealthCheck,
    [int]$TimeoutSeconds = 30
)

Write-Host "🚨 Meta Aggregator 2.0 - Emergency Service Restart" -ForegroundColor Yellow
Write-Host "=" * 50

# Check if running as administrator
$currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Warning "⚠️  This script should be run as Administrator for best results"
}

# Function to safely stop processes
function Stop-ServiceSafely {
    param($ProcessName, $ServiceName)
    
    Write-Host "🛑 Stopping $ServiceName..." -ForegroundColor Red
    
    try {
        # Try PM2 first
        if (Get-Command pm2 -ErrorAction SilentlyContinue) {
            Write-Host "   Using PM2 to stop $ServiceName"
            pm2 stop $ProcessName 2>$null
            pm2 delete $ProcessName 2>$null
        }
        
        # Force kill Node.js processes if needed
        $processes = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -like "*$ProcessName*" -or
            $_.CommandLine -like "*Backend server*" -or
            $_.CommandLine -like "*listener*"
        }
        
        if ($processes) {
            Write-Host "   Found $($processes.Count) Node.js processes to stop"
            $processes | ForEach-Object {
                Write-Host "   Stopping PID $($_.Id): $($_.ProcessName)"
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
        }
        
        Write-Host "✅ $ServiceName stopped successfully"
        return $true
    }
    catch {
        Write-Warning "❌ Failed to stop $ServiceName : $($_.Exception.Message)"
        return $false
    }
}

# Function to start services
function Start-ServiceSafely {
    param($Command, $ServiceName, $WorkingDirectory = $null)
    
    Write-Host "🚀 Starting $ServiceName..." -ForegroundColor Green
    
    try {
        if ($WorkingDirectory) {
            Push-Location $WorkingDirectory
        }
        
        # Start service based on type
        if (Get-Command pm2 -ErrorAction SilentlyContinue) {
            Write-Host "   Using PM2 to start $ServiceName"
            Invoke-Expression $Command
        } else {
            Write-Host "   Starting $ServiceName directly"
            Start-Process -FilePath "node" -ArgumentList $Command.Replace("pm2 start ", "").Replace(" --name listener", "") -NoNewWindow
        }
        
        Start-Sleep -Seconds 3
        Write-Host "✅ $ServiceName started successfully"
        return $true
    }
    catch {
        Write-Warning "❌ Failed to start $ServiceName : $($_.Exception.Message)"
        return $false
    }
    finally {
        if ($WorkingDirectory) {
            Pop-Location
        }
    }
}

# Function to check service health
function Test-ServiceHealth {
    Write-Host "🏥 Running health checks..." -ForegroundColor Cyan
    
    try {
        $healthResult = node scripts/system-health-check.js quick
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Health check passed"
            return $true
        } else {
            Write-Warning "⚠️  Health check showed issues"
            return $false
        }
    }
    catch {
        Write-Warning "❌ Health check failed: $($_.Exception.Message)"
        return $false
    }
}

# Main restart sequence
Write-Host "🔄 Starting service restart sequence..." -ForegroundColor Yellow

# Step 1: Stop all services
Write-Host "`n📋 Step 1: Stopping all services"
$stopResults = @{
    "Backend Listener" = Stop-ServiceSafely -ProcessName "Backend server/index.js" -ServiceName "Backend Listener"
    "Key Rotation" = Stop-ServiceSafely -ProcessName "orchestrator.js" -ServiceName "Key Rotation Monitor"
    "Event Listener" = Stop-ServiceSafely -ProcessName "listener" -ServiceName "Event Listener"
}

# Wait for processes to fully stop
Write-Host "⏳ Waiting 5 seconds for processes to fully stop..."
Start-Sleep -Seconds 5

# Step 2: Clean up any remaining processes if Force flag is used
if ($Force) {
    Write-Host "`n🧹 Step 2: Force cleaning remaining Node.js processes"
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Force cleanup completed"
}

# Step 3: Start services in correct order
Write-Host "`n📋 Step 3: Starting services"

# Start backend server first
$backendStarted = Start-ServiceSafely -Command "pm2 start 'Backend server/index.js' --name listener" -ServiceName "Backend Listener" -WorkingDirectory (Get-Location)

# Start key rotation monitoring
$keyRotationStarted = Start-ServiceSafely -Command "node security/key-rotation/orchestrator.js start" -ServiceName "Key Rotation Monitor"

# Wait for services to initialize
Write-Host "⏳ Waiting $TimeoutSeconds seconds for services to initialize..."
Start-Sleep -Seconds $TimeoutSeconds

# Step 4: Health check
if (!$SkipHealthCheck) {
    Write-Host "`n📋 Step 4: Performing health checks"
    $healthPassed = Test-ServiceHealth
} else {
    Write-Host "`n⏭️  Skipping health checks (--SkipHealthCheck flag provided)"
    $healthPassed = $true
}

# Step 5: Report results
Write-Host "`n📊 RESTART SUMMARY" -ForegroundColor Yellow
Write-Host "=" * 30

$allSuccessful = $true
foreach ($service in $stopResults.Keys) {
    $status = if ($stopResults[$service]) { "✅ OK" } else { "❌ FAILED"; $allSuccessful = $false }
    Write-Host "$service : $status"
}

if ($backendStarted) {
    Write-Host "Backend Listener Start: ✅ OK"
} else {
    Write-Host "Backend Listener Start: ❌ FAILED"
    $allSuccessful = $false
}

if ($keyRotationStarted) {
    Write-Host "Key Rotation Start: ✅ OK"
} else {
    Write-Host "Key Rotation Start: ❌ FAILED"
    $allSuccessful = $false
}

if (!$SkipHealthCheck) {
    if ($healthPassed) {
        Write-Host "Health Check: ✅ PASSED"
    } else {
        Write-Host "Health Check: ⚠️  ISSUES DETECTED"
        $allSuccessful = $false
    }
}

# Final status
Write-Host "`n🎯 OVERALL RESULT:" -ForegroundColor Yellow
if ($allSuccessful) {
    Write-Host "✅ ALL SERVICES RESTARTED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "🌐 System should be operational"
    
    # Show quick status
    Write-Host "`n📋 Quick Status Check:"
    try {
        pm2 status 2>$null
    } catch {
        Write-Host "   PM2 status not available, services may be running directly"
    }
    
    exit 0
} else {
    Write-Host "❌ SOME SERVICES FAILED TO RESTART" -ForegroundColor Red
    Write-Host "🔧 Manual intervention may be required"
    Write-Host "💡 Check logs for more details:"
    Write-Host "   - Get-Content logs/*.log -Tail 50"
    Write-Host "   - node scripts/system-health-check.js full"
    
    exit 1
}
