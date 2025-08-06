-- Settlement batches table
CREATE TABLE settlement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number BIGSERIAL UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'processing', 'submitted', 'confirmed', 'failed', 'reverted')),
    trade_count INTEGER NOT NULL CHECK (trade_count > 0),
    total_volume DECIMAL(36,18) NOT NULL CHECK (total_volume > 0),
    merkle_root VARCHAR(66),
    ipfs_hash VARCHAR(100),
    tx_hash VARCHAR(66),
    block_number BIGINT,
    gas_used BIGINT,
    gas_price DECIMAL(36,18),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT valid_tx_hash CHECK (tx_hash IS NULL OR tx_hash ~ '^0x[a-fA-F0-9]{64}$'),
    CONSTRAINT valid_merkle_root CHECK (merkle_root IS NULL OR merkle_root ~ '^0x[a-fA-F0-9]{64}$')
);

-- Create indexes for settlement batches
CREATE INDEX idx_settlement_batches_status ON settlement_batches (status, created_at) 
    WHERE status IN ('pending', 'processing', 'submitted');
CREATE INDEX idx_settlement_batches_tx_hash ON settlement_batches (tx_hash) 
    WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_settlement_batches_block ON settlement_batches (block_number DESC) 
    WHERE block_number IS NOT NULL;

-- Settlement batch trades mapping
CREATE TABLE settlement_batch_trades (
    batch_id UUID NOT NULL REFERENCES settlement_batches(id),
    trade_id UUID NOT NULL REFERENCES trades(id),
    merkle_proof JSONB,
    PRIMARY KEY (batch_id, trade_id)
);

-- Create indexes for batch trades
CREATE INDEX idx_settlement_batch_trades_trade ON settlement_batch_trades (trade_id);

-- Settlement queue for pending settlements
CREATE TABLE settlement_queue (
    id BIGSERIAL PRIMARY KEY,
    trade_id UUID NOT NULL REFERENCES trades(id),
    priority INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INTEGER NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'queued' 
        CHECK (status IN ('queued', 'processing', 'settled', 'failed', 'cancelled')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_retry_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for settlement queue
CREATE UNIQUE INDEX idx_settlement_queue_trade ON settlement_queue (trade_id) 
    WHERE status IN ('queued', 'processing');
CREATE INDEX idx_settlement_queue_status_priority ON settlement_queue (status, priority DESC, created_at) 
    WHERE status = 'queued';
CREATE INDEX idx_settlement_queue_retry ON settlement_queue (next_retry_at) 
    WHERE status = 'queued' AND retry_count < max_retries;

-- Gas price tracking for optimal settlement timing
CREATE TABLE gas_prices (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    safe_low DECIMAL(36,18) NOT NULL CHECK (safe_low > 0),
    standard DECIMAL(36,18) NOT NULL CHECK (standard >= safe_low),
    fast DECIMAL(36,18) NOT NULL CHECK (fast >= standard),
    instant DECIMAL(36,18) NOT NULL CHECK (instant >= fast),
    block_number BIGINT NOT NULL,
    base_fee DECIMAL(36,18),
    priority_fee DECIMAL(36,18),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for gas prices
CREATE INDEX idx_gas_prices_timestamp ON gas_prices (timestamp DESC);
CREATE INDEX idx_gas_prices_block ON gas_prices (block_number DESC);

-- Settlement configuration
CREATE TABLE settlement_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(42)
);

-- Insert default settlement configuration
INSERT INTO settlement_config (key, value, description) VALUES
    ('batch_size', '100', 'Maximum number of trades per settlement batch'),
    ('batch_timeout', '300', 'Maximum time in seconds to wait before settling a batch'),
    ('min_gas_price', '"20000000000"', 'Minimum gas price in wei for settlement'),
    ('max_gas_price', '"500000000000"', 'Maximum gas price in wei for settlement'),
    ('retry_delay', '60', 'Delay in seconds between settlement retries'),
    ('confirmation_blocks', '12', 'Number of blocks to wait for confirmation')
ON CONFLICT (key) DO NOTHING;

-- Update triggers
CREATE TRIGGER update_settlement_queue_updated_at
    BEFORE UPDATE ON settlement_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_config_updated_at
    BEFORE UPDATE ON settlement_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();