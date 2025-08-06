-- View for active orders with user info
CREATE OR REPLACE VIEW active_orders_view AS
SELECT 
    o.*,
    u.tier as user_tier,
    u.maker_fee_rate as user_maker_fee,
    u.taker_fee_rate as user_taker_fee,
    tp.base_asset,
    tp.quote_asset,
    tp.tick_size
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN trading_pairs tp ON o.pair = tp.pair
WHERE o.status IN ('open', 'partially_filled')
    AND u.status = 'active'
    AND tp.status = 'active';

-- View for user trading statistics
CREATE OR REPLACE VIEW user_trading_stats AS
SELECT 
    u.id as user_id,
    COUNT(DISTINCT t.id) as total_trades,
    COALESCE(SUM(t.amount * t.price), 0) as total_volume,
    COUNT(DISTINCT t.pair) as pairs_traded,
    MIN(t.executed_at) as first_trade_at,
    MAX(t.executed_at) as last_trade_at,
    COUNT(DISTINCT DATE(t.executed_at)) as active_days
FROM users u
LEFT JOIN trades t ON (u.id = t.maker_user_id OR u.id = t.taker_user_id)
GROUP BY u.id;

-- Function to calculate order book depth
CREATE OR REPLACE FUNCTION calculate_orderbook_depth(
    p_pair VARCHAR(20),
    p_depth_percent DECIMAL DEFAULT 0.01 -- 1% depth
)
RETURNS TABLE (
    bid_depth DECIMAL(36,18),
    ask_depth DECIMAL(36,18),
    total_depth DECIMAL(36,18)
) AS $$
DECLARE
    v_mid_price DECIMAL(36,18);
BEGIN
    -- Get current mid price
    SELECT (ms.bid + ms.ask) / 2 INTO v_mid_price
    FROM market_stats ms
    WHERE ms.pair = p_pair;
    
    IF v_mid_price IS NULL THEN
        RETURN QUERY SELECT 0::DECIMAL, 0::DECIMAL, 0::DECIMAL;
        RETURN;
    END IF;
    
    RETURN QUERY
    WITH depth_calc AS (
        SELECT 
            COALESCE(SUM(CASE 
                WHEN o.side = 'buy' AND o.price >= v_mid_price * (1 - p_depth_percent) 
                THEN o.remaining 
                ELSE 0 
            END), 0) as bid_depth,
            COALESCE(SUM(CASE 
                WHEN o.side = 'sell' AND o.price <= v_mid_price * (1 + p_depth_percent) 
                THEN o.remaining 
                ELSE 0 
            END), 0) as ask_depth
        FROM orders o
        WHERE o.pair = p_pair
            AND o.status IN ('open', 'partially_filled')
    )
    SELECT 
        bid_depth,
        ask_depth,
        bid_depth + ask_depth as total_depth
    FROM depth_calc;
END;
$$ LANGUAGE plpgsql;

-- Function to get best bid/ask
CREATE OR REPLACE FUNCTION get_best_prices(p_pair VARCHAR(20))
RETURNS TABLE (
    best_bid DECIMAL(36,18),
    best_bid_amount DECIMAL(36,18),
    best_ask DECIMAL(36,18),
    best_ask_amount DECIMAL(36,18),
    spread DECIMAL(36,18),
    spread_percent DECIMAL(8,4)
) AS $$
BEGIN
    RETURN QUERY
    WITH best_prices AS (
        SELECT 
            MAX(CASE WHEN side = 'buy' THEN price END) as best_bid,
            MIN(CASE WHEN side = 'sell' THEN price END) as best_ask
        FROM orders
        WHERE pair = p_pair
            AND status IN ('open', 'partially_filled')
    ),
    best_amounts AS (
        SELECT 
            SUM(CASE WHEN o.side = 'buy' AND o.price = bp.best_bid THEN o.remaining ELSE 0 END) as bid_amount,
            SUM(CASE WHEN o.side = 'sell' AND o.price = bp.best_ask THEN o.remaining ELSE 0 END) as ask_amount
        FROM orders o, best_prices bp
        WHERE o.pair = p_pair
            AND o.status IN ('open', 'partially_filled')
    )
    SELECT 
        bp.best_bid,
        ba.bid_amount,
        bp.best_ask,
        ba.ask_amount,
        bp.best_ask - bp.best_bid as spread,
        CASE 
            WHEN bp.best_bid > 0 
            THEN ((bp.best_ask - bp.best_bid) / bp.best_bid * 100)::DECIMAL(8,4)
            ELSE NULL 
        END as spread_percent
    FROM best_prices bp, best_amounts ba;
END;
$$ LANGUAGE plpgsql;

