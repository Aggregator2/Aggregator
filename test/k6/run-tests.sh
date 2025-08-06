#!/bin/bash

# K6 Load Testing Runner Script
# Executes different load testing scenarios for SwappiQ Protocol

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3000}"
WS_URL="${WS_URL:-ws://localhost:8080}"
K6_RESULTS_DIR="./results"
K6_REPORTS_DIR="./reports"

# Create directories if they don't exist
mkdir -p "$K6_RESULTS_DIR"
mkdir -p "$K6_REPORTS_DIR"

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if K6 is installed
check_k6() {
    if ! command -v k6 &> /dev/null; then
        print_error "K6 is not installed. Please install K6 first."
        echo "Installation instructions: https://k6.io/docs/getting-started/installation/"
        exit 1
    fi
    print_success "K6 is installed: $(k6 version)"
}

# Function to check if the API is accessible
check_api() {
    print_info "Checking API availability at $BASE_URL..."
    
    if curl -s -f "$BASE_URL/api/health" > /dev/null; then
        print_success "API is accessible"
    else
        print_error "API is not accessible at $BASE_URL"
        exit 1
    fi
}

# Function to run a specific test scenario
run_test() {
    local scenario=$1
    local description=$2
    local duration=$3
    
    print_info "Starting $description..."
    echo "Duration: $duration"
    echo "----------------------------------------"
    
    # Generate timestamp for unique file names
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local result_file="$K6_RESULTS_DIR/${scenario}_${timestamp}.json"
    local report_file="$K6_REPORTS_DIR/${scenario}_${timestamp}.html"
    
    # Run the test
    k6 run \
        --out json="$result_file" \
        --summary-export="$K6_RESULTS_DIR/${scenario}_${timestamp}_summary.json" \
        -e BASE_URL="$BASE_URL" \
        -e WS_URL="$WS_URL" \
        "scenarios/$scenario.js"
    
    # Generate HTML report if k6-reporter is available
    if command -v k6-reporter &> /dev/null; then
        k6-reporter "$result_file" -o "$report_file"
        print_success "HTML report generated: $report_file"
    fi
    
    print_success "$description completed!"
    echo ""
}

# Function to run all tests
run_all_tests() {
    print_info "Running all load test scenarios..."
    
    # Run each test scenario
    run_test "01-steady-state" "Steady State Test (1,000 users)" "30 minutes"
    run_test "02-spike-test" "Spike Test (0 to 10,000 users)" "10 minutes"
    run_test "03-stress-test" "Stress Test (find breaking point)" "18 minutes"
    run_test "04-soak-test" "Soak Test (5,000 users)" "4 hours"
    run_test "05-breakpoint-test" "Breakpoint Test (P95 > 500ms)" "Variable"
}

# Function to show menu
show_menu() {
    echo ""
    echo "SwappiQ Protocol - K6 Load Testing Suite"
    echo "========================================"
    echo ""
    echo "Select a test scenario to run:"
    echo ""
    echo "  1) Steady State Test (1,000 concurrent users for 30 minutes)"
    echo "  2) Spike Test (0 to 10,000 users in 2 minutes)"
    echo "  3) Stress Test (Find system breaking point)"
    echo "  4) Soak Test (5,000 users for 4 hours)"
    echo "  5) Breakpoint Test (Increase load until P95 > 500ms)"
    echo "  6) Run ALL tests (Sequential execution)"
    echo "  0) Exit"
    echo ""
}

# Main execution
main() {
    print_info "SwappiQ Protocol Load Testing Suite"
    
    # Check prerequisites
    check_k6
    check_api
    
    # Interactive menu
    while true; do
        show_menu
        read -p "Enter your choice (0-6): " choice
        
        case $choice in
            1)
                run_test "01-steady-state" "Steady State Test" "30 minutes"
                ;;
            2)
                run_test "02-spike-test" "Spike Test" "10 minutes"
                ;;
            3)
                run_test "03-stress-test" "Stress Test" "18 minutes"
                ;;
            4)
                print_warning "Soak test will run for 4 hours. Are you sure? (y/n)"
                read -p "" confirm
                if [[ $confirm == "y" || $confirm == "Y" ]]; then
                    run_test "04-soak-test" "Soak Test" "4 hours"
                fi
                ;;
            5)
                run_test "05-breakpoint-test" "Breakpoint Test" "Variable"
                ;;
            6)
                print_warning "This will run ALL tests sequentially and may take over 5 hours. Continue? (y/n)"
                read -p "" confirm
                if [[ $confirm == "y" || $confirm == "Y" ]]; then
                    run_all_tests
                fi
                ;;
            0)
                print_info "Exiting..."
                exit 0
                ;;
            *)
                print_error "Invalid choice. Please select 0-6."
                ;;
        esac
    done
}

# Check if script is run with arguments
if [ $# -gt 0 ]; then
    case $1 in
        steady-state)
            check_k6
            check_api
            run_test "01-steady-state" "Steady State Test" "30 minutes"
            ;;
        spike)
            check_k6
            check_api
            run_test "02-spike-test" "Spike Test" "10 minutes"
            ;;
        stress)
            check_k6
            check_api
            run_test "03-stress-test" "Stress Test" "18 minutes"
            ;;
        soak)
            check_k6
            check_api
            run_test "04-soak-test" "Soak Test" "4 hours"
            ;;
        breakpoint)
            check_k6
            check_api
            run_test "05-breakpoint-test" "Breakpoint Test" "Variable"
            ;;
        all)
            check_k6
            check_api
            run_all_tests
            ;;
        *)
            print_error "Unknown argument: $1"
            echo "Usage: $0 [steady-state|spike|stress|soak|breakpoint|all]"
            exit 1
            ;;
    esac
else
    # Run interactive menu
    main
fi