Write-Host "🚀 Setting up Claude Code Assistant for Meta Aggregator 2.0..." -ForegroundColor Green

# Check if API key is configured
$apiKey = "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"
if ($apiKey) {
    Write-Host "✅ API Key configured" -ForegroundColor Green
    $env:ANTHROPIC_API_KEY = $apiKey
} else {
    Write-Host "⚠️ ANTHROPIC_API_KEY not found!" -ForegroundColor Yellow
    exit 1
}

# Check if Docker is running
try {
    docker version | Out-Null
    Write-Host "✅ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Check if VS Code is available
try {
    code --version | Out-Null
    Write-Host "✅ VS Code found" -ForegroundColor Green
} catch {
    Write-Host "⚠️ VS Code not found in PATH. Install VS Code for best experience." -ForegroundColor Yellow
}

Write-Host "`n🛠️ Setup Options:" -ForegroundColor Cyan
Write-Host "1. Quick Setup (VS Code Dev Container) - RECOMMENDED" -ForegroundColor White
Write-Host "2. Manual Docker Setup" -ForegroundColor White
Write-Host "3. Direct Node.js Setup (no container)" -ForegroundColor White

$choice = Read-Host "`nSelect option (1-3)"

switch ($choice) {
    "1" {
        Write-Host "`n🐳 Setting up VS Code Dev Container..." -ForegroundColor Blue
        
        # Make start script executable (Git Bash style)
        if (Get-Command "bash" -ErrorAction SilentlyContinue) {
            bash -c "chmod +x .devcontainer/start.sh"
        }
        
        Write-Host "✅ Container configuration ready!" -ForegroundColor Green
        Write-Host "`n🎯 Next steps:" -ForegroundColor Cyan
        Write-Host "1. Open VS Code: code ." -ForegroundColor White
        Write-Host "2. Press Ctrl+Shift+P" -ForegroundColor White
        Write-Host "3. Type: 'Remote-Containers: Reopen in Container'" -ForegroundColor White
        Write-Host "4. Wait for container to build and start" -ForegroundColor White
        Write-Host "5. Claude will automatically analyze your project!" -ForegroundColor White
        
        # Try to open VS Code automatically
        try {
            code .
            Write-Host "`n🚀 VS Code opened! Follow the steps above." -ForegroundColor Green
        } catch {
            Write-Host "`nManually open VS Code and follow the steps above." -ForegroundColor Yellow
        }
    }
    
    "2" {
        Write-Host "`n🐳 Building Docker container manually..." -ForegroundColor Blue
        
        try {
            Set-Location ".devcontainer"
            docker-compose up --build -d
            Write-Host "✅ Container started!" -ForegroundColor Green
            
            Write-Host "`n🎯 To run Claude analysis:" -ForegroundColor Cyan
            Write-Host "docker-compose exec claude-dev bash" -ForegroundColor White
            Write-Host "node .devcontainer/auto-fix.js" -ForegroundColor White
            
            Set-Location ".."
        } catch {
            Write-Host "❌ Docker build failed: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    "3" {
        Write-Host "`n📦 Setting up Node.js environment..." -ForegroundColor Blue
        
        # Install dependencies
        npm install @anthropic-ai/sdk
        
        # Create output directory
        if (!(Test-Path ".claude-output")) {
            New-Item -ItemType Directory -Path ".claude-output"
        }
        
        Write-Host "✅ Node.js environment ready!" -ForegroundColor Green
        Write-Host "`n🎯 To run Claude analysis:" -ForegroundColor Cyan
        Write-Host "node .devcontainer/auto-fix.js" -ForegroundColor White
    }
    
    default {
        Write-Host "❌ Invalid option selected." -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n📋 Available Commands After Setup:" -ForegroundColor Cyan
Write-Host "• Full Analysis:     node .devcontainer/auto-fix.js" -ForegroundColor White  
Write-Host "• Analysis Only:     node .devcontainer/auto-fix.js analyze" -ForegroundColor White
Write-Host "• UI Fixes Only:     node .devcontainer/auto-fix.js ui-fixes" -ForegroundColor White
Write-Host "• Specific Fix:      node .devcontainer/auto-fix.js fix <filename> <issue>" -ForegroundColor White

Write-Host "`n📁 Output Files:" -ForegroundColor Cyan
Write-Host "• .claude-output/analysis.md      - Project analysis" -ForegroundColor White
Write-Host "• .claude-output/ui-fixes.md      - Code fixes" -ForegroundColor White  
Write-Host "• .claude-output/summary.md       - Quick summary" -ForegroundColor White
Write-Host "• claude-session.log              - Detailed logs" -ForegroundColor White

Write-Host ""
Write-Host "💰 Cost Estimation:" -ForegroundColor Cyan
Write-Host "• Estimated cost per analysis: ~$0.05-0.15" -ForegroundColor White
Write-Host "• Your API credits will be used based on token usage" -ForegroundColor White
Write-Host "• Monitor usage in Anthropic Console" -ForegroundColor White

Write-Host ""
Write-Host "✅ Claude Code Assistant setup complete!" -ForegroundColor Green
