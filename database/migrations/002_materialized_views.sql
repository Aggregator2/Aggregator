-- Materialized Views for High-Performance Order Book Operations

-- Real-time order book depth view
CREATE MATERIALIZED VIEW order_book_depth AS
WITH price_levels AS (
    SELECT 
        pair,
        side,
        price,
        SUM(quantity - filled_quantity) as total_quantity,
        COUNT(*) as order_count,
        MAX(last_update_time) as last_update
    FROM orders
    WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
    GROUP BY pair, side, price
),
ranked_levels AS (
    SELECT 
        pair,
        side,
        price,
        total_quantity,
        order_count,
        last_update,
        ROW_NUMBER() OVER (PARTITION BY pair, side ORDER BY 
            CASE WHEN side = 'BUY' THEN price END DESC,
            CASE WHEN side = 'SELL' THEN price END ASC
        ) as level_rank
    FROM price_levels
    WHERE total_quantity > 0
)
SELECT 
    pair,
    side,
    price,
    total_quantity,
    order_count,
    last_update,
    level_rank
FROM ranked_levels
WHERE level_rank <= 100  -- Top 100 levels per side
WITH DATA;

-- Create indexes on materialized view
CREATE UNIQUE INDEX idx_order_book_depth_unique ON order_book_depth (pair, side, price);
CREATE INDEX idx_order_book_depth_lookup ON order_book_depth (pair, side, level_rank);

-- Market statistics materialized view (24h rolling)
CREATE MATERIALIZED VIEW market_stats_24h AS
SELECT 
    t.pair,
    COUNT(*) as trade_count,
    SUM(t.quantity) as volume,
    SUM(t.quantity * t.price) as volume_quote,
    MIN(t.price) as low_24h,
    MAX(t.price) as high_24h,
    FIRST_VALUE(t.price) OVER (PARTITION BY t.pair ORDER BY t.timestamp DESC) as last_price,
    FIRST_VALUE(t.price) OVER (PARTITION BY t.pair ORDER BY t.timestamp ASC) as open_24h,
    AVG(t.price) as vwap,
    STDDEV(t.price) as price_stddev,
    MAX(t.timestamp) as last_trade_time
FROM trades t
WHERE t.timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY t.pair
WITH DATA;

-- Create indexes
CREATE UNIQUE INDEX idx_market_stats_24h_pair ON market_stats_24h (pair);

-- User position summary
CREATE MATERIALIZED VIEW user_positions AS
SELECT 
    o.user_id,
    o.pair,
    SUM(CASE WHEN o.side = 'BUY' AND o.status IN ('FILLED', 'PARTIALLY_FILLED') 
        THEN o.filled_quantity ELSE 0 END) as total_bought,
    SUM(CASE WHEN o.side = 'SELL' AND o.status IN ('FILLED', 'PARTIALLY_FILLED') 
        THEN o.filled_quantity ELSE 0 END) as total_sold,
    SUM(CASE WHEN o.side = 'BUY' AND o.status IN ('OPEN', 'PARTIALLY_FILLED') 
        THEN o.quantity - o.filled_quantity ELSE 0 END) as open_buy_quantity,
    SUM(CASE WHEN o.side = 'SELL' AND o.status IN ('OPEN', 'PARTIALLY_FILLED') 
        THEN o.quantity - o.filled_quantity ELSE 0 END) as open_sell_quantity,
    COUNT(CASE WHEN o.status IN ('OPEN', 'PARTIALLY_FILLED') THEN 1 END) as open_orders,
    MAX(o.last_update_time) as last_activity
FROM orders o
WHERE o.timestamp >= NOW() - INTERVAL '30 days'
GROUP BY o.user_id, o.pair
WITH DATA;

-- Create indexes
CREATE UNIQUE INDEX idx_user_positions_unique ON user_positions (user_id, pair);
CREATE INDEX idx_user_positions_activity ON user_positions (last_activity DESC);

-- Order book imbalance indicator
CREATE MATERIALIZED VIEW order_book_imbalance AS
WITH book_totals AS (
    SELECT 
        pair,
        SUM(CASE WHEN side = 'BUY' THEN quantity - filled_quantity ELSE 0 END) as bid_volume,
        SUM(CASE WHEN side = 'SELL' THEN quantity - filled_quantity ELSE 0 END) as ask_volume,
        SUM(CASE WHEN side = 'BUY' THEN (quantity - filled_quantity) * price ELSE 0 END) as bid_value,
        SUM(CASE WHEN side = 'SELL' THEN (quantity - filled_quantity) * price ELSE 0 END) as ask_value,
        COUNT(CASE WHEN side = 'BUY' THEN 1 END) as bid_count,
        COUNT(CASE WHEN side = 'SELL' THEN 1 END) as ask_count
    FROM orders
    WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
    GROUP BY pair
)
SELECT 
    pair,
    bid_volume,
    ask_volume,
    bid_value,
    ask_value,
    bid_count,
    ask_count,
    CASE 
        WHEN bid_volume + ask_volume > 0 
        THEN (bid_volume - ask_volume) / (bid_volume + ask_volume)
        ELSE 0 
    END as volume_imbalance,
    CASE 
        WHEN bid_value + ask_value > 0 
        THEN (bid_value - ask_value) / (bid_value + ask_value)
        ELSE 0 
    END as value_imbalance,
    NOW() as calculated_at
