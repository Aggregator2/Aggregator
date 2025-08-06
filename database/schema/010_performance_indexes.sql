-- Performance optimization indexes and configurations

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY idx_orders_user_pair_status 
    ON orders (user_id, pair, status, created_at DESC) 
    WHERE status IN ('open', 'partially_filled');

CREATE INDEX CONCURRENTLY idx_orders_pair_side_price_status 
    ON orders (pair, side, price, status) 
    INCLUDE (amount, filled, user_id)
    WHERE status IN ('open', 'partially_filled');

CREATE INDEX CONCURRENTLY idx_trades_pair_time_price 
    ON trades (pair, executed_at DESC) 
    INCLUDE (price, amount, side);

CREATE INDEX CONCURRENTLY idx_trades_users_time 
    ON trades (maker_user_id, executed_at DESC) 
    INCLUDE (taker_user_id, pair, price, amount);

-- Partial indexes for specific queries
CREATE INDEX CONCURRENTLY idx_orders_market_active 
    ON orders (pair, created_at DESC) 
    WHERE type = 'market' AND status = 'open';

CREATE INDEX CONCURRENTLY idx_orders_stop_active 
    ON orders (pair, (metadata->>'stop_price')::DECIMAL) 
    WHERE type IN ('stop', 'stop_limit') AND status = 'open';

CREATE INDEX CONCURRENTLY idx_trades_unsettled 
    ON trades (settlement_status, executed_at) 
    WHERE settlement_status IN ('pending', 'settling');

-- BRIN indexes for time-series data (very efficient for large tables)
CREATE INDEX idx_orders_created_brin 
    ON orders USING BRIN (created_at) 
    WITH (pages_per_range = 128);

CREATE INDEX idx_trades_executed_brin 
    ON trades USING BRIN (executed_at) 
    WITH (pages_per_range = 128);

CREATE INDEX idx_candles_time_brin 
    ON candles USING BRIN (time) 
    WITH (pages_per_range = 64);

-- Hash indexes for exact lookups (PostgreSQL 10+)
CREATE INDEX CONCURRENTLY idx_users_id_hash 
    ON users USING HASH (id);

CREATE INDEX CONCURRENTLY idx_api_keys_hash_hash 
    ON api_keys USING HASH (key_hash);

-- Covering indexes to enable index-only scans
CREATE INDEX CONCURRENTLY idx_market_stats_covering 
    ON market_stats (pair) 
    INCLUDE (
        last_price, bid, ask, volume_24h, 
        price_change_percent_24h, updated_at
    );

CREATE INDEX CONCURRENTLY idx_user_balances_covering 
    ON user_balances (user_id, token) 
    INCLUDE (available, locked, last_updated);

-- Expression indexes for computed values
CREATE INDEX CONCURRENTLY idx_orders_remaining 
    ON orders ((amount - filled)) 
    WHERE status IN ('open', 'partially_filled');

CREATE INDEX CONCURRENTLY idx_trades_value 
    ON trades ((amount * price) DESC);

-- Text search indexes for metadata
CREATE INDEX CONCURRENTLY idx_orders_metadata_gin 
    ON orders USING GIN (metadata jsonb_path_ops);

CREATE INDEX CONCURRENTLY idx_trades_metadata_gin 
    ON trades USING GIN (metadata jsonb_path_ops);

-- Optimize table storage parameters
ALTER TABLE orders SET (fillfactor = 90); -- Allow some space for updates
ALTER TABLE trades SET (fillfactor = 100); -- Trades are immutable
ALTER TABLE market_stats SET (fillfactor = 50); -- Frequently updated
ALTER TABLE user_balances SET (fillfactor = 70); -- Regular updates

-- Create statistics for better query planning
CREATE STATISTICS orders_stats (dependencies) 
    ON pair, side, status FROM orders;

CREATE STATISTICS trades_stats (dependencies) 
    ON pair, settlement_status FROM trades;

CREATE STATISTICS user_trading_stats (ndistinct) 
    ON maker_user_id, taker_user_id FROM trades;

