-- =============================================
-- SwappiQ Protocol Database Performance Optimizations
-- =============================================

-- =============================================
-- 1. INDEXING STRATEGY
-- =============================================

-- User table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_status_created 
ON "User"(status, "createdAt" DESC) 
WHERE status = 'ACTIVE';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_email_lower 
ON "User"(LOWER(email)) 
WHERE email IS NOT NULL;

-- GIN index for wallet address search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_wallet_gin 
ON "User" USING gin("walletAddress" gin_trgm_ops);

-- Order table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_user_status_created 
ON "Order"("userId", status, "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_pair_side_price 
ON "Order"("pairId", side, price) 
WHERE status IN ('NEW', 'PARTIALLY_FILLED');

-- Composite index for order matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_matching 
ON "Order"("pairId", side, price, "createdAt") 
WHERE status = 'NEW';

-- BRIN index for time-series data
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_created_brin 
ON "Order" USING brin("createdAt") WITH (pages_per_range = 128);

-- Trade table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_pair_executed 
ON "Trade"("pairId", "executedAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_buyer_executed 
ON "Trade"("buyerId", "executedAt" DESC);

-- BRIN index for trade history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trade_executed_brin 
ON "Trade" USING brin("executedAt") WITH (pages_per_range = 64);

-- Balance table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balance_user_asset 
ON "Balance"("userId", asset) 
INCLUDE (available, locked);

-- Transaction table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_user_status 
ON "Transaction"("userId", status, "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_hash 
ON "Transaction"("txHash") 
WHERE "txHash" IS NOT NULL;

-- Price history indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_history_lookup 
ON "PriceHistory"("pairId", interval, "openTime" DESC);

-- Partial index for active orders
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_order_active 
ON "Order"("pairId", side, price) 
WHERE status IN ('NEW', 'PARTIALLY_FILLED');

-- =============================================
-- 2. TABLE PARTITIONING
-- =============================================

-- Partition Trade table by month
CREATE TABLE IF NOT EXISTS "Trade_y2024m01" PARTITION OF "Trade" 
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE IF NOT EXISTS "Trade_y2024m02" PARTITION OF "Trade" 
FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Function to create monthly partitions automatically
CREATE OR REPLACE FUNCTION create_monthly_trade_partition()
RETURNS void AS $$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_DATE);
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'Trade_y' || TO_CHAR(start_date, 'YYYY') || 'm' || TO_CHAR(start_date, 'MM');
    
    -- Check if partition exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_class 
        WHERE relname = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF "Trade" FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
        
        -- Create indexes on new partition
        EXECUTE format(
            'CREATE INDEX CONCURRENTLY %I ON %I ("pairId", "executedAt" DESC)',
            partition_name || '_pair_executed_idx', partition_name
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Schedule partition creation (requires pg_cron extension)
-- SELECT cron.schedule('create-trade-partitions', '0 0 1 * *', 'SELECT create_monthly_trade_partition()');

-- Partition Order table by status and date
CREATE TABLE IF NOT EXISTS "Order_active" PARTITION OF "Order" 
FOR VALUES IN ('NEW', 'PARTIALLY_FILLED') 
PARTITION BY RANGE ("createdAt");

CREATE TABLE IF NOT EXISTS "Order_completed" PARTITION OF "Order" 
FOR VALUES IN ('FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED') 
PARTITION BY RANGE ("createdAt");

-- =============================================
-- 3. MATERIALIZED VIEWS
-- =============================================

-- Order book snapshot materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_orderbook_snapshot AS
WITH ranked_orders AS (
    SELECT 
        o."pairId",
        o.side,
        o.price,
        SUM(o."remainingQuantity") as total_quantity,
        COUNT(*) as order_count,
        ROW_NUMBER() OVER (
            PARTITION BY o."pairId", o.side 
            ORDER BY 
                CASE WHEN o.side = 'BUY' THEN o.price END DESC,
                CASE WHEN o.side = 'SELL' THEN o.price END ASC
        ) as depth_rank
    FROM "Order" o
    WHERE o.status IN ('NEW', 'PARTIALLY_FILLED')
    GROUP BY o."pairId", o.side, o.price
)
SELECT 
    "pairId",
    side,
    price,
    total_quantity,
    order_count,
    depth_rank,
    NOW() as snapshot_time
FROM ranked_orders
WHERE depth_rank <= 50;

CREATE UNIQUE INDEX ON mv_orderbook_snapshot ("pairId", side, price);
CREATE INDEX ON mv_orderbook_snapshot ("pairId", side, depth_rank);

-- 24h statistics materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pair_stats_24h AS
SELECT 
    t."pairId",
    COUNT(*) as trade_count,
    SUM(t.quantity) as volume,
    SUM(t."quoteQuantity") as quote_volume,
    MAX(t.price) as high_24h,
    MIN(t.price) as low_24h,
    FIRST(t.price ORDER BY t."executedAt" DESC) as last_price,
    FIRST(t.price ORDER BY t."executedAt" DESC) - FIRST(t.price ORDER BY t."executedAt" ASC) as price_change,
    NOW() as last_updated
FROM "Trade" t
WHERE t."executedAt" >= NOW() - INTERVAL '24 hours'
GROUP BY t."pairId";

CREATE UNIQUE INDEX ON mv_pair_stats_24h ("pairId");

-- User trading statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_trading_stats AS
SELECT 
    u.id as user_id,
    COUNT(DISTINCT o.id) as total_orders,
    COUNT(DISTINCT t.id) as total_trades,
    SUM(t."quoteQuantity") as total_volume,
    COUNT(DISTINCT DATE(o."createdAt")) as active_days,
    MAX(o."createdAt") as last_order_at,
    NOW() as calculated_at
FROM "User" u
LEFT JOIN "Order" o ON u.id = o."userId"
LEFT JOIN "Trade" t ON (u.id = t."buyerId" OR u.id = t."sellerId")
GROUP BY u.id;

CREATE UNIQUE INDEX ON mv_user_trading_stats (user_id);

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_orderbook_snapshot;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_pair_stats_24h;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_trading_stats;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 4. QUERY OPTIMIZATION FUNCTIONS
-- =============================================

-- Function to get order book depth efficiently
CREATE OR REPLACE FUNCTION get_orderbook_depth(
    p_pair_id UUID,
    p_depth INT DEFAULT 20
)
RETURNS TABLE(
    side "OrderSide",
    price DECIMAL(20, 8),
    quantity DECIMAL(20, 8),
    order_count INT
) AS $$
BEGIN
    RETURN QUERY
    WITH bids AS (
        SELECT 
            o.side,
            o.price,
            SUM(o."remainingQuantity") as quantity,
            COUNT(*)::INT as order_count
        FROM "Order" o
        WHERE o."pairId" = p_pair_id
            AND o.side = 'BUY'
            AND o.status IN ('NEW', 'PARTIALLY_FILLED')
        GROUP BY o.side, o.price
        ORDER BY o.price DESC
        LIMIT p_depth
    ),
    asks AS (
        SELECT 
            o.side,
            o.price,
            SUM(o."remainingQuantity") as quantity,
            COUNT(*)::INT as order_count
        FROM "Order" o
        WHERE o."pairId" = p_pair_id
            AND o.side = 'SELL'
            AND o.status IN ('NEW', 'PARTIALLY_FILLED')
        GROUP BY o.side, o.price
        ORDER BY o.price ASC
        LIMIT p_depth
    )
    SELECT * FROM bids
    UNION ALL
    SELECT * FROM asks;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to match orders efficiently
CREATE OR REPLACE FUNCTION match_orders(p_pair_id UUID)
RETURNS TABLE(
    buy_order_id UUID,
    sell_order_id UUID,
    match_price DECIMAL(20, 8),
    match_quantity DECIMAL(20, 8)
) AS $$
BEGIN
    RETURN QUERY
    WITH best_bid AS (
        SELECT o.id, o.price, o."remainingQuantity", o."userId"
        FROM "Order" o
        WHERE o."pairId" = p_pair_id
            AND o.side = 'BUY'
            AND o.status = 'NEW'
        ORDER BY o.price DESC, o."createdAt" ASC
        LIMIT 1
    ),
    best_ask AS (
        SELECT o.id, o.price, o."remainingQuantity", o."userId"
        FROM "Order" o
        WHERE o."pairId" = p_pair_id
            AND o.side = 'SELL'
            AND o.status = 'NEW'
        ORDER BY o.price ASC, o."createdAt" ASC
        LIMIT 1
    )
    SELECT 
        bb.id as buy_order_id,
        ba.id as sell_order_id,
        ba.price as match_price,
        LEAST(bb."remainingQuantity", ba."remainingQuantity") as match_quantity
    FROM best_bid bb, best_ask ba
    WHERE bb.price >= ba.price
        AND bb."userId" != ba."userId"; -- Prevent self-trading
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================
-- 5. PERFORMANCE MONITORING
-- =============================================

-- Create extension for query stats
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- View for slow queries
CREATE OR REPLACE VIEW v_slow_queries AS
SELECT 
    query,
    calls,
    mean_exec_time,
    total_exec_time,
    min_exec_time,
    max_exec_time,
    stddev_exec_time,
    rows
FROM pg_stat_statements
WHERE mean_exec_time > 100 -- queries taking more than 100ms
ORDER BY mean_exec_time DESC;

-- View for missing indexes
CREATE OR REPLACE VIEW v_missing_indexes AS
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    correlation,
    null_frac,
    avg_width
FROM pg_stats
WHERE schemaname = 'public'
    AND n_distinct > 100
    AND correlation < 0.1
    AND null_frac < 0.5
ORDER BY n_distinct DESC;

-- View for table bloat
CREATE OR REPLACE VIEW v_table_bloat AS
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
    pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size,
    ROUND(100 * pg_total_relation_size(schemaname||'.'||tablename) / 
        NULLIF(pg_database_size(current_database()), 0), 2) AS percent_of_db
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- =============================================
-- 6. MAINTENANCE FUNCTIONS
-- =============================================

-- Function to analyze tables and update statistics
CREATE OR REPLACE FUNCTION analyze_all_tables()
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE 'ANALYZE ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to reindex tables safely
CREATE OR REPLACE FUNCTION reindex_tables_concurrently()
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
    LOOP
        EXECUTE 'REINDEX TABLE CONCURRENTLY ' || quote_ident(r.schemaname) || '.' || quote_ident(r.tablename);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 7. CONFIGURATION OPTIMIZATIONS
-- =============================================

-- Recommended PostgreSQL configuration changes (add to postgresql.conf):
/*
# Memory Settings
shared_buffers = 25% of RAM
effective_cache_size = 75% of RAM
work_mem = RAM / max_connections / 2
maintenance_work_mem = RAM / 16

# Checkpoint Settings
checkpoint_completion_target = 0.9
wal_buffers = 16MB
max_wal_size = 4GB

# Query Planner
random_page_cost = 1.1  # For SSD storage
effective_io_concurrency = 200  # For SSD storage

# Logging
log_min_duration_statement = 100  # Log queries over 100ms
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on

# Autovacuum
autovacuum_max_workers = 4
autovacuum_naptime = 30s
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_scale_factor = 0.02
*/

-- =============================================
-- 8. MONITORING QUERIES
-- =============================================

-- Check index usage
CREATE OR REPLACE VIEW v_index_usage AS
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    CASE WHEN idx_scan = 0 THEN 0 
         ELSE ROUND(100.0 * idx_tup_read / idx_scan, 2) 
    END AS avg_tuples_per_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan DESC;

-- Check table cache hit ratio
CREATE OR REPLACE VIEW v_cache_hit_ratio AS
SELECT
    schemaname,
    tablename,
    heap_blks_read,
    heap_blks_hit,
    CASE WHEN heap_blks_read + heap_blks_hit = 0 THEN 0
         ELSE ROUND(100.0 * heap_blks_hit / (heap_blks_read + heap_blks_hit), 2)
    END AS cache_hit_ratio
FROM pg_statio_user_tables
ORDER BY heap_blks_read + heap_blks_hit DESC;