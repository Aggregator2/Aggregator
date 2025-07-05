-- Cross-Chain Settlement Extension for Trading Platform
-- This schema extends the base schema with cross-chain bridge functionality

-- Enum for cross-chain settlement status
CREATE TYPE cross_chain_status AS ENUM (
    'PENDING',
    'QUOTE_RECEIVED',
    'EXECUTING',
    'MONITORING',
    'COMPLETED',
    'FAILED'
);

-- Cross-chain settlements table
CREATE TABLE cross_chain_settlements (
    id VARCHAR(255) PRIMARY KEY,
    settlement_epoch_id UUID REFERENCES settlement_epochs(id),
    user_id VARCHAR(255) NOT NULL,
    
    -- Chain and token information
    source_chain_id INTEGER NOT NULL,
    target_chain_id INTEGER NOT NULL,
    source_token VARCHAR(66) NOT NULL, -- Token address on source chain
    target_token VARCHAR(66) NOT NULL, -- Token address on target chain
    
    -- Amounts
    source_amount DECIMAL(36, 18) NOT NULL,
    target_amount DECIMAL(36, 18),
    target_amount_min DECIMAL(36, 18), -- Minimum acceptable amount after slippage
    
    -- Status tracking
    status cross_chain_status NOT NULL DEFAULT 'PENDING',
    
    -- LiFi integration
    lifi_route_id VARCHAR(255),
    
    -- Transaction hashes
    bridge_transaction_hash VARCHAR(66), -- Initial bridge transaction
    source_transaction_hash VARCHAR(66), -- Transaction on source chain
    target_transaction_hash VARCHAR(66), -- Final transaction on target chain
    
    -- Timing
    execution_started TIMESTAMP WITH TIME ZONE,
    execution_completed TIMESTAMP WITH TIME ZONE,
    
    -- Error handling
    error_message TEXT,
    
    -- Metadata (stores quote details, route info, etc.)
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_chains CHECK (source_chain_id != target_chain_id),
    CONSTRAINT valid_amounts CHECK (source_amount > 0)
);

-- Bridge transaction monitoring table
CREATE TABLE bridge_transaction_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cross_chain_settlement_id VARCHAR(255) REFERENCES cross_chain_settlements(id),
    
    -- Status check details
    check_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) NOT NULL, -- PENDING, DONE, FAILED, NOT_FOUND
    
    -- Chain-specific status
    source_chain_status VARCHAR(50),
    target_chain_status VARCHAR(50),
    
    -- Additional status info
    substatus VARCHAR(100),
    
    -- Gas and fees
    source_gas_used DECIMAL(36, 18),
    target_gas_used DECIMAL(36, 18),
    bridge_fee_amount DECIMAL(36, 18),
    bridge_fee_token VARCHAR(66),
    
    -- Error details
    error_code VARCHAR(50),
    error_message TEXT,
    
    -- Raw response data
    raw_response JSONB
);

-- Supported bridges configuration
CREATE TABLE supported_bridges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bridge_name VARCHAR(50) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    
    -- Bridge capabilities
    supported_chains INTEGER[] NOT NULL,
    min_amount DECIMAL(36, 18),
    max_amount DECIMAL(36, 18),
    
    -- Performance metrics
    avg_execution_time INTEGER, -- seconds
    success_rate DECIMAL(5, 2), -- percentage
    
    -- Configuration
    priority INTEGER DEFAULT 100, -- Higher priority = preferred
    metadata JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Chain configuration for cross-chain settlements
CREATE TABLE chain_configurations (
    chain_id INTEGER PRIMARY KEY,
    chain_name VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    
    -- RPC and network info
    rpc_url VARCHAR(255),
    block_time INTEGER, -- Average block time in seconds
    confirmations_required INTEGER DEFAULT 12,
    
    -- Contract addresses
    lifi_contract_address VARCHAR(66),
    settlement_contract_address VARCHAR(66),
    
    -- Gas settings
    gas_price_multiplier DECIMAL(4, 2) DEFAULT 1.2, -- Multiplier for gas price estimation
    max_gas_price DECIMAL(36, 18), -- Maximum gas price in gwei
    
    metadata JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Cross-chain settlement aggregated stats
CREATE TABLE cross_chain_settlement_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL,
    source_chain_id INTEGER NOT NULL,
    target_chain_id INTEGER NOT NULL,
    
    -- Volume metrics
    total_settlements INTEGER DEFAULT 0,
    successful_settlements INTEGER DEFAULT 0,
    failed_settlements INTEGER DEFAULT 0,
    total_volume_usd DECIMAL(36, 18) DEFAULT 0,
    
    -- Performance metrics
    avg_execution_time INTEGER, -- seconds
    min_execution_time INTEGER,
    max_execution_time INTEGER,
    
    -- Bridge usage
    bridge_usage JSONB, -- { "bridge_name": count }
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT unique_daily_stats UNIQUE(date, source_chain_id, target_chain_id)
);

-- Indexes for performance

CREATE INDEX idx_cross_chain_settlements_user ON cross_chain_settlements(user_id);
CREATE INDEX idx_cross_chain_settlements_status ON cross_chain_settlements(status);
CREATE INDEX idx_cross_chain_settlements_epoch ON cross_chain_settlements(settlement_epoch_id);
CREATE INDEX idx_cross_chain_settlements_chains ON cross_chain_settlements(source_chain_id, target_chain_id);
CREATE INDEX idx_cross_chain_settlements_monitoring ON cross_chain_settlements(status, execution_started) 
    WHERE status IN ('EXECUTING', 'MONITORING');

