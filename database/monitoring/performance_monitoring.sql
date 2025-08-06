-- Performance Monitoring Queries for PostgreSQL
-- High-frequency trading database performance analytics

-- =====================================================
-- 1. REAL-TIME PERFORMANCE DASHBOARD
-- =====================================================

-- Current database activity overview
CREATE OR REPLACE VIEW performance_dashboard AS
SELECT 
    'Active Connections' as metric,
    COUNT(*) FILTER (WHERE state = 'active') as value,
    COUNT(*) as total,
    'connections' as unit
FROM pg_stat_activity
WHERE datname = current_database()
UNION ALL
SELECT 
    'Transaction Rate' as metric,
    ROUND(SUM(xact_commit + xact_rollback) / EXTRACT(epoch FROM NOW() - stats_reset))::numeric as value,
    NULL as total,
    'tx/sec' as unit
FROM pg_stat_database
WHERE datname = current_database()
UNION ALL
SELECT 
    'Cache Hit Ratio' as metric,
    ROUND(100.0 * SUM(blks_hit) / NULLIF(SUM(blks_hit + blks_read), 0), 2)::numeric as value,
    100 as total,
    '%' as unit
FROM pg_stat_database
WHERE datname = current_database()
UNION ALL
SELECT 
    'Index Usage' as metric,
    ROUND(100.0 * SUM(idx_scan) / NULLIF(SUM(seq_scan + idx_scan), 0), 2)::numeric as value,
    100 as total,
    '%' as unit
FROM pg_stat_user_tables;

-- =====================================================
-- 2. QUERY PERFORMANCE MONITORING
-- =====================================================

-- Top 20 slowest queries
CREATE OR REPLACE VIEW top_slow_queries AS
SELECT 
    substring(query, 1, 100) as query_preview,
    calls,
    ROUND(total_time::numeric, 2) as total_time_ms,
    ROUND(mean_time::numeric, 2) as avg_time_ms,
    ROUND(stddev_time::numeric, 2) as stddev_ms,
    ROUND(max_time::numeric, 2) as max_time_ms,
    rows,
    ROUND(100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) as cache_hit_pct
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat%'
  AND query NOT LIKE '%EXPLAIN%'
  AND calls > 10
ORDER BY mean_time DESC
LIMIT 20;

-- Queries with high variance (unpredictable performance)
CREATE OR REPLACE VIEW high_variance_queries AS
SELECT 
    substring(query, 1, 100) as query_preview,
    calls,
    ROUND(mean_time::numeric, 2) as avg_time_ms,
    ROUND(stddev_time::numeric, 2) as stddev_ms,
    ROUND((stddev_time / NULLIF(mean_time, 0))::numeric, 2) as coefficient_of_variation,
    ROUND(min_time::numeric, 2) as min_time_ms,
    ROUND(max_time::numeric, 2) as max_time_ms
FROM pg_stat_statements
WHERE calls > 100
  AND stddev_time > mean_time * 0.5
  AND mean_time > 1
ORDER BY coefficient_of_variation DESC
LIMIT 20;

-- =====================================================
-- 3. TABLE AND INDEX MONITORING
-- =====================================================

-- Table access patterns
CREATE OR REPLACE VIEW table_access_patterns AS
SELECT 
    schemaname,
    tablename,
    n_tup_ins as inserts,
    n_tup_upd as updates,
    n_tup_del as deletes,
    n_tup_hot_upd as hot_updates,
    ROUND(100.0 * n_tup_hot_upd / NULLIF(n_tup_upd, 0), 2) as hot_update_ratio,
    seq_scan,
    idx_scan,
    ROUND(100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0), 2) as index_usage_pct,
    pg_size_pretty(pg_table_size(schemaname||'.'||tablename)) as table_size
FROM pg_stat_user_tables
ORDER BY n_tup_ins + n_tup_upd + n_tup_del DESC;

