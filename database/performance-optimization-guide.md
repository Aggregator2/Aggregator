# PostgreSQL Performance Optimization for Millions of Orders

## Overview

This guide provides comprehensive performance optimization strategies for the SettlementQueue database system handling millions of orders. The optimizations focus on indexing, partitioning, query optimization, and system tuning.

## Current Performance Baseline

### Expected Load Characteristics
- **Orders per day**: 1-10 million
- **Peak TPS**: 10,000 transactions per second
- **Data retention**: 7 years (compliance requirement)
- **Query patterns**: 80% reads, 20% writes
- **Concurrent connections**: 100-500

### Performance Targets
- **Order insertion**: < 5ms (95th percentile)
- **Balance lookup**: < 2ms (95th percentile)
- **Complex queries**: < 100ms (95th percentile)
- **Partition maintenance**: < 1 second per operation

## Database Configuration Optimization

### PostgreSQL Configuration (postgresql.conf)

```postgresql
# =============================================================================
# MEMORY CONFIGURATION
# =============================================================================

# Shared buffers: 25% of available RAM for dedicated database server
shared_buffers = 8GB                    # For 32GB RAM system
effective_cache_size = 24GB             # Total memory available for caching

# Work memory for sorting and hash operations
work_mem = 256MB                        # Per connection, for large sorts
maintenance_work_mem = 2GB              # For VACUUM, CREATE INDEX operations
temp_buffers = 128MB                    # Temporary tables

# =============================================================================
# CHECKPOINT AND WAL CONFIGURATION
# =============================================================================

# WAL settings for high-throughput workloads
wal_buffers = 64MB                      # WAL buffer size
max_wal_size = 8GB                      # Maximum WAL size before checkpoint
min_wal_size = 2GB                      # Minimum WAL size
checkpoint_completion_target = 0.9       # Spread checkpoints over time
checkpoint_timeout = 15min              # Maximum time between checkpoints

# WAL archiving for backup and replication
wal_level = replica                     # Enable replication
archive_mode = on                       # Enable WAL archiving
archive_command = 'cp %p /backup/wal/%f'

# =============================================================================
# QUERY PLANNER CONFIGURATION
# =============================================================================

# Random page cost - set lower for SSD storage
random_page_cost = 1.1                 # SSD optimized (default 4.0 for HDD)
seq_page_cost = 1.0                     # Sequential read cost

# CPU cost settings
cpu_tuple_cost = 0.01                   # Per-tuple processing cost
cpu_index_tuple_cost = 0.005            # Per-index-tuple processing cost
cpu_operator_cost = 0.0025              # Per-operator cost

# Parallel query settings
max_parallel_workers_per_gather = 4     # Parallel workers per query
max_parallel_workers = 8                # Total parallel workers
parallel_tuple_cost = 0.1               # Cost of transferring tuple to worker

# =============================================================================
# CONNECTION AND CONCURRENCY
# =============================================================================

max_connections = 500                   # Maximum concurrent connections
max_prepared_transactions = 100         # Prepared transactions (2PC)

# Background writer settings
bgwriter_delay = 200ms                  # Background writer sleep time
bgwriter_lru_maxpages = 100            # Maximum pages to write per round
bgwriter_lru_multiplier = 2.0          # Multiple of average buffer usage

# =============================================================================
# PARTITIONING OPTIMIZATION
# =============================================================================

enable_partition_pruning = on           # Enable partition pruning
enable_partitionwise_join = on          # Enable partition-wise joins
enable_partitionwise_aggregate = on     # Enable partition-wise aggregates

# =============================================================================
# LOGGING AND MONITORING
# =============================================================================

# Query logging for performance analysis
log_min_duration_statement = 1000      # Log queries taking > 1 second
log_checkpoints = on                    # Log checkpoint activity
log_connections = on                    # Log connections
log_disconnections = on                 # Log disconnections
log_lock_waits = on                     # Log lock waits

# Statement statistics
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.max = 10000          # Track top 10k statements
pg_stat_statements.track = all          # Track all statements
```

### Kernel and OS Optimization

