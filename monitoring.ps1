# Meta Aggregator 2.0 - Continuous Monitoring Script
# This script runs health checks every 5 minutes and sends alerts as needed

param(
    [int]$IntervalMinutes = 5,
    [switch]$RunOnce,
    [switch]$Help
)

if ($Help) {
    Write-Host @"
Meta Aggregator 2.0 - Monitoring Script

Usage:
    .\monitoring.ps1 [-IntervalMinutes <minutes>] [-RunOnce] [-Help]

Parameters:
    -IntervalMinutes    How often to run health checks (default: 5 minutes)
    -RunOnce           Run health check once and exit
    -Help              Show this help message

Examples:
    .\monitoring.ps1                    # Run continuously every 5 minutes
    .\monitoring.ps1 -IntervalMinutes 2 # Run every 2 minutes  
    .\monitoring.ps1 -RunOnce          # Run once and exit

Emergency Contacts:
    Primary: Joeri (+1-555-0123)
    Operations: +1-555-0100
    Security: +1-555-0911
"@
    exit 0
}

function Write-Log {
    param($Message, $Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path "monitoring.log" -Value $logMessage
}

function Test-Prerequisites {
    Write-Log "Checking prerequisites..."
    
    # Check if Node.js is available
    try {
        $nodeVersion = node --version
        Write-Log "Node.js version: $nodeVersion"
    } catch {
        Write-Log "ERROR: Node.js not found. Please install Node.js." "ERROR"
        exit 1
    }
    
    # Check if required services are running
    $hardhatRunning = Get-Process | Where-Object { $_.ProcessName -like "*node*" -and $_.CommandLine -like "*hardhat node*" }
    $nextjsRunning = Get-Process | Where-Object { $_.ProcessName -like "*node*" -and $_.CommandLine -like "*next*" }
    
    if (-not $hardhatRunning) {
        Write-Log "WARNING: Hardhat network may not be running" "WARN"
    }
    
    if (-not $nextjsRunning) {
        Write-Log "WARNING: Next.js server may not be running" "WARN"
    }
}

function Invoke-HealthCheck {
    Write-Log "Running health check and monitoring alerts..."
    
    try {
        $result = node scripts/monitoringAlerts.js | Out-String
        Write-Log "Health check completed successfully"
        
        # Check if any alerts were triggered by looking for alert keywords
        if ($result -match "🚨.*ALERT") {
            Write-Log "ALERT DETECTED in health check output" "WARN"
            Write-Log $result "ALERT"
        }
        
        return $true
    } catch {
        Write-Log "ERROR: Health check failed: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

function Start-EmergencyResponse {
    param($FailureCount)
    
    Write-Log "EMERGENCY RESPONSE TRIGGERED - $FailureCount consecutive failures" "CRITICAL"
    
    # Create emergency alert file
    $emergencyAlert = @{
        timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"
        severity = "CRITICAL"
        consecutiveFailures = $FailureCount
        message = "Meta Aggregator monitoring has detected $FailureCount consecutive health check failures"
        actions = @(
            "1. Check system status immediately"
            "2. Contact primary on-call: Joeri (+1-555-0123)"
            "3. If no response in 5 minutes, escalate to Operations (+1-555-0100)"
            "4. Document all actions taken"
        )
    }
    
    $emergencyAlert | ConvertTo-Json -Depth 3 | Set-Content "EMERGENCY_ALERT.json"
    Write-Log "Emergency alert saved to EMERGENCY_ALERT.json" "CRITICAL"
    
    # In a real environment, this would:
    # - Send SMS/email alerts
    # - Create PagerDuty incident
    # - Post to Slack emergency channel
    # - Potentially trigger automated rollback
}

# Main monitoring loop
Write-Log "Starting Meta Aggregator monitoring..."
Write-Log "Interval: $IntervalMinutes minutes"
Write-Log "Run once: $RunOnce"

Test-Prerequisites

$consecutiveFailures = 0
$startTime = Get-Date

do {
    $loopStart = Get-Date
    Write-Log "=== Monitoring Check ($(($loopStart - $startTime).TotalMinutes.ToString('F1')) minutes since start) ==="
    
    $healthCheckSuccess = Invoke-HealthCheck
    
    if ($healthCheckSuccess) {
        $consecutiveFailures = 0
        Write-Log "Health check passed. Consecutive failures reset to 0."
    } else {
        $consecutiveFailures++
        Write-Log "Health check failed. Consecutive failures: $consecutiveFailures" "ERROR"
        
        # Trigger emergency response after 3 consecutive failures
        if ($consecutiveFailures -ge 3) {
            Start-EmergencyResponse -FailureCount $consecutiveFailures
        }
    }
    
    if (-not $RunOnce) {
        $sleepSeconds = $IntervalMinutes * 60
        Write-Log "Waiting $sleepSeconds seconds until next check..."
        Start-Sleep -Seconds $sleepSeconds
    }
    
} while (-not $RunOnce)

Write-Log "Monitoring completed."
