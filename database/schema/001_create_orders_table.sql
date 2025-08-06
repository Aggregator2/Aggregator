-- Orders table with partitioning for high-performance trading
-- Supports time-based partitioning for efficient data management

-- Create orders table with comprehensive constraints
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(42) NOT NULL,
    pair VARCHAR(20) NOT NULL,
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    type VARCHAR(10) NOT NULL CHECK (type IN ('limit', 'market', 'stop', 'stop_limit')),
    price DECIMAL(36,18) CHECK (price > 0 OR (type = 'market' AND price IS NULL)),
    amount DECIMAL(36,18) NOT NULL CHECK (amount > 0),
    filled DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (filled >= 0 AND filled <= amount),
    remaining DECIMAL(36,18) GENERATED ALWAYS AS (amount - filled) STORED,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'open', 'partially_filled', 'filled', 'cancelled', 'expired', 'rejected')),
    fee DECIMAL(36,18) DEFAULT 0 CHECK (fee >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    signature JSONB NOT NULL,
    metadata JSONB,
    CONSTRAINT valid_expiry CHECK (expires_at IS NULL OR expires_at > created_at),
    CONSTRAINT valid_stop_price CHECK (
        (type IN ('stop', 'stop_limit') AND metadata->>'stop_price' IS NOT NULL) OR
        type NOT IN ('stop', 'stop_limit')
    )
) PARTITION BY RANGE (created_at);

-- Create indexes for optimal query performance
CREATE INDEX idx_orders_user_id_created ON orders (user_id, created_at DESC);
CREATE INDEX idx_orders_pair_side_status ON orders (pair, side, status) WHERE status IN ('open', 'partially_filled');
CREATE INDEX idx_orders_pair_price ON orders (pair, price) WHERE status IN ('open', 'partially_filled') AND type = 'limit';
CREATE INDEX idx_orders_expires_at ON orders (expires_at) WHERE expires_at IS NOT NULL AND status IN ('open', 'partially_filled');
CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);
CREATE INDEX idx_orders_metadata_gin ON orders USING GIN (metadata);

-- Create partitions for the last 12 months and next 3 months
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create historical partitions (12 months)
    FOR i IN 0..11 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'orders_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF orders
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
    
    -- Create future partitions (3 months)
    FOR i IN 1..3 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'orders_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF orders
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;

-- Function to automatically create new partitions
CREATE OR REPLACE FUNCTION create_orders_partition()
RETURNS void AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create partition for next month if it doesn't exist
    start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '3 months');
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'orders_' || TO_CHAR(start_date, 'YYYY_MM');
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = partition_name
    ) THEN
        EXECUTE format('
            CREATE TABLE %I PARTITION OF orders
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
        
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END $$ LANGUAGE plpgsql;

-- Schedule partition creation (requires pg_cron extension)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('create_orders_partitions', '0 0 1 * *', 'SELECT create_orders_partition()');

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();