```bash
# /etc/sysctl.conf optimizations for PostgreSQL

# Shared memory settings
kernel.shmmax = 34359738368             # 32GB in bytes
kernel.shmall = 8388608                 # 32GB in pages

# TCP settings for high connection loads
net.core.somaxconn = 4096               # Socket listen backlog
net.ipv4.tcp_keepalive_time = 600       # TCP keepalive time
net.ipv4.tcp_keepalive_intvl = 30       # TCP keepalive interval
net.ipv4.tcp_keepalive_probes = 3       # TCP keepalive probes

# Virtual memory settings
vm.swappiness = 1                       # Minimize swapping
vm.dirty_ratio = 3                      # Dirty page ratio
vm.dirty_background_ratio = 1           # Background dirty ratio
vm.overcommit_memory = 2                # Don't overcommit memory

# Huge pages configuration (optional but recommended)
vm.nr_hugepages = 4096                  # Number of huge pages (8GB worth)
```

## Index Optimization Strategy

### Primary Index Strategy

```sql
-- =============================================================================
-- CORE BUSINESS INDEXES
-- =============================================================================

-- High-frequency trader queries
CREATE INDEX CONCURRENTLY idx_orders_trader_status_created 
ON orders (trader_address, status, created_at DESC) 
WHERE status IN ('pending', 'revealed', 'processing');

-- Token pair trading analysis
CREATE INDEX CONCURRENTLY idx_orders_token_pair_volume 
ON orders (token_in, token_out, created_at DESC, amount_in) 
WHERE status = 'completed';

-- Priority queue operations (most critical for performance)
CREATE INDEX CONCURRENTLY idx_orders_priority_queue 
ON orders (status, priority DESC, created_at ASC) 
WHERE status IN ('revealed', 'processing')
INCLUDE (id, trader_address, amount_in, token_in, token_out);

-- Settlement processing
CREATE INDEX CONCURRENTLY idx_orders_settlement_batch 
ON orders (created_at, status, requires_multi_sig) 
WHERE status IN ('revealed', 'processing');

-- =============================================================================
-- PARTIAL INDEXES FOR SPECIFIC USE CASES
-- =============================================================================

-- MEV protection queries
CREATE INDEX CONCURRENTLY idx_orders_mev_protection 
ON orders (mev_protection_enabled, created_at DESC, priority) 
WHERE mev_protection_enabled = true AND status != 'completed';

-- Large orders requiring special handling
CREATE INDEX CONCURRENTLY idx_orders_large_orders 
ON orders (is_large_order, amount_in DESC, created_at DESC) 
WHERE is_large_order = true;

-- Failed orders analysis
CREATE INDEX CONCURRENTLY idx_orders_failed_analysis 
ON orders (status, error_message, created_at DESC) 
WHERE status = 'failed';

-- Expired orders cleanup
CREATE INDEX CONCURRENTLY idx_orders_expired_cleanup 
ON orders (deadline, status) 
WHERE status IN ('pending', 'revealed') AND deadline < NOW();

-- =============================================================================
-- COMPOSITE INDEXES FOR COMPLEX QUERIES
-- =============================================================================

-- Trading pair analysis with volume
CREATE INDEX CONCURRENTLY idx_orders_pair_volume_analysis 
ON orders (token_in, token_out, DATE(created_at), status) 
INCLUDE (amount_in, actual_amount_out)
WHERE status = 'completed';

-- User activity patterns
CREATE INDEX CONCURRENTLY idx_orders_user_activity 
ON orders (trader_address, DATE(created_at), status) 
INCLUDE (token_in, token_out, amount_in);

-- Blockchain reference lookups
CREATE INDEX CONCURRENTLY idx_orders_blockchain_ref 
ON orders (tx_hash, block_number, log_index) 
WHERE tx_hash IS NOT NULL;
```

### Balance Table Optimization

```sql
-- =============================================================================
-- BALANCE TABLE INDEXES
-- =============================================================================

-- Primary balance lookup (most frequent operation)
CREATE UNIQUE INDEX idx_user_balances_lookup 
ON user_balances (user_address, token_address, chain_id);

-- Stale balance cleanup
CREATE INDEX CONCURRENTLY idx_user_balances_stale_cleanup 
ON user_balances (last_updated, is_stale) 
WHERE is_stale = true OR cache_ttl < NOW();

-- Large balance monitoring
CREATE INDEX CONCURRENTLY idx_user_balances_large_balances 
ON user_balances (token_address, balance DESC, chain_id) 
WHERE balance > 1000000000000000000; -- > 1 ETH equivalent

-- Active trading accounts
CREATE INDEX CONCURRENTLY idx_user_balances_active_traders 
ON user_balances (last_updated DESC, user_address) 
WHERE last_updated > NOW() - INTERVAL '24 hours';
```

