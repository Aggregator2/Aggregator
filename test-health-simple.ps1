# Health Check Test Script for Event Listener Service (PowerShell - Simple)
# Usage: .\test-health-simple.ps1 [-Port 3001]

param(
    [int]$Port = 3001
)

$HealthEndpoint = "http://localhost:$Port/api/health/listener"

Write-Host "Testing Event Listener Health Endpoint"
Write-Host "Endpoint: $HealthEndpoint"
Write-Host "Timestamp: $(Get-Date)"
Write-Host ""

# Test 1: Basic health check
Write-Host "Test 1: Basic Health Check"
Write-Host "-----------------------------"

try {
    $response = Invoke-WebRequest -Uri $HealthEndpoint -Method "GET" -TimeoutSec 30
    $statusCode = $response.StatusCode
    $body = $response.Content
    
    Write-Host "Status Code: $statusCode"
    Write-Host "Response:"
    $body | ConvertFrom-Json | ConvertTo-Json -Depth 10
    
    if ($statusCode -eq 200 -or $statusCode -eq 503) {
        Write-Host "PASS: Health endpoint responding correctly" -ForegroundColor Green
        $test1Result = $true
    } else {
        Write-Host "FAIL: Unexpected status code" -ForegroundColor Red
        $test1Result = $false
    }
    
} catch {
    Write-Host "FAIL: Request failed - $($_.Exception.Message)" -ForegroundColor Red
    $test1Result = $false
}

Write-Host ""

# Test 2: Invalid method check
Write-Host "Test 2: Invalid Method Check"
Write-Host "-------------------------------"

try {
    $response = Invoke-WebRequest -Uri $HealthEndpoint -Method "POST" -TimeoutSec 30
    Write-Host "FAIL: Should have returned 405" -ForegroundColor Red
    $test2Result = $false
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -eq 405) {
        Write-Host "PASS: Method validation working (405)" -ForegroundColor Green
        $test2Result = $true
    } else {
        Write-Host "FAIL: Expected 405, got $statusCode" -ForegroundColor Red
        $test2Result = $false
    }
}

Write-Host ""

# Summary
Write-Host "Test Summary"
Write-Host "============"
Write-Host "Test 1 (Health Check): $(if ($test1Result) { "PASS" } else { "FAIL" })"
Write-Host "Test 2 (Method Check): $(if ($test2Result) { "PASS" } else { "FAIL" })"

$passed = @($test1Result, $test2Result) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
Write-Host "Overall: $passed/2 tests passed"

if ($passed -eq 2) {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "Some tests failed." -ForegroundColor Yellow
    exit 1
}
