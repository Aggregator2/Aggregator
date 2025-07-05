#!/bin/bash

# PostgreSQL Automated Backup Script
# This script creates encrypted backups with rotation and S3 upload support

set -euo pipefail

# Configuration
BACKUP_DIR="${BACKUP_DIR:-/backups}"
POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-trading_platform}"
POSTGRES_USER="${POSTGRES_USER:-trading_user}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_ENCRYPTION="${BACKUP_ENCRYPTION:-true}"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}"
S3_BUCKET="${S3_BUCKET}"
S3_PREFIX="${S3_PREFIX:-postgres-backups}"
SLACK_WEBHOOK="${SLACK_WEBHOOK}"
LOG_FILE="/var/log/postgres-backup.log"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling
error_exit() {
    log "ERROR: $1"
    if [ -n "$SLACK_WEBHOOK" ]; then
        send_slack_notification "❌ PostgreSQL backup failed: $1" "danger"
    fi
    exit 1
}

# Send Slack notification
send_slack_notification() {
    local message="$1"
    local color="${2:-good}"
    
    if [ -n "$SLACK_WEBHOOK" ]; then
        curl -X POST -H 'Content-type: application/json' \
            --data "{\"attachments\":[{\"color\":\"$color\",\"text\":\"$message\"}]}" \
            "$SLACK_WEBHOOK" 2>/dev/null || true
    fi
}

# Check required tools
check_dependencies() {
    local deps=("pg_dump" "gzip")
    
    if [ "$BACKUP_ENCRYPTION" = "true" ]; then
        deps+=("openssl")
    fi
    
    if [ -n "$S3_BUCKET" ]; then
        deps+=("aws")
    fi
    
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            error_exit "Required tool '$dep' is not installed"
        fi
    done
}

# Perform backup
perform_backup() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="postgres_${POSTGRES_DB}_${timestamp}"
    local backup_file="${BACKUP_DIR}/${backup_name}.sql.gz"
    
    log "Starting backup of database: $POSTGRES_DB"
    
    # Create PostgreSQL dump
    export PGPASSWORD="${POSTGRES_PASSWORD}"
    
    if pg_dump \
        -h "$POSTGRES_HOST" \
        -p "$POSTGRES_PORT" \
        -U "$POSTGRES_USER" \
        -d "$POSTGRES_DB" \
        --verbose \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --exclude-table-data='*.logs' \
        --exclude-table-data='*.sessions' \
        | gzip -9 > "$backup_file"; then
        
        log "Database dump completed: $backup_file"
        
        # Get file size
        local size=$(du -h "$backup_file" | cut -f1)
        log "Backup size: $size"
        
        # Encrypt backup if enabled
        if [ "$BACKUP_ENCRYPTION" = "true" ]; then
            encrypt_backup "$backup_file"
            backup_file="${backup_file}.enc"
        fi
        
        # Upload to S3 if configured
        if [ -n "$S3_BUCKET" ]; then
            upload_to_s3 "$backup_file" "$backup_name"
        fi
        
        # Verify backup
        verify_backup "$backup_file"
        
        # Clean up old backups
        cleanup_old_backups
        
        # Send success notification
        send_slack_notification "✅ PostgreSQL backup completed successfully\n📦 Size: $size\n📍 Location: $backup_file" "good"
        
        log "Backup completed successfully"
        
    else
        error_exit "Database dump failed"
    fi
    
    unset PGPASSWORD
}

# Encrypt backup file
encrypt_backup() {
    local backup_file="$1"
    local encrypted_file="${backup_file}.enc"
    
    log "Encrypting backup..."
    
    if [ -z "$ENCRYPTION_KEY" ]; then
        error_exit "BACKUP_ENCRYPTION_KEY is not set"
    fi
    
    if openssl enc -aes-256-cbc \
        -salt \
        -in "$backup_file" \
        -out "$encrypted_file" \
        -pass "pass:$ENCRYPTION_KEY"; then
        
        log "Backup encrypted successfully"
        rm -f "$backup_file"
    else
        error_exit "Backup encryption failed"
    fi
}

