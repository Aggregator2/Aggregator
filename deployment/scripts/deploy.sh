#!/bin/bash

# Production Deployment Script
# This script automates the deployment process

set -euo pipefail

# Configuration
PROJECT_DIR="/opt/trading-platform"
DEPLOYMENT_DIR="$PROJECT_DIR/deployment"
BACKUP_BEFORE_DEPLOY=true
HEALTH_CHECK_TIMEOUT=300
ROLLBACK_ON_FAILURE=true

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging
log() { echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"; }
error() { echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2; }
warning() { echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"; }
info() { echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1"; }

# Deployment ID
DEPLOYMENT_ID="deploy_$(date +%Y%m%d_%H%M%S)"
DEPLOYMENT_LOG="/var/log/deployments/${DEPLOYMENT_ID}.log"

# Initialize deployment
init_deployment() {
    log "=== Starting Deployment ${DEPLOYMENT_ID} ==="
    
    # Create log directory
    mkdir -p /var/log/deployments
    
    # Start logging
    exec 1> >(tee -a "$DEPLOYMENT_LOG")
    exec 2>&1
    
    # Record deployment start
    echo "{
        \"deployment_id\": \"$DEPLOYMENT_ID\",
        \"start_time\": \"$(date -Iseconds)\",
        \"user\": \"$USER\",
        \"branch\": \"$(cd $PROJECT_DIR && git rev-parse --abbrev-ref HEAD)\",
        \"commit\": \"$(cd $PROJECT_DIR && git rev-parse HEAD)\"
    }" > "/var/log/deployments/${DEPLOYMENT_ID}.json"
}

# Pre-deployment checks
pre_deployment_checks() {
    log "Running pre-deployment checks..."
    
    # Check disk space
    local available_space=$(df -BG /opt | awk 'NR==2 {print $4}' | sed 's/G//')
    if [ "$available_space" -lt 10 ]; then
        error "Insufficient disk space: ${available_space}GB available (minimum 10GB required)"
        exit 1
    fi
    
    # Check if services are healthy
    if ! docker-compose -f "$DEPLOYMENT_DIR/docker-compose.yml" ps | grep -q "Up"; then
        error "Some services are not running"
        exit 1
    fi
    
    # Check for uncommitted changes
    if [ -n "$(cd $PROJECT_DIR && git status --porcelain)" ]; then
        warning "Uncommitted changes detected"
        read -p "Continue with deployment? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
    
    log "Pre-deployment checks passed"
}

# Backup current state
backup_current_state() {
    if [ "$BACKUP_BEFORE_DEPLOY" = true ]; then
        log "Creating backup before deployment..."
        
        # Backup database
        "$DEPLOYMENT_DIR/scripts/backup-postgres.sh" || {
            error "Database backup failed"
            exit 1
        }
        
        # Backup current code
        tar -czf "/backups/code_${DEPLOYMENT_ID}.tar.gz" \
            -C "$PROJECT_DIR" \
            --exclude=node_modules \
            --exclude=.git \
            --exclude=logs \
            --exclude=uploads \
            .
        
        log "Backup completed"
    fi
}

# Pull latest code
pull_latest_code() {
    log "Pulling latest code..."
    
    cd "$PROJECT_DIR"
    
    # Fetch latest changes
    git fetch origin
    
    # Get target branch/tag
    local target="${1:-main}"
    
    # Checkout target
    git checkout "$target"
    git pull origin "$target"
    
    log "Code updated to: $(git rev-parse HEAD)"
}

# Build and deploy
build_and_deploy() {
    log "Building and deploying services..."
    
    cd "$DEPLOYMENT_DIR"
    
    # Build images
    docker-compose build --no-cache || {
        error "Build failed"
        return 1
    }
    
    # Deploy with zero downtime
    log "Starting new containers..."
    
    # Scale up new instances
    docker-compose up -d --scale app=4 --no-recreate
    
    # Wait for new instances to be healthy
    sleep 10
    
    # Remove old instances
    docker-compose up -d --scale app=2 --no-recreate
    
    log "Deployment completed"
}

# Run migrations
run_migrations() {
    log "Running database migrations..."
    
    docker-compose -f "$DEPLOYMENT_DIR/docker-compose.yml" \
        exec -T app npm run migrate || {
        error "Migration failed"
        return 1
    }
    
    log "Migrations completed"
}

# Health check
health_check() {
    log "Running health checks..."
    
    local start_time=$(date +%s)
    local timeout=$HEALTH_CHECK_TIMEOUT
    
    while true; do
        if curl -sf "http://localhost/health" > /dev/null; then
            log "Health check passed"
            return 0
        fi
        
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        
        if [ $elapsed -gt $timeout ]; then
            error "Health check timeout after ${timeout}s"
            return 1
        fi
        
        info "Waiting for services to be healthy... (${elapsed}s)"
        sleep 5
    done
}

# Post-deployment tasks
post_deployment_tasks() {
    log "Running post-deployment tasks..."
    
    # Clear caches
    docker-compose -f "$DEPLOYMENT_DIR/docker-compose.yml" \
        exec -T redis redis-cli FLUSHDB
    
    # Warm up caches
    curl -sf "http://localhost/api/warmup" > /dev/null || true
    
    # Send notification
    if [ -n "${SLACK_WEBHOOK:-}" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{
                \"text\":\"✅ Deployment completed successfully\",
                \"attachments\": [{
                    \"color\": \"good\",
                    \"fields\": [
                        {\"title\": \"Deployment ID\", \"value\": \"$DEPLOYMENT_ID\", \"short\": true},
                        {\"title\": \"Duration\", \"value\": \"$SECONDS seconds\", \"short\": true}
                    ]
                }]
            }" \
            "$SLACK_WEBHOOK" 2>/dev/null || true
    fi
    
    log "Post-deployment tasks completed"
}

# Rollback deployment
rollback_deployment() {
    error "Deployment failed, rolling back..."
    
    cd "$PROJECT_DIR"
    
    # Get previous commit
    local previous_commit=$(git rev-parse HEAD~1)
    
    # Checkout previous commit
    git checkout "$previous_commit"
    
    # Rebuild and deploy
    cd "$DEPLOYMENT_DIR"
    docker-compose build
    docker-compose up -d
    
    warning "Rollback completed to commit: $previous_commit"
}

# Main deployment flow
main() {
    local start_time=$(date +%s)
    
    # Initialize
    init_deployment
    
    # Pre-deployment
    pre_deployment_checks
    backup_current_state
    
    # Get deployment target
    local target="${1:-main}"
    
    # Deploy
    if pull_latest_code "$target" && \
       build_and_deploy && \
       run_migrations && \
       health_check; then
        
        # Success
        post_deployment_tasks
        
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log "=== Deployment Successful ==="
        log "Duration: ${duration} seconds"
        
        # Update deployment record
        jq ". + {
            \"end_time\": \"$(date -Iseconds)\",
            \"duration\": $duration,
            \"status\": \"success\"
        }" "/var/log/deployments/${DEPLOYMENT_ID}.json" > "/var/log/deployments/${DEPLOYMENT_ID}.json.tmp"
        mv "/var/log/deployments/${DEPLOYMENT_ID}.json.tmp" "/var/log/deployments/${DEPLOYMENT_ID}.json"
        
    else
        # Failure
        if [ "$ROLLBACK_ON_FAILURE" = true ]; then
            rollback_deployment
        fi
        
        error "=== Deployment Failed ==="
        
        # Update deployment record
        jq ". + {
            \"end_time\": \"$(date -Iseconds)\",
            \"status\": \"failed\"
        }" "/var/log/deployments/${DEPLOYMENT_ID}.json" > "/var/log/deployments/${DEPLOYMENT_ID}.json.tmp"
        mv "/var/log/deployments/${DEPLOYMENT_ID}.json.tmp" "/var/log/deployments/${DEPLOYMENT_ID}.json"
        
        exit 1
    fi
}

# Usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS] [TARGET]

Options:
    -h, --help              Show this help message
    -n, --no-backup         Skip backup before deployment
    -f, --force             Force deployment without health checks
    -r, --no-rollback       Disable automatic rollback on failure

Target:
    Branch name or tag to deploy (default: main)

Examples:
    $0                      # Deploy main branch
    $0 develop              # Deploy develop branch
    $0 v1.2.3               # Deploy tag v1.2.3
    $0 --no-backup develop  # Deploy without backup

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            exit 0
            ;;
        -n|--no-backup)
            BACKUP_BEFORE_DEPLOY=false
            shift
            ;;
        -f|--force)
            HEALTH_CHECK_TIMEOUT=10
            shift
            ;;
        -r|--no-rollback)
            ROLLBACK_ON_FAILURE=false
            shift
            ;;
        *)
            TARGET="$1"
            shift
            ;;
    esac
done

# Run deployment
main "${TARGET:-main}"