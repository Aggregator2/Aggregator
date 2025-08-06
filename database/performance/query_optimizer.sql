-- Query Optimization with EXPLAIN ANALYZE
-- Collection of optimized queries for high-frequency trading operations

-- =====================================================
-- 1. OPTIMIZED ORDER BOOK QUERIES
-- =====================================================

-- Get order book depth with optimal performance
-- This query uses the covering index for maximum efficiency
PREPARE get_order_book_depth (text, int) AS
WITH order_levels AS (
    SELECT 
        side,
        price,
        SUM(quantity - filled_quantity) as total_quantity,
        COUNT(*) as order_count
    FROM orders
    WHERE pair = $1 
      AND status IN ('OPEN', 'PARTIALLY_FILLED')
    GROUP BY side, price
),
ranked_bids AS (
    SELECT price, total_quantity, order_count
    FROM order_levels
    WHERE side = 'BUY'
    ORDER BY price DESC
    LIMIT $2
),
ranked_asks AS (
    SELECT price, total_quantity, order_count
    FROM order_levels
    WHERE side = 'SELL'
    ORDER BY price ASC
    LIMIT $2
)
SELECT 
    'BUY' as side, price, total_quantity, order_count
FROM ranked_bids
UNION ALL
SELECT 
    'SELL' as side, price, total_quantity, order_count
FROM ranked_asks
ORDER BY side DESC, price DESC;

-- EXPLAIN ANALYZE for order book query
/*
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE get_order_book_depth('ETH/USDT', 50);

Expected execution plan:
- Index scan on idx_orders_pair_side_price
- HashAggregate for grouping
- Sort for ranking
- Execution time: < 5ms for active pairs
*/

-- =====================================================
-- 2. OPTIMIZED ORDER MATCHING QUERIES
-- =====================================================

-- Find matching orders for incoming order
PREPARE find_matching_orders (text, text, numeric, numeric) AS
SELECT 
    id,
    user_id,
    price,
    quantity - filled_quantity as available_quantity,
    timestamp
FROM orders
WHERE pair = $1
  AND side = CASE WHEN $2 = 'BUY' THEN 'SELL' ELSE 'BUY' END
  AND status IN ('OPEN', 'PARTIALLY_FILLED')
  AND CASE 
      WHEN $2 = 'BUY' THEN price <= $3
      ELSE price >= $3
  END
ORDER BY 
    CASE WHEN $2 = 'BUY' THEN price END ASC,
    CASE WHEN $2 = 'SELL' THEN price END DESC,
    timestamp ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;  -- Prevent lock contention

-- EXPLAIN ANALYZE for matching query
/*
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE find_matching_orders('ETH/USDT', 'BUY', 2000.00, 1.0);

Expected execution plan:
- Index scan on idx_orders_pair_side_price
- Sort operation (should be minimal due to index)
- Row locking with SKIP LOCKED
- Execution time: < 2ms
*/

-- =====================================================
-- 3. OPTIMIZED USER BALANCE QUERIES
-- =====================================================

-- Get user balance with row-level locking
PREPARE get_user_balance_for_update (text, text) AS
SELECT 
    available_balance,
    locked_balance,
    total_balance,
    version
FROM user_balances
WHERE user_id = $1 
  AND currency = $2
FOR UPDATE NOWAIT;  -- Fail fast if locked

-- Update balance with optimistic locking
PREPARE update_user_balance (text, text, numeric, numeric, int) AS
UPDATE user_balances
SET available_balance = available_balance + $3,
    locked_balance = locked_balance + $4,
    version = version + 1
WHERE user_id = $1 
  AND currency = $2
  AND version = $5
RETURNING available_balance, locked_balance, version;

-- =====================================================
-- 4. OPTIMIZED TRADE HISTORY QUERIES
-- =====================================================

-- Get recent trades with optimal pagination
PREPARE get_recent_trades (text, int, timestamptz) AS
SELECT 
    t.id,
    t.price,
    t.quantity,
    t.taker_side,
    t.timestamp,
    t.taker_fee,
    t.maker_fee
FROM trades t
WHERE t.pair = $1
  AND t.timestamp < COALESCE($3, NOW())
ORDER BY t.timestamp DESC
LIMIT $2;

-- EXPLAIN ANALYZE for trades query
/*
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
EXECUTE get_recent_trades('ETH/USDT', 100, NULL);

Expected execution plan:
- Index scan backward on idx_trades_pair_timestamp
- No sort needed due to index
- Execution time: < 1ms
*/

-- =====================================================
-- 5. OPTIMIZED MARKET STATISTICS QUERIES
-- =====================================================

