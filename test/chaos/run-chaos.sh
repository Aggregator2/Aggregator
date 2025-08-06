#!/bin/bash

# Chaos Engineering Test Runner
# Executes various chaos scenarios for SwappiQ Protocol

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
CHAOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${CHAOS_DIR}/logs"
RESULTS_DIR="${CHAOS_DIR}/results"

# Create directories
mkdir -p "$LOG_DIR"
mkdir -p "$RESULTS_DIR"

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

print_chaos() {
    echo -e "${PURPLE}[CHAOS]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check for required tools
    local tools=("docker" "redis-cli" "psql" "stress-ng" "tc" "iptables")
    local missing_tools=()
    
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        print_error "Missing required tools: ${missing_tools[*]}"
        print_info "Install missing tools:"
        print_info "  Ubuntu/Debian: sudo apt-get install stress-ng iproute2 iptables"
        print_info "  macOS: brew install stress-ng"
        return 1
    fi
    
    # Check if running with sufficient privileges
    if [ "$EUID" -ne 0 ] && [[ "$1" =~ ^(network|all)$ ]]; then
        print_warning "Some chaos scenarios require sudo privileges"
        print_info "Run with: sudo $0 $1"
        return 1
    fi
    
    print_success "All prerequisites met"
    return 0
}

# Create safety snapshot
create_snapshot() {
    print_info "Creating safety snapshot..."
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local snapshot_dir="${RESULTS_DIR}/snapshot_${timestamp}"
    mkdir -p "$snapshot_dir"
    
    # Snapshot database
    if command -v pg_dump &> /dev/null; then
        pg_dump -h localhost -U postgres swappiq > "${snapshot_dir}/database_backup.sql" 2>/dev/null || true
    fi
    
    # Snapshot Redis
    if command -v redis-cli &> /dev/null; then
        redis-cli BGSAVE &>/dev/null || true
        sleep 2
        cp /var/lib/redis/dump.rdb "${snapshot_dir}/redis_backup.rdb" 2>/dev/null || true
    fi
    
    # Save current service states
    docker ps > "${snapshot_dir}/docker_services.txt" 2>/dev/null || true
    systemctl list-units --type=service --state=running > "${snapshot_dir}/system_services.txt" 2>/dev/null || true
    
    print_success "Snapshot created: ${snapshot_dir}"
}

# Run chaos scenario
run_scenario() {
    local scenario=$1
    local duration=${2:-300} # Default 5 minutes
    
    print_chaos "Starting $scenario chaos scenario"
    print_info "Duration: ${duration} seconds"
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local log_file="${LOG_DIR}/${scenario}_${timestamp}.log"
    
    # Set environment variables
    export CHAOS_DURATION=$((duration * 1000))
    export NODE_ENV=chaos
    
    # Run the scenario
    cd "${CHAOS_DIR}/scenarios"
    node "${scenario}.js" 2>&1 | tee "$log_file"
    
    local exit_code=${PIPESTATUS[0]}
    
    if [ $exit_code -eq 0 ]; then
        print_success "$scenario completed successfully"
    else
        print_error "$scenario failed with exit code $exit_code"
    fi
    
    return $exit_code
}

# Recovery check
check_recovery() {
    print_info "Checking system recovery..."
    
    local recovery_timeout=60
    local start_time=$(date +%s)
    local all_healthy=false
    
    while [ $(($(date +%s) - start_time)) -lt $recovery_timeout ]; do
        local healthy=true
        
        # Check API health
        if ! curl -s -f http://localhost:3000/api/health > /dev/null 2>&1; then
            healthy=false
        fi
        
        # Check database
        if ! psql -h localhost -U postgres -d swappiq -c "SELECT 1" > /dev/null 2>&1; then
            healthy=false
        fi
        
        # Check Redis
        if ! redis-cli ping > /dev/null 2>&1; then
            healthy=false
        fi
        
        if [ "$healthy" = true ]; then
            all_healthy=true
            break
        fi
        
        sleep 5
    done
    
    if [ "$all_healthy" = true ]; then
        print_success "System recovered successfully"
        return 0
    else
        print_error "System failed to recover within ${recovery_timeout}s"
        return 1
    fi
}

# Show menu
show_menu() {
    echo ""
    echo "SwappiQ Protocol - Chaos Engineering Suite"
    echo "=========================================="
    echo ""
    echo "⚠️  WARNING: These tests will intentionally break your system!"
    echo "   Ensure you have backups and are running in a test environment."
    echo ""
    echo "Select a chaos scenario:"
    echo ""
    echo "  1) Service Failure - Kill random services"
    echo "  2) Network Chaos - Latency, packet loss, partitions"
    echo "  3) Database Chaos - Failover, locks, slow queries"
    echo "  4) Redis Chaos - Cluster failures, memory issues"
    echo "  5) Resource Exhaustion - CPU, memory, disk stress"
    echo "  6) Full Chaos - Run all scenarios sequentially"
    echo "  7) Custom Duration - Run scenario with custom duration"
    echo "  0) Exit"
    echo ""
}