### Settlement Transaction Indexes

```sql
-- =============================================================================
-- SETTLEMENT TRANSACTION INDEXES
-- =============================================================================

-- Block-based queries for blockchain monitoring
CREATE INDEX CONCURRENTLY idx_settlement_tx_block_monitoring 
ON settlement_transactions (chain_id, block_number DESC, log_index)
INCLUDE (tx_hash, status, gas_used);

-- Settlement type analysis
CREATE INDEX CONCURRENTLY idx_settlement_tx_type_analysis 
ON settlement_transactions (settlement_type, created_at DESC, total_volume_usd)
WHERE status = 'finalized';

-- MEV protection effectiveness
CREATE INDEX CONCURRENTLY idx_settlement_tx_mev_analysis 
ON settlement_transactions (mev_protection_used, created_at DESC, gas_cost_wei)
INCLUDE (flashbot_bundle_hash, total_volume_usd);

-- Failed transaction analysis
CREATE INDEX CONCURRENTLY idx_settlement_tx_failed_analysis 
ON settlement_transactions (status, error_message, created_at DESC)
WHERE status IN ('failed', 'reverted');

-- Order relationship lookups
CREATE INDEX CONCURRENTLY idx_settlement_tx_order_lookup 
ON settlement_transactions USING GIN (order_ids);
```

## Partition-Specific Optimizations

### Partition Pruning Optimization

```sql
-- =============================================================================
-- PARTITION CONSTRAINT EXCLUSION
-- =============================================================================

-- Enable constraint exclusion for better partition pruning
SET constraint_exclusion = partition;

-- Example optimized query that leverages partition pruning
-- GOOD: Uses partition key in WHERE clause
SELECT * FROM orders 
WHERE created_at >= '2025-07-01' 
  AND created_at < '2025-08-01' 
  AND trader_address = decode('1234...', 'hex');

-- BAD: No partition key filter
SELECT * FROM orders 
WHERE trader_address = decode('1234...', 'hex');

-- =============================================================================
-- PARTITION-WISE JOINS
-- =============================================================================

-- Configure for partition-wise operations
SET enable_partitionwise_join = on;
SET enable_partitionwise_aggregate = on;

-- Example of partition-wise join optimization
SELECT o.id, o.amount_in, st.gas_used
FROM orders o
JOIN settlement_transactions st ON st.primary_order_id = o.id
WHERE o.created_at >= '2025-07-01' 
  AND o.created_at < '2025-08-01'
  AND st.created_at >= '2025-07-01' 
  AND st.created_at < '2025-08-01';
```

### Partition Maintenance Automation

```sql
-- =============================================================================
-- AUTOMATED PARTITION STATISTICS
-- =============================================================================

-- Function to update partition statistics efficiently
CREATE OR REPLACE FUNCTION update_partition_statistics()
RETURNS void AS $$
DECLARE
    partition_record RECORD;
BEGIN
    -- Update statistics for recent partitions only
    FOR partition_record IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
        AND tablename ~ '^(orders|settlement_transactions|balance_updates)_\d{4}_\d{2}$'
        AND tablename >= to_char(CURRENT_DATE - INTERVAL '3 months', '"orders_"YYYY_MM')
    LOOP
        EXECUTE format('ANALYZE %I.%I', partition_record.schemaname, partition_record.tablename);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule statistics updates
SELECT cron.schedule('partition-stats', '0 2 * * *', 'SELECT update_partition_statistics();');
```

## Query Optimization Patterns

### Optimized Query Examples

