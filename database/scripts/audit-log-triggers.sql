-- =============================================
-- SwappiQ Protocol Audit Log Triggers
-- =============================================
-- Comprehensive audit logging system for all critical tables
-- =============================================

-- =============================================
-- 1. AUDIT LOG INFRASTRUCTURE
-- =============================================

-- Create audit log table if not exists
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    operation VARCHAR(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    user_id UUID,
    username VARCHAR(100),
    client_ip INET,
    session_id UUID,
    
    -- Record identification
    record_id UUID NOT NULL,
    record_data JSONB,
    
    -- Change tracking
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    
    -- Metadata
    query_text TEXT,
    application_name TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexing
    CONSTRAINT chk_operation_data CHECK (
        (operation = 'INSERT' AND old_values IS NULL) OR
        (operation = 'DELETE' AND new_values IS NULL) OR
        (operation = 'UPDATE' AND old_values IS NOT NULL AND new_values IS NOT NULL)
    )
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_table_operation 
ON audit_log(table_name, operation, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id 
ON audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_record 
ON audit_log(table_name, record_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_created 
ON audit_log(created_at DESC);

-- GIN index for JSONB searches
CREATE INDEX IF NOT EXISTS idx_audit_log_changes 
ON audit_log USING gin(changed_fields);

-- =============================================
-- 2. AUDIT TRIGGER FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
    v_old_values JSONB;
    v_new_values JSONB;
    v_changed_fields TEXT[];
    v_user_id UUID;
    v_username VARCHAR(100);
    v_client_ip INET;
    v_session_id UUID;
    v_record_id UUID;
    v_excluded_columns TEXT[] := ARRAY['updatedAt', 'lastActivity'];
BEGIN
    -- Get session context (set by application)
    BEGIN
        v_user_id := current_setting('app.current_user_id')::UUID;
        v_username := current_setting('app.current_username');
        v_client_ip := current_setting('app.client_ip')::INET;
        v_session_id := current_setting('app.session_id')::UUID;
    EXCEPTION WHEN OTHERS THEN
        -- Use defaults if context not set
        v_user_id := NULL;
        v_username := current_user;
        v_client_ip := inet_client_addr();
        v_session_id := NULL;
    END;
    
    -- Determine operation and prepare data
    IF TG_OP = 'INSERT' THEN
        v_new_values := to_jsonb(NEW);
        v_record_id := (NEW.id)::UUID;
        v_changed_fields := ARRAY(SELECT jsonb_object_keys(v_new_values));
        
    ELSIF TG_OP = 'UPDATE' THEN
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
        v_record_id := (NEW.id)::UUID;
        
        -- Get only changed fields
        SELECT array_agg(key) INTO v_changed_fields
        FROM jsonb_each(v_old_values) o
        FULL OUTER JOIN jsonb_each(v_new_values) n USING (key)
        WHERE (o.value IS DISTINCT FROM n.value)
            AND key != ALL(v_excluded_columns);
        
        -- Skip if no actual changes
        IF v_changed_fields IS NULL OR array_length(v_changed_fields, 1) = 0 THEN
            RETURN NEW;
        END IF;
        
    ELSIF TG_OP = 'DELETE' THEN
        v_old_values := to_jsonb(OLD);
        v_record_id := (OLD.id)::UUID;
        v_changed_fields := ARRAY(SELECT jsonb_object_keys(v_old_values));
    END IF;
    
    -- Insert audit log entry
    INSERT INTO audit_log (
        table_name,
        operation,
        user_id,
        username,
        client_ip,
        session_id,
        record_id,
        record_data,
        old_values,
        new_values,
        changed_fields,
        query_text,
        application_name
    ) VALUES (
        TG_TABLE_NAME,
        TG_OP,
        v_user_id,
        v_username,
        v_client_ip,
        v_session_id,
        v_record_id,
        COALESCE(v_new_values, v_old_values),
        CASE WHEN TG_OP = 'UPDATE' THEN v_old_values ELSE NULL END,
        CASE WHEN TG_OP != 'DELETE' THEN v_new_values ELSE NULL END,
        v_changed_fields,
        current_query(),
        application_name()
    );
    
    -- Return appropriate value
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- 3. SPECIALIZED AUDIT FUNCTIONS
-- =============================================

-- Order audit with additional context
CREATE OR REPLACE FUNCTION audit_order_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_audit_id BIGINT;
    v_pair_symbol VARCHAR(20);
    v_user_email VARCHAR(255);
BEGIN
    -- Get additional context
    SELECT symbol INTO v_pair_symbol 
    FROM "TradingPair" WHERE id = COALESCE(NEW."pairId", OLD."pairId");
    
    SELECT email INTO v_user_email 
    FROM "User" WHERE id = COALESCE(NEW."userId", OLD."userId");
    
    -- Call main audit function
    PERFORM audit_trigger_function();
    
    -- Get the audit record just created
    SELECT id INTO v_audit_id FROM audit_log 
    WHERE table_name = 'Order' AND record_id = COALESCE(NEW.id, OLD.id)
    ORDER BY created_at DESC LIMIT 1;
    
    -- Add order-specific metadata
    UPDATE audit_log 
    SET record_data = record_data || 
        jsonb_build_object(
            'pair_symbol', v_pair_symbol,
            'user_email', v_user_email,
            'order_value', COALESCE(NEW.price * NEW.quantity, OLD.price * OLD.quantity)
        )
    WHERE id = v_audit_id;
    
    -- Log high-value orders to AuditLog table
    IF TG_OP = 'INSERT' AND NEW.price * NEW.quantity > 100000 THEN
        INSERT INTO "AuditLog" (
            id, "userId", action, category, severity,
            "ipAddress", metadata, "createdAt"
        ) VALUES (
            gen_random_uuid(),
            NEW."userId",
            'HIGH_VALUE_ORDER_PLACED',
            'TRADING',
            'HIGH',
            current_setting('app.client_ip', true)::INET,
            jsonb_build_object(
                'orderId', NEW.id,
                'pair', v_pair_symbol,
                'value', NEW.price * NEW.quantity,
                'side', NEW.side
            ),
            NOW()
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Balance audit with security checks
CREATE OR REPLACE FUNCTION audit_balance_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_change_amount DECIMAL(20, 8);
    v_change_type VARCHAR(20);
BEGIN
    -- Call main audit function
    PERFORM audit_trigger_function();
    
    -- Detect suspicious changes
    IF TG_OP = 'UPDATE' THEN
        -- Check for large withdrawals
        IF NEW.available < OLD.available THEN
            v_change_amount := OLD.available - NEW.available;
            v_change_type := 'WITHDRAWAL';
        ELSIF NEW.available > OLD.available THEN
            v_change_amount := NEW.available - OLD.available;
            v_change_type := 'DEPOSIT';
        END IF;
        
        -- Alert on large balance changes
        IF v_change_amount > 10000 THEN
            INSERT INTO "AuditLog" (
                id, "userId", action, category, severity,
                metadata, "createdAt"
            ) VALUES (
                gen_random_uuid(),
                NEW."userId",
                'LARGE_BALANCE_CHANGE',
                'SECURITY',
                'HIGH',
                jsonb_build_object(
                    'asset', NEW.asset,
                    'change_type', v_change_type,
                    'amount', v_change_amount,
                    'old_balance', OLD.available,
                    'new_balance', NEW.available
                ),
                NOW()
            );
        END IF;
        
        -- Check for impossible balance changes
        IF NEW.total != NEW.available + NEW.locked THEN
            RAISE EXCEPTION 'Balance integrity violation detected';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- User security audit
CREATE OR REPLACE FUNCTION audit_user_security_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Call main audit function
    PERFORM audit_trigger_function();
    
    -- Log security-relevant changes
    IF TG_OP = 'UPDATE' THEN
        -- KYC status change
        IF OLD."kycStatus" IS DISTINCT FROM NEW."kycStatus" THEN
            INSERT INTO "AuditLog" (
                id, "userId", action, category, severity,
                metadata, "createdAt"
            ) VALUES (
                gen_random_uuid(),
                NEW.id,
                'KYC_STATUS_CHANGE',
                'SECURITY',
                'MEDIUM',
                jsonb_build_object(
                    'old_status', OLD."kycStatus",
                    'new_status', NEW."kycStatus"
                ),
                NOW()
            );
        END IF;
        
        -- 2FA status change
        IF OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled" THEN
            INSERT INTO "AuditLog" (
                id, "userId", action, category, severity,
                metadata, "createdAt"
            ) VALUES (
                gen_random_uuid(),
                NEW.id,
                CASE WHEN NEW."twoFactorEnabled" 
                    THEN '2FA_ENABLED' 
                    ELSE '2FA_DISABLED' 
                END,
                'SECURITY',
                'HIGH',
                jsonb_build_object(
                    'ip_address', current_setting('app.client_ip', true)
                ),
                NOW()
            );
        END IF;
        
        -- Account status change
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            INSERT INTO "AuditLog" (
                id, "userId", action, category, severity,
                metadata, "createdAt"
            ) VALUES (
                gen_random_uuid(),
                NEW.id,
                'ACCOUNT_STATUS_CHANGE',
                'SECURITY',
                CASE WHEN NEW.status IN ('SUSPENDED', 'BANNED') 
                    THEN 'CRITICAL' 
                    ELSE 'HIGH' 
                END,
                jsonb_build_object(
                    'old_status', OLD.status,
                    'new_status', NEW.status
                ),
                NOW()
            );
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 4. CREATE AUDIT TRIGGERS
-- =============================================

-- User table
DROP TRIGGER IF EXISTS audit_user_changes ON "User";
CREATE TRIGGER audit_user_changes
    AFTER INSERT OR UPDATE OR DELETE ON "User"
    FOR EACH ROW EXECUTE FUNCTION audit_user_security_changes();

-- Order table
DROP TRIGGER IF EXISTS audit_order_changes ON "Order";
CREATE TRIGGER audit_order_changes
    AFTER INSERT OR UPDATE OR DELETE ON "Order"
    FOR EACH ROW EXECUTE FUNCTION audit_order_changes();

-- Trade table
DROP TRIGGER IF EXISTS audit_trade_changes ON "Trade";
CREATE TRIGGER audit_trade_changes
    AFTER INSERT OR UPDATE OR DELETE ON "Trade"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Balance table
DROP TRIGGER IF EXISTS audit_balance_changes ON "Balance";
CREATE TRIGGER audit_balance_changes
    AFTER INSERT OR UPDATE OR DELETE ON "Balance"
    FOR EACH ROW EXECUTE FUNCTION audit_balance_changes();

-- Transaction table
DROP TRIGGER IF EXISTS audit_transaction_changes ON "Transaction";
CREATE TRIGGER audit_transaction_changes
    AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- ApiKey table
DROP TRIGGER IF EXISTS audit_apikey_changes ON "ApiKey";
CREATE TRIGGER audit_apikey_changes
    AFTER INSERT OR UPDATE OR DELETE ON "ApiKey"
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- =============================================
-- 5. AUDIT ANALYSIS FUNCTIONS
-- =============================================

-- Function to get audit trail for a specific record
CREATE OR REPLACE FUNCTION get_audit_trail(
    p_table_name VARCHAR,
    p_record_id UUID,
    p_limit INT DEFAULT 100
)
RETURNS TABLE (
    audit_id BIGINT,
    operation VARCHAR,
    changed_fields TEXT[],
    old_values JSONB,
    new_values JSONB,
    user_id UUID,
    username VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.operation,
        a.changed_fields,
        a.old_values,
        a.new_values,
        a.user_id,
        a.username,
        a.created_at
    FROM audit_log a
    WHERE a.table_name = p_table_name
        AND a.record_id = p_record_id
    ORDER BY a.created_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get user activity summary
CREATE OR REPLACE FUNCTION get_user_activity_summary(
    p_user_id UUID,
    p_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '30 days',
    p_end_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE (
    table_name VARCHAR,
    operation VARCHAR,
    count BIGINT,
    last_activity TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.table_name,
        a.operation,
        COUNT(*) as count,
        MAX(a.created_at) as last_activity
    FROM audit_log a
    WHERE a.user_id = p_user_id
        AND a.created_at BETWEEN p_start_date AND p_end_date
    GROUP BY a.table_name, a.operation
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 6. AUDIT LOG MAINTENANCE
-- =============================================

-- Function to archive old audit logs
CREATE OR REPLACE FUNCTION archive_audit_logs(
    p_days_to_keep INT DEFAULT 90
)
RETURNS TABLE (
    archived_count BIGINT,
    deleted_count BIGINT
) AS $$
DECLARE
    v_cutoff_date TIMESTAMP WITH TIME ZONE;
    v_archived_count BIGINT;
    v_deleted_count BIGINT;
BEGIN
    v_cutoff_date := NOW() - (p_days_to_keep || ' days')::INTERVAL;
    
    -- Create archive table if not exists
    CREATE TABLE IF NOT EXISTS audit_log_archive (LIKE audit_log INCLUDING ALL);
    
    -- Archive old records
    WITH archived AS (
        INSERT INTO audit_log_archive
        SELECT * FROM audit_log
        WHERE created_at < v_cutoff_date
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_archived_count FROM archived;
    
    -- Delete archived records
    WITH deleted AS (
        DELETE FROM audit_log
        WHERE created_at < v_cutoff_date
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
    
    RETURN QUERY SELECT v_archived_count, v_deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 7. AUDIT REPORT VIEWS
-- =============================================

-- View for recent security events
CREATE OR REPLACE VIEW v_recent_security_events AS
SELECT 
    a.created_at,
    a.table_name,
    a.operation,
    a.user_id,
    a.username,
    a.client_ip,
    a.record_data->>'action' as action,
    a.changed_fields
FROM audit_log a
WHERE a.table_name IN ('User', 'ApiKey', 'Balance')
    AND (
        'status' = ANY(a.changed_fields) OR
        'kycStatus' = ANY(a.changed_fields) OR
        'twoFactorEnabled' = ANY(a.changed_fields) OR
        a.operation = 'DELETE'
    )
ORDER BY a.created_at DESC
LIMIT 1000;

-- View for high-value transactions
CREATE OR REPLACE VIEW v_high_value_audit AS
SELECT 
    a.created_at,
    a.table_name,
    a.operation,
    a.user_id,
    a.record_data->>'pair_symbol' as pair,
    (a.record_data->>'order_value')::DECIMAL as value,
    a.record_data->>'side' as side
FROM audit_log a
WHERE a.table_name = 'Order'
    AND (a.record_data->>'order_value')::DECIMAL > 10000
ORDER BY a.created_at DESC;

-- =============================================
-- 8. COMPLIANCE REPORTING
-- =============================================

-- Function for compliance report generation
CREATE OR REPLACE FUNCTION generate_compliance_report(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    report_section TEXT,
    metric_name TEXT,
    metric_value BIGINT
) AS $$
BEGIN
    -- User registrations
    RETURN QUERY
    SELECT 'User Activity', 'New Registrations', COUNT(*)
    FROM audit_log
    WHERE table_name = 'User' 
        AND operation = 'INSERT'
        AND created_at::DATE BETWEEN p_start_date AND p_end_date;
    
    -- KYC verifications
    RETURN QUERY
    SELECT 'Compliance', 'KYC Verifications', COUNT(*)
    FROM audit_log
    WHERE table_name = 'User'
        AND 'kycStatus' = ANY(changed_fields)
        AND new_values->>'kycStatus' = 'VERIFIED'
        AND created_at::DATE BETWEEN p_start_date AND p_end_date;
    
    -- Large transactions
    RETURN QUERY
    SELECT 'Trading', 'Large Orders (>$100k)', COUNT(*)
    FROM "AuditLog"
    WHERE action = 'HIGH_VALUE_ORDER_PLACED'
        AND "createdAt"::DATE BETWEEN p_start_date AND p_end_date;
    
    -- Security incidents
    RETURN QUERY
    SELECT 'Security', 'Account Suspensions', COUNT(*)
    FROM audit_log
    WHERE table_name = 'User'
        AND new_values->>'status' IN ('SUSPENDED', 'BANNED')
        AND created_at::DATE BETWEEN p_start_date AND p_end_date;
END;
$$ LANGUAGE plpgsql;