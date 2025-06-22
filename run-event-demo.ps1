# Escrow Event Listener Demo Script for Windows PowerShell
# Usage: .\run-event-demo.ps1 [command]

param(
    [Parameter(Position=0)]
    [ValidateSet("setup", "simulate", "listen", "full-demo", "help")]
    [string]$Command = "help"
)

Write-Host "🚀 Meta Aggregator 2.0 - Escrow Event Listener" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

function Write-Step {
    param([string]$Message)
    Write-Host "📋 $Message" -ForegroundColor Green
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "💡 $Message" -ForegroundColor Yellow
}

function Test-Command {
    param([string]$CommandName)
    $null = Get-Command $CommandName -ErrorAction SilentlyContinue
    return $?
}

function Invoke-CommandWithOutput {
    param(
        [string]$Command,
        [string[]]$Arguments,
        [string]$Description
    )
    
    Write-Step $Description
    Write-Host "   Running: $Command $($Arguments -join ' ')" -ForegroundColor Gray
    
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Command completed successfully"
            return $true
        } else {
            Write-Error "Command failed with exit code: $LASTEXITCODE"
            return $false
        }
    } catch {
        Write-Error "Command failed: $($_.Exception.Message)"
        return $false
    }
}

function Start-Setup {
    Write-Step "Setting up Hardhat network..."
    Write-Info "This will start the Hardhat network in the background"
    Write-Info "You can run simulations in another terminal while this runs"
    Write-Host ""
    
    # Compile contracts first
    if (!(Invoke-CommandWithOutput "npx" @("hardhat", "compile") "Compiling contracts")) {
        return
    }
    
    Write-Host ""
    Write-Step "Starting Hardhat network..."
    Write-Info "Press Ctrl+C to stop the network"
    Write-Host ""
    
    try {
        & npx hardhat node
    } catch {
        Write-Error "Failed to start Hardhat network: $($_.Exception.Message)"
    }
}

function Start-Simulation {
    Write-Step "Running event simulation..."
    Write-Info "This will deploy test contracts and emit various events"
    Write-Host ""
    
    if (!(Invoke-CommandWithOutput "npx" @("hardhat", "run", "scripts/simulateEscrowEvents.js", "--network", "localhost") "Running event simulation")) {
        Write-Error "Event simulation failed"
        return
    }
    
    Write-Host ""
    Write-Success "Event simulation completed!"
    Write-Info "Check the logs directory for detailed event logs"
}

function Start-Listener {
    Write-Step "Starting event listener..."
    Write-Info "This will monitor the escrow contract for events"
    Write-Info "Press Ctrl+C to stop listening"
    Write-Host ""
    
    try {
        & node utils/escrowEventListener.js
    } catch {
        Write-Error "Failed to start event listener: $($_.Exception.Message)"
    }
}

function Start-FullDemo {
    Write-Step "Running full demonstration..."
    Write-Host ""
    
    # Check if Node.js and npm are available
    if (!(Test-Command "node")) {
        Write-Error "Node.js is not installed or not in PATH"
        return
    }
    
    if (!(Test-Command "npm")) {
        Write-Error "npm is not installed or not in PATH"
        return
    }
    
    # Compile contracts
    if (!(Invoke-CommandWithOutput "npx" @("hardhat", "compile") "Compiling contracts")) {
        return
    }
    
    Write-Host ""
    Write-Step "Starting Hardhat network in background..."
    
    # Start Hardhat node in background
    $hardhatJob = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        & npx hardhat node
    }
    
    # Wait for network to start
    Write-Host "Waiting for network to start..." -ForegroundColor Gray
    Start-Sleep -Seconds 8
    
    try {
        Write-Host ""
        if (!(Invoke-CommandWithOutput "npx" @("hardhat", "run", "scripts/simulateEscrowEvents.js", "--network", "localhost") "Running event simulation")) {
            return
        }
        
        Write-Host ""
        Write-Success "Full demo completed successfully!"
        Write-Info "Check the logs directory for detailed event logs"
        
    } finally {
        Write-Host ""
        Write-Step "Stopping Hardhat network..."
        Stop-Job $hardhatJob
        Remove-Job $hardhatJob
        Write-Success "Cleanup completed"
    }
}

function Show-Help {
    Write-Host "Available commands:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  setup       " -ForegroundColor White -NoNewline
    Write-Host "- Start Hardhat network (keep running)" -ForegroundColor Gray
    Write-Host "  simulate    " -ForegroundColor White -NoNewline  
    Write-Host "- Run event simulation (requires network)" -ForegroundColor Gray
    Write-Host "  listen      " -ForegroundColor White -NoNewline
    Write-Host "- Start event listener (requires network)" -ForegroundColor Gray
    Write-Host "  full-demo   " -ForegroundColor White -NoNewline
    Write-Host "- Run complete demo automatically" -ForegroundColor Gray
    Write-Host "  help        " -ForegroundColor White -NoNewline
    Write-Host "- Show this help message" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Quick start examples:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  # Run everything automatically:"
    Write-Host "  .\run-event-demo.ps1 full-demo" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  # Manual setup (3 terminals):"
    Write-Host "  .\run-event-demo.ps1 setup      " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Terminal 1"
    Write-Host "  .\run-event-demo.ps1 listen     " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Terminal 2"  
    Write-Host "  .\run-event-demo.ps1 simulate   " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Terminal 3"
    Write-Host ""
    Write-Host "NPM shortcuts:" -ForegroundColor Cyan
    Write-Host "  npm run event-demo              " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Same as full-demo"
    Write-Host "  npm run event-setup             " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Same as setup"
    Write-Host "  npm run event-simulate          " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Same as simulate"
    Write-Host "  npm run event-listen            " -ForegroundColor Yellow -NoNewline
    Write-Host "  # Same as listen"
}

# Main execution
switch ($Command) {
    "setup" {
        Start-Setup
    }
    "simulate" {
        Start-Simulation
    }
    "listen" {
        Start-Listener
    }
    "full-demo" {
        Start-FullDemo
    }
    "help" {
        Show-Help
    }
    default {
        Write-Error "Unknown command: $Command"
        Write-Host ""
        Show-Help
    }
}
