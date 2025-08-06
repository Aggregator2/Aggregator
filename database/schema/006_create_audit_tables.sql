-- Audit log table with partitioning
CREATE TABLE audit_logs (
    id BIGSERIAL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id VARCHAR(42),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    old_value JSONB,
    new_value JSONB,
    ip_address INET,
    user_agent TEXT,
    api_key_id UUID,
    request_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- Create indexes for audit logs
CREATE INDEX idx_audit_logs_user_timestamp ON audit_logs (user_id, timestamp DESC);
CREATE INDEX idx_audit_logs_action_timestamp ON audit_logs (action, timestamp DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id, timestamp DESC);
CREATE INDEX idx_audit_logs_api_key ON audit_logs (api_key_id, timestamp DESC) 
    WHERE api_key_id IS NOT NULL;

-- Create audit log partitions (monthly)
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create partitions for last 3 months and next 3 months
    FOR i IN -2..3 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'audit_logs_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_logs
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;

-- System events table for monitoring
CREATE TABLE system_events (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    component VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(42),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for system events
CREATE INDEX idx_system_events_timestamp ON system_events (timestamp DESC);
CREATE INDEX idx_system_events_severity ON system_events (severity, timestamp DESC) 
    WHERE severity IN ('error', 'critical');
CREATE INDEX idx_system_events_unresolved ON system_events (severity, timestamp DESC) 
    WHERE resolved = FALSE;
CREATE INDEX idx_system_events_component ON system_events (component, timestamp DESC);

-- Performance metrics table
CREATE TABLE performance_metrics (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metric_name VARCHAR(100) NOT NULL,
    value DECIMAL(36,18) NOT NULL,
    unit VARCHAR(20),
    tags JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for performance metrics
CREATE INDEX idx_performance_metrics_name_time ON performance_metrics (metric_name, timestamp DESC);
CREATE INDEX idx_performance_metrics_tags ON performance_metrics USING GIN (tags);

-- Create hypertable for performance metrics (requires TimescaleDB)
-- SELECT create_hypertable('performance_metrics', 'timestamp', if_not_exists => TRUE);

-- Failed jobs table for retry handling
CREATE TABLE failed_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    error_message TEXT,
    stack_trace TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_retry_at TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for failed jobs
CREATE INDEX idx_failed_jobs_type ON failed_jobs (job_type, failed_at DESC);
CREATE INDEX idx_failed_jobs_retry ON failed_jobs (next_retry_at) 
    WHERE resolved = FALSE AND retry_count < max_retries;
CREATE INDEX idx_failed_jobs_unresolved ON failed_jobs (job_type, failed_at DESC) 
    WHERE resolved = FALSE;