-- SettlementQueue Database Partition Management
-- Automated partition creation and maintenance for high-volume tables
-- Version: 1.0

-- =============================================================================
-- PARTITION MANAGEMENT SYSTEM
-- =============================================================================

-- Create schema for partition management
CREATE SCHEMA IF NOT EXISTS partition_mgmt;

-- Table to track partition configurations
CREATE TABLE partition_mgmt.partition_config (
    id                      SERIAL PRIMARY KEY,
    table_schema            TEXT NOT NULL DEFAULT 'public',
    table_name              TEXT NOT NULL,
    partition_type          TEXT NOT NULL CHECK (partition_type IN ('range', 'list', 'hash')),
    partition_column        TEXT NOT NULL,
    partition_interval      INTERVAL, -- For time-based partitions
    retention_period        INTERVAL, -- How long to keep old partitions
    pre_create_partitions   INTEGER DEFAULT 3, -- How many future partitions to create
    
    -- Automation settings
    auto_create_enabled     BOOLEAN DEFAULT TRUE,
    auto_drop_enabled       BOOLEAN DEFAULT FALSE,
    last_maintenance        TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT partition_config_unique UNIQUE (table_schema, table_name)
);

-- Insert configuration for our main tables
INSERT INTO partition_mgmt.partition_config (
    table_name, partition_type, partition_column, partition_interval, 
    retention_period, pre_create_partitions, auto_drop_enabled
) VALUES 
    ('orders', 'range', 'created_at', '1 month', '2 years', 3, true),
    ('order_history', 'range', 'completed_at', '1 year', '7 years', 2, false),
    ('settlement_transactions', 'range', 'created_at', '1 month', '2 years', 3, true),
    ('balance_updates', 'range', 'created_at', '1 month', '1 year', 3, true),
    ('audit_log', 'range', 'timestamp', '1 month', '7 years', 3, false),
    ('order_metrics', 'range', 'timestamp', '1 month', '1 year', 3, true);

-- =============================================================================
-- AUTOMATED PARTITION CREATION FUNCTIONS
-- =============================================================================

-- Function to generate partition name
CREATE OR REPLACE FUNCTION partition_mgmt.generate_partition_name(
    p_table_name TEXT,
    p_start_date DATE
) RETURNS TEXT AS $$
BEGIN
    RETURN p_table_name || '_' || to_char(p_start_date, 'YYYY_MM');
END;
$$ LANGUAGE plpgsql;

-- Function to create a single partition
CREATE OR REPLACE FUNCTION partition_mgmt.create_partition(
    p_schema_name TEXT,
    p_table_name TEXT,
    p_start_date DATE,
    p_end_date DATE
) RETURNS TEXT AS $$
DECLARE
    partition_name TEXT;
    sql_command TEXT;
BEGIN
    partition_name := partition_mgmt.generate_partition_name(p_table_name, p_start_date);
    
    sql_command := format(
        'CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %I.%I FOR VALUES FROM (%L) TO (%L)',
        p_schema_name, partition_name, p_schema_name, p_table_name, p_start_date, p_end_date
    );
    
    EXECUTE sql_command;
    
    -- Add indexes specific to this partition if needed
    PERFORM partition_mgmt.create_partition_indexes(p_schema_name, partition_name, p_table_name);
    
    RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Function to create partition-specific indexes
CREATE OR REPLACE FUNCTION partition_mgmt.create_partition_indexes(
    p_schema_name TEXT,
    p_partition_name TEXT,
    p_base_table_name TEXT
) RETURNS void AS $$
DECLARE
    index_sql TEXT;
