#!/bin/bash
# Automated maintenance script for PostgreSQL high-frequency trading database

set -e

# Configuration
DB_NAME="${PGDATABASE:-trading}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-postgres}"
LOG_DIR="/var/log/postgresql/maintenance"
RETENTION_DAYS=90
PARTITION_LEAD_DAYS=30

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_DIR/maintenance_$(date +%Y%m%d).log"
}

# Function to execute SQL and log results
execute_sql() {
    local query=$1
    local description=$2
    
    log "Executing: $description"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$query" 2>&1 | tee -a "$LOG_DIR/maintenance_$(date +%Y%m%d).log"
}

# =====================================================
# 1. PARTITION MANAGEMENT
# =====================================================

manage_partitions() {
    log "Starting partition management..."
    
    # Create future partitions for orders table (monthly)
    for i in {0..3}; do
        PARTITION_DATE=$(date -d "+$i month" +%Y-%m-01)
        PARTITION_NAME="orders_$(date -d "+$i month" +%Y_%m)"
        
        execute_sql "SELECT create_monthly_partition('orders', '$PARTITION_DATE'::date);" \
            "Creating partition $PARTITION_NAME if not exists"
    done
    
    # Create future partitions for trades table (weekly)
    for i in {0..4}; do
        PARTITION_DATE=$(date -d "+$i week" +%Y-%m-%d)
        PARTITION_NAME="trades_$(date -d "+$i week" +%Y_w%V)"
        
        execute_sql "SELECT create_weekly_partition('trades', '$PARTITION_DATE'::date);" \
            "Creating partition $PARTITION_NAME if not exists"
    done
    
    # Drop old partitions
    OLD_DATE=$(date -d "-$RETENTION_DAYS days" +%Y-%m-%d)
    
    execute_sql "
    DO \$\$
    DECLARE
        partition_name text;
    BEGIN
        FOR partition_name IN 
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname = 'public' 
              AND tablename LIKE 'orders_%'
              AND tablename < 'orders_' || to_char('$OLD_DATE'::date, 'YYYY_MM')
        LOOP
            EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_name);
            RAISE NOTICE 'Dropped old partition: %', partition_name;
        END LOOP;
    END \$\$;
    " "Dropping old order partitions"
    
    log "Partition management completed"
}

# =====================================================
# 2. VACUUM AND ANALYZE
# =====================================================

vacuum_analyze() {
    log "Starting VACUUM and ANALYZE operations..."
    
    # Vacuum analyze high-activity tables
    execute_sql "VACUUM ANALYZE orders;" "Vacuum analyzing orders table"
    execute_sql "VACUUM ANALYZE trades;" "Vacuum analyzing trades table"
    execute_sql "VACUUM ANALYZE user_balances;" "Vacuum analyzing user_balances table"
    execute_sql "VACUUM ANALYZE balance_history;" "Vacuum analyzing balance_history table"
    
    # Full vacuum for bloated tables (if bloat > 50%)
    execute_sql "
    DO \$\$
    DECLARE
        tbl RECORD;
    BEGIN
        FOR tbl IN 
            SELECT table_schema, table_name, bloat_pct
            FROM table_bloat
            WHERE bloat_pct > 50
        LOOP
            EXECUTE format('VACUUM FULL %I.%I', tbl.table_schema, tbl.table_name);
            RAISE NOTICE 'Full vacuum completed for %.% (bloat: %)', 
                tbl.table_schema, tbl.table_name, tbl.bloat_pct;
        END LOOP;
    END \$\$;
    " "Running VACUUM FULL on bloated tables"
    
    log "VACUUM and ANALYZE completed"
}

# =====================================================
# 3. INDEX MAINTENANCE
# =====================================================

maintain_indexes() {
    log "Starting index maintenance..."
    
    # Rebuild bloated indexes
    execute_sql "
    DO \$\$
    DECLARE
        idx RECORD;
    BEGIN
        FOR idx IN 
            SELECT schemaname, tablename, indexname
            FROM pg_stat_user_indexes
            WHERE pg_relation_size(indexrelid) > 100 * 1024 * 1024 -- > 100MB
              AND idx_scan < 100 -- Low usage
        LOOP
            EXECUTE format('REINDEX INDEX CONCURRENTLY %I.%I', 
                idx.schemaname, idx.indexname);
            RAISE NOTICE 'Reindexed: %.%', idx.schemaname, idx.indexname;
        END LOOP;
    END \$\$;
    " "Rebuilding bloated indexes"
    
    # Drop unused indexes (with safety check)
    execute_sql "
    SELECT schemaname, tablename, indexname, idx_scan, 
           pg_size_pretty(pg_relation_size(indexrelid)) as size
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
      AND indexrelid > 16384
      AND pg_relation_size(indexrelid) > 1024 * 1024
      AND NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conindid = indexrelid
      )
    ORDER BY pg_relation_size(indexrelid) DESC;
    " "Listing unused indexes (manual review required before dropping)"
    
    log "Index maintenance completed"
}

