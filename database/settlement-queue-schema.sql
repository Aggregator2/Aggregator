-- SettlementQueueV5 PostgreSQL Database Schema
-- Optimized for millions of orders with comprehensive indexing and partitioning
-- Version: 1.0
-- Date: 2025-07-12

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =============================================================================
-- CORE ORDERS TABLE WITH OPTIMIZED INDEXING
-- =============================================================================

-- Main orders table for active and recent orders (last 30 days)
CREATE TABLE orders (
    -- Primary identifiers
    id                      BIGSERIAL PRIMARY KEY,
    order_hash              BYTEA NOT NULL UNIQUE,
    commitment_id           BYTEA,
    nonce                   BIGINT NOT NULL,
    
    -- User and contract data
    trader_address          BYTEA NOT NULL,
    contract_address        BYTEA NOT NULL,
    chain_id                INTEGER NOT NULL DEFAULT 1,
    
    -- Token and amounts
    token_in                BYTEA NOT NULL,
    token_out               BYTEA NOT NULL,
    amount_in               NUMERIC(78, 0) NOT NULL CHECK (amount_in > 0),
    min_amount_out          NUMERIC(78, 0) NOT NULL CHECK (min_amount_out > 0),
    actual_amount_out       NUMERIC(78, 0),
    max_slippage_bps        INTEGER NOT NULL CHECK (max_slippage_bps >= 0 AND max_slippage_bps <= 10000),
    
    -- Timing and priority
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deadline                TIMESTAMP WITH TIME ZONE NOT NULL,
    revealed_at             TIMESTAMP WITH TIME ZONE,
    processed_at            TIMESTAMP WITH TIME ZONE,
    completed_at            TIMESTAMP WITH TIME ZONE,
    priority                INTEGER NOT NULL DEFAULT 500 CHECK (priority >= 1 AND priority <= 1000),
    
    -- Order status and flags
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'committed', 'revealed', 'processing', 'completed', 'failed', 'cancelled', 'expired')
    ),
    order_type              TEXT NOT NULL DEFAULT 'market' CHECK (
        order_type IN ('market', 'limit', 'stop_loss', 'take_profit', 'mev_protected')
    ),
    requires_multi_sig      BOOLEAN NOT NULL DEFAULT FALSE,
    is_large_order          BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- MEV protection data
    mev_protection_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    commitment_hash         BYTEA,
    reveal_salt             BYTEA,
    deposit_amount          NUMERIC(78, 0) DEFAULT 0,
    
    -- Processing data
    gas_price               BIGINT,
    gas_used                BIGINT,
    tx_hash                 BYTEA,
    block_number            BIGINT,
    block_hash              BYTEA,
    log_index               INTEGER,
    
    -- Metadata and errors
    metadata                JSONB DEFAULT '{}',
    error_message           TEXT,
    retry_count             INTEGER DEFAULT 0,
    
    -- Audit fields
    created_by              TEXT DEFAULT 'system',
    version                 INTEGER NOT NULL DEFAULT 1,
    
    -- Constraints
    CONSTRAINT orders_deadline_check CHECK (deadline > created_at),
    CONSTRAINT orders_revealed_after_created CHECK (revealed_at IS NULL OR revealed_at >= created_at),
    CONSTRAINT orders_processed_after_revealed CHECK (processed_at IS NULL OR revealed_at IS NULL OR processed_at >= revealed_at),
    CONSTRAINT orders_completed_after_processed CHECK (completed_at IS NULL OR processed_at IS NULL OR completed_at >= processed_at),
    CONSTRAINT orders_nonce_trader_unique UNIQUE (trader_address, nonce, chain_id)
) PARTITION BY RANGE (created_at);

