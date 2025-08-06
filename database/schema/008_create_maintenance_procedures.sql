-- Maintenance procedures for automated database upkeep

-- Function to create new partitions automatically
CREATE OR REPLACE FUNCTION maintain_partitions()
RETURNS VOID AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_partition_name TEXT;
    v_table_name TEXT;
    v_months_ahead INTEGER := 3;
BEGIN
    -- Array of partitioned tables
    FOR v_table_name IN SELECT unnest(ARRAY['orders', 'trades', 'candles', 'audit_logs']) LOOP
        -- Create future partitions
        FOR i IN 1..v_months_ahead LOOP
            v_start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month' * i);
            v_end_date := v_start_date + INTERVAL '1 month';
            v_partition_name := v_table_name || '_' || TO_CHAR(v_start_date, 'YYYY_MM');
            
            IF NOT EXISTS (
                SELECT 1 FROM pg_tables 
                WHERE schemaname = 'public' 
                AND tablename = v_partition_name
            ) THEN
                EXECUTE format('
                    CREATE TABLE %I PARTITION OF %I
                    FOR VALUES FROM (%L) TO (%L)',
                    v_partition_name, v_table_name, v_start_date, v_end_date
                );
                
                RAISE NOTICE 'Created partition: % for table: %', v_partition_name, v_table_name;
            END IF;
        END LOOP;
    END LOOP;
    
    -- Special handling for orderbook_snapshots (daily partitions)
    FOR i IN 1..7 LOOP
        v_start_date := CURRENT_DATE + i;
        v_end_date := v_start_date + 1;
        v_partition_name := 'orderbook_snapshots_' || TO_CHAR(v_start_date, 'YYYY_MM_DD');
        
        IF NOT EXISTS (
            SELECT 1 FROM pg_tables 
            WHERE schemaname = 'public' 
            AND tablename = v_partition_name
        ) THEN
            EXECUTE format('
                CREATE TABLE %I PARTITION OF orderbook_snapshots
                FOR VALUES FROM (%L) TO (%L)',
                v_partition_name, v_start_date, v_end_date
            );
            
            RAISE NOTICE 'Created daily partition: %', v_partition_name;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to drop old partitions
CREATE OR REPLACE FUNCTION drop_old_partitions(
    p_table_name TEXT,
    p_retention_months INTEGER DEFAULT 12
)
RETURNS VOID AS $$
DECLARE
    v_partition RECORD;
    v_drop_before DATE;
BEGIN
    v_drop_before := DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month' * p_retention_months);
    
    FOR v_partition IN 
        SELECT 
            schemaname,
            tablename
        FROM pg_tables
        WHERE schemaname = 'public'
            AND tablename LIKE p_table_name || '_%'
            AND tablename ~ '[0-9]{4}_[0-9]{2}$'
    LOOP
        -- Extract date from partition name
        IF TO_DATE(RIGHT(v_partition.tablename, 7), 'YYYY_MM') < v_drop_before THEN
            EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', 
                v_partition.schemaname, v_partition.tablename);
            RAISE NOTICE 'Dropped old partition: %.%', 
                v_partition.schemaname, v_partition.tablename;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to analyze and vacuum tables
CREATE OR REPLACE FUNCTION vacuum_analyze_tables()
RETURNS VOID AS $$
DECLARE
    v_table RECORD;
BEGIN
    FOR v_table IN 
        SELECT 
            schemaname,
            tablename
        FROM pg_tables
        WHERE schemaname = 'public'
            AND tablename NOT LIKE 'pg_%'
    LOOP
        EXECUTE format('VACUUM ANALYZE %I.%I', v_table.schemaname, v_table.tablename);
        RAISE NOTICE 'Vacuumed and analyzed: %.%', v_table.schemaname, v_table.tablename;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Function to update table statistics