-- Index efficiency analysis
CREATE OR REPLACE VIEW index_efficiency AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    ROUND(idx_tup_fetch::numeric / NULLIF(idx_scan, 0), 2) as avg_tuples_per_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    CASE 
        WHEN idx_scan = 0 THEN 'UNUSED'
        WHEN idx_tup_fetch / NULLIF(idx_scan, 0) < 1 THEN 'INEFFICIENT'
        ELSE 'EFFICIENT'
    END as status
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Bloated tables and indexes
CREATE OR REPLACE VIEW table_bloat AS
WITH constants AS (
    SELECT current_setting('block_size')::int AS bs, 23 AS hdr, 8 AS ma
),
no_stats AS (
    SELECT table_schema, table_name, 
        n_live_tup::numeric as est_rows,
        pg_table_size(quote_ident(table_schema)||'.'||quote_ident(table_name))::numeric as table_size
    FROM information_schema.tables
    LEFT OUTER JOIN pg_stat_user_tables
        ON table_schema = schemaname AND table_name = tablename
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
),
null_headers AS (
    SELECT
        hdr+1+(sum(case when null_frac <> 0 THEN 1 else 0 END)/8) as nullhdr,
        SUM((1-null_frac)*avg_width) as datawidth,
        MAX(null_frac) as maxfracsum,
        table_schema,
        table_name,
        hdr, ma, bs
    FROM pg_stats CROSS JOIN constants
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    GROUP BY table_schema, table_name, hdr, ma, bs
)
SELECT
    table_schema,
    table_name,
    pg_size_pretty(table_size) AS table_size,
    ROUND(100 * (table_size - index_size - toast_size - (datawidth + nullhdr + ma) * est_rows) / table_size::numeric, 2) AS bloat_pct,
    pg_size_pretty((table_size - index_size - toast_size - (datawidth + nullhdr + ma) * est_rows)::numeric) AS bloat_size
FROM (
    SELECT 
        ns.table_schema,
        ns.table_name,
        ns.table_size,
        COALESCE(ns.table_size - COALESCE(s.index_size, 0) - COALESCE(t.toast_size, 0), 0) as table_size_without_extras,
        COALESCE(s.index_size, 0) AS index_size,
        COALESCE(t.toast_size, 0) AS toast_size,
        nh.datawidth,
        nh.nullhdr,
        nh.ma,
        ns.est_rows
    FROM no_stats ns
    LEFT OUTER JOIN null_headers nh ON ns.table_schema = nh.table_schema AND ns.table_name = nh.table_name
    LEFT OUTER JOIN (
        SELECT table_schema, table_name, SUM(pg_relation_size(indexrelid))::bigint AS index_size
        FROM pg_stat_user_indexes
        GROUP BY table_schema, table_name
    ) s ON ns.table_schema = s.table_schema AND ns.table_name = s.table_name
    LEFT OUTER JOIN (
        SELECT n.nspname AS table_schema, c.relname AS table_name,
            pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - COALESCE(SUM(pg_relation_size(i.indexrelid)), 0) AS toast_size
        FROM pg_class c
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_index i ON i.indrelid = c.oid
        WHERE c.relkind = 'r'
        GROUP BY n.nspname, c.relname, c.oid
    ) t ON ns.table_schema = t.table_schema AND ns.table_name = t.table_name
) calc
WHERE table_size > 1024 * 1024  -- Only tables > 1MB
  AND bloat_pct > 20  -- Only show significant bloat
ORDER BY bloat_pct DESC;

-- =====================================================
-- 4. LOCK MONITORING
-- =====================================================

-- Current lock analysis
CREATE OR REPLACE VIEW current_locks AS
SELECT 
    pid,
    usename,
    application_name,
    locktype,
    database,
    relation::regclass as table_name,
    mode,
    granted,
    age(clock_timestamp(), query_start) as lock_age,
    query
FROM pg_locks
LEFT JOIN pg_stat_activity ON pg_locks.pid = pg_stat_activity.pid
WHERE NOT granted
ORDER BY lock_age DESC;

-- Lock wait analysis
CREATE OR REPLACE VIEW lock_wait_analysis AS
WITH lock_info AS (
    SELECT 
        blocked_locks.pid AS blocked_pid,
        blocked_activity.usename AS blocked_user,
        blocking_locks.pid AS blocking_pid,
        blocking_activity.usename AS blocking_user,
        blocked_activity.query AS blocked_statement,
        blocking_activity.query AS blocking_statement,
        blocked_activity.application_name AS blocked_app,
        blocking_activity.application_name AS blocking_app,
        age(clock_timestamp(), blocked_activity.query_start) AS blocked_duration,
        age(clock_timestamp(), blocking_activity.query_start) AS blocking_duration
    FROM pg_catalog.pg_locks blocked_locks
    JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
    JOIN pg_catalog.pg_locks blocking_locks 
        ON blocking_locks.locktype = blocked_locks.locktype
        AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
        AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
        AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
        AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
        AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
        AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
        AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
        AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
        AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
        AND blocking_locks.pid != blocked_locks.pid
    JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
    WHERE NOT blocked_locks.granted
)
SELECT * FROM lock_info;

-- =====================================================
-- 5. CONNECTION POOL MONITORING
-- =====================================================