-- Create indexes for high-performance queries
CREATE INDEX CONCURRENTLY idx_orders_trader_status ON orders (trader_address, status) WHERE status != 'completed';
CREATE INDEX CONCURRENTLY idx_orders_token_pair ON orders (token_in, token_out, created_at DESC);
CREATE INDEX CONCURRENTLY idx_orders_status_priority ON orders (status, priority DESC, created_at ASC) WHERE status IN ('revealed', 'processing');
CREATE INDEX CONCURRENTLY idx_orders_deadline ON orders (deadline) WHERE status NOT IN ('completed', 'failed', 'cancelled');
CREATE INDEX CONCURRENTLY idx_orders_block_number ON orders (block_number, log_index) WHERE block_number IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_orders_tx_hash ON orders (tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_orders_commitment ON orders (commitment_id) WHERE commitment_id IS NOT NULL;
CREATE INDEX CONCURRENTLY idx_orders_metadata_gin ON orders USING GIN (metadata);
CREATE INDEX CONCURRENTLY idx_orders_large_orders ON orders (trader_address, created_at DESC) WHERE is_large_order = TRUE;

-- Partial indexes for performance
CREATE INDEX CONCURRENTLY idx_orders_pending_processing ON orders (priority DESC, created_at ASC) 
    WHERE status IN ('revealed', 'processing');
CREATE INDEX CONCURRENTLY idx_orders_mev_protected ON orders (created_at DESC) 
    WHERE mev_protection_enabled = TRUE;

-- =============================================================================
-- ORDER HISTORY PARTITIONING (MONTHLY PARTITIONS)
-- =============================================================================

-- Create monthly partitions for orders table
CREATE TABLE orders_2025_01 PARTITION OF orders FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
CREATE TABLE orders_2025_02 PARTITION OF orders FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
CREATE TABLE orders_2025_03 PARTITION OF orders FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
CREATE TABLE orders_2025_04 PARTITION OF orders FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');
CREATE TABLE orders_2025_05 PARTITION OF orders FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');
CREATE TABLE orders_2025_06 PARTITION OF orders FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');
CREATE TABLE orders_2025_07 PARTITION OF orders FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE orders_2025_08 PARTITION OF orders FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
CREATE TABLE orders_2025_09 PARTITION OF orders FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');
CREATE TABLE orders_2025_10 PARTITION OF orders FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');
CREATE TABLE orders_2025_11 PARTITION OF orders FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');
CREATE TABLE orders_2025_12 PARTITION OF orders FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Order history archive for completed orders (yearly partitions)
CREATE TABLE order_history (
    LIKE orders INCLUDING ALL
) PARTITION BY RANGE (completed_at);

-- Create yearly partitions for history
CREATE TABLE order_history_2024 PARTITION OF order_history FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE order_history_2025 PARTITION OF order_history FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE order_history_2026 PARTITION OF order_history FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- =============================================================================
-- USER BALANCES CACHE WITH CONSISTENCY GUARANTEES
-- =============================================================================

CREATE TABLE user_balances (
    id                      BIGSERIAL PRIMARY KEY,
    user_address            BYTEA NOT NULL,
    token_address           BYTEA NOT NULL,
    chain_id                INTEGER NOT NULL DEFAULT 1,
    
    -- Balance data
    balance                 NUMERIC(78, 0) NOT NULL DEFAULT 0,
    locked_balance          NUMERIC(78, 0) NOT NULL DEFAULT 0,
    available_balance       NUMERIC(78, 0) GENERATED ALWAYS AS (balance - locked_balance) STORED,
    
    -- Cache metadata
    last_updated            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_block_number       BIGINT NOT NULL,
    last_tx_hash            BYTEA,
    cache_ttl               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 seconds'),
    
    -- Consistency tracking
    version                 BIGINT NOT NULL DEFAULT 1,
    is_stale                BOOLEAN NOT NULL DEFAULT FALSE,
    update_in_progress      BOOLEAN NOT NULL DEFAULT FALSE,
    last_validation         TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT user_balances_positive CHECK (balance >= 0 AND locked_balance >= 0 AND locked_balance <= balance),
    CONSTRAINT user_balances_unique UNIQUE (user_address, token_address, chain_id)
);

-- Indexes for balance queries
CREATE INDEX CONCURRENTLY idx_user_balances_user ON user_balances (user_address, chain_id);
CREATE INDEX CONCURRENTLY idx_user_balances_token ON user_balances (token_address, chain_id);
CREATE INDEX CONCURRENTLY idx_user_balances_stale ON user_balances (last_updated) WHERE is_stale = TRUE;
CREATE INDEX CONCURRENTLY idx_user_balances_ttl ON user_balances (cache_ttl) WHERE cache_ttl < NOW();

-- Balance update history for auditing
CREATE TABLE balance_updates (
    id                      BIGSERIAL PRIMARY KEY,
    user_address            BYTEA NOT NULL,
    token_address           BYTEA NOT NULL,
    chain_id                INTEGER NOT NULL,
    
    -- Change data
    old_balance             NUMERIC(78, 0) NOT NULL,
    new_balance             NUMERIC(78, 0) NOT NULL,
    old_locked              NUMERIC(78, 0) NOT NULL,
    new_locked              NUMERIC(78, 0) NOT NULL,
    
    -- Context
    change_type             TEXT NOT NULL CHECK (change_type IN ('order_placed', 'order_filled', 'order_cancelled', 'deposit', 'withdrawal', 'correction')),
    related_order_id        BIGINT REFERENCES orders(id),
    tx_hash                 BYTEA,
    block_number            BIGINT,
    
    -- Timing
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Audit
    created_by              TEXT NOT NULL DEFAULT 'system'
) PARTITION BY RANGE (created_at);

-- Create monthly partitions for balance updates
CREATE TABLE balance_updates_2025_07 PARTITION OF balance_updates FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE balance_updates_2025_08 PARTITION OF balance_updates FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

-- =============================================================================
-- SETTLEMENT TRANSACTION LOG WITH BLOCKCHAIN REFERENCES
-- =============================================================================

CREATE TABLE settlement_transactions (
    id                      BIGSERIAL PRIMARY KEY,
    
    -- Blockchain reference
    tx_hash                 BYTEA NOT NULL UNIQUE,
    block_number            BIGINT NOT NULL,
    block_hash              BYTEA NOT NULL,
    log_index               INTEGER NOT NULL,
    chain_id                INTEGER NOT NULL DEFAULT 1,
    
    -- Settlement data
    settlement_id           BYTEA NOT NULL,
    batch_id                UUID DEFAULT uuid_generate_v4(),
    settlement_type         TEXT NOT NULL CHECK (settlement_type IN ('single', 'batch', 'emergency', 'dispute')),
    
    -- Orders involved
    order_ids               BIGINT[] NOT NULL,
    primary_order_id        BIGINT NOT NULL REFERENCES orders(id),
    
    -- Financial data
    total_volume_usd        NUMERIC(20, 8),
    gas_price               BIGINT NOT NULL,
    gas_used                BIGINT NOT NULL,
    gas_cost_wei            BIGINT NOT NULL,
    protocol_fee_wei        BIGINT DEFAULT 0,
    
    -- Participants
    settler_address         BYTEA NOT NULL,
    operator_address        BYTEA,
    
    -- MEV protection data
    mev_protection_used     BOOLEAN DEFAULT FALSE,
    flashbot_bundle_hash    BYTEA,
    bundle_block_number     BIGINT,
    
    -- Status and timing
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'confirmed', 'finalized', 'failed', 'reverted')
    ),
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    confirmed_at            TIMESTAMP WITH TIME ZONE,
    finalized_at            TIMESTAMP WITH TIME ZONE,
    
    -- Error handling
    error_message           TEXT,
    retry_count             INTEGER DEFAULT 0,
    
    -- Metadata
    metadata                JSONB DEFAULT '{}',
    
    -- Constraints
    CONSTRAINT settlement_tx_block_log_unique UNIQUE (block_number, log_index, chain_id),
    CONSTRAINT settlement_tx_confirmed_after_created CHECK (confirmed_at IS NULL OR confirmed_at >= created_at),
    CONSTRAINT settlement_tx_finalized_after_confirmed CHECK (finalized_at IS NULL OR confirmed_at IS NULL OR finalized_at >= confirmed_at)
) PARTITION BY RANGE (created_at);

