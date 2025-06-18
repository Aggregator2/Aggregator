# Event Listener Testing Script for Windows PowerShell
# Starts Hardhat network and tests the enhanced escrow event listener

Write-Host "🚀 Escrow Event Listener Testing Script" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

# Function to check if a command exists
function Test-Command($command) {
    try {
        Get-Command $command -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# Check prerequisites
Write-Host "`n🔍 Checking prerequisites..." -ForegroundColor Yellow

if (-not (Test-Command "node")) {
    Write-Host "❌ Node.js is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

if (-not (Test-Command "npx")) {
    Write-Host "❌ npm/npx is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Node.js and npm are available" -ForegroundColor Green

# Check if we're in the right directory
if (-not (Test-Path "hardhat.config.js")) {
    Write-Host "❌ hardhat.config.js not found. Are you in the project root?" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Found hardhat.config.js" -ForegroundColor Green

# Set environment variables for testing
$env:PROVIDER_URL = "http://127.0.0.1:8545"
$env:ESCROW_CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3"

Write-Host "`n📋 Test Configuration:" -ForegroundColor Cyan
Write-Host "  Provider URL: $env:PROVIDER_URL"
Write-Host "  Contract Address: $env:ESCROW_CONTRACT_ADDRESS"

# Function to start Hardhat network in background
function Start-HardhatNetwork {
    Write-Host "`n🔧 Starting Hardhat local network..." -ForegroundColor Yellow
    
    # Check if Hardhat network is already running
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8545" -Method POST -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -ContentType "application/json" -TimeoutSec 5
        Write-Host "✅ Hardhat network is already running" -ForegroundColor Green
        return $null
    } catch {
        Write-Host "🔄 Starting new Hardhat network instance..." -ForegroundColor Yellow
    }
    
    # Start Hardhat network in background
    $hardhatProcess = Start-Process -FilePath "npx" -ArgumentList "hardhat", "node" -NoNewWindow -PassThru
    
    # Wait for network to start
    $maxAttempts = 20
    $attempt = 0
    
    do {
        Start-Sleep -Seconds 1
        $attempt++
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:8545" -Method POST -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -ContentType "application/json" -TimeoutSec 2
            Write-Host "✅ Hardhat network is ready!" -ForegroundColor Green
            return $hardhatProcess
        } catch {
            Write-Host "⏳ Waiting for network... ($attempt/$maxAttempts)" -ForegroundColor Gray
        }
    } while ($attempt -lt $maxAttempts)
    
    Write-Host "❌ Failed to start Hardhat network" -ForegroundColor Red
    return $null
}

# Function to deploy contracts
function Deploy-Contracts {
    Write-Host "`n📦 Deploying contracts..." -ForegroundColor Yellow
    
    try {
        $deployOutput = npx hardhat run scripts/deploy.js --network localhost 2>&1
        Write-Host $deployOutput
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Contracts deployed successfully" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Contract deployment failed" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ Error during contract deployment: $_" -ForegroundColor Red
        return $false
    }
}

# Function to run event listener tests
function Test-EventListener {
    param($testType)
    
    Write-Host "`n🧪 Running event listener test: $testType" -ForegroundColor Yellow
    
    switch ($testType) {
        "demo" {
            Write-Host "🎬 Starting comprehensive demo..." -ForegroundColor Cyan
            node utils/eventListenerDemo.js
        }
        "simulation" {
            Write-Host "🎭 Running event simulation..." -ForegroundColor Cyan
            node utils/escrowEventListener.js --simulate
        }
        "live" {
            Write-Host "👂 Starting live event monitoring..." -ForegroundColor Cyan
            Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
            node utils/escrowEventListener.js --history
        }
        default {
            Write-Host "❌ Unknown test type: $testType" -ForegroundColor Red
        }
    }
}

# Main execution
try {
    # Start Hardhat network
    $hardhatProcess = Start-HardhatNetwork
    
    if ($hardhatProcess -eq $null -and -not (Test-NetConnection -ComputerName 127.0.0.1 -Port 8545 -InformationLevel Quiet)) {
        Write-Host "❌ Failed to start or connect to Hardhat network" -ForegroundColor Red
        exit 1
    }
    
    # Deploy contracts if needed
    if (-not (Deploy-Contracts)) {
        Write-Host "⚠️ Contract deployment failed, continuing with existing contracts..." -ForegroundColor Yellow
    }
    
    # Main menu
    do {
        Write-Host "`n🎯 Event Listener Testing Menu" -ForegroundColor Cyan
        Write-Host "==============================" -ForegroundColor Cyan
        Write-Host "1. Run comprehensive demo"
        Write-Host "2. Test event simulation"
        Write-Host "3. Start live event monitoring"
        Write-Host "4. Check system status"
        Write-Host "5. View recent logs"
        Write-Host "Q. Quit"
        
        $choice = Read-Host "`nSelect option (1-5, Q)"
        
        switch ($choice.ToUpper()) {
            "1" { Test-EventListener "demo" }
            "2" { Test-EventListener "simulation" }
            "3" { Test-EventListener "live" }
            "4" {
                Write-Host "`n📊 System Status Check" -ForegroundColor Yellow
                Write-Host "Provider URL: $env:PROVIDER_URL"
                Write-Host "Contract: $env:ESCROW_CONTRACT_ADDRESS"
                
                try {
                    $response = Invoke-WebRequest -Uri $env:PROVIDER_URL -Method POST -Body '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' -ContentType "application/json" -TimeoutSec 5
                    Write-Host "✅ Network connection: OK" -ForegroundColor Green
                } catch {
                    Write-Host "❌ Network connection: FAILED" -ForegroundColor Red
                }
                
                if (Test-Path "logs/escrow-events.log") {
                    $logSize = (Get-Item "logs/escrow-events.log").Length
                    Write-Host "📁 Event log size: $logSize bytes" -ForegroundColor Green
                } else {
                    Write-Host "📁 No event log found" -ForegroundColor Gray
                }
            }
            "5" {
                Write-Host "`n📖 Recent Event Logs" -ForegroundColor Yellow
                if (Test-Path "logs/escrow-events.log") {
                    Get-Content "logs/escrow-events.log" | Select-Object -Last 10
                } else {
                    Write-Host "No event logs found" -ForegroundColor Gray
                }
                
                if (Test-Path "logs/escrow-errors.log") {
                    Write-Host "`n🚨 Recent Error Logs" -ForegroundColor Red
                    Get-Content "logs/escrow-errors.log" | Select-Object -Last 5
                }
            }
            "Q" { 
                Write-Host "`n👋 Exiting..." -ForegroundColor Yellow
                break 
            }
            default { 
                Write-Host "❌ Invalid option. Please try again." -ForegroundColor Red 
            }
        }
    } while ($true)

} catch {
    Write-Host "`n💥 An error occurred: $_" -ForegroundColor Red
} finally {
    # Cleanup
    if ($hardhatProcess -and -not $hardhatProcess.HasExited) {
        Write-Host "`n🧹 Cleaning up Hardhat process..." -ForegroundColor Yellow
        Stop-Process -Id $hardhatProcess.Id -Force -ErrorAction SilentlyContinue
    }
    
    Write-Host "🏁 Test session ended" -ForegroundColor Green
}
