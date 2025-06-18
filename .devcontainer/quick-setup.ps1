# Set your Anthropic API key
$env:ANTHROPIC_API_KEY = "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"

Write-Host "🚀 Claude Code Assistant - Quick Setup" -ForegroundColor Green
Write-Host "Setting API key: $($env:ANTHROPIC_API_KEY.Substring(0,20))..." -ForegroundColor Yellow

# Install required package
Write-Host "📦 Installing dependencies..." -ForegroundColor Blue
npm install @anthropic-ai/sdk

# Create output directory
if (!(Test-Path ".claude-output")) {
    New-Item -ItemType Directory -Path ".claude-output"
    Write-Host "📁 Created output directory: .claude-output" -ForegroundColor Green
}

Write-Host "✅ Setup complete! Ready to run Claude analysis." -ForegroundColor Green
Write-Host ""
Write-Host "🎯 Usage Commands:" -ForegroundColor Cyan
Write-Host "• node .devcontainer/auto-fix.js analyze     - Analyze project" -ForegroundColor White
Write-Host "• node .devcontainer/auto-fix.js fix         - Get UI fixes" -ForegroundColor White
Write-Host "• node .devcontainer/auto-fix.js ui-only     - UI fixes only" -ForegroundColor White
Write-Host ""
