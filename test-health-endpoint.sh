#!/bin/bash

# Health Check Test Script for Event Listener Service
# Usage: ./test-health-endpoint.sh [PORT]

PORT=${1:-3002}
BASE_URL="http://localhost:$PORT"
HEALTH_ENDPOINT="$BASE_URL/api/health/listener"

echo "🏥 Testing Event Listener Health Endpoint"
echo "================================================"
echo "Endpoint: $HEALTH_ENDPOINT"
echo "Timestamp: $(date)"
echo ""

# Function to make curl request with timeout
make_request() {
    local url=$1
    local expected_status=${2:-200}
    
    echo "📡 Making request to: $url"
    
    # Make request with curl and capture response and status
    response=$(curl -s -w "\n%{http_code}" --connect-timeout 10 --max-time 30 "$url" 2>/dev/null)
    
    if [ $? -ne 0 ]; then
        echo "❌ Request failed - connection error"
        return 1
    fi
    
    # Split response and status code
    body=$(echo "$response" | head -n -1)
    status_code=$(echo "$response" | tail -n 1)
    
    echo "📊 Status Code: $status_code"
    echo "📄 Response Body:"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    echo ""
    
    # Check if status code matches expected
    if [ "$status_code" = "$expected_status" ]; then
        echo "✅ Health check passed (HTTP $status_code)"
        return 0
    else
        echo "❌ Health check failed (Expected HTTP $expected_status, got HTTP $status_code)"
        return 1
    fi
}

# Test 1: Basic health check
echo "🧪 Test 1: Basic Health Check"
echo "-----------------------------"
make_request "$HEALTH_ENDPOINT" 200
test1_result=$?
echo ""

# Test 2: Health check when service might be down (expect 503)
echo "🧪 Test 2: Service Unavailable Check"
echo "------------------------------------"
echo "This test expects HTTP 503 if the service is not properly connected"
make_request "$HEALTH_ENDPOINT" 503
test2_result=$?
echo ""

# Test 3: Invalid method (POST instead of GET)
echo "🧪 Test 3: Invalid Method Check"
echo "-------------------------------"
echo "📡 Testing POST method (should return 405 Method Not Allowed)"
response=$(curl -s -w "\n%{http_code}" -X POST --connect-timeout 10 --max-time 30 "$HEALTH_ENDPOINT" 2>/dev/null)

if [ $? -eq 0 ]; then
    body=$(echo "$response" | head -n -1)
    status_code=$(echo "$response" | tail -n 1)
    
    echo "📊 Status Code: $status_code"
    echo "📄 Response Body:"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    
    if [ "$status_code" = "405" ]; then
        echo "✅ Method validation passed (HTTP 405)"
        test3_result=0
    else
        echo "❌ Method validation failed (Expected HTTP 405, got HTTP $status_code)"
        test3_result=1
    fi
else
    echo "❌ Request failed - connection error"
    test3_result=1
fi
echo ""

# Test 4: Check response format and required fields
echo "🧪 Test 4: Response Format Validation"
echo "-------------------------------------"
response=$(curl -s --connect-timeout 10 --max-time 30 "$HEALTH_ENDPOINT" 2>/dev/null)

if [ $? -eq 0 ]; then
    echo "📄 Validating response format..."
    
    # Check if response is valid JSON
    if echo "$response" | jq . >/dev/null 2>&1; then
        echo "✅ Valid JSON response"
        
        # Check required fields
        status_field=$(echo "$response" | jq -r '.status' 2>/dev/null)
        timestamp_field=$(echo "$response" | jq -r '.timestamp' 2>/dev/null)
        service_field=$(echo "$response" | jq -r '.service' 2>/dev/null)
        details_field=$(echo "$response" | jq -r '.details' 2>/dev/null)
        
        echo "🔍 Field validation:"
        echo "   - status: $status_field"
        echo "   - timestamp: $timestamp_field"
        echo "   - service: $service_field"
        echo "   - details: $details_field"
        
        if [ "$status_field" != "null" ] && [ "$timestamp_field" != "null" ] && [ "$service_field" = "event-listener" ]; then
            echo "✅ Required fields present"
            test4_result=0
        else
            echo "❌ Missing required fields"
            test4_result=1
        fi
    else
        echo "❌ Invalid JSON response"
        echo "Response: $response"
        test4_result=1
    fi
else
    echo "❌ Request failed - connection error"
    test4_result=1
fi
echo ""

# Summary
echo "📋 Test Summary"
echo "==============="
echo "Test 1 (Basic Health): $([ $test1_result -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL")"
echo "Test 2 (Service Down): $([ $test2_result -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL")"
echo "Test 3 (Invalid Method): $([ $test3_result -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL")"
echo "Test 4 (Response Format): $([ $test4_result -eq 0 ] && echo "✅ PASS" || echo "❌ FAIL")"
echo ""

# Overall result
total_passed=$((4 - test1_result - test2_result - test3_result - test4_result))
echo "📊 Overall: $total_passed/4 tests passed"

if [ $total_passed -eq 4 ]; then
    echo "🎉 All tests passed!"
    exit 0
else
    echo "⚠️  Some tests failed. Check the service status."
    exit 1
fi