```sql
-- =============================================================================
-- HIGH-PERFORMANCE QUERY PATTERNS
-- =============================================================================

-- 1. TRADER DASHBOARD QUERY (Sub-100ms target)
-- Optimized version using covering index
EXPLAIN (ANALYZE, BUFFERS)
SELECT 
    o.id,
    o.status,
    o.token_in,
    o.token_out,
    o.amount_in,
    o.created_at,
    o.priority
FROM orders o
WHERE o.trader_address = $1 
  AND o.status != 'completed'
  AND o.created_at > CURRENT_DATE - INTERVAL '30 days'
ORDER BY o.priority DESC, o.created_at ASC
LIMIT 50;

-- 2. PRIORITY QUEUE PROCESSING (Sub-5ms target)
-- Uses dedicated priority queue index
WITH next_batch AS (
    SELECT id, trader_address, amount_in, token_in, token_out
    FROM orders 
    WHERE status = 'revealed'
    ORDER BY priority DESC, created_at ASC
    LIMIT 100
    FOR UPDATE SKIP LOCKED
)
UPDATE orders 
SET status = 'processing', 
    updated_at = NOW()
WHERE id IN (SELECT id FROM next_batch)
RETURNING id, trader_address, amount_in;

-- 3. BALANCE VALIDATION (Sub-2ms target)
-- Single index lookup with covering index
SELECT 
    balance,
    locked_balance,
    available_balance,
    last_updated,
    version
FROM user_balances 
WHERE user_address = $1 
  AND token_address = $2 
  AND chain_id = $3;

-- 4. SETTLEMENT HISTORY (Sub-50ms target)
-- Partition-pruned query with time bounds
SELECT 
    st.tx_hash,
    st.block_number,
    st.settlement_type,
    st.total_volume_usd,
    st.gas_used,
    st.created_at
FROM settlement_transactions st
WHERE st.created_at >= $1 
  AND st.created_at <= $2
  AND st.settler_address = $3
  AND st.status = 'finalized'
ORDER BY st.created_at DESC
LIMIT 100;

-- =============================================================================
-- AGGREGATE QUERIES WITH OPTIMIZATION
-- =============================================================================

-- 5. DAILY TRADING VOLUME (Sub-200ms target)
-- Pre-aggregated with materialized view refresh
SELECT 
    DATE(created_at) as trade_date,
    token_in,
    token_out,
    COUNT(*) as trade_count,
    SUM(amount_in) as total_volume,
    AVG(actual_amount_out::numeric / amount_in::numeric) as avg_rate
FROM orders 
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND status = 'completed'
  AND actual_amount_out IS NOT NULL
GROUP BY DATE(created_at), token_in, token_out
HAVING COUNT(*) >= 10
ORDER BY trade_date DESC, total_volume DESC;

-- 6. MEV PROTECTION EFFECTIVENESS
-- Complex analysis query optimized with partial indexes
SELECT 
    DATE(created_at) as date,
    COUNT(*) as total_settlements,
    COUNT(*) FILTER (WHERE mev_protection_used = true) as mev_protected,
    AVG(gas_cost_wei) FILTER (WHERE mev_protection_used = true) as avg_gas_mev,
    AVG(gas_cost_wei) FILTER (WHERE mev_protection_used = false) as avg_gas_normal,
    COUNT(*) FILTER (WHERE flashbot_bundle_hash IS NOT NULL) as flashbot_bundles
FROM settlement_transactions
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
  AND status = 'finalized'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

## Performance Monitoring Setup

### Key Performance Metrics

```sql
-- =============================================================================
-- PERFORMANCE MONITORING QUERIES
-- =============================================================================

-- 1. Table size and growth monitoring
CREATE VIEW performance_table_sizes AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - 
                   pg_relation_size(schemaname||'.'||tablename)) as index_size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY size_bytes DESC;

-- 2. Index usage statistics
CREATE VIEW performance_index_usage AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan,
    CASE 
        WHEN idx_scan = 0 THEN 'UNUSED'
        WHEN idx_scan < 100 THEN 'LOW_USAGE'
        ELSE 'ACTIVE'
    END as usage_status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- 3. Slow query identification
CREATE VIEW performance_slow_queries AS
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    stddev_time,
    rows,
    100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) as hit_percent
FROM pg_stat_statements 
WHERE mean_time > 100 -- Queries taking more than 100ms on average
ORDER BY mean_time DESC
LIMIT 20;

-- 4. Lock contention monitoring
CREATE VIEW performance_lock_contention AS
SELECT 
    waiting.locktype,
    waiting.database,
    waiting.relation::regclass,
    waiting.page,
    waiting.tuple,
    waiting.virtualxid,
    waiting.transactionid,
    waiting.classid,
    waiting.objid,
    waiting.objsubid,
    waiting.pid AS waiting_pid,
    waiting_stm.query AS waiting_query,
    other.pid AS other_pid,
    other_stm.query AS other_query