-- Function to analyze index usage and suggest optimizations
CREATE OR REPLACE FUNCTION analyze_index_efficiency()
RETURNS TABLE (
    index_name TEXT,
    table_name TEXT,
    index_size TEXT,
    table_size TEXT,
    index_scans BIGINT,
    rows_per_scan NUMERIC,
    write_activity NUMERIC,
    recommendation TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH index_stats AS (
        SELECT 
            i.indexrelname::TEXT AS index_name,
            i.relname::TEXT AS table_name,
            pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
            pg_size_pretty(pg_relation_size(i.relid)) AS table_size,
            i.idx_scan AS index_scans,
            CASE 
                WHEN i.idx_scan > 0 
                THEN (i.idx_tup_fetch::NUMERIC / i.idx_scan)::NUMERIC(10,2)
                ELSE 0 
            END AS rows_per_scan,
            (t.n_tup_ins + t.n_tup_upd + t.n_tup_del)::NUMERIC AS write_activity
        FROM pg_stat_user_indexes i
        JOIN pg_stat_user_tables t ON i.relid = t.relid
        WHERE i.schemaname = 'public'
    )
    SELECT 
        index_name,
        table_name,
        index_size,
        table_size,
        index_scans,
        rows_per_scan,
        write_activity,
        CASE
            WHEN index_scans = 0 AND write_activity > 1000 
                THEN 'UNUSED - Consider dropping this index'
            WHEN index_scans > 0 AND rows_per_scan < 10 AND write_activity > index_scans * 10
                THEN 'INEFFICIENT - High write overhead, low read benefit'
            WHEN index_scans > 0 AND rows_per_scan > 1000
                THEN 'EFFICIENT - Good selectivity'
            WHEN index_size::TEXT > table_size::TEXT
                THEN 'OVERSIZED - Index larger than table'
            ELSE 'OK'
        END AS recommendation
    FROM index_stats
    ORDER BY 
        CASE 
            WHEN index_scans = 0 THEN 0
            ELSE 1
        END,
        write_activity DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to suggest missing indexes based on query patterns
CREATE OR REPLACE FUNCTION suggest_missing_indexes()
RETURNS TABLE (
    table_name TEXT,
    column_names TEXT[],
    index_type TEXT,
    estimated_benefit TEXT,
    create_statement TEXT
) AS $$
BEGIN
    -- This is a simplified version. In production, analyze pg_stat_statements
    RETURN QUERY
    SELECT 
        'orders'::TEXT,
        ARRAY['pair', 'status', 'price']::TEXT[],
        'btree'::TEXT,
        'HIGH - Frequent order book queries'::TEXT,
        'CREATE INDEX CONCURRENTLY idx_orders_orderbook ON orders (pair, status, price) WHERE status IN (''open'', ''partially_filled'')'::TEXT
    UNION ALL
    SELECT 
        'trades'::TEXT,
        ARRAY['pair', 'executed_at', 'settlement_status']::TEXT[],
        'btree'::TEXT,
        'MEDIUM - Settlement processing queries'::TEXT,
        'CREATE INDEX CONCURRENTLY idx_trades_settlement ON trades (pair, executed_at DESC) WHERE settlement_status = ''pending'''::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Materialized view for expensive aggregations
CREATE MATERIALIZED VIEW user_statistics AS
SELECT 
    u.id as user_id,
    u.tier,
    COUNT(DISTINCT o.id) as total_orders,
    COUNT(DISTINCT CASE WHEN o.status = 'filled' THEN o.id END) as filled_orders,
    COUNT(DISTINCT t.id) as total_trades,
    COALESCE(SUM(
        CASE 
            WHEN t.maker_user_id = u.id THEN t.amount * t.price
            WHEN t.taker_user_id = u.id THEN t.amount * t.price
            ELSE 0
        END
    ), 0) as lifetime_volume,
    COUNT(DISTINCT DATE(COALESCE(o.created_at, t.executed_at))) as active_days,
    MAX(COALESCE(o.created_at, t.executed_at)) as last_activity
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
LEFT JOIN trades t ON u.id IN (t.maker_user_id, t.taker_user_id)
GROUP BY u.id, u.tier;

CREATE UNIQUE INDEX idx_user_statistics_user_id ON user_statistics (user_id);
CREATE INDEX idx_user_statistics_volume ON user_statistics (lifetime_volume DESC);

-- Refresh materialized view periodically
CREATE OR REPLACE FUNCTION refresh_user_statistics()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_statistics;
END;
$$ LANGUAGE plpgsql;