-- Create monthly partitions for settlement transactions
CREATE TABLE settlement_transactions_2025_07 PARTITION OF settlement_transactions FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE settlement_transactions_2025_08 PARTITION OF settlement_transactions FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

-- Indexes for settlement queries
CREATE INDEX CONCURRENTLY idx_settlement_tx_block ON settlement_transactions (block_number DESC, log_index);
CREATE INDEX CONCURRENTLY idx_settlement_tx_orders ON settlement_transactions USING GIN (order_ids);
CREATE INDEX CONCURRENTLY idx_settlement_tx_settler ON settlement_transactions (settler_address, created_at DESC);
CREATE INDEX CONCURRENTLY idx_settlement_tx_status ON settlement_transactions (status, created_at DESC);
CREATE INDEX CONCURRENTLY idx_settlement_tx_batch ON settlement_transactions (batch_id);
CREATE INDEX CONCURRENTLY idx_settlement_tx_mev ON settlement_transactions (created_at DESC) WHERE mev_protection_used = TRUE;

-- =============================================================================
-- AUDIT TRAIL FOR COMPLIANCE
-- =============================================================================

CREATE TABLE audit_log (
    id                      BIGSERIAL PRIMARY KEY,
    
    -- Event identification
    event_id                UUID NOT NULL DEFAULT uuid_generate_v4(),
    event_type              TEXT NOT NULL,
    entity_type             TEXT NOT NULL,
    entity_id               TEXT NOT NULL,
    
    -- Actor information
    actor_type              TEXT NOT NULL CHECK (actor_type IN ('user', 'operator', 'system', 'admin', 'external')),
    actor_address           BYTEA,
    actor_id                TEXT,
    ip_address              INET,
    user_agent              TEXT,
    
    -- Change data
    old_values              JSONB,
    new_values              JSONB,
    changes                 JSONB,
    
    -- Context
    action                  TEXT NOT NULL,
    resource                TEXT NOT NULL,
    method                  TEXT,
    endpoint                TEXT,
    session_id              TEXT,
    request_id              TEXT,
    
    -- Compliance data
    compliance_level        TEXT NOT NULL DEFAULT 'standard' CHECK (
        compliance_level IN ('low', 'standard', 'high', 'critical')
    ),
    retention_period        INTERVAL DEFAULT '7 years',
    is_sensitive            BOOLEAN DEFAULT FALSE,
    
    -- Timing
    timestamp               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    timezone                TEXT DEFAULT 'UTC',
    
    -- Metadata
    metadata                JSONB DEFAULT '{}',
    tags                    TEXT[] DEFAULT '{}',
    
    -- Verification
    checksum                TEXT,
    signature               TEXT
) PARTITION BY RANGE (timestamp);