FROM pg_locks waiting
JOIN pg_stat_activity waiting_stm ON waiting_stm.pid = waiting.pid
JOIN pg_locks other ON (
    waiting."database" = other."database" AND
    waiting.relation = other.relation AND
    waiting.page = other.page AND
    waiting.tuple = other.tuple AND
    waiting.virtualxid = other.virtualxid AND
    waiting.transactionid = other.transactionid AND
    waiting.classid = other.classid AND
    waiting.objid = other.objid AND
    waiting.objsubid = other.objsubid AND
    waiting.pid != other.pid
)
JOIN pg_stat_activity other_stm ON other_stm.pid = other.pid
WHERE NOT waiting.granted;
```

### Automated Performance Alerts

```sql
-- =============================================================================
-- PERFORMANCE ALERTING FUNCTIONS
-- =============================================================================

-- Function to check for performance issues
CREATE OR REPLACE FUNCTION check_performance_issues()
RETURNS TABLE(
    issue_type TEXT,
    severity TEXT,
    description TEXT,
    recommendation TEXT
) AS $$
BEGIN
    -- Check for unused indexes
    RETURN QUERY
    SELECT 
        'UNUSED_INDEX'::TEXT,
        'MEDIUM'::TEXT,
        'Index ' || indexname || ' on ' || tablename || ' has not been used',
        'Consider dropping unused index to improve write performance'
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public' AND idx_scan = 0;
    
    -- Check for table bloat
    RETURN QUERY
    SELECT 
        'TABLE_BLOAT'::TEXT,
        'HIGH'::TEXT,
        'Table ' || tablename || ' may have significant bloat',
        'Run VACUUM FULL or pg_repack to reduce bloat'
    FROM pg_stat_user_tables
    WHERE schemaname = 'public' 
    AND n_dead_tup > n_live_tup * 0.1; -- More than 10% dead tuples
    
    -- Check for slow queries
    RETURN QUERY
    SELECT 
        'SLOW_QUERY'::TEXT,
        'HIGH'::TEXT,
        'Query with mean time ' || mean_time::TEXT || 'ms found',
        'Optimize query or add appropriate indexes'
    FROM pg_stat_statements
    WHERE mean_time > 1000 AND calls > 100;
    
    -- Check for lock waits
    RETURN QUERY
    SELECT 
        'LOCK_CONTENTION'::TEXT,
        'CRITICAL'::TEXT,
        'Active lock contention detected',
        'Investigate blocking queries and optimize transaction duration'
    WHERE EXISTS (
        SELECT 1 FROM pg_locks WHERE NOT granted
    );
END;
$$ LANGUAGE plpgsql;

-- Schedule performance checks
SELECT cron.schedule('performance-check', '*/15 * * * *', 'SELECT check_performance_issues();');
```

## Maintenance Procedures

### Automated Maintenance Script

```sql
-- =============================================================================
-- AUTOMATED MAINTENANCE PROCEDURES
-- =============================================================================

-- Comprehensive maintenance function
CREATE OR REPLACE FUNCTION perform_database_maintenance()
RETURNS TABLE(
    operation TEXT,
    table_name TEXT,
    duration INTERVAL,
    status TEXT
) AS $$
DECLARE
    start_time TIMESTAMP;
    table_rec RECORD;
BEGIN
    -- Update table statistics
    start_time := clock_timestamp();
    
    FOR table_rec IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ANALYZE %I.%I', table_rec.schemaname, table_rec.tablename);
    END LOOP;
    
    RETURN QUERY SELECT 
        'ANALYZE'::TEXT,
        'ALL_TABLES'::TEXT,
        clock_timestamp() - start_time,
        'COMPLETED'::TEXT;
    
    -- Vacuum heavily updated tables
    start_time := clock_timestamp();
    
    VACUUM (ANALYZE) user_balances;
    VACUUM (ANALYZE) orders;
    
    RETURN QUERY SELECT 
        'VACUUM'::TEXT,
        'CORE_TABLES'::TEXT,
        clock_timestamp() - start_time,
        'COMPLETED'::TEXT;
    
    -- Reindex if fragmentation is high
    start_time := clock_timestamp();
    
    -- Check and reindex fragmented indexes
    FOR table_rec IN 
        SELECT indexname 
        FROM pg_stat_user_indexes 
        WHERE idx_scan > 1000 AND schemaname = 'public'
    LOOP
        EXECUTE format('REINDEX INDEX CONCURRENTLY %I', table_rec.indexname);
    END LOOP;
    
    RETURN QUERY SELECT 
        'REINDEX'::TEXT,
        'HIGH_USAGE_INDEXES'::TEXT,
        clock_timestamp() - start_time,
        'COMPLETED'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Schedule maintenance during low-traffic periods
