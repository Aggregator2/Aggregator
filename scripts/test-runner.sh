#!/bin/bash

# SwappiQ Comprehensive Test Runner
# Runs all test suites with proper prerequisites and generates reports

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test results directory
TEST_RESULTS_DIR="test-results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_DIR="${TEST_RESULTS_DIR}/${TIMESTAMP}"

# Test suite status tracking
declare -A TEST_STATUS
declare -A TEST_OUTPUT
declare -A TEST_DURATION

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "info") echo -e "${BLUE}[INFO]${NC} $message" ;;
        "success") echo -e "${GREEN}[SUCCESS]${NC} $message" ;;
        "warning") echo -e "${YELLOW}[WARNING]${NC} $message" ;;
        "error") echo -e "${RED}[ERROR]${NC} $message" ;;
    esac
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a service is running
service_running() {
    local service=$1
    local port=$2
    nc -z localhost $port >/dev/null 2>&1
}

# Function to wait for a service
wait_for_service() {
    local service=$1
    local port=$2
    local max_attempts=30
    local attempt=0
    
    print_status "info" "Waiting for $service on port $port..."
    while ! service_running $service $port; do
        attempt=$((attempt + 1))
        if [ $attempt -gt $max_attempts ]; then
            print_status "error" "$service failed to start on port $port"
            return 1
        fi
        sleep 1
    done
    print_status "success" "$service is running on port $port"
    return 0
}