-- Connection pool efficiency
CREATE OR REPLACE VIEW connection_pool_stats AS
SELECT 
    datname,
    numbackends as active_connections,
    ROUND(100.0 * numbackends / 
        NULLIF(current_setting('max_connections')::int, 0), 2) as connection_pct,
    xact_commit + xact_rollback as total_transactions,
    blks_hit + blks_read as total_blocks_accessed,
    tup_returned + tup_fetched as total_tuples,
    temp_files as temp_files_created,
    pg_size_pretty(temp_bytes) as temp_space_used
FROM pg_stat_database
WHERE datname = current_database();

-- =====================================================
-- 6. PERFORMANCE ALERTING
-- =====================================================

-- Performance alert conditions
CREATE OR REPLACE VIEW performance_alerts AS
SELECT 
    'High query execution time' as alert_type,
    'CRITICAL' as severity,
    COUNT(*) as count,
    'queries with avg time > 100ms' as details
FROM pg_stat_statements
WHERE mean_time > 100
  AND calls > 10
HAVING COUNT(*) > 0
UNION ALL
SELECT 
    'Low cache hit ratio' as alert_type,
    CASE 
        WHEN ratio < 90 THEN 'CRITICAL'
        WHEN ratio < 95 THEN 'WARNING'
        ELSE 'INFO'
    END as severity,
    1 as count,
    ROUND(ratio, 2) || '% cache hits' as details
FROM (
    SELECT 100.0 * SUM(blks_hit) / NULLIF(SUM(blks_hit + blks_read), 0) as ratio
    FROM pg_stat_database
    WHERE datname = current_database()
) cache_stats
WHERE ratio < 95
UNION ALL
SELECT 
    'Table bloat detected' as alert_type,
    'WARNING' as severity,
    COUNT(*) as count,
    'tables with > 40% bloat' as details
FROM table_bloat
WHERE bloat_pct > 40
HAVING COUNT(*) > 0
UNION ALL
SELECT 
    'Unused indexes' as alert_type,
    'INFO' as severity,
    COUNT(*) as count,
    'indexes with 0 scans' as details
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexrelid > 16384  -- User indexes only
HAVING COUNT(*) > 0;

-- =====================================================
-- 7. MONITORING FUNCTIONS
-- =====================================================

-- Function to capture performance snapshot
CREATE OR REPLACE FUNCTION capture_performance_snapshot()
RETURNS TABLE(
    snapshot_time timestamptz,
    metric_name text,
    metric_value numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        NOW() as snapshot_time,
        metric || '_' || unit as metric_name,
        value as metric_value
    FROM performance_dashboard
    UNION ALL
    SELECT 
        NOW(),
        'slow_queries_count',
        COUNT(*)::numeric
    FROM top_slow_queries
    UNION ALL
    SELECT 
        NOW(),
        'lock_waits_count',
        COUNT(*)::numeric
    FROM current_locks
    WHERE NOT granted;
END;
$$ LANGUAGE plpgsql;

-- Function to analyze query plan
CREATE OR REPLACE FUNCTION analyze_query_plan(query_text text)
RETURNS TABLE(
    node_type text,
    total_cost numeric,
    rows bigint,
    width int,
    actual_time numeric,
    actual_rows bigint,
    loops bigint,
    buffers_hit bigint,
    buffers_read bigint
) AS $$
DECLARE
    plan_json json;
BEGIN
    EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || query_text INTO plan_json;
    
    RETURN QUERY
    WITH RECURSIVE plan_nodes AS (
        SELECT 
            plan_json->0->'Plan' as node,
            0 as level
        UNION ALL
        SELECT 
            CASE 
                WHEN json_typeof(child.node) = 'array' THEN json_array_elements(child.node)
                ELSE child.node
            END as node,
            parent.level + 1
        FROM plan_nodes parent,
        LATERAL (
            SELECT parent.node->'Plans' as node
            WHERE parent.node->'Plans' IS NOT NULL
        ) child
    )
    SELECT 
        node->>'Node Type' as node_type,
        (node->>'Total Cost')::numeric as total_cost,
        (node->>'Plan Rows')::bigint as rows,
        (node->>'Plan Width')::int as width,
        (node->>'Actual Total Time')::numeric as actual_time,
        (node->>'Actual Rows')::bigint as actual_rows,
        (node->>'Actual Loops')::bigint as loops,
        (node->>'Shared Hit Blocks')::bigint as buffers_hit,
        (node->>'Shared Read Blocks')::bigint as buffers_read
    FROM plan_nodes
    ORDER BY level, total_cost DESC;
END;
$$ LANGUAGE plpgsql;