SELECT cron.schedule('database-maintenance', '0 3 * * SUN', 'SELECT perform_database_maintenance();');
```

## Connection Pool Optimization

### pgBouncer Configuration

```ini
# /etc/pgbouncer/pgbouncer.ini

[databases]
settlement_queue = host=localhost port=5432 dbname=settlement_queue user=postgres

[pgbouncer]
# Connection pooling mode
pool_mode = transaction              # Best for high-throughput OLTP

# Connection limits
max_client_conn = 1000              # Maximum client connections
default_pool_size = 25              # Pool size per database
reserve_pool_size = 5               # Reserve connections
reserve_pool_timeout = 5            # Reserve pool timeout

# Performance tuning
server_round_robin = 1              # Round-robin server connections
ignore_startup_parameters = extra_float_digits

# Authentication
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt

# Logging
log_connections = 1
log_disconnections = 1
log_pooler_errors = 1

# Admin interface
admin_users = postgres
stats_users = postgres

# Listen configuration
listen_addr = 127.0.0.1
listen_port = 6432

# TCP settings
tcp_keepalive = 1
tcp_keepcnt = 3
tcp_keepidle = 600
tcp_keepintvl = 30
```

### Application Connection Pool Settings

```javascript
// Node.js pg pool configuration for high performance
const poolConfig = {
    // Connection limits
    max: 20,                        // Maximum pool size
    min: 5,                         // Minimum pool size
    
    // Timeout settings
    connectionTimeoutMillis: 2000,  // Connection timeout
    idleTimeoutMillis: 30000,       // Idle connection timeout
    acquireTimeoutMillis: 5000,     // Pool acquire timeout
    
    // Health checks
    idleInTransactionSessionTimeout: 60000,
    query_timeout: 30000,
    
    // Performance settings
    allowExitOnIdle: true,
    keepAlive: true,
    keepAliveInitialDelayMillis: 0,
    
    // Statement timeout
    statement_timeout: 30000,
    
    // SSL configuration for production
    ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
    } : false
};
```

## Monitoring and Alerting

### Prometheus Metrics Configuration

```yaml
# prometheus.yml - PostgreSQL monitoring
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'postgres-exporter'
    static_configs:
      - targets: ['localhost:9187']
    scrape_interval: 10s
    metrics_path: /metrics
    
rule_files:
  - "postgres_alerts.yml"

# postgres_alerts.yml
groups:
- name: postgresql
  rules:
  - alert: PostgreSQLDown
    expr: pg_up == 0
    for: 0m
    labels:
      severity: critical
    annotations:
      summary: PostgreSQL instance is down
      
  - alert: PostgreSQLSlowQueries
    expr: rate(pg_stat_activity_max_tx_duration[5m]) > 300
    for: 2m
    labels:
      severity: warning
    annotations:
      summary: PostgreSQL has slow queries
      
  - alert: PostgreSQLHighConnections
    expr: pg_stat_activity_count > 450
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: PostgreSQL connection count is high
      
  - alert: PostgreSQLLockContention
    expr: pg_locks_count{mode!="AccessShareLock"} > 10
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: PostgreSQL lock contention detected
```

### Grafana Dashboard Queries

```sql
-- =============================================================================
-- GRAFANA DASHBOARD QUERIES
-- =============================================================================

-- Transaction throughput
SELECT 
    time_bucket('1 minute', created_at) as time,
    COUNT(*) as transactions_per_minute
FROM orders 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY time_bucket('1 minute', created_at)
ORDER BY time;

-- Database size growth
SELECT 
    pg_size_pretty(pg_database_size('settlement_queue')) as database_size,
    pg_database_size('settlement_queue') as size_bytes;

-- Active connections
SELECT 
    state,
    COUNT(*) as connection_count
FROM pg_stat_activity 
WHERE datname = 'settlement_queue'
GROUP BY state;

-- Cache hit ratio
SELECT 
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100 as cache_hit_ratio
FROM pg_statio_user_tables;

-- Lock contention
SELECT 
    COUNT(*) as blocked_queries
FROM pg_locks 
WHERE NOT granted;
```

## Disaster Recovery and Backup

### Automated Backup Strategy

```bash
#!/bin/bash
# backup-database.sh - Automated backup script

BACKUP_DIR="/backup/postgresql"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="settlement_queue"

# Create backup directory
mkdir -p ${BACKUP_DIR}/${DATE}

