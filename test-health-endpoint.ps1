# Health Check Test Script for Event Listener Service (PowerShell)
# Usage: .\test-health-endpoint.ps1 [-Port 3002]

param(
    [int]$Port = 3002
)

$BaseUrl = "http://localhost:$Port"
$HealthEndpoint = "$BaseUrl/api/health/listener"

Write-Host "🏥 Testing Event Listener Health Endpoint" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Gray
Write-Host "Endpoint: $HealthEndpoint" -ForegroundColor Yellow
Write-Host "Timestamp: $(Get-Date)" -ForegroundColor Gray
Write-Host ""

# Function to make HTTP request
function Invoke-HealthRequest {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [int]$ExpectedStatus = 200
    )
    
    Write-Host "📡 Making $Method request to: $Url" -ForegroundColor Cyan
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method $Method -TimeoutSec 30 -ErrorAction Stop
        $statusCode = $response.StatusCode
        $body = $response.Content
        
        Write-Host "📊 Status Code: $statusCode" -ForegroundColor Green
        Write-Host "📄 Response Body:" -ForegroundColor Gray
        
        # Try to format as JSON if possible
        try {
            $jsonObject = $body | ConvertFrom-Json
            $jsonObject | ConvertTo-Json -Depth 10 | Write-Host
        } catch {
            Write-Host $body
        }
        
        Write-Host ""
        
        if ($statusCode -eq $ExpectedStatus) {
            Write-Host "✅ Request passed (HTTP $statusCode)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Request failed (Expected HTTP $ExpectedStatus, got HTTP $statusCode)" -ForegroundColor Red
            return $false
        }
        
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq $ExpectedStatus) {
            Write-Host "📊 Status Code: $statusCode" -ForegroundColor Yellow
            Write-Host "✅ Request passed (HTTP $statusCode)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Request failed: $($_.Exception.Message)" -ForegroundColor Red
            return $false
        }
    }
}

# Test 1: Basic health check
Write-Host "🧪 Test 1: Basic Health Check" -ForegroundColor Magenta
Write-Host "-----------------------------" -ForegroundColor Gray
$test1Result = Invoke-HealthRequest -Url $HealthEndpoint -ExpectedStatus 200
Write-Host ""

# Test 2: Health check when service might be down (expect 503)
Write-Host "🧪 Test 2: Service Unavailable Check" -ForegroundColor Magenta
Write-Host "------------------------------------" -ForegroundColor Gray
Write-Host "This test expects HTTP 503 if the service is not properly connected" -ForegroundColor Yellow
$test2Result = Invoke-HealthRequest -Url $HealthEndpoint -ExpectedStatus 503
Write-Host ""

# Test 3: Invalid method (POST instead of GET)
Write-Host "🧪 Test 3: Invalid Method Check" -ForegroundColor Magenta
Write-Host "-------------------------------" -ForegroundColor Gray
Write-Host "📡 Testing POST method (should return 405 Method Not Allowed)" -ForegroundColor Cyan
$test3Result = Invoke-HealthRequest -Url $HealthEndpoint -Method "POST" -ExpectedStatus 405
Write-Host ""

# Test 4: Check response format and required fields
Write-Host "🧪 Test 4: Response Format Validation" -ForegroundColor Magenta
Write-Host "-------------------------------------" -ForegroundColor Gray

try {
    $response = Invoke-WebRequest -Uri $HealthEndpoint -Method "GET" -TimeoutSec 30 -ErrorAction Stop
    $body = $response.Content
    
    Write-Host "📄 Validating response format..." -ForegroundColor Gray
    
    try {
        $jsonObject = $body | ConvertFrom-Json
        Write-Host "✅ Valid JSON response" -ForegroundColor Green
        
        # Check required fields
        $statusField = $jsonObject.status
        $timestampField = $jsonObject.timestamp
        $serviceField = $jsonObject.service
        $detailsField = $jsonObject.details
        
        Write-Host "🔍 Field validation:" -ForegroundColor Gray
        Write-Host "   - status: $statusField" -ForegroundColor Gray
        Write-Host "   - timestamp: $timestampField" -ForegroundColor Gray
        Write-Host "   - service: $serviceField" -ForegroundColor Gray
        Write-Host "   - details: $($null -ne $detailsField)" -ForegroundColor Gray
        
        if ($statusField -and $timestampField -and $serviceField -eq "event-listener") {
            Write-Host "✅ Required fields present" -ForegroundColor Green
            $test4Result = $true
        } else {
            Write-Host "❌ Missing required fields" -ForegroundColor Red
            $test4Result = $false
        }
    } catch {
        Write-Host "❌ Invalid JSON response" -ForegroundColor Red
        Write-Host "Response: $body" -ForegroundColor Gray
        $test4Result = $false
    }
    
} catch {
    Write-Host "❌ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    $test4Result = $false
}

Write-Host ""

# Summary
Write-Host "📋 Test Summary" -ForegroundColor Green
Write-Host "===============" -ForegroundColor Gray
Write-Host "Test 1 (Basic Health): $(if ($test1Result) { "✅ PASS" } else { "❌ FAIL" })" -ForegroundColor $(if ($test1Result) { "Green" } else { "Red" })
Write-Host "Test 2 (Service Down): $(if ($test2Result) { "✅ PASS" } else { "❌ FAIL" })" -ForegroundColor $(if ($test2Result) { "Green" } else { "Red" })
Write-Host "Test 3 (Invalid Method): $(if ($test3Result) { "✅ PASS" } else { "❌ FAIL" })" -ForegroundColor $(if ($test3Result) { "Green" } else { "Red" })
Write-Host "Test 4 (Response Format): $(if ($test4Result) { "✅ PASS" } else { "❌ FAIL" })" -ForegroundColor $(if ($test4Result) { "Green" } else { "Red" })
Write-Host ""

# Overall result
$totalPassed = @($test1Result, $test2Result, $test3Result, $test4Result) | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count
Write-Host "📊 Overall: $totalPassed/4 tests passed" -ForegroundColor Yellow

if ($totalPassed -eq 4) {
    Write-Host "🎉 All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "⚠️  Some tests failed. Check the service status." -ForegroundColor Yellow
    exit 1
}