-- Create monthly partitions for audit log
CREATE TABLE audit_log_2025_07 PARTITION OF audit_log FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
CREATE TABLE audit_log_2025_08 PARTITION OF audit_log FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

-- Indexes for audit queries
CREATE INDEX CONCURRENTLY idx_audit_log_entity ON audit_log (entity_type, entity_id, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_log_actor ON audit_log (actor_type, actor_address, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_log_event_type ON audit_log (event_type, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_log_compliance ON audit_log (compliance_level, timestamp DESC);
CREATE INDEX CONCURRENTLY idx_audit_log_sensitive ON audit_log (timestamp DESC) WHERE is_sensitive = TRUE;
CREATE INDEX CONCURRENTLY idx_audit_log_tags ON audit_log USING GIN (tags);
CREATE INDEX CONCURRENTLY idx_audit_log_metadata ON audit_log USING GIN (metadata);

-- =============================================================================
-- PERFORMANCE MONITORING TABLES
-- =============================================================================

-- Order processing metrics
CREATE TABLE order_metrics (
    id                      BIGSERIAL PRIMARY KEY,
    
    -- Time window
    timestamp               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    window_start            TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end              TIMESTAMP WITH TIME ZONE NOT NULL,
    window_duration         INTERVAL NOT NULL,
    
    -- Volume metrics
    total_orders            BIGINT NOT NULL DEFAULT 0,
    completed_orders        BIGINT NOT NULL DEFAULT 0,
    failed_orders           BIGINT NOT NULL DEFAULT 0,
    cancelled_orders        BIGINT NOT NULL DEFAULT 0,
    
    -- Performance metrics
    avg_processing_time     INTERVAL,
    p95_processing_time     INTERVAL,
    p99_processing_time     INTERVAL,
    avg_gas_used            BIGINT,
    total_gas_used          BIGINT,
    
    -- MEV metrics
    mev_protected_orders    BIGINT DEFAULT 0,
    sandwich_attacks_prevented BIGINT DEFAULT 0,
    flashbot_bundles_used   BIGINT DEFAULT 0,
    
    -- Financial metrics
    total_volume_usd        NUMERIC(20, 8) DEFAULT 0,
    total_fees_usd          NUMERIC(20, 8) DEFAULT 0,
    avg_order_size_usd      NUMERIC(20, 8),
    
    -- Chain metrics
    chain_id                INTEGER NOT NULL DEFAULT 1,
    avg_block_time          INTERVAL,
    network_congestion      NUMERIC(5, 4),
    
    CONSTRAINT order_metrics_window_check CHECK (window_end > window_start)
) PARTITION BY RANGE (timestamp);

-- Create daily partitions for metrics
CREATE TABLE order_metrics_2025_07 PARTITION OF order_metrics FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

-- Indexes for metrics
CREATE INDEX CONCURRENTLY idx_order_metrics_window ON order_metrics (window_start, window_end);
CREATE INDEX CONCURRENTLY idx_order_metrics_chain ON order_metrics (chain_id, timestamp DESC);

-- =============================================================================
-- MATERIALIZED VIEWS FOR PERFORMANCE
-- =============================================================================

-- Active orders summary for dashboard
CREATE MATERIALIZED VIEW active_orders_summary AS
SELECT 
    status,
    COUNT(*) as order_count,
    AVG(priority) as avg_priority,
    MIN(created_at) as oldest_order,
    MAX(created_at) as newest_order,
    COUNT(*) FILTER (WHERE mev_protection_enabled) as mev_protected_count,
    COUNT(*) FILTER (WHERE is_large_order) as large_order_count,
    SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_count
FROM orders 
WHERE status NOT IN ('completed', 'failed', 'cancelled')
    AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY status;

CREATE UNIQUE INDEX ON active_orders_summary (status);

-- Token pair trading volume (last 24h)
CREATE MATERIALIZED VIEW token_pair_volume_24h AS
SELECT 
    token_in,
    token_out,
    COUNT(*) as trade_count,
    SUM(amount_in) as total_volume_in,
    SUM(actual_amount_out) as total_volume_out,
    AVG(actual_amount_out::numeric / NULLIF(amount_in::numeric, 0)) as avg_rate,
    MAX(created_at) as last_trade
FROM orders 
WHERE status = 'completed'
    AND created_at > NOW() - INTERVAL '24 hours'
    AND actual_amount_out IS NOT NULL
GROUP BY token_in, token_out
HAVING COUNT(*) >= 3;

CREATE UNIQUE INDEX ON token_pair_volume_24h (token_in, token_out);

-- =============================================================================
-- TRIGGERS AND FUNCTIONS
-- =============================================================================

-- Update timestamp trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to orders table
CREATE TRIGGER update_orders_updated_at 
    BEFORE UPDATE ON orders 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Balance consistency trigger
CREATE OR REPLACE FUNCTION validate_balance_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure balance is never negative
    IF NEW.balance < 0 OR NEW.locked_balance < 0 THEN
        RAISE EXCEPTION 'Balance cannot be negative';
    END IF;
    
    -- Ensure locked balance doesn't exceed total balance
    IF NEW.locked_balance > NEW.balance THEN
        RAISE EXCEPTION 'Locked balance cannot exceed total balance';
    END IF;
    
    -- Update version number
    NEW.version = OLD.version + 1;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER validate_user_balances_update 
    BEFORE UPDATE ON user_balances 
    FOR EACH ROW 
    EXECUTE FUNCTION validate_balance_update();

-- Audit log trigger for orders
CREATE OR REPLACE FUNCTION audit_order_changes()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (
        event_type,
        entity_type,
        entity_id,
        actor_type,
        action,
        resource,
        old_values,
        new_values,
        compliance_level
    ) VALUES (
        CASE 
            WHEN TG_OP = 'INSERT' THEN 'order_created'
            WHEN TG_OP = 'UPDATE' THEN 'order_updated'
            WHEN TG_OP = 'DELETE' THEN 'order_deleted'
        END,
        'order',
        COALESCE(NEW.id::text, OLD.id::text),
        'system',
        TG_OP,
        'orders',
        CASE WHEN TG_OP != 'INSERT' THEN row_to_json(OLD) ELSE NULL END,
        CASE WHEN TG_OP != 'DELETE' THEN row_to_json(NEW) ELSE NULL END,
        CASE 
            WHEN COALESCE(NEW.is_large_order, OLD.is_large_order) THEN 'high'
            ELSE 'standard'
        END
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

CREATE TRIGGER audit_orders_changes 
    AFTER INSERT OR UPDATE OR DELETE ON orders 
    FOR EACH ROW 
    EXECUTE FUNCTION audit_order_changes();

-- =============================================================================
-- PERFORMANCE OPTIMIZATION SETTINGS
-- =============================================================================

-- Optimize for high-throughput operations
ALTER SYSTEM SET shared_buffers = '4GB';
ALTER SYSTEM SET effective_cache_size = '12GB';
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '64MB';
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET min_wal_size = '1GB';

-- Optimize for partitioned tables
ALTER SYSTEM SET enable_partition_pruning = on;
ALTER SYSTEM SET enable_partitionwise_join = on;
ALTER SYSTEM SET enable_partitionwise_aggregate = on;

-- Configure for heavy write workload
ALTER SYSTEM SET synchronous_commit = off;
ALTER SYSTEM SET commit_delay = 100;
ALTER SYSTEM SET commit_siblings = 10;

-- =============================================================================
-- MAINTENANCE PROCEDURES
-- =============================================================================

-- Function to create new monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partitions(table_name text, months_ahead integer DEFAULT 3)
RETURNS void AS $$
DECLARE
    start_date date;
    end_date date;
    partition_name text;
    i integer;
BEGIN
    FOR i IN 1..months_ahead LOOP
        start_date := date_trunc('month', CURRENT_DATE + (i * interval '1 month'));
        end_date := start_date + interval '1 month';
        partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
        
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                      partition_name, table_name, start_date, end_date);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions
CREATE OR REPLACE FUNCTION drop_old_partitions(table_name text, retention_months integer DEFAULT 24)
RETURNS void AS $$
DECLARE
    cutoff_date date;
    partition_name text;
    partition_record record;
BEGIN
    cutoff_date := date_trunc('month', CURRENT_DATE - (retention_months * interval '1 month'));
    
    FOR partition_record IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE tablename LIKE table_name || '_%'
        AND tablename ~ '\d{4}_\d{2}$'
    LOOP
        -- Extract date from partition name and check if it's old enough to drop
        IF to_date(right(partition_record.tablename, 7), 'YYYY_MM') < cutoff_date THEN
            EXECUTE format('DROP TABLE IF EXISTS %I.%I', partition_record.schemaname, partition_record.tablename);
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_performance_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY active_orders_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY token_pair_volume_24h;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- SECURITY AND PERMISSIONS
-- =============================================================================

-- Create roles for different access levels
CREATE ROLE settlement_app_read;
CREATE ROLE settlement_app_write;
CREATE ROLE settlement_admin;
CREATE ROLE settlement_auditor;

-- Grant appropriate permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO settlement_app_read;
GRANT SELECT, INSERT, UPDATE ON orders, user_balances, settlement_transactions TO settlement_app_write;
GRANT SELECT, INSERT ON audit_log, balance_updates TO settlement_app_write;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO settlement_admin;
GRANT SELECT ON audit_log, order_history TO settlement_auditor;

-- Row-level security for sensitive data
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_access_policy ON audit_log
    FOR ALL TO settlement_auditor
    USING (compliance_level != 'critical' OR pg_has_role('settlement_admin', 'member'));

-- =============================================================================
-- INITIAL DATA AND CONFIGURATION
-- =============================================================================

-- Insert configuration data
INSERT INTO order_metrics (
    timestamp, window_start, window_end, window_duration,
    total_orders, completed_orders, failed_orders, cancelled_orders,
    chain_id
) VALUES (
    NOW(), 
    date_trunc('hour', NOW() - INTERVAL '1 hour'),
    date_trunc('hour', NOW()),
    INTERVAL '1 hour',
    0, 0, 0, 0, 1
);

-- Create initial indexes statistics
ANALYZE orders;
ANALYZE user_balances;
ANALYZE settlement_transactions;
ANALYZE audit_log;

-- =============================================================================
-- MONITORING QUERIES
-- =============================================================================

-- Performance monitoring query
CREATE OR REPLACE VIEW performance_dashboard AS
SELECT 
    'Orders' as metric_type,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
    COUNT(*) FILTER (WHERE status = 'processing') as processing_count,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
    AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - created_at))) as avg_processing_seconds,
    MAX(created_at) as last_activity
FROM orders 
WHERE created_at > NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 
    'Settlements' as metric_type,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
    COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed_count,
    COUNT(*) FILTER (WHERE status = 'finalized') as finalized_count,
    AVG(gas_used) as avg_gas_used,
    MAX(created_at) as last_activity
FROM settlement_transactions 
WHERE created_at > NOW() - INTERVAL '1 hour';

-- Table size monitoring
CREATE OR REPLACE VIEW table_sizes AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

COMMENT ON DATABASE settlement_queue IS 'SettlementQueueV5 database optimized for millions of orders with comprehensive auditing and MEV protection';