# Full database backup
pg_dump -Fc -h localhost -U postgres ${DB_NAME} > ${BACKUP_DIR}/${DATE}/settlement_queue_${DATE}.dump

# Backup specific critical tables with compression
pg_dump -h localhost -U postgres -t orders -t user_balances -t settlement_transactions \
    --compress=9 ${DB_NAME} > ${BACKUP_DIR}/${DATE}/critical_tables_${DATE}.sql.gz

# WAL archiving
rsync -av /var/lib/postgresql/14/main/pg_wal/ ${BACKUP_DIR}/${DATE}/wal/

# Cleanup old backups (keep 30 days)
find ${BACKUP_DIR} -type d -mtime +30 -exec rm -rf {} \;

# Verify backup integrity
pg_restore --list ${BACKUP_DIR}/${DATE}/settlement_queue_${DATE}.dump > /dev/null
if [ $? -eq 0 ]; then
    echo "Backup completed successfully: ${DATE}"
else
    echo "Backup verification failed: ${DATE}"
    exit 1
fi
```

### Point-in-Time Recovery Setup

```sql
-- Enable point-in-time recovery
ALTER SYSTEM SET wal_level = replica;
ALTER SYSTEM SET archive_mode = on;
ALTER SYSTEM SET archive_command = 'test ! -f /backup/wal/%f && cp %p /backup/wal/%f';
ALTER SYSTEM SET restore_command = 'cp /backup/wal/%f %p';

-- Create recovery script
-- recovery.conf template
restore_command = 'cp /backup/wal/%f %p'
recovery_target_time = '2025-07-12 14:30:00'
recovery_target_inclusive = true
```

## Performance Testing

### Load Testing Scenarios

```sql
-- =============================================================================
-- PERFORMANCE TESTING QUERIES
-- =============================================================================

-- Test 1: High-frequency order insertion
DO $$
DECLARE
    i INTEGER;
    start_time TIMESTAMP;
    end_time TIMESTAMP;
BEGIN
    start_time := clock_timestamp();
    
    FOR i IN 1..10000 LOOP
        INSERT INTO orders (
            order_hash, trader_address, token_in, token_out,
            amount_in, min_amount_out, deadline, nonce, priority
        ) VALUES (
            decode(md5(random()::text), 'hex'),
            decode(md5(random()::text), 'hex'),
            decode('C02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'hex'),
            decode('A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'hex'),
            (random() * 1000000000000000000)::bigint,
            (random() * 1000000000000000000)::bigint,
            NOW() + INTERVAL '1 hour',
            i,
            (random() * 1000)::integer
        );
        
        IF i % 1000 = 0 THEN
            RAISE NOTICE 'Inserted % orders', i;
        END IF;
    END LOOP;
    
    end_time := clock_timestamp();
    RAISE NOTICE 'Inserted 10000 orders in %', end_time - start_time;
END $$;

-- Test 2: Concurrent balance updates
-- Run this from multiple connections simultaneously
DO $$
DECLARE
    user_addr BYTEA := decode('1234567890123456789012345678901234567890', 'hex');
    token_addr BYTEA := decode('C02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'hex');
    i INTEGER;
BEGIN
    FOR i IN 1..1000 LOOP
        UPDATE user_balances 
        SET balance = balance + (random() * 1000000000000000)::bigint,
            version = version + 1
        WHERE user_address = user_addr 
          AND token_address = token_addr;
          
        IF NOT FOUND THEN
            INSERT INTO user_balances (user_address, token_address, balance)
            VALUES (user_addr, token_addr, (random() * 1000000000000000)::bigint)
            ON CONFLICT (user_address, token_address, chain_id) 
            DO UPDATE SET balance = EXCLUDED.balance;
        END IF;
    END LOOP;
END $$;
```

## Conclusion

This performance optimization guide provides a comprehensive framework for scaling the SettlementQueue database to handle millions of orders efficiently. Key success factors include:

1. **Proper Indexing**: Strategic use of partial and covering indexes
2. **Partitioning**: Automated partition management and pruning
3. **Query Optimization**: Efficient query patterns and execution plans
4. **System Tuning**: PostgreSQL and OS-level optimizations
5. **Monitoring**: Comprehensive performance monitoring and alerting
6. **Maintenance**: Automated maintenance procedures

Regular monitoring and adjustment of these optimizations ensure continued high performance as the system scales.