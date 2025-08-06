-- Performance-Optimized Database Schema for High-Frequency Trading
-- This migration creates an optimized schema with proper indexing strategies

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create custom types
CREATE TYPE order_status AS ENUM ('PENDING', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED');
CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_type AS ENUM ('MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT');
CREATE TYPE time_in_force AS ENUM ('GTC', 'IOC', 'FOK', 'GTD');

-- Orders table with optimized structure
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    pair VARCHAR(20) NOT NULL,
    side order_side NOT NULL,
    type order_type NOT NULL,
    status order_status NOT NULL DEFAULT 'PENDING',
    price DECIMAL(20, 8) NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    filled_quantity DECIMAL(20, 8) NOT NULL DEFAULT 0,
    time_in_force time_in_force NOT NULL DEFAULT 'GTC',
    client_order_id VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_update_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expire_time TIMESTAMPTZ,
    metadata JSONB,
    version INTEGER NOT NULL DEFAULT 1
) PARTITION BY RANGE (timestamp);

-- Create indexes for orders table
CREATE INDEX idx_orders_user_id ON orders USING HASH (user_id);
CREATE INDEX idx_orders_pair_status ON orders (pair, status) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
CREATE INDEX idx_orders_pair_side_price ON orders (pair, side, price) WHERE status IN ('OPEN', 'PARTIALLY_FILLED');
CREATE INDEX idx_orders_timestamp ON orders USING BRIN (timestamp);
CREATE INDEX idx_orders_client_order_id ON orders (client_order_id) WHERE client_order_id IS NOT NULL;
CREATE INDEX idx_orders_expire_time ON orders (expire_time) WHERE expire_time IS NOT NULL AND status IN ('OPEN', 'PARTIALLY_FILLED');

-- GIN index for JSONB metadata searches
CREATE INDEX idx_orders_metadata ON orders USING GIN (metadata);

-- Trades table with optimized structure
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pair VARCHAR(20) NOT NULL,
    taker_order_id UUID NOT NULL,
    maker_order_id UUID NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    quantity DECIMAL(20, 8) NOT NULL,
    taker_side order_side NOT NULL,
    taker_fee DECIMAL(20, 8) NOT NULL DEFAULT 0,
    maker_fee DECIMAL(20, 8) NOT NULL DEFAULT 0,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settlement_status VARCHAR(20) DEFAULT 'PENDING',
    metadata JSONB
) PARTITION BY RANGE (timestamp);

-- Create indexes for trades table
CREATE INDEX idx_trades_pair_timestamp ON trades (pair, timestamp DESC);
CREATE INDEX idx_trades_taker_order_id ON trades USING HASH (taker_order_id);
CREATE INDEX idx_trades_maker_order_id ON trades USING HASH (maker_order_id);
CREATE INDEX idx_trades_timestamp ON trades USING BRIN (timestamp);
CREATE INDEX idx_trades_settlement_status ON trades (settlement_status) WHERE settlement_status = 'PENDING';

-- User balances table with row-level locking optimization
CREATE TABLE IF NOT EXISTS user_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    available_balance DECIMAL(20, 8) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
    locked_balance DECIMAL(20, 8) NOT NULL DEFAULT 0 CHECK (locked_balance >= 0),
    total_balance DECIMAL(20, 8) GENERATED ALWAYS AS (available_balance + locked_balance) STORED,
    last_update_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, currency)
);

-- Create indexes for user_balances
CREATE INDEX idx_user_balances_user_id ON user_balances USING HASH (user_id);
CREATE INDEX idx_user_balances_currency ON user_balances USING HASH (currency);

-- Balance history table for audit trail
CREATE TABLE IF NOT EXISTS balance_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    change_amount DECIMAL(20, 8) NOT NULL,
    locked_change DECIMAL(20, 8) NOT NULL DEFAULT 0,
    balance_after DECIMAL(20, 8) NOT NULL,
    locked_after DECIMAL(20, 8) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    reference_id VARCHAR(255),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (timestamp);

-- Create indexes for balance_history
CREATE INDEX idx_balance_history_user_currency_time ON balance_history (user_id, currency, timestamp DESC);
CREATE INDEX idx_balance_history_timestamp ON balance_history USING BRIN (timestamp);
CREATE INDEX idx_balance_history_reference ON balance_history (reference_id) WHERE reference_id IS NOT NULL;

-- Market data aggregation table
CREATE TABLE IF NOT EXISTS market_data_1m (
    pair VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    open DECIMAL(20, 8) NOT NULL,
    high DECIMAL(20, 8) NOT NULL,
    low DECIMAL(20, 8) NOT NULL,
    close DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 8) NOT NULL,
    trade_count INTEGER NOT NULL,
    PRIMARY KEY (pair, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create indexes for market data
CREATE INDEX idx_market_data_timestamp ON market_data_1m USING BRIN (timestamp);

-- Order book snapshot table for fast retrieval
CREATE TABLE IF NOT EXISTS order_book_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pair VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sequence_number BIGINT NOT NULL,
    bids JSONB NOT NULL,
    asks JSONB NOT NULL,
    checksum VARCHAR(64) NOT NULL
);

