-- PostgreSQL Database Schema for Trading System
-- Author: Trading Platform
-- Description: Complete schema for orders, trades, settlements, and user balances

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search optimization

-- Enum Types
CREATE TYPE order_type AS ENUM ('LIMIT', 'MARKET');
CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_status AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED');
CREATE TYPE time_in_force AS ENUM ('GTC', 'IOC', 'FOK', 'DAY');
CREATE TYPE settlement_status AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'ROLLED_BACK');

-- User Balances Table
CREATE TABLE user_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    available_balance DECIMAL(36, 18) NOT NULL DEFAULT 0,
    locked_balance DECIMAL(36, 18) NOT NULL DEFAULT 0,
    total_balance DECIMAL(36, 18) GENERATED ALWAYS AS (available_balance + locked_balance) STORED,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1, -- For optimistic locking
    CONSTRAINT unique_user_currency UNIQUE(user_id, currency),
    CONSTRAINT positive_balances CHECK (available_balance >= 0 AND locked_balance >= 0)
);

-- Orders Table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    client_order_id VARCHAR(255),
    pair VARCHAR(20) NOT NULL,
    side order_side NOT NULL,
    type order_type NOT NULL,
    price DECIMAL(36, 18),
    quantity DECIMAL(36, 18) NOT NULL,
    filled_quantity DECIMAL(36, 18) NOT NULL DEFAULT 0,
    remaining_quantity DECIMAL(36, 18) GENERATED ALWAYS AS (quantity - filled_quantity) STORED,
    status order_status NOT NULL DEFAULT 'PENDING',
    time_in_force time_in_force NOT NULL DEFAULT 'GTC',
    stop_price DECIMAL(36, 18),
    average_filled_price DECIMAL(36, 18),
    total_fees DECIMAL(36, 18) DEFAULT 0,
    timestamp BIGINT NOT NULL, -- Unix timestamp in milliseconds
    last_update_time BIGINT NOT NULL,
    expire_time BIGINT, -- For time-based expiration
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_client_order UNIQUE(user_id, client_order_id),
    CONSTRAINT valid_limit_order CHECK (type != 'LIMIT' OR price IS NOT NULL),
    CONSTRAINT valid_quantities CHECK (quantity > 0 AND filled_quantity >= 0 AND filled_quantity <= quantity)
);

-- Trades Table (Matched Order Pairs)
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade_id VARCHAR(255) UNIQUE NOT NULL, -- External trade ID
    pair VARCHAR(20) NOT NULL,
    taker_order_id UUID NOT NULL REFERENCES orders(id),
    maker_order_id UUID NOT NULL REFERENCES orders(id),
    price DECIMAL(36, 18) NOT NULL,
    quantity DECIMAL(36, 18) NOT NULL,
    quote_quantity DECIMAL(36, 18) GENERATED ALWAYS AS (price * quantity) STORED,
    taker_side order_side NOT NULL,
    taker_user_id VARCHAR(255) NOT NULL,
    maker_user_id VARCHAR(255) NOT NULL,
    taker_fee DECIMAL(36, 18) NOT NULL DEFAULT 0,
    maker_fee DECIMAL(36, 18) NOT NULL DEFAULT 0,
    taker_fee_currency VARCHAR(10) NOT NULL,
    maker_fee_currency VARCHAR(10) NOT NULL,
    settlement_status settlement_status NOT NULL DEFAULT 'PENDING',
    settlement_epoch_id UUID,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    settled_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    CONSTRAINT different_orders CHECK (taker_order_id != maker_order_id),
    CONSTRAINT positive_values CHECK (price > 0 AND quantity > 0)
);

-- Settlement Epochs Table (Batch Processing)
CREATE TABLE settlement_epochs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    epoch_number BIGINT UNIQUE NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status settlement_status NOT NULL DEFAULT 'PENDING',
    total_trades INTEGER DEFAULT 0,
    settled_trades INTEGER DEFAULT 0,
    failed_trades INTEGER DEFAULT 0,
    total_volume DECIMAL(36, 18) DEFAULT 0,
    net_positions JSONB, -- Net positions per user per currency
    settlement_proof VARCHAR(66), -- Blockchain transaction hash
    error_message TEXT,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_epoch_times CHECK (end_time > start_time),
    CONSTRAINT valid_trade_counts CHECK (
        total_trades >= 0 AND 
        settled_trades >= 0 AND 
        failed_trades >= 0 AND 
        settled_trades + failed_trades <= total_trades
    )
);

