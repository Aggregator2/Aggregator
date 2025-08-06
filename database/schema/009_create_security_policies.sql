-- Row Level Security (RLS) policies for multi-tenant security

-- Enable RLS on sensitive tables
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Create application roles
CREATE ROLE app_user;
CREATE ROLE app_admin;
CREATE ROLE app_readonly;
CREATE ROLE app_settlement;

-- Grant base permissions
GRANT CONNECT ON DATABASE postgres TO app_user, app_admin, app_readonly, app_settlement;
GRANT USAGE ON SCHEMA public TO app_user, app_admin, app_readonly, app_settlement;

-- Grant table permissions
-- app_readonly: Read-only access to public data
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly;

-- app_user: Standard user operations
GRANT SELECT, INSERT, UPDATE ON orders TO app_user;
GRANT SELECT ON trades TO app_user;
GRANT SELECT, UPDATE ON user_balances TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO app_user;
GRANT SELECT ON trading_pairs, market_stats, candles TO app_user;

-- app_admin: Full access
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;

-- app_settlement: Settlement operations
GRANT SELECT, UPDATE ON trades TO app_settlement;
GRANT SELECT, INSERT, UPDATE ON settlement_batches TO app_settlement;
GRANT SELECT, INSERT, UPDATE, DELETE ON settlement_queue TO app_settlement;
GRANT SELECT, INSERT ON gas_prices TO app_settlement;

-- RLS Policies for orders
CREATE POLICY orders_user_policy ON orders
    FOR ALL
    TO app_user
    USING (user_id = current_setting('app.current_user_id')::VARCHAR);

CREATE POLICY orders_admin_policy ON orders
    FOR ALL
    TO app_admin
    USING (true);

-- RLS Policies for trades
CREATE POLICY trades_user_policy ON trades
    FOR SELECT
    TO app_user
    USING (
        maker_user_id = current_setting('app.current_user_id')::VARCHAR OR
        taker_user_id = current_setting('app.current_user_id')::VARCHAR
    );

CREATE POLICY trades_admin_policy ON trades
    FOR ALL
    TO app_admin
    USING (true);

-- RLS Policies for user_balances
CREATE POLICY balances_user_policy ON user_balances
    FOR ALL
    TO app_user
    USING (user_id = current_setting('app.current_user_id')::VARCHAR);

CREATE POLICY balances_admin_policy ON user_balances
    FOR ALL
    TO app_admin
    USING (true);

-- RLS Policies for api_keys
CREATE POLICY api_keys_user_policy ON api_keys
    FOR ALL
    TO app_user
    USING (user_id = current_setting('app.current_user_id')::VARCHAR);

CREATE POLICY api_keys_admin_policy ON api_keys
    FOR ALL
    TO app_admin
    USING (true);

-- Function to set current user context
CREATE OR REPLACE FUNCTION set_current_user_id(p_user_id VARCHAR)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_user_id', p_user_id, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Audit trigger for sensitive operations
CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
    v_user_id VARCHAR;
    v_action VARCHAR;
BEGIN
    v_user_id := current_setting('app.current_user_id', true);
    
    IF TG_OP = 'DELETE' THEN
        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;
        v_action := 'DELETE';
    ELSIF TG_OP = 'UPDATE' THEN
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
        v_action := 'UPDATE';
    ELSIF TG_OP = 'INSERT' THEN
        v_old_data := NULL;
        v_new_data := to_jsonb(NEW);
        v_action := 'INSERT';
    END IF;
    
    INSERT INTO audit_logs (
        user_id,
        action,
        entity_type,
        entity_id,
        old_value,
        new_value,
        ip_address,
        api_key_id,
        request_id
    ) VALUES (
        v_user_id,
        v_action,
        TG_TABLE_NAME,
        CASE 
            WHEN TG_OP = 'DELETE' THEN OLD.id::VARCHAR
            ELSE NEW.id::VARCHAR
        END,
        v_old_data,
        v_new_data,
        inet(current_setting('app.client_ip', true)),
        current_setting('app.api_key_id', true)::UUID,
        current_setting('app.request_id', true)::UUID
    );
    
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit triggers to sensitive tables
CREATE TRIGGER audit_orders
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_trades
    AFTER INSERT OR UPDATE ON trades
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_user_balances
    AFTER UPDATE ON user_balances
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER audit_api_keys
    AFTER INSERT OR UPDATE OR DELETE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Security functions
CREATE OR REPLACE FUNCTION check_api_key_permissions(
    p_key_hash VARCHAR,
    p_required_permission VARCHAR
)
RETURNS BOOLEAN AS $$
DECLARE
    v_permissions JSONB;
    v_user_id VARCHAR;
    v_status VARCHAR;
BEGIN
    SELECT 
        permissions,
        user_id,
        status
    INTO 
        v_permissions,
        v_user_id,
        v_status
    FROM api_keys
    WHERE key_hash = p_key_hash
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW());
    
    IF v_user_id IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Set user context
    PERFORM set_config('app.current_user_id', v_user_id, false);
    
    -- Check if permission exists in array
    RETURN v_permissions ? p_required_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rate limiting function
CREATE OR REPLACE FUNCTION check_rate_limit(
    p_key_hash VARCHAR,
    p_increment INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
    v_rate_limit INTEGER;
    v_daily_limit INTEGER;
    v_current_count INTEGER;
    v_daily_count INTEGER;
BEGIN
    -- Get rate limits
    SELECT 
        rate_limit,
        daily_limit
    INTO 
        v_rate_limit,
        v_daily_limit
    FROM api_keys
    WHERE key_hash = p_key_hash
        AND status = 'active';
    
    IF v_rate_limit IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Check rate limits (simplified - in production use Redis)
    -- This is a placeholder for actual rate limiting logic
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Data masking function for sensitive data
CREATE OR REPLACE FUNCTION mask_user_id(p_user_id VARCHAR)
RETURNS VARCHAR AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Show first 6 and last 4 characters
    RETURN SUBSTRING(p_user_id, 1, 6) || '...' || SUBSTRING(p_user_id, LENGTH(p_user_id) - 3, 4);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create secure views with data masking
CREATE OR REPLACE VIEW public_trades AS
SELECT 
    id,
    pair,
    mask_user_id(maker_user_id) as maker_user_id,
    mask_user_id(taker_user_id) as taker_user_id,
    price,
    amount,
    side,
    executed_at
FROM trades
WHERE settlement_status = 'settled';

GRANT SELECT ON public_trades TO app_readonly;