-- Create indexes for snapshots
CREATE INDEX idx_snapshots_pair_timestamp ON order_book_snapshots (pair, timestamp DESC);
CREATE INDEX idx_snapshots_sequence ON order_book_snapshots (pair, sequence_number DESC);

-- Create partitions for orders (monthly)
CREATE TABLE orders_2024_01 PARTITION OF orders FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE orders_2024_02 PARTITION OF orders FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
CREATE TABLE orders_2024_03 PARTITION OF orders FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');
CREATE TABLE orders_2024_04 PARTITION OF orders FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');
CREATE TABLE orders_2024_05 PARTITION OF orders FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');
CREATE TABLE orders_2024_06 PARTITION OF orders FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

-- Create partitions for trades (weekly)
CREATE TABLE trades_2024_w01 PARTITION OF trades FOR VALUES FROM ('2024-01-01') TO ('2024-01-08');
CREATE TABLE trades_2024_w02 PARTITION OF trades FOR VALUES FROM ('2024-01-08') TO ('2024-01-15');
CREATE TABLE trades_2024_w03 PARTITION OF trades FOR VALUES FROM ('2024-01-15') TO ('2024-01-22');
CREATE TABLE trades_2024_w04 PARTITION OF trades FOR VALUES FROM ('2024-01-22') TO ('2024-01-29');

-- Create partitions for balance_history (monthly)
CREATE TABLE balance_history_2024_01 PARTITION OF balance_history FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
CREATE TABLE balance_history_2024_02 PARTITION OF balance_history FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Create partitions for market_data_1m (daily)
CREATE TABLE market_data_1m_2024_01_01 PARTITION OF market_data_1m FOR VALUES FROM ('2024-01-01') TO ('2024-01-02');
CREATE TABLE market_data_1m_2024_01_02 PARTITION OF market_data_1m FOR VALUES FROM ('2024-01-02') TO ('2024-01-03');

-- Function to automatically create new partitions
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name text, start_date date)
RETURNS void AS $$
DECLARE
    partition_name text;
    start_date_str text;
    end_date_str text;
BEGIN
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    start_date_str := to_char(start_date, 'YYYY-MM-DD');
    end_date_str := to_char(start_date + interval '1 month', 'YYYY-MM-DD');
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name, table_name, start_date_str, end_date_str);
END;
$$ LANGUAGE plpgsql;

-- Function to create weekly partitions
CREATE OR REPLACE FUNCTION create_weekly_partition(table_name text, start_date date)
RETURNS void AS $$
DECLARE
    partition_name text;
    week_number int;
    start_date_str text;
    end_date_str text;
BEGIN
    week_number := extract(week from start_date);
    partition_name := table_name || '_' || to_char(start_date, 'YYYY') || '_w' || lpad(week_number::text, 2, '0');
    start_date_str := to_char(start_date, 'YYYY-MM-DD');
    end_date_str := to_char(start_date + interval '1 week', 'YYYY-MM-DD');
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        partition_name, table_name, start_date_str, end_date_str);
END;
$$ LANGUAGE plpgsql;

-- Trigger to update last_update_time
CREATE OR REPLACE FUNCTION update_last_update_time()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_update_time = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_orders_last_update_time
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_last_update_time();

CREATE TRIGGER update_user_balances_last_update_time
    BEFORE UPDATE ON user_balances
    FOR EACH ROW
    EXECUTE FUNCTION update_last_update_time();

-- Function for optimistic locking
CREATE OR REPLACE FUNCTION update_order_with_version(
    p_order_id UUID,
    p_status order_status,
    p_filled_quantity DECIMAL,
    p_expected_version INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    rows_updated INTEGER;
BEGIN
    UPDATE orders
    SET status = p_status,
        filled_quantity = p_filled_quantity,
        version = version + 1
    WHERE id = p_order_id
      AND version = p_expected_version;
    
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    RETURN rows_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- Create statistics tracking
CREATE STATISTICS orders_pair_status_stats (dependencies) ON pair, status FROM orders;
CREATE STATISTICS trades_pair_timestamp_stats (dependencies) ON pair, timestamp FROM trades;

-- Configure autovacuum for high-frequency tables
ALTER TABLE orders SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0,
    autovacuum_vacuum_cost_limit = 10000
);

ALTER TABLE trades SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_cost_delay = 0,
    autovacuum_vacuum_cost_limit = 10000
);

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;