-- Get 24h market statistics
PREPARE get_market_stats_24h (text) AS
WITH stats AS (
    SELECT 
        COUNT(*) as trade_count,
        SUM(quantity) as volume,
        MIN(price) as low_24h,
        MAX(price) as high_24h,
        SUM(quantity * price) / NULLIF(SUM(quantity), 0) as vwap
    FROM trades
    WHERE pair = $1
      AND timestamp >= NOW() - INTERVAL '24 hours'
),
last_trade AS (
    SELECT price as last_price
    FROM trades
    WHERE pair = $1
    ORDER BY timestamp DESC
    LIMIT 1
),
first_trade AS (
    SELECT price as open_24h
    FROM trades
    WHERE pair = $1
      AND timestamp >= NOW() - INTERVAL '24 hours'
    ORDER BY timestamp ASC
    LIMIT 1
)
SELECT 
    s.*,
    l.last_price,
    f.open_24h,
    CASE 
        WHEN f.open_24h > 0 
        THEN ((l.last_price - f.open_24h) / f.open_24h * 100)
        ELSE 0 
    END as price_change_24h
FROM stats s
CROSS JOIN last_trade l
CROSS JOIN first_trade f;

-- =====================================================
-- 6. QUERY PERFORMANCE MONITORING
-- =====================================================

-- Monitor slow queries
CREATE OR REPLACE VIEW slow_queries AS
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    stddev_time,
    min_time,
    max_time,
    rows
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_stat_statements%'
  AND mean_time > 10  -- Queries averaging > 10ms
ORDER BY mean_time DESC
LIMIT 50;

-- Identify missing indexes
CREATE OR REPLACE VIEW missing_indexes AS
SELECT 
    schemaname,
    tablename,
    attname,
    n_distinct,
    most_common_vals,
    correlation
FROM pg_stats
WHERE schemaname = 'public'
  AND n_distinct > 100
  AND correlation < 0.1
  AND tablename IN ('orders', 'trades', 'user_balances')
ORDER BY n_distinct DESC;

-- =====================================================
-- 7. QUERY OPTIMIZATION FUNCTIONS
-- =====================================================

-- Function to analyze query performance
CREATE OR REPLACE FUNCTION analyze_query_performance(query_text text)
RETURNS TABLE(
    planning_time numeric,
    execution_time numeric,
    total_time numeric,
    rows_returned bigint,
    shared_blks_hit bigint,
    shared_blks_read bigint,
    cache_hit_ratio numeric
) AS $$
DECLARE
    result json;
    plan json;
BEGIN
    -- Execute EXPLAIN ANALYZE
    EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || query_text INTO result;
    
    -- Extract metrics
    plan := result->0;
    
    RETURN QUERY
    SELECT 
        (plan->>'Planning Time')::numeric,
        (plan->>'Execution Time')::numeric,
        (plan->>'Planning Time')::numeric + (plan->>'Execution Time')::numeric,
        (plan->'Plan'->>'Actual Rows')::bigint,
        (plan->'Plan'->>'Shared Hit Blocks')::bigint,
        (plan->'Plan'->>'Shared Read Blocks')::bigint,
        CASE 
            WHEN (plan->'Plan'->>'Shared Hit Blocks')::bigint + 
                 (plan->'Plan'->>'Shared Read Blocks')::bigint > 0
            THEN (plan->'Plan'->>'Shared Hit Blocks')::numeric / 
                 ((plan->'Plan'->>'Shared Hit Blocks')::numeric + 
                  (plan->'Plan'->>'Shared Read Blocks')::numeric) * 100
            ELSE 0
        END;
END;
$$ LANGUAGE plpgsql;

-- Function to recommend indexes
CREATE OR REPLACE FUNCTION recommend_indexes()
RETURNS TABLE(
    table_name text,
    recommended_index text,
    reason text,
    estimated_improvement text
) AS $$
BEGIN
    -- Check for missing indexes on foreign keys
    RETURN QUERY
    SELECT 
        tc.table_name::text,
        format('CREATE INDEX idx_%s_%s ON %s (%s);', 
               tc.table_name, kcu.column_name, tc.table_name, kcu.column_name)::text,
        'Missing index on foreign key'::text,
        'High - Foreign key lookups'::text
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = tc.table_name
            AND indexdef LIKE '%' || kcu.column_name || '%'
      );
    
    -- Check for missing indexes on commonly filtered columns
    RETURN QUERY
    SELECT 
        'orders'::text,
        'CREATE INDEX idx_orders_user_status_time ON orders (user_id, status, timestamp DESC);'::text,
        'Composite index for user order queries'::text,
        'Medium - User order history'::text
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'orders'
          AND indexname = 'idx_orders_user_status_time'
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. QUERY EXECUTION HINTS
-- =====================================================

-- Set optimal planner settings for OLTP workload
SET random_page_cost = 1.1;  -- SSD optimized
SET effective_cache_size = '48GB';  -- 75% of RAM
SET shared_buffers = '16GB';  -- 25% of RAM
SET work_mem = '256MB';  -- For sorting/hashing
SET maintenance_work_mem = '2GB';  -- For index creation
SET effective_io_concurrency = 200;  -- SSD optimized
SET max_parallel_workers_per_gather = 4;
SET max_parallel_workers = 8;

-- Enable JIT for complex queries
SET jit = on;
SET jit_above_cost = 100000;

-- Query timeout settings
SET statement_timeout = '30s';  -- Prevent runaway queries
SET lock_timeout = '10s';  -- Prevent long lock waits
SET idle_in_transaction_session_timeout = '5min';