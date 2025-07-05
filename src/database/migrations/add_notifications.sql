-- Notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    channel ENUM('email', 'webhook', 'websocket', 'sms') NOT NULL,
    enabled BOOLEAN DEFAULT true,
    
    -- Email preferences
    email_address VARCHAR(255),
    email_verified BOOLEAN DEFAULT false,
    
    -- Webhook preferences
    webhook_url TEXT,
    webhook_secret VARCHAR(255),
    webhook_active BOOLEAN DEFAULT true,
    
    -- SMS preferences
    phone_number VARCHAR(20),
    phone_verified BOOLEAN DEFAULT false,
    
    -- Event subscriptions
    order_created BOOLEAN DEFAULT true,
    order_filled BOOLEAN DEFAULT true,
    order_partially_filled BOOLEAN DEFAULT true,
    order_cancelled BOOLEAN DEFAULT true,
    order_rejected BOOLEAN DEFAULT false,
    trade_executed BOOLEAN DEFAULT true,
    settlement_completed BOOLEAN DEFAULT true,
    deposit_received BOOLEAN DEFAULT true,
    withdrawal_completed BOOLEAN DEFAULT true,
    
    -- Delivery preferences
    batch_notifications BOOLEAN DEFAULT false,
    batch_interval_minutes INTEGER DEFAULT 5,
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_user_channel (user_id, channel),
    INDEX idx_user_id (user_id),
    INDEX idx_channel_enabled (channel, enabled)
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    type ENUM('order', 'trade', 'settlement', 'deposit', 'withdrawal', 'system') NOT NULL,
    event VARCHAR(50) NOT NULL, -- order_filled, trade_executed, etc.
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    data JSONB, -- Additional data like order details
    
    -- Status tracking
    read BOOLEAN DEFAULT false,
    read_at TIMESTAMP WITH TIME ZONE,
    archived BOOLEAN DEFAULT false,
    
    -- Delivery tracking
    channels JSONB DEFAULT '[]', -- Array of channels to deliver to
    delivery_status JSONB DEFAULT '{}', -- Status per channel
    
    -- Priority and grouping
    priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
    group_id VARCHAR(255), -- For grouping related notifications
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    INDEX idx_user_unread (user_id, read),
    INDEX idx_user_created (user_id, created_at DESC),
    INDEX idx_type_event (type, event),
    INDEX idx_group_id (group_id),
    INDEX idx_expires_at (expires_at)
);

-- Webhook delivery attempts table
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    webhook_url TEXT NOT NULL,
    
    -- Delivery details
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status ENUM('pending', 'success', 'failed', 'abandoned') DEFAULT 'pending',
    status_code INTEGER,
    response_body TEXT,
    error_message TEXT,
    
    -- Timing
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempted_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    INDEX idx_status_scheduled (status, scheduled_at),
    INDEX idx_notification_id (notification_id),
    INDEX idx_next_retry (next_retry_at)
);

-- Notification templates table
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    event VARCHAR(50) NOT NULL,
    channel ENUM('email', 'webhook', 'websocket', 'sms') NOT NULL,
    
    -- Template content
    title_template TEXT NOT NULL,
    message_template TEXT NOT NULL,
    data_schema JSONB, -- Expected data structure
    
    -- Metadata
    active BOOLEAN DEFAULT true,
    version INTEGER DEFAULT 1,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE KEY unique_type_event_channel (type, event, channel)
);

-- User notification settings (per-notification overrides)
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    notification_id UUID NOT NULL,
    
    -- User actions
    starred BOOLEAN DEFAULT false,
    snoozed_until TIMESTAMP WITH TIME ZONE,
    
    -- Custom settings
    custom_sound VARCHAR(50),
    custom_priority ENUM('low', 'medium', 'high', 'urgent'),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_notification (user_id, notification_id)
);

-- Views for easy querying
CREATE OR REPLACE VIEW v_unread_notifications AS
SELECT 
    n.id,
    n.user_id,
    n.type,
    n.event,
    n.title,
    n.message,
    n.data,
    n.priority,
    n.created_at,
    COUNT(*) OVER (PARTITION BY n.user_id) as unread_count
FROM notifications n
WHERE n.read = false 
    AND n.archived = false
    AND (n.expires_at IS NULL OR n.expires_at > CURRENT_TIMESTAMP)
ORDER BY n.created_at DESC;

-- Function to get user's notification preferences
CREATE OR REPLACE FUNCTION get_user_notification_channels(p_user_id VARCHAR(255), p_event VARCHAR(50))
RETURNS TABLE (
    channel VARCHAR(20),
    config JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        np.channel::VARCHAR,
        jsonb_build_object(
            'enabled', np.enabled,
            'email', np.email_address,
            'webhook_url', np.webhook_url,
            'webhook_secret', np.webhook_secret,
            'event_enabled', 
            CASE p_event
                WHEN 'order_created' THEN np.order_created
                WHEN 'order_filled' THEN np.order_filled
                WHEN 'order_partially_filled' THEN np.order_partially_filled
                WHEN 'order_cancelled' THEN np.order_cancelled
                WHEN 'order_rejected' THEN np.order_rejected
                WHEN 'trade_executed' THEN np.trade_executed
                WHEN 'settlement_completed' THEN np.settlement_completed
                WHEN 'deposit_received' THEN np.deposit_received
                WHEN 'withdrawal_completed' THEN np.withdrawal_completed
                ELSE true
            END
        ) as config
    FROM notification_preferences np
    WHERE np.user_id = p_user_id
        AND np.enabled = true;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notification_preferences_updated_at
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_notification_templates_updated_at
    BEFORE UPDATE ON notification_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default notification templates
INSERT INTO notification_templates (type, event, channel, title_template, message_template) VALUES
('order', 'order_created', 'websocket', 'Order Created', 'Your {{orderType}} order for {{quantity}} {{symbol}} has been created'),
('order', 'order_filled', 'websocket', 'Order Filled', 'Your order #{{orderId}} has been filled at {{price}}'),
('order', 'order_partially_filled', 'websocket', 'Order Partially Filled', 'Your order #{{orderId}} has been {{filledQuantity}}/{{quantity}} filled'),
('order', 'order_cancelled', 'websocket', 'Order Cancelled', 'Your order #{{orderId}} has been cancelled'),
('trade', 'trade_executed', 'websocket', 'Trade Executed', 'Trade executed: {{side}} {{quantity}} {{symbol}} at {{price}}'),
('settlement', 'settlement_completed', 'websocket', 'Settlement Complete', 'Settlement for epoch {{epochId}} has been completed')
ON CONFLICT (type, event, channel) DO NOTHING;