CREATE OR REPLACE FUNCTION update_table_statistics()
RETURNS TABLE (
    table_name TEXT,
    row_count BIGINT,
    total_size TEXT,
    index_size TEXT,
    toast_size TEXT,
    last_vacuum TIMESTAMPTZ,
    last_analyze TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname||'.'||tablename AS table_name,
        n_live_tup AS row_count,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
        pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) AS index_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - 
                      pg_relation_size(schemaname||'.'||tablename) - 
                      pg_indexes_size(schemaname||'.'||tablename)) AS toast_size,
        last_vacuum,
        last_analyze
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to check index usage
CREATE OR REPLACE FUNCTION check_index_usage()
RETURNS TABLE (
    table_name TEXT,
    index_name TEXT,
    index_size TEXT,
    index_scans BIGINT,
    tuples_read BIGINT,
    tuples_fetched BIGINT,
    usage_ratio NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname||'.'||tablename AS table_name,
        indexname AS index_name,
        pg_size_pretty(pg_relation_size(schemaname||'.'||indexname::text)) AS index_size,
        idx_scan AS index_scans,
        idx_tup_read AS tuples_read,
        idx_tup_fetch AS tuples_fetched,
        CASE 
            WHEN idx_scan = 0 THEN 0
            ELSE ROUND((idx_tup_fetch::NUMERIC / idx_scan::NUMERIC), 2)
        END AS usage_ratio
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan ASC;
END;
$$ LANGUAGE plpgsql;

-- Scheduled maintenance job
CREATE OR REPLACE FUNCTION perform_scheduled_maintenance()
RETURNS VOID AS $$
DECLARE
    v_expired_count INTEGER;
    v_start_time TIMESTAMPTZ;
    v_end_time TIMESTAMPTZ;
BEGIN
    v_start_time := clock_timestamp();
    
    -- 1. Create new partitions
    PERFORM maintain_partitions();
    
    -- 2. Clean up expired orders
    v_expired_count := cleanup_expired_orders();
    RAISE NOTICE 'Cleaned up % expired orders', v_expired_count;
    
    -- 3. Update market statistics for all active pairs
    PERFORM update_market_stats(pair) 
    FROM trading_pairs 
    WHERE status = 'active';
    
    -- 4. Drop old partitions (keep 12 months)
    PERFORM drop_old_partitions('orders', 12);
    PERFORM drop_old_partitions('trades', 12);
    PERFORM drop_old_partitions('candles', 12);
    PERFORM drop_old_partitions('audit_logs', 6);
    PERFORM drop_old_partitions('orderbook_snapshots', 30); -- 30 days for snapshots
    
    -- 5. Vacuum and analyze heavily used tables
    VACUUM ANALYZE orders;
    VACUUM ANALYZE trades;
    VACUUM ANALYZE market_stats;
    
    v_end_time := clock_timestamp();
    
    -- Log maintenance completion
    INSERT INTO system_events (event_type, severity, component, message, details)
    VALUES (
        'maintenance_completed',
        'info',
        'database',
        'Scheduled maintenance completed successfully',
        jsonb_build_object(
            'duration_ms', EXTRACT(MILLISECOND FROM (v_end_time - v_start_time)),
            'expired_orders_cleaned', v_expired_count,
            'timestamp', v_end_time
        )
    );
END;
$$ LANGUAGE plpgsql;

-- Create scheduled jobs using pg_cron (if available)
-- Note: Requires pg_cron extension to be installed
/*
-- Create extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule maintenance jobs
SELECT cron.schedule('maintain-partitions', '0 1 * * *', 'SELECT maintain_partitions()');
SELECT cron.schedule('cleanup-expired-orders', '*/15 * * * *', 'SELECT cleanup_expired_orders()');
SELECT cron.schedule('update-market-stats', '* * * * *', 'SELECT update_market_stats(pair) FROM trading_pairs WHERE status = ''active''');
SELECT cron.schedule('full-maintenance', '0 3 * * 0', 'SELECT perform_scheduled_maintenance()');
SELECT cron.schedule('vacuum-analyze', '0 4 * * *', 'SELECT vacuum_analyze_tables()');
*/