# Upload backup to S3
upload_to_s3() {
    local backup_file="$1"
    local backup_name="$2"
    local s3_path="s3://${S3_BUCKET}/${S3_PREFIX}/${backup_name}.sql.gz"
    
    if [ "$BACKUP_ENCRYPTION" = "true" ]; then
        s3_path="${s3_path}.enc"
    fi
    
    log "Uploading backup to S3: $s3_path"
    
    if aws s3 cp "$backup_file" "$s3_path" \
        --storage-class STANDARD_IA \
        --metadata "backup-date=$(date -Iseconds),database=$POSTGRES_DB"; then
        
        log "Backup uploaded to S3 successfully"
        
        # Set lifecycle for S3 object
        aws s3api put-object-tagging \
            --bucket "$S3_BUCKET" \
            --key "${S3_PREFIX}/${backup_name}.sql.gz$([ "$BACKUP_ENCRYPTION" = "true" ] && echo ".enc")" \
            --tagging "TagSet=[{Key=retention-days,Value=$RETENTION_DAYS}]" 2>/dev/null || true
            
    else
        log "WARNING: S3 upload failed, keeping local backup"
    fi
}

# Verify backup integrity
verify_backup() {
    local backup_file="$1"
    
    log "Verifying backup integrity..."
    
    if [ "$BACKUP_ENCRYPTION" = "true" ]; then
        # For encrypted backups, just check file exists and size
        if [ -f "$backup_file" ] && [ -s "$backup_file" ]; then
            log "Encrypted backup file verified"
        else
            error_exit "Backup verification failed: file is empty or missing"
        fi
    else
        # For unencrypted backups, test gzip integrity
        if gzip -t "$backup_file" 2>/dev/null; then
            log "Backup integrity verified"
        else
            error_exit "Backup verification failed: corrupted gzip file"
        fi
    fi
}

# Clean up old local backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."
    
    local count=0
    while IFS= read -r -d '' file; do
        rm -f "$file"
        ((count++))
        log "Deleted old backup: $(basename "$file")"
    done < <(find "$BACKUP_DIR" -name "postgres_*.sql.gz*" -type f -mtime +$RETENTION_DAYS -print0)
    
    if [ $count -gt 0 ]; then
        log "Deleted $count old backup(s)"
    else
        log "No old backups to delete"
    fi
    
    # Clean up S3 if configured (using lifecycle rules)
    if [ -n "$S3_BUCKET" ]; then
        log "S3 cleanup is managed by lifecycle rules"
    fi
}

# Create backup report
generate_report() {
    local report_file="${BACKUP_DIR}/backup_report_$(date +%Y%m).txt"
    
    {
        echo "PostgreSQL Backup Report - $(date)"
        echo "=================================="
        echo ""
        echo "Database: $POSTGRES_DB"
        echo "Host: $POSTGRES_HOST"
        echo ""
        echo "Local Backups:"
        ls -lh "$BACKUP_DIR"/postgres_*.sql.gz* 2>/dev/null || echo "No backups found"
        echo ""
        echo "Disk Usage:"
        df -h "$BACKUP_DIR"
        echo ""
        echo "Recent Backup Log:"
        tail -n 50 "$LOG_FILE"
    } > "$report_file"
    
    log "Backup report generated: $report_file"
}

# Restore function (separate script recommended for safety)
restore_info() {
    cat << EOF
To restore a backup:

1. For encrypted backups:
   openssl enc -d -aes-256-cbc -in backup.sql.gz.enc -out backup.sql.gz -pass "pass:\$ENCRYPTION_KEY"

2. Restore the database:
   gunzip -c backup.sql.gz | psql -h \$POSTGRES_HOST -U \$POSTGRES_USER -d \$POSTGRES_DB

3. From S3:
   aws s3 cp s3://\$S3_BUCKET/\$S3_PREFIX/backup.sql.gz.enc backup.sql.gz.enc
EOF
}

# Main execution
main() {
    log "=== PostgreSQL Backup Script Started ==="
    
    # Check dependencies
    check_dependencies
    
    # Perform backup
    perform_backup
    
    # Generate monthly report on the 1st
    if [ "$(date +%d)" = "01" ]; then
        generate_report
    fi
    
    log "=== PostgreSQL Backup Script Completed ==="
}

# Run main function
main "$@"