-- Function to update user tier based on volume
CREATE OR REPLACE FUNCTION update_user_tier()
RETURNS TRIGGER AS $$
BEGIN
    -- Update tier based on 30-day volume
    NEW.tier = CASE
        WHEN NEW.volume_30d >= 10000000 THEN 'vip'        -- $10M+
        WHEN NEW.volume_30d >= 1000000 THEN 'platinum'    -- $1M+
        WHEN NEW.volume_30d >= 100000 THEN 'gold'         -- $100k+
        WHEN NEW.volume_30d >= 10000 THEN 'silver'        -- $10k+
        ELSE 'basic'
    END;
    
    -- Update fee rates based on tier
    CASE NEW.tier
        WHEN 'vip' THEN
            NEW.maker_fee_rate = 0.0000;
            NEW.taker_fee_rate = 0.0010;
        WHEN 'platinum' THEN
            NEW.maker_fee_rate = 0.0002;
            NEW.taker_fee_rate = 0.0012;
        WHEN 'gold' THEN
            NEW.maker_fee_rate = 0.0005;
            NEW.taker_fee_rate = 0.0015;
        WHEN 'silver' THEN
            NEW.maker_fee_rate = 0.0008;
            NEW.taker_fee_rate = 0.0018;
        ELSE
            NEW.maker_fee_rate = 0.0010;
            NEW.taker_fee_rate = 0.0020;
    END CASE;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_tier_trigger
    BEFORE UPDATE OF volume_30d ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_user_tier();

-- Function to clean up expired orders
CREATE OR REPLACE FUNCTION cleanup_expired_orders()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE orders
    SET 
        status = 'expired',
        updated_at = NOW()
    WHERE 
        status IN ('open', 'partially_filled')
        AND expires_at IS NOT NULL
        AND expires_at < NOW();
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate 24h market statistics
CREATE OR REPLACE FUNCTION update_market_stats(p_pair VARCHAR(20))
RETURNS VOID AS $$
BEGIN
    INSERT INTO market_stats (
        pair,
        high_24h,
        low_24h,
        volume_24h,
        volume_quote_24h,
        trade_count_24h,
        last_price,
        last_trade_at,
        price_change_24h,
        price_change_percent_24h,
        bid,
        ask,
        updated_at
    )
    SELECT 
        p_pair,
        MAX(t.price) as high_24h,
        MIN(t.price) as low_24h,
        COALESCE(SUM(t.amount), 0) as volume_24h,
        COALESCE(SUM(t.amount * t.price), 0) as volume_quote_24h,
        COUNT(*) as trade_count_24h,
        (SELECT price FROM trades WHERE pair = p_pair ORDER BY executed_at DESC LIMIT 1) as last_price,
        MAX(t.executed_at) as last_trade_at,
        (SELECT price FROM trades WHERE pair = p_pair ORDER BY executed_at DESC LIMIT 1) - 
        (SELECT price FROM trades WHERE pair = p_pair AND executed_at >= NOW() - INTERVAL '24 hours' ORDER BY executed_at ASC LIMIT 1) as price_change_24h,
        CASE 
            WHEN (SELECT price FROM trades WHERE pair = p_pair AND executed_at >= NOW() - INTERVAL '24 hours' ORDER BY executed_at ASC LIMIT 1) > 0
            THEN (
                ((SELECT price FROM trades WHERE pair = p_pair ORDER BY executed_at DESC LIMIT 1) - 
                 (SELECT price FROM trades WHERE pair = p_pair AND executed_at >= NOW() - INTERVAL '24 hours' ORDER BY executed_at ASC LIMIT 1)) /
                (SELECT price FROM trades WHERE pair = p_pair AND executed_at >= NOW() - INTERVAL '24 hours' ORDER BY executed_at ASC LIMIT 1) * 100
            )::DECIMAL(8,4)
            ELSE NULL
        END as price_change_percent_24h,
        (SELECT best_bid FROM get_best_prices(p_pair)) as bid,
        (SELECT best_ask FROM get_best_prices(p_pair)) as ask,
        NOW()
    FROM trades t
    WHERE t.pair = p_pair
        AND t.executed_at >= NOW() - INTERVAL '24 hours'
    ON CONFLICT (pair) DO UPDATE SET
        high_24h = EXCLUDED.high_24h,
        low_24h = EXCLUDED.low_24h,
        volume_24h = EXCLUDED.volume_24h,
        volume_quote_24h = EXCLUDED.volume_quote_24h,
        trade_count_24h = EXCLUDED.trade_count_24h,
        last_price = EXCLUDED.last_price,
        last_trade_at = EXCLUDED.last_trade_at,
        price_change_24h = EXCLUDED.price_change_24h,
        price_change_percent_24h = EXCLUDED.price_change_percent_24h,
        bid = EXCLUDED.bid,
        ask = EXCLUDED.ask,
        updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;