# Run full chaos suite
run_full_chaos() {
    print_warning "This will run ALL chaos scenarios sequentially!"
    print_warning "Total duration: ~25 minutes"
    read -p "Are you sure? (yes/no): " confirm
    
    if [ "$confirm" != "yes" ]; then
        print_info "Cancelled"
        return
    fi
    
    local scenarios=(
        "01-service-failure"
        "02-network-chaos"
        "03-database-chaos"
        "04-redis-chaos"
        "05-resource-exhaustion"
    )
    
    for scenario in "${scenarios[@]}"; do
        print_info "Running $scenario..."
        run_scenario "$scenario" 300
        
        # Recovery time between scenarios
        print_info "Waiting for recovery..."
        sleep 30
        check_recovery
    done
    
    print_success "Full chaos suite completed"
}

# Main execution
main() {
    print_chaos "SwappiQ Protocol Chaos Engineering"
    
    # Check if running with arguments
    if [ $# -gt 0 ]; then
        case $1 in
            service-failure)
                check_prerequisites "$1" && \
                create_snapshot && \
                run_scenario "01-service-failure" ${2:-300} && \
                check_recovery
                ;;
            network)
                check_prerequisites "$1" && \
                create_snapshot && \
                run_scenario "02-network-chaos" ${2:-300} && \
                check_recovery
                ;;
            database)
                check_prerequisites "$1" && \
                create_snapshot && \
                run_scenario "03-database-chaos" ${2:-300} && \
                check_recovery
                ;;
            redis)
                check_prerequisites "$1" && \
                create_snapshot && \
                run_scenario "04-redis-chaos" ${2:-300} && \
                check_recovery
                ;;
            resource)
                check_prerequisites "$1" && \
                create_snapshot && \
                run_scenario "05-resource-exhaustion" ${2:-300} && \
                check_recovery
                ;;
            all)
                check_prerequisites "all" && \
                create_snapshot && \
                run_full_chaos
                ;;
            *)
                print_error "Unknown scenario: $1"
                echo "Usage: $0 [service-failure|network|database|redis|resource|all] [duration_seconds]"
                exit 1
                ;;
        esac
    else
        # Interactive mode
        check_prerequisites "interactive"
        
        while true; do
            show_menu
            read -p "Enter your choice (0-7): " choice
            
            case $choice in
                1)
                    create_snapshot
                    run_scenario "01-service-failure"
                    check_recovery
                    ;;
                2)
                    if [ "$EUID" -ne 0 ]; then
                        print_error "Network chaos requires sudo privileges"
                        print_info "Run: sudo $0"
                    else
                        create_snapshot
                        run_scenario "02-network-chaos"
                        check_recovery
                    fi
                    ;;
                3)
                    create_snapshot
                    run_scenario "03-database-chaos"
                    check_recovery
                    ;;
                4)
                    create_snapshot
                    run_scenario "04-redis-chaos"
                    check_recovery
                    ;;
                5)
                    create_snapshot
                    run_scenario "05-resource-exhaustion"
                    check_recovery
                    ;;
                6)
                    run_full_chaos
                    ;;
                7)
                    read -p "Select scenario (1-5): " scenario_num
                    read -p "Duration in seconds (default 300): " duration
                    duration=${duration:-300}
                    
                    case $scenario_num in
                        1) scenario="01-service-failure" ;;
                        2) scenario="02-network-chaos" ;;
                        3) scenario="03-database-chaos" ;;
                        4) scenario="04-redis-chaos" ;;
                        5) scenario="05-resource-exhaustion" ;;
                        *) print_error "Invalid scenario"; continue ;;
                    esac
                    
                    create_snapshot
                    run_scenario "$scenario" "$duration"
                    check_recovery
                    ;;
                0)
                    print_info "Exiting chaos engineering suite"
                    exit 0
                    ;;
                *)
                    print_error "Invalid choice"
                    ;;
            esac
            
            echo ""
            read -p "Press Enter to continue..."
        done
    fi
}

# Cleanup handler
cleanup() {
    print_info "Cleaning up chaos effects..."
    
    # Kill any remaining stress processes
    pkill -f stress-ng 2>/dev/null || true
    pkill -f iperf3 2>/dev/null || true
    
    # Reset network rules
    sudo tc qdisc del dev eth0 root 2>/dev/null || true
    sudo tc qdisc del dev lo root 2>/dev/null || true
    
    # Clear iptables rules (be careful in production!)
    # sudo iptables -F INPUT 2>/dev/null || true
    # sudo iptables -F OUTPUT 2>/dev/null || true
    
    print_success "Cleanup completed"
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Run main
main "$@"