FROM book_totals
WITH DATA;

-- Create index
CREATE UNIQUE INDEX idx_order_book_imbalance_pair ON order_book_imbalance (pair);

-- Top traders by volume
CREATE MATERIALIZED VIEW top_traders_daily AS
WITH trader_stats AS (
    SELECT 
        DATE_TRUNC('day', t.timestamp) as trade_date,
        CASE 
            WHEN t.taker_side = 'BUY' THEN o1.user_id 
            ELSE o2.user_id 
        END as user_id,
        t.pair,
        SUM(t.quantity * t.price) as volume,
        COUNT(*) as trade_count,
        SUM(CASE WHEN t.taker_side = 'BUY' THEN t.taker_fee ELSE t.maker_fee END) as fees_paid
    FROM trades t
    JOIN orders o1 ON t.taker_order_id = o1.id
    JOIN orders o2 ON t.maker_order_id = o2.id
    WHERE t.timestamp >= NOW() - INTERVAL '7 days'
    GROUP BY DATE_TRUNC('day', t.timestamp), 
             CASE WHEN t.taker_side = 'BUY' THEN o1.user_id ELSE o2.user_id END,
             t.pair
)
SELECT 
    trade_date,
    user_id,
    pair,
    volume,
    trade_count,
    fees_paid,
    RANK() OVER (PARTITION BY trade_date, pair ORDER BY volume DESC) as volume_rank
FROM trader_stats
WITH DATA;

-- Create indexes
CREATE INDEX idx_top_traders_lookup ON top_traders_daily (trade_date, pair, volume_rank);
CREATE INDEX idx_top_traders_user ON top_traders_daily (user_id, trade_date);

-- Best bid/ask tracking
CREATE MATERIALIZED VIEW best_bid_ask AS
WITH best_prices AS (
    SELECT DISTINCT ON (pair)
        pair,
        MAX(CASE WHEN side = 'BUY' THEN price END) OVER (PARTITION BY pair) as best_bid,
        MIN(CASE WHEN side = 'SELL' THEN price END) OVER (PARTITION BY pair) as best_ask,
        SUM(CASE WHEN side = 'BUY' AND price = MAX(CASE WHEN side = 'BUY' THEN price END) OVER (PARTITION BY pair) 
            THEN quantity - filled_quantity ELSE 0 END) OVER (PARTITION BY pair) as best_bid_quantity,
        SUM(CASE WHEN side = 'SELL' AND price = MIN(CASE WHEN side = 'SELL' THEN price END) OVER (PARTITION BY pair) 
            THEN quantity - filled_quantity ELSE 0 END) OVER (PARTITION BY pair) as best_ask_quantity
    FROM orders
    WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
)
SELECT 
    pair,
    best_bid,
    best_ask,
    best_bid_quantity,
    best_ask_quantity,
    best_ask - best_bid as spread,
    CASE 
        WHEN best_bid > 0 
        THEN (best_ask - best_bid) / best_bid * 100 
        ELSE NULL 
    END as spread_percentage,
    NOW() as calculated_at
FROM best_prices
WITH DATA;

-- Create unique index
CREATE UNIQUE INDEX idx_best_bid_ask_pair ON best_bid_ask (pair);

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
    -- Refresh in dependency order
    REFRESH MATERIALIZED VIEW CONCURRENTLY order_book_depth;
    REFRESH MATERIALIZED VIEW CONCURRENTLY market_stats_24h;
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_positions;
    REFRESH MATERIALIZED VIEW CONCURRENTLY order_book_imbalance;
    REFRESH MATERIALIZED VIEW CONCURRENTLY top_traders_daily;
    REFRESH MATERIALIZED VIEW CONCURRENTLY best_bid_ask;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh specific materialized view with timing
CREATE OR REPLACE FUNCTION refresh_materialized_view_with_timing(view_name text)
RETURNS TABLE(view_name text, refresh_time interval) AS $$
DECLARE
    start_time timestamp;
    end_time timestamp;
BEGIN
    start_time := clock_timestamp();
    
    EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', view_name);
    
    end_time := clock_timestamp();
    
    RETURN QUERY SELECT view_name, end_time - start_time;
END;
$$ LANGUAGE plpgsql;

-- Create refresh schedule (to be called by cron or pg_cron)
CREATE OR REPLACE FUNCTION schedule_materialized_view_refresh()
RETURNS void AS $$
BEGIN
    -- High frequency refreshes (every 10 seconds)
    PERFORM refresh_materialized_view_with_timing('best_bid_ask');
    PERFORM refresh_materialized_view_with_timing('order_book_depth');
    
    -- Medium frequency refreshes (every minute)
    IF extract(second from NOW())::int < 10 THEN
        PERFORM refresh_materialized_view_with_timing('order_book_imbalance');
        PERFORM refresh_materialized_view_with_timing('market_stats_24h');
    END IF;
    
    -- Low frequency refreshes (every 5 minutes)
    IF extract(minute from NOW())::int % 5 = 0 THEN
        PERFORM refresh_materialized_view_with_timing('user_positions');
        PERFORM refresh_materialized_view_with_timing('top_traders_daily');
    END IF;
END;
$$ LANGUAGE plpgsql;