BEGIN
    -- Create partition-specific indexes based on base table
    CASE p_base_table_name
        WHEN 'orders' THEN
            -- High-frequency query indexes for orders
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (trader_address, status) WHERE status != ''completed''',
                         'idx_' || p_partition_name || '_trader_status', p_schema_name, p_partition_name);
            
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (status, priority DESC) WHERE status IN (''revealed'', ''processing'')',
                         'idx_' || p_partition_name || '_status_priority', p_schema_name, p_partition_name);
                         
        WHEN 'settlement_transactions' THEN
            -- Settlement-specific indexes
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (block_number DESC, log_index)',
                         'idx_' || p_partition_name || '_block', p_schema_name, p_partition_name);
                         
        WHEN 'audit_log' THEN
            -- Audit trail indexes
            EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (entity_type, entity_id)',
                         'idx_' || p_partition_name || '_entity', p_schema_name, p_partition_name);
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to create future partitions
CREATE OR REPLACE FUNCTION partition_mgmt.create_future_partitions(
    p_config_id INTEGER DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    config_rec partition_mgmt.partition_config%ROWTYPE;
    current_date DATE;
    start_date DATE;
    end_date DATE;
    partitions_created INTEGER := 0;
    i INTEGER;
BEGIN
    -- Process all configurations or specific one
    FOR config_rec IN 
        SELECT * FROM partition_mgmt.partition_config 
        WHERE (p_config_id IS NULL OR id = p_config_id)
        AND auto_create_enabled = true
        AND partition_type = 'range'
    LOOP
        current_date := CURRENT_DATE;
        
        -- Create future partitions based on configuration
        FOR i IN 1..config_rec.pre_create_partitions LOOP
            CASE 
                WHEN config_rec.partition_interval = '1 month' THEN
                    start_date := date_trunc('month', current_date + (i * interval '1 month'))::DATE;
                    end_date := (start_date + interval '1 month')::DATE;
                WHEN config_rec.partition_interval = '1 year' THEN
                    start_date := date_trunc('year', current_date + (i * interval '1 year'))::DATE;
                    end_date := (start_date + interval '1 year')::DATE;
                ELSE
                    CONTINUE; -- Skip unsupported intervals
            END CASE;
            
            -- Check if partition already exists
            IF NOT EXISTS (
                SELECT 1 FROM pg_tables 
                WHERE schemaname = config_rec.table_schema 
                AND tablename = partition_mgmt.generate_partition_name(config_rec.table_name, start_date)
            ) THEN
                PERFORM partition_mgmt.create_partition(
                    config_rec.table_schema,
                    config_rec.table_name,
                    start_date,
                    end_date
                );
                partitions_created := partitions_created + 1;
            END IF;
        END LOOP;
        
        -- Update last maintenance timestamp
        UPDATE partition_mgmt.partition_config 
        SET last_maintenance = NOW() 
        WHERE id = config_rec.id;
    END LOOP;
    
    RETURN partitions_created;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions
CREATE OR REPLACE FUNCTION partition_mgmt.drop_old_partitions(
    p_config_id INTEGER DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
    config_rec partition_mgmt.partition_config%ROWTYPE;
    partition_rec RECORD;
    cutoff_date DATE;
    partition_date DATE;
    partitions_dropped INTEGER := 0;
    partition_name_pattern TEXT;
BEGIN
    FOR config_rec IN 
        SELECT * FROM partition_mgmt.partition_config 
        WHERE (p_config_id IS NULL OR id = p_config_id)
        AND auto_drop_enabled = true
        AND retention_period IS NOT NULL
    LOOP
        cutoff_date := CURRENT_DATE - config_rec.retention_period;
        partition_name_pattern := config_rec.table_name || '_%';
        
        -- Find partitions to drop
        FOR partition_rec IN 
            SELECT schemaname, tablename 
            FROM pg_tables 
            WHERE schemaname = config_rec.table_schema
            AND tablename LIKE partition_name_pattern
            AND tablename ~ '\d{4}_\d{2}$'
        LOOP
            -- Extract date from partition name
            BEGIN
                partition_date := to_date(right(partition_rec.tablename, 7), 'YYYY_MM');
                
                IF partition_date < cutoff_date THEN
                    -- Archive data before dropping if needed
                    PERFORM partition_mgmt.archive_partition_data(
                        partition_rec.schemaname, 
                        partition_rec.tablename,
                        config_rec.table_name
                    );
                    
                    -- Drop the partition
                    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', 
                                 partition_rec.schemaname, partition_rec.tablename);
                    
                    partitions_dropped := partitions_dropped + 1;
                    
                    -- Log the action
                    INSERT INTO partition_mgmt.partition_log (
                        action, table_schema, table_name, partition_name, executed_at
                    ) VALUES (
                        'DROP', partition_rec.schemaname, config_rec.table_name, 
                        partition_rec.tablename, NOW()
                    );
                END IF;
            EXCEPTION
                WHEN OTHERS THEN
                    -- Skip partitions with invalid date formats
                    CONTINUE;
            END;
        END LOOP;
    END LOOP;
    
    RETURN partitions_dropped;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PARTITION ARCHIVAL SYSTEM
-- =============================================================================

-- Table to track partition operations
CREATE TABLE partition_mgmt.partition_log (
    id                      SERIAL PRIMARY KEY,
    action                  TEXT NOT NULL CHECK (action IN ('CREATE', 'DROP', 'ARCHIVE')),
    table_schema            TEXT NOT NULL,
    table_name              TEXT NOT NULL,
    partition_name          TEXT NOT NULL,
    executed_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    execution_time          INTERVAL,
    row_count               BIGINT,
    size_bytes              BIGINT,
    notes                   TEXT
);

-- Function to archive partition data before dropping
CREATE OR REPLACE FUNCTION partition_mgmt.archive_partition_data(
    p_schema_name TEXT,
    p_partition_name TEXT,
    p_base_table_name TEXT
) RETURNS void AS $$
DECLARE
    archive_table_name TEXT;
    row_count BIGINT;
    table_size BIGINT;
BEGIN
    -- Generate archive table name
    archive_table_name := 'archive_' || p_partition_name;
    
    -- Get current statistics
    SELECT 
        n_tup_ins + n_tup_upd + n_tup_del,
        pg_total_relation_size(p_schema_name || '.' || p_partition_name)
    INTO row_count, table_size
    FROM pg_stat_user_tables 
    WHERE schemaname = p_schema_name AND relname = p_partition_name;
    
    -- Create archive table (optional - depends on requirements)
    -- EXECUTE format('CREATE TABLE %I.%I AS SELECT * FROM %I.%I', 
    --              'archive', archive_table_name, p_schema_name, p_partition_name);
    
    -- Log the archival
    INSERT INTO partition_mgmt.partition_log (
        action, table_schema, table_name, partition_name, 
        row_count, size_bytes, notes
    ) VALUES (
        'ARCHIVE', p_schema_name, p_base_table_name, p_partition_name,
        row_count, table_size, 'Data archived before partition drop'
    );
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PARTITION MAINTENANCE AUTOMATION
-- =============================================================================

-- Main maintenance function to be called by cron
CREATE OR REPLACE FUNCTION partition_mgmt.perform_maintenance()
RETURNS TABLE(
    action TEXT,
    table_name TEXT,
    partitions_affected INTEGER,
    execution_time INTERVAL
) AS $$
DECLARE
    start_time TIMESTAMP WITH TIME ZONE;
    end_time TIMESTAMP WITH TIME ZONE;
    created_count INTEGER;
    dropped_count INTEGER;
BEGIN
    -- Create future partitions
    start_time := clock_timestamp();
    created_count := partition_mgmt.create_future_partitions();
    end_time := clock_timestamp();
    
    RETURN QUERY SELECT 
        'CREATE'::TEXT, 
        'ALL_TABLES'::TEXT, 
        created_count, 
        end_time - start_time;
    
    -- Drop old partitions
    start_time := clock_timestamp();
    dropped_count := partition_mgmt.drop_old_partitions();
    end_time := clock_timestamp();
    
    RETURN QUERY SELECT 
        'DROP'::TEXT, 
        'ALL_TABLES'::TEXT, 
        dropped_count, 
        end_time - start_time;
        
    -- Update statistics
    PERFORM partition_mgmt.update_partition_statistics();
    
    RETURN QUERY SELECT 
        'ANALYZE'::TEXT, 
        'ALL_PARTITIONS'::TEXT, 
        0, 
        INTERVAL '0';
END;
$$ LANGUAGE plpgsql;

-- Function to update partition statistics
CREATE OR REPLACE FUNCTION partition_mgmt.update_partition_statistics()
RETURNS void AS $$
DECLARE
    partition_rec RECORD;
BEGIN
    -- Analyze all partition tables for optimal query planning
    FOR partition_rec IN 
        SELECT schemaname, tablename 
        FROM pg_tables 
        WHERE schemaname = 'public'
        AND (tablename LIKE 'orders_%' 
             OR tablename LIKE 'settlement_transactions_%'
             OR tablename LIKE 'balance_updates_%'
             OR tablename LIKE 'audit_log_%'
             OR tablename LIKE 'order_metrics_%')
    LOOP
        EXECUTE format('ANALYZE %I.%I', partition_rec.schemaname, partition_rec.tablename);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PARTITION MONITORING AND HEALTH CHECKS
-- =============================================================================

-- View for partition health monitoring
CREATE OR REPLACE VIEW partition_mgmt.partition_health AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes,
    (SELECT COUNT(*) FROM information_schema.table_constraints 
     WHERE table_schema = schemaname AND table_name = tablename 
     AND constraint_type = 'CHECK') as constraints_count,
    (SELECT COUNT(*) FROM pg_indexes 
     WHERE schemaname = schemaname AND tablename = tablename) as indexes_count,
    CASE 
        WHEN tablename ~ '\d{4}_\d{2}$' THEN
            to_date(right(tablename, 7), 'YYYY_MM')
        ELSE NULL
    END as partition_date,
    NOW() - CASE 
        WHEN tablename ~ '\d{4}_\d{2}$' THEN
            to_date(right(tablename, 7), 'YYYY_MM')
        ELSE NULL
    END as age
FROM pg_tables 
WHERE schemaname = 'public'
AND (tablename LIKE 'orders_%' 
     OR tablename LIKE 'settlement_transactions_%'
     OR tablename LIKE 'balance_updates_%'
     OR tablename LIKE 'audit_log_%'
     OR tablename LIKE 'order_metrics_%'
     OR tablename LIKE 'order_history_%')
ORDER BY size_bytes DESC;

-- Function to check partition health
CREATE OR REPLACE FUNCTION partition_mgmt.check_partition_health()
RETURNS TABLE(
    issue_type TEXT,
    table_name TEXT,
    partition_name TEXT,
    description TEXT,
    severity TEXT
) AS $$
BEGIN
    -- Check for missing future partitions
    RETURN QUERY
    WITH future_dates AS (
        SELECT 
            pc.table_name,
            generate_series(
                date_trunc('month', CURRENT_DATE + interval '1 month'),
                date_trunc('month', CURRENT_DATE + (pc.pre_create_partitions * pc.partition_interval)),
                pc.partition_interval
            )::date as future_date
        FROM partition_mgmt.partition_config pc
        WHERE pc.auto_create_enabled = true
    )
    SELECT 
        'MISSING_PARTITION'::TEXT,
        fd.table_name,
        partition_mgmt.generate_partition_name(fd.table_name, fd.future_date),
        'Missing future partition for ' || fd.future_date::text,
        'MEDIUM'::TEXT
    FROM future_dates fd
    LEFT JOIN pg_tables pt ON (
        pt.schemaname = 'public' 
        AND pt.tablename = partition_mgmt.generate_partition_name(fd.table_name, fd.future_date)
    )
    WHERE pt.tablename IS NULL;
    
    -- Check for oversized partitions
    RETURN QUERY
    SELECT 
        'OVERSIZED_PARTITION'::TEXT,
        SPLIT_PART(ph.tablename, '_', 1),
        ph.tablename,
        'Partition size ' || ph.size || ' exceeds recommended 10GB',
        CASE 
            WHEN ph.size_bytes > 50000000000 THEN 'HIGH'::TEXT
            WHEN ph.size_bytes > 20000000000 THEN 'MEDIUM'::TEXT
            ELSE 'LOW'::TEXT
        END
    FROM partition_mgmt.partition_health ph
    WHERE ph.size_bytes > 10000000000; -- 10GB threshold
    
    -- Check for old partitions that should be dropped
    RETURN QUERY
    SELECT 
        'OLD_PARTITION'::TEXT,
        SPLIT_PART(ph.tablename, '_', 1),
        ph.tablename,
        'Partition is ' || ph.age::text || ' old and may need archival',
        CASE 
            WHEN ph.age > interval '3 years' THEN 'HIGH'::TEXT
            WHEN ph.age > interval '1 year' THEN 'MEDIUM'::TEXT
            ELSE 'LOW'::TEXT
        END
    FROM partition_mgmt.partition_health ph
    WHERE ph.age > interval '6 months'
    AND ph.partition_date IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- AUTOMATED SCHEDULING SETUP
-- =============================================================================

-- Create a function for cron job execution
CREATE OR REPLACE FUNCTION partition_mgmt.daily_maintenance()
RETURNS void AS $$
DECLARE
    result_rec RECORD;
BEGIN
    -- Log maintenance start
    INSERT INTO partition_mgmt.partition_log (action, table_schema, table_name, partition_name, notes)
    VALUES ('MAINTENANCE', 'partition_mgmt', 'daily_maintenance', 'system', 'Daily maintenance started');
    
    -- Perform maintenance
    FOR result_rec IN SELECT * FROM partition_mgmt.perform_maintenance() LOOP
        -- Log each action
        INSERT INTO partition_mgmt.partition_log (
            action, table_schema, table_name, partition_name, notes, execution_time
        ) VALUES (
            result_rec.action, 'public', result_rec.table_name, 'bulk_operation',
            result_rec.partitions_affected || ' partitions affected', result_rec.execution_time
        );
    END LOOP;
    
    -- Log maintenance completion
    INSERT INTO partition_mgmt.partition_log (action, table_schema, table_name, partition_name, notes)
    VALUES ('MAINTENANCE', 'partition_mgmt', 'daily_maintenance', 'system', 'Daily maintenance completed');
END;
$$ LANGUAGE plpgsql;

-- Grant permissions for automation
GRANT USAGE ON SCHEMA partition_mgmt TO settlement_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA partition_mgmt TO settlement_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA partition_mgmt TO settlement_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partition_mgmt TO settlement_admin;

-- =============================================================================
-- INITIAL SETUP AND TESTING
-- =============================================================================

-- Test the partition creation system
DO $$
DECLARE
    created_count INTEGER;
BEGIN
    -- Create initial future partitions
    created_count := partition_mgmt.create_future_partitions();
    RAISE NOTICE 'Created % future partitions', created_count;
    
    -- Run health check
    PERFORM partition_mgmt.update_partition_statistics();
    RAISE NOTICE 'Updated partition statistics';
END;
$$;

-- Example cron job command (to be added to system cron):
-- 0 2 * * * psql -d settlement_queue -c "SELECT partition_mgmt.daily_maintenance();"

COMMENT ON SCHEMA partition_mgmt IS 'Automated partition management system for SettlementQueue database';