# =====================================================
# 4. MATERIALIZED VIEW REFRESH
# =====================================================

refresh_materialized_views() {
    log "Starting materialized view refresh..."
    
    execute_sql "SELECT refresh_all_materialized_views();" "Refreshing all materialized views"
    
    # Log refresh times
    execute_sql "
    SELECT 
        matviewname,
        pg_size_pretty(pg_relation_size(matviewname::regclass)) as size,
        last_refresh.refresh_time
    FROM pg_matviews
    LEFT JOIN LATERAL (
        SELECT refresh_materialized_view_with_timing(matviewname) as refresh_time
    ) last_refresh ON true
    WHERE schemaname = 'public'
    ORDER BY pg_relation_size(matviewname::regclass) DESC;
    " "Materialized view refresh times"
    
    log "Materialized view refresh completed"
}

# =====================================================
# 5. STATISTICS UPDATE
# =====================================================

update_statistics() {
    log "Starting statistics update..."
    
    # Update table statistics
    execute_sql "ANALYZE;" "Updating all table statistics"
    
    # Reset statistics if needed
    if [ "$(date +%d)" = "01" ]; then
        log "First day of month - resetting statistics"
        execute_sql "SELECT pg_stat_reset();" "Resetting general statistics"
        execute_sql "SELECT pg_stat_statements_reset();" "Resetting statement statistics"
    fi
    
    log "Statistics update completed"
}

# =====================================================
# 6. PERFORMANCE HEALTH CHECK
# =====================================================

health_check() {
    log "Starting performance health check..."
    
    # Check for performance alerts
    execute_sql "
    SELECT alert_type, severity, count, details
    FROM performance_alerts
    ORDER BY 
        CASE severity 
            WHEN 'CRITICAL' THEN 1
            WHEN 'WARNING' THEN 2
            WHEN 'INFO' THEN 3
        END;
    " "Performance alerts"
    
    # Check connection pool efficiency
    execute_sql "
    SELECT *
    FROM connection_pool_stats;
    " "Connection pool statistics"
    
    # Check slow queries
    execute_sql "
    SELECT query_preview, calls, avg_time_ms, max_time_ms
    FROM top_slow_queries
    LIMIT 10;
    " "Top 10 slow queries"
    
    log "Health check completed"
}

# =====================================================
# 7. BACKUP VERIFICATION
# =====================================================

verify_backups() {
    log "Starting backup verification..."
    
    # Check last backup time
    execute_sql "
    SELECT 
        datname,
        age(now(), last_backup) as time_since_backup,
        CASE 
            WHEN age(now(), last_backup) > interval '25 hours' THEN 'CRITICAL'
            WHEN age(now(), last_backup) > interval '12 hours' THEN 'WARNING'
            ELSE 'OK'
        END as status
    FROM (
        SELECT 
            datname,
            pg_stat_file(pg_relation_filepath('pg_database'))::timestamp as last_backup
        FROM pg_database
        WHERE datname = current_database()
    ) backup_info;
    " "Backup status check"
    
    log "Backup verification completed"
}

# =====================================================
# 8. CLEANUP OLD LOGS
# =====================================================

cleanup_logs() {
    log "Starting log cleanup..."
    
    # Remove old maintenance logs
    find "$LOG_DIR" -name "maintenance_*.log" -mtime +30 -delete
    
    # Archive PostgreSQL logs
    if [ -d "/var/log/postgresql" ]; then
        find /var/log/postgresql -name "postgresql-*.log" -mtime +7 -exec gzip {} \;
        find /var/log/postgresql -name "postgresql-*.log.gz" -mtime +30 -delete
    fi
    
    log "Log cleanup completed"
}

# =====================================================
# MAIN EXECUTION
# =====================================================

main() {
    log "=== Starting automated maintenance ==="
    
    # Record start time
    START_TIME=$(date +%s)
    
    # Execute maintenance tasks
    manage_partitions
    vacuum_analyze
    maintain_indexes
    refresh_materialized_views
    update_statistics
    health_check
    verify_backups
    cleanup_logs
    
    # Calculate execution time
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
    log "=== Maintenance completed in $DURATION seconds ==="
    
    # Send notification if critical alerts exist
    CRITICAL_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT COUNT(*) FROM performance_alerts WHERE severity = 'CRITICAL'")
    
    if [ "$CRITICAL_COUNT" -gt 0 ]; then
        log "WARNING: $CRITICAL_COUNT critical alerts detected!"
        # Add notification logic here (email, Slack, etc.)
    fi
}

# Run main function
main

# Exit successfully
exit 0