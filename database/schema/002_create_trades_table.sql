-- Trades table with partitioning for executed trades
CREATE TABLE trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair VARCHAR(20) NOT NULL,
    maker_order_id UUID NOT NULL,
    taker_order_id UUID NOT NULL,
    maker_user_id VARCHAR(42) NOT NULL,
    taker_user_id VARCHAR(42) NOT NULL,
    price DECIMAL(36,18) NOT NULL CHECK (price > 0),
    amount DECIMAL(36,18) NOT NULL CHECK (amount > 0),
    maker_fee DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (maker_fee >= 0),
    taker_fee DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (taker_fee >= 0),
    side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settlement_status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (settlement_status IN ('pending', 'settling', 'settled', 'failed')),
    settlement_tx_hash VARCHAR(66),
    settlement_block_number BIGINT,
    settlement_gas_used BIGINT,
    metadata JSONB
) PARTITION BY RANGE (executed_at);

-- Create indexes for trades
CREATE INDEX idx_trades_pair_executed ON trades (pair, executed_at DESC);
CREATE INDEX idx_trades_maker_user_executed ON trades (maker_user_id, executed_at DESC);
CREATE INDEX idx_trades_taker_user_executed ON trades (taker_user_id, executed_at DESC);
CREATE INDEX idx_trades_settlement_status ON trades (settlement_status, executed_at) 
    WHERE settlement_status IN ('pending', 'settling');
CREATE INDEX idx_trades_maker_order ON trades (maker_order_id);
CREATE INDEX idx_trades_taker_order ON trades (taker_order_id);
CREATE INDEX idx_trades_settlement_tx ON trades (settlement_tx_hash) 
    WHERE settlement_tx_hash IS NOT NULL;

-- Create partitions for trades
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create partitions for last 6 months and next 3 months
    FOR i IN -5..3 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'trades_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF trades
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;

-- Function to automatically create new trade partitions
CREATE OR REPLACE FUNCTION create_trades_partition()
RETURNS void AS $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '3 months');
    end_date := start_date + INTERVAL '1 month';
    partition_name := 'trades_' || TO_CHAR(start_date, 'YYYY_MM');
    
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename = partition_name
    ) THEN
        EXECUTE format('
            CREATE TABLE %I PARTITION OF trades
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END IF;
END $$ LANGUAGE plpgsql;