# Function to check prerequisites
check_prerequisites() {
    print_status "info" "Checking prerequisites..."
    
    local missing_deps=()
    
    # Check required commands
    for cmd in node npm redis-cli nc jq; do
        if ! command_exists $cmd; then
            missing_deps+=($cmd)
        fi
    done
    
    if [ ${#missing_deps[@]} -gt 0 ]; then
        print_status "error" "Missing dependencies: ${missing_deps[*]}"
        print_status "info" "Please install missing dependencies and try again"
        return 1
    fi
    
    print_status "success" "All required commands are available"
    return 0
}

# Function to check and start services
check_services() {
    print_status "info" "Checking required services..."
    
    # Check Redis
    if ! service_running "Redis" 6379; then
        print_status "warning" "Redis not running, attempting to start..."
        if command_exists redis-server; then
            redis-server --daemonize yes >/dev/null 2>&1
            wait_for_service "Redis" 6379 || return 1
        else
            print_status "error" "Redis is not installed"
            return 1
        fi
    else
        print_status "success" "Redis is running"
    fi
    
    # Check if Hardhat network is needed (for integration tests)
    if [[ " $* " =~ " integration " ]] || [[ $# -eq 0 ]]; then
        if ! service_running "Hardhat" 8545; then
            print_status "warning" "Hardhat network not running, starting..."
            npx hardhat node --fork https://eth.llamarpc.com >/dev/null 2>&1 &
            HARDHAT_PID=$!
            wait_for_service "Hardhat" 8545 || return 1
        else
            print_status "success" "Hardhat network is running"
        fi
    fi
    
    return 0
}

# Function to setup test environment
setup_test_env() {
    print_status "info" "Setting up test environment..."
    
    # Create test results directory
    mkdir -p "$REPORT_DIR"
    
    # Set environment variables
    export NODE_ENV=test
    export TEST_RESULTS_DIR="$REPORT_DIR"
    export FORCE_COLOR=0  # Disable color in test output for cleaner logs
    
    # Check if .env.test exists, create if not
    if [ ! -f .env.test ]; then
        print_status "warning" ".env.test not found, creating from .env.example..."
        if [ -f .env.example ]; then
            cp .env.example .env.test
        else
            print_status "error" "Neither .env.test nor .env.example found"
            return 1
        fi
    fi
    
    # Load test environment variables
    export $(cat .env.test | grep -v '^#' | xargs)
    
    print_status "success" "Test environment configured"
    return 0
}

# Function to run a test suite
run_test_suite() {
    local suite_name=$1
    local test_command=$2
    local output_file="${REPORT_DIR}/${suite_name}.log"
    local json_file="${REPORT_DIR}/${suite_name}.json"
    
    print_status "info" "Running $suite_name tests..."
    
    local start_time=$(date +%s)
    
    # Run the test command and capture output
    if npm run $test_command -- --json --outputFile="$json_file" > "$output_file" 2>&1; then
        TEST_STATUS[$suite_name]="passed"
        print_status "success" "$suite_name tests passed"
    else
        TEST_STATUS[$suite_name]="failed"
        print_status "error" "$suite_name tests failed"
    fi
    
    local end_time=$(date +%s)
    TEST_DURATION[$suite_name]=$((end_time - start_time))
    TEST_OUTPUT[$suite_name]="$output_file"
    
    # Extract summary from output if json file doesn't exist
    if [ ! -f "$json_file" ]; then
        # Try to extract test results from output
        local passed=$(grep -E "passing|✓" "$output_file" | wc -l || echo 0)
        local failed=$(grep -E "failing|✗" "$output_file" | wc -l || echo 0)
        echo "{\"passed\": $passed, \"failed\": $failed, \"duration\": ${TEST_DURATION[$suite_name]}}" > "$json_file"
    fi
}

# Function to run tests in parallel
run_parallel_tests() {
    local -a pids=()
    local -a suites=()
    
    # Start unit tests
    if [[ " $* " =~ " unit " ]] || [[ $# -eq 0 ]]; then
        run_test_suite "unit" "test:unit" &
        pids+=($!)
        suites+=("unit")
    fi
    
    # Start matching engine tests
    if [[ " $* " =~ " matching " ]] || [[ $# -eq 0 ]]; then
        run_test_suite "matching" "test:matching" &
        pids+=($!)
        suites+=("matching")
    fi
    
    # Wait for parallel tests to complete
    for i in "${!pids[@]}"; do
        wait ${pids[$i]}
        print_status "info" "Completed ${suites[$i]} tests"
    done
}

# Function to run sequential tests
run_sequential_tests() {
    # Integration tests (need to run after unit tests)
    if [[ " $* " =~ " integration " ]] || [[ $# -eq 0 ]]; then
        run_test_suite "integration" "test:integration"
    fi
    
    # Settlement tests (depend on integration tests)
    if [[ " $* " =~ " settlement " ]] || [[ $# -eq 0 ]]; then
        run_test_suite "settlement" "test:settlement"
    fi
}

# Function to generate HTML report
generate_html_report() {
    local html_file="${REPORT_DIR}/test-report.html"
    
    cat > "$html_file" << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SwappiQ Test Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 30px;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .summary-card {
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card.passed {
            background-color: #d4edda;
            color: #155724;
        }
        .summary-card.failed {
            background-color: #f8d7da;
            color: #721c24;
        }
        .summary-card.total {
            background-color: #d1ecf1;
            color: #0c5460;
        }
        .summary-card h3 {
            margin: 0 0 10px 0;
            font-size: 1.2em;
        }
        .summary-card .number {
            font-size: 2.5em;
            font-weight: bold;
        }
        .test-suites {
            margin-top: 40px;
        }
        .test-suite {
            margin-bottom: 30px;
            border: 1px solid #ddd;
            border-radius: 8px;
            overflow: hidden;
        }
        .test-suite-header {
            padding: 15px 20px;
            background-color: #f8f9fa;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .test-suite-header.passed {
            border-left: 4px solid #28a745;
        }
        .test-suite-header.failed {
            border-left: 4px solid #dc3545;
        }
        .test-suite-body {
            padding: 20px;
        }
        .status-badge {
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 0.9em;
            font-weight: 500;
        }
        .status-badge.passed {
            background-color: #28a745;
            color: white;
        }
        .status-badge.failed {
            background-color: #dc3545;
            color: white;
        }
        .metrics {
            display: flex;
            gap: 20px;
            margin-top: 10px;
            font-size: 0.9em;
            color: #666;
        }
        .log-preview {
            margin-top: 15px;
            padding: 15px;
            background-color: #f5f5f5;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.85em;
            max-height: 200px;
            overflow-y: auto;
        }
        .timestamp {
            color: #666;
            font-size: 0.9em;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>SwappiQ Test Report</h1>
        <div class="timestamp">Generated on: REPORT_TIMESTAMP</div>
        
        <div class="summary">
            <div class="summary-card total">
                <h3>Total Tests</h3>
                <div class="number">TOTAL_TESTS</div>
            </div>
            <div class="summary-card passed">
                <h3>Passed</h3>
                <div class="number">TOTAL_PASSED</div>
            </div>
            <div class="summary-card failed">
                <h3>Failed</h3>
                <div class="number">TOTAL_FAILED</div>
            </div>
        </div>
        
        <div class="test-suites">
            <h2>Test Suites</h2>
            TEST_SUITES_HTML
        </div>
    </div>
</body>
</html>
EOF
    
    # Calculate totals
    local total_passed=0
    local total_failed=0
    local test_suites_html=""
    
    for suite in "${!TEST_STATUS[@]}"; do
        local json_file="${REPORT_DIR}/${suite}.json"
        local log_file="${TEST_OUTPUT[$suite]}"
        local status="${TEST_STATUS[$suite]}"
        local duration="${TEST_DURATION[$suite]}"
        
        # Parse test results
        local passed=0
        local failed=0
        if [ -f "$json_file" ]; then
            passed=$(jq -r '.passed // 0' "$json_file" 2>/dev/null || echo 0)
            failed=$(jq -r '.failed // 0' "$json_file" 2>/dev/null || echo 0)
        fi
        
        total_passed=$((total_passed + passed))
        total_failed=$((total_failed + failed))
        
        # Get last few lines of log for preview
        local log_preview=""
        if [ -f "$log_file" ]; then
            log_preview=$(tail -20 "$log_file" | sed 's/</\&lt;/g; s/>/\&gt;/g' | sed ':a;N;$!ba;s/\n/<br>/g')
        fi
        
        test_suites_html+="
        <div class='test-suite'>
            <div class='test-suite-header $status'>
                <div>
                    <h3>$suite</h3>
                    <div class='metrics'>
                        <span>Duration: ${duration}s</span>
                        <span>Passed: $passed</span>
                        <span>Failed: $failed</span>
                    </div>
                </div>
                <div class='status-badge $status'>$status</div>
            </div>
            <div class='test-suite-body'>
                <div class='log-preview'>$log_preview</div>
            </div>
        </div>"
    done
    
    # Replace placeholders
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local total_tests=$((total_passed + total_failed))
    
    sed -i "s|REPORT_TIMESTAMP|$timestamp|g" "$html_file"
    sed -i "s|TOTAL_TESTS|$total_tests|g" "$html_file"
    sed -i "s|TOTAL_PASSED|$total_passed|g" "$html_file"
    sed -i "s|TOTAL_FAILED|$total_failed|g" "$html_file"
    sed -i "s|TEST_SUITES_HTML|$test_suites_html|g" "$html_file"
    
    print_status "success" "HTML report generated: $html_file"
}

# Function to generate summary report
generate_summary_report() {
    local summary_file="${REPORT_DIR}/summary.txt"
    local json_summary="${REPORT_DIR}/summary.json"
    
    print_status "info" "Generating test summary..."
    
    # Text summary
    {
        echo "SwappiQ Test Summary"
        echo "===================="
        echo "Generated: $(date)"
        echo ""
        echo "Test Results:"
        echo "-------------"
        
        local total_duration=0
        local all_passed=true
        
        for suite in "${!TEST_STATUS[@]}"; do
            local status="${TEST_STATUS[$suite]}"
            local duration="${TEST_DURATION[$suite]}"
            total_duration=$((total_duration + duration))
            
            printf "%-15s %-10s %5ds\n" "$suite:" "$status" "$duration"
            
            if [ "$status" = "failed" ]; then
                all_passed=false
            fi
        done
        
        echo ""
        echo "Total Duration: ${total_duration}s"
        echo ""
        
        if $all_passed; then
            echo "Overall Status: PASSED ✅"
        else
            echo "Overall Status: FAILED ❌"
        fi
        
        echo ""
        echo "Detailed logs available in: $REPORT_DIR/"
    } > "$summary_file"
    
    # JSON summary
    {
        echo "{"
        echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
        echo "  \"duration\": $total_duration,"
        echo "  \"status\": \"$(if $all_passed; then echo "passed"; else echo "failed"; fi)\","
        echo "  \"suites\": {"
        
        local first=true
        for suite in "${!TEST_STATUS[@]}"; do
            if ! $first; then echo ","; fi
            first=false
            
            local json_file="${REPORT_DIR}/${suite}.json"
            local passed=0
            local failed=0
            
            if [ -f "$json_file" ]; then
                passed=$(jq -r '.passed // 0' "$json_file" 2>/dev/null || echo 0)
                failed=$(jq -r '.failed // 0' "$json_file" 2>/dev/null || echo 0)
            fi
            
            echo -n "    \"$suite\": {
      \"status\": \"${TEST_STATUS[$suite]}\",
      \"duration\": ${TEST_DURATION[$suite]},
      \"passed\": $passed,
      \"failed\": $failed
    }"
        done
        
        echo ""
        echo "  }"
        echo "}"
    } > "$json_summary"
    
    # Display summary
    cat "$summary_file"
    
    # Generate HTML report
    generate_html_report
}

# Function to cleanup
cleanup() {
    print_status "info" "Cleaning up..."
    
    # Kill Hardhat if we started it
    if [ ! -z "${HARDHAT_PID:-}" ]; then
        kill $HARDHAT_PID 2>/dev/null || true
    fi
    
    # Archive old test results
    if [ -d "$TEST_RESULTS_DIR" ]; then
        find "$TEST_RESULTS_DIR" -type d -mtime +7 -exec rm -rf {} + 2>/dev/null || true
    fi
}

# Main execution
main() {
    print_status "info" "SwappiQ Test Runner v1.0"
    print_status "info" "========================"
    
    # Parse arguments
    local test_suites=("$@")
    if [ ${#test_suites[@]} -eq 0 ]; then
        print_status "info" "No specific test suites specified, running all tests"
    else
        print_status "info" "Running test suites: ${test_suites[*]}"
    fi
    
    # Setup trap for cleanup
    trap cleanup EXIT
    
    # Check prerequisites
    if ! check_prerequisites; then
        exit 1
    fi
    
    # Check and start services
    if ! check_services "$@"; then
        exit 1
    fi
    
    # Setup test environment
    if ! setup_test_env; then
        exit 1
    fi
    
    # Run tests
    print_status "info" "Starting test execution..."
    
    # Run tests that can be parallelized
    run_parallel_tests "$@"
    
    # Run tests that need to be sequential
    run_sequential_tests "$@"
    
    # Generate reports
    generate_summary_report
    
    # Determine exit code
    local exit_code=0
    for status in "${TEST_STATUS[@]}"; do
        if [ "$status" = "failed" ]; then
            exit_code=1
            break
        fi
    done
    
    if [ $exit_code -eq 0 ]; then
        print_status "success" "All tests passed! 🎉"
    else
        print_status "error" "Some tests failed. Check the reports for details."
    fi
    
    print_status "info" "Test reports available in: $REPORT_DIR/"
    
    exit $exit_code
}

# Run main function
main "$@"