-- Balance History Table (Audit Trail)
CREATE TABLE balance_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    balance_before DECIMAL(36, 18) NOT NULL,
    balance_after DECIMAL(36, 18) NOT NULL,
    change_amount DECIMAL(36, 18) GENERATED ALWAYS AS (balance_after - balance_before) STORED,
    change_type VARCHAR(50) NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'TRADE', 'FEE', 'SETTLEMENT'
    reference_id UUID, -- Can reference trade_id, settlement_id, etc.
    reference_type VARCHAR(50), -- 'TRADE', 'SETTLEMENT', 'DEPOSIT', etc.
    description TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB
);

-- Settlement Details Table (Individual Trade Settlements)
CREATE TABLE settlement_details (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    settlement_epoch_id UUID NOT NULL REFERENCES settlement_epochs(id),
    trade_id UUID NOT NULL REFERENCES trades(id),
    user_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    amount DECIMAL(36, 18) NOT NULL, -- Positive for credit, negative for debit
    balance_before DECIMAL(36, 18),
    balance_after DECIMAL(36, 18),
    status settlement_status NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_settlement_trade_user UNIQUE(settlement_epoch_id, trade_id, user_id, currency)
);

-- Indexes for Performance

-- Orders indexes
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_pair ON orders(pair);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_timestamp ON orders(timestamp DESC);
CREATE INDEX idx_orders_pair_side_status ON orders(pair, side, status) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
CREATE INDEX idx_orders_expire_time ON orders(expire_time) WHERE expire_time IS NOT NULL AND status IN ('OPEN', 'PARTIALLY_FILLED');

-- Trades indexes
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_pair ON trades(pair);
CREATE INDEX idx_trades_taker_user ON trades(taker_user_id);
CREATE INDEX idx_trades_maker_user ON trades(maker_user_id);
CREATE INDEX idx_trades_settlement_status ON trades(settlement_status);
CREATE INDEX idx_trades_settlement_epoch ON trades(settlement_epoch_id) WHERE settlement_epoch_id IS NOT NULL;
CREATE INDEX idx_trades_unsettled ON trades(settlement_status, timestamp) WHERE settlement_status = 'PENDING';

-- User balances indexes
CREATE INDEX idx_user_balances_user ON user_balances(user_id);
CREATE INDEX idx_user_balances_currency ON user_balances(currency);

-- Settlement epochs indexes
CREATE INDEX idx_settlement_epochs_status ON settlement_epochs(status);
CREATE INDEX idx_settlement_epochs_number ON settlement_epochs(epoch_number DESC);
CREATE INDEX idx_settlement_epochs_time_range ON settlement_epochs(start_time, end_time);

-- Balance history indexes
CREATE INDEX idx_balance_history_user ON balance_history(user_id, currency, timestamp DESC);
CREATE INDEX idx_balance_history_reference ON balance_history(reference_type, reference_id);

-- Settlement details indexes
CREATE INDEX idx_settlement_details_epoch ON settlement_details(settlement_epoch_id);
CREATE INDEX idx_settlement_details_user ON settlement_details(user_id);
CREATE INDEX idx_settlement_details_status ON settlement_details(status);

-- Triggers

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_epochs_updated_at BEFORE UPDATE ON settlement_epochs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update user balance with optimistic locking
CREATE OR REPLACE FUNCTION update_user_balance(
    p_user_id VARCHAR(255),
    p_currency VARCHAR(10),
    p_available_delta DECIMAL(36, 18),
    p_locked_delta DECIMAL(36, 18),
    p_expected_version INTEGER
) RETURNS user_balances AS $$
DECLARE
    v_balance user_balances;