CREATE INDEX idx_bridge_status_settlement ON bridge_transaction_status(cross_chain_settlement_id);
CREATE INDEX idx_bridge_status_timestamp ON bridge_transaction_status(check_timestamp DESC);

CREATE INDEX idx_chain_config_active ON chain_configurations(chain_id) WHERE is_active = true;

-- Functions

-- Function to get pending cross-chain settlements
CREATE OR REPLACE FUNCTION get_pending_cross_chain_settlements(
    p_limit INTEGER DEFAULT 100
) RETURNS TABLE (
    id VARCHAR(255),
    user_id VARCHAR(255),
    source_chain_id INTEGER,
    target_chain_id INTEGER,
    source_amount DECIMAL(36, 18),
    status cross_chain_status,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ccs.id,
        ccs.user_id,
        ccs.source_chain_id,
        ccs.target_chain_id,
        ccs.source_amount,
        ccs.status,
        ccs.created_at
    FROM cross_chain_settlements ccs
    WHERE ccs.status IN ('EXECUTING', 'MONITORING')
    ORDER BY ccs.created_at ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to update cross-chain settlement stats
CREATE OR REPLACE FUNCTION update_cross_chain_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'COMPLETED' AND OLD.status != 'COMPLETED' THEN
        INSERT INTO cross_chain_settlement_stats (
            date,
            source_chain_id,
            target_chain_id,
            successful_settlements,
            total_volume_usd
        ) VALUES (
            CURRENT_DATE,
            NEW.source_chain_id,
            NEW.target_chain_id,
            1,
            COALESCE((NEW.metadata->>'volume_usd')::DECIMAL, 0)
        )
        ON CONFLICT (date, source_chain_id, target_chain_id) DO UPDATE
        SET 
            successful_settlements = cross_chain_settlement_stats.successful_settlements + 1,
            total_volume_usd = cross_chain_settlement_stats.total_volume_usd + COALESCE((NEW.metadata->>'volume_usd')::DECIMAL, 0);
    ELSIF NEW.status = 'FAILED' AND OLD.status != 'FAILED' THEN
        INSERT INTO cross_chain_settlement_stats (
            date,
            source_chain_id,
            target_chain_id,
            failed_settlements
        ) VALUES (
            CURRENT_DATE,
            NEW.source_chain_id,
            NEW.target_chain_id,
            1
        )
        ON CONFLICT (date, source_chain_id, target_chain_id) DO UPDATE
        SET failed_settlements = cross_chain_settlement_stats.failed_settlements + 1;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cross_chain_stats_trigger
AFTER UPDATE ON cross_chain_settlements
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_cross_chain_stats();

-- Insert default supported bridges
INSERT INTO supported_bridges (bridge_name, supported_chains, priority, metadata) VALUES
('stargate', ARRAY[1, 137, 42161, 10, 56], 150, '{"fast": true, "reliable": true}'),
('across', ARRAY[1, 137, 42161, 10], 140, '{"fast": true, "capital_efficient": true}'),
('hop', ARRAY[1, 137, 42161, 10], 130, '{"good_liquidity": true}'),
('cbridge', ARRAY[1, 137, 42161, 10, 56, 43114], 120, '{"wide_support": true}'),
('connext', ARRAY[1, 137, 42161, 10, 56], 110, '{"secure": true}');

-- Insert default chain configurations
INSERT INTO chain_configurations (chain_id, chain_name, block_time, confirmations_required, lifi_contract_address) VALUES
(1, 'Ethereum', 12, 12, '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'),
(137, 'Polygon', 2, 128, '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'),
(42161, 'Arbitrum', 1, 0, '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'),
(10, 'Optimism', 2, 0, '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'),
(56, 'BSC', 3, 15, '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'),
(43114, 'Avalanche', 2, 1, '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE');

-- Views for monitoring

CREATE VIEW pending_cross_chain_settlements_view AS
SELECT 
    ccs.*,
    cc1.chain_name as source_chain_name,
    cc2.chain_name as target_chain_name,
    EXTRACT(EPOCH FROM (NOW() - ccs.execution_started)) as seconds_elapsed
FROM cross_chain_settlements ccs
JOIN chain_configurations cc1 ON ccs.source_chain_id = cc1.chain_id
JOIN chain_configurations cc2 ON ccs.target_chain_id = cc2.chain_id
WHERE ccs.status IN ('EXECUTING', 'MONITORING');

CREATE VIEW cross_chain_settlement_summary AS
SELECT 
    DATE_TRUNC('day', created_at) as date,
    source_chain_id,
    target_chain_id,
    COUNT(*) as total_settlements,
    COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
    COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed,
    COUNT(CASE WHEN status IN ('EXECUTING', 'MONITORING') THEN 1 END) as pending,
    AVG(CASE 
        WHEN status = 'COMPLETED' AND execution_completed IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (execution_completed - execution_started))
    END) as avg_execution_seconds
FROM cross_chain_settlements
GROUP BY DATE_TRUNC('day', created_at), source_chain_id, target_chain_id;

-- Comments
COMMENT ON TABLE cross_chain_settlements IS 'Tracks cross-chain token transfers using LiFi bridge aggregator';
COMMENT ON TABLE bridge_transaction_status IS 'Monitoring history for bridge transactions';
COMMENT ON TABLE supported_bridges IS 'Configuration for available bridge protocols';
COMMENT ON TABLE chain_configurations IS 'Network-specific settings for cross-chain operations';
COMMENT ON COLUMN cross_chain_settlements.lifi_route_id IS 'Unique identifier from LiFi for tracking the route';
COMMENT ON COLUMN cross_chain_settlements.target_amount_min IS 'Minimum amount accounting for slippage tolerance';