BEGIN
    UPDATE user_balances
    SET 
        available_balance = available_balance + p_available_delta,
        locked_balance = locked_balance + p_locked_delta,
        version = version + 1,
        last_updated = CURRENT_TIMESTAMP
    WHERE 
        user_id = p_user_id 
        AND currency = p_currency 
        AND version = p_expected_version
        AND available_balance + p_available_delta >= 0
        AND locked_balance + p_locked_delta >= 0
    RETURNING * INTO v_balance;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Balance update failed: version mismatch or insufficient funds';
    END IF;
    
    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

-- Function to get order book depth
CREATE OR REPLACE FUNCTION get_order_book_depth(
    p_pair VARCHAR(20),
    p_depth INTEGER DEFAULT 20
) RETURNS TABLE (
    side order_side,
    price DECIMAL(36, 18),
    quantity DECIMAL(36, 18),
    order_count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH ranked_orders AS (
        SELECT 
            o.side,
            o.price,
            o.remaining_quantity,
            ROW_NUMBER() OVER (PARTITION BY o.side ORDER BY 
                CASE WHEN o.side = 'BUY' THEN o.price END DESC,
                CASE WHEN o.side = 'SELL' THEN o.price END ASC
            ) as rn
        FROM orders o
        WHERE 
            o.pair = p_pair 
            AND o.status IN ('OPEN', 'PARTIALLY_FILLED')
            AND o.type = 'LIMIT'
    )
    SELECT 
        ro.side,
        ro.price,
        SUM(ro.remaining_quantity) as quantity,
        COUNT(*)::INTEGER as order_count
    FROM ranked_orders ro
    WHERE ro.rn <= p_depth
    GROUP BY ro.side, ro.price
    ORDER BY 
        ro.side,
        CASE WHEN ro.side = 'BUY' THEN ro.price END DESC,
        CASE WHEN ro.side = 'SELL' THEN ro.price END ASC;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate 24h market statistics
CREATE OR REPLACE FUNCTION get_market_stats_24h(p_pair VARCHAR(20))
RETURNS TABLE (
    volume_24h DECIMAL(36, 18),
    high_24h DECIMAL(36, 18),
    low_24h DECIMAL(36, 18),
    trade_count_24h INTEGER,
    last_price DECIMAL(36, 18)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(t.quote_quantity), 0) as volume_24h,
        MAX(t.price) as high_24h,
        MIN(t.price) as low_24h,
        COUNT(*)::INTEGER as trade_count_24h,
        (SELECT price FROM trades WHERE pair = p_pair ORDER BY timestamp DESC LIMIT 1) as last_price
    FROM trades t
    WHERE 
        t.pair = p_pair 
        AND t.timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000;
END;
$$ LANGUAGE plpgsql;

-- Materialized view for pair statistics (refresh periodically)
CREATE MATERIALIZED VIEW pair_statistics AS
SELECT 
    pair,
    COUNT(DISTINCT CASE WHEN timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000 THEN taker_user_id END) +
    COUNT(DISTINCT CASE WHEN timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000 THEN maker_user_id END) as active_traders_24h,
    COUNT(CASE WHEN timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000 THEN 1 END) as trades_24h,
    SUM(CASE WHEN timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '24 hours') * 1000 THEN quote_quantity ELSE 0 END) as volume_24h,
    AVG(CASE WHEN timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000 THEN price END) as avg_price_1h
FROM trades
GROUP BY pair;

CREATE UNIQUE INDEX idx_pair_statistics_pair ON pair_statistics(pair);

-- Comments for documentation
COMMENT ON TABLE orders IS 'Main orders table storing all order types and their current state';
COMMENT ON TABLE trades IS 'Executed trades representing matched order pairs';
COMMENT ON TABLE settlement_epochs IS 'Batch settlement periods for processing multiple trades';
COMMENT ON TABLE user_balances IS 'Current user balances with optimistic locking support';
COMMENT ON TABLE balance_history IS 'Complete audit trail of all balance changes';
COMMENT ON TABLE settlement_details IS 'Individual trade settlement records within each epoch';

COMMENT ON COLUMN orders.version IS 'Not used in orders table, but kept for consistency';
COMMENT ON COLUMN user_balances.version IS 'Used for optimistic locking to prevent race conditions';
COMMENT ON COLUMN settlement_epochs.net_positions IS 'JSON object mapping user_id -> currency -> net_amount';