-- Create webhook tables migration

-- Create enum types
CREATE TYPE webhook_event_type AS ENUM (
  'order.created',
  'order.filled',
  'order.cancelled',
  'trade.executed',
  'settlement.completed',
  'settlement.claimed'
);

CREATE TYPE webhook_status AS ENUM (
  'active',
  'inactive',
  'failed'
);

CREATE TYPE webhook_event_status AS ENUM (
  'pending',
  'delivered',
  'failed'
);

-- Create webhooks table
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  secret VARCHAR(255) NOT NULL,
  events webhook_event_type[] NOT NULL DEFAULT '{}',
  status webhook_status NOT NULL DEFAULT 'active',
  description VARCHAR(255),
  headers JSONB DEFAULT '{}',
  ip_whitelist TEXT[] DEFAULT '{}',
  retry_config JSONB DEFAULT '{
    "maxRetries": 5,
    "initialDelay": 1000,
    "maxDelay": 3600000,
    "timeout": 30000
  }',
  metadata JSONB DEFAULT '{}',
  last_triggered_at TIMESTAMP WITH TIME ZONE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create webhook_events table
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id VARCHAR(255) NOT NULL UNIQUE,
  type webhook_event_type NOT NULL,
  payload JSONB NOT NULL,
  signature VARCHAR(255) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status webhook_event_status NOT NULL DEFAULT 'pending',
  next_retry_at TIMESTAMP WITH TIME ZONE,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  response_status INTEGER,
  response_body TEXT,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_webhooks_user_id ON webhooks(user_id);
CREATE INDEX idx_webhooks_status ON webhooks(status);
CREATE INDEX idx_webhooks_events ON webhooks USING GIN(events);

CREATE INDEX idx_webhook_events_webhook_id ON webhook_events(webhook_id);
CREATE INDEX idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX idx_webhook_events_type ON webhook_events(type);
CREATE INDEX idx_webhook_events_status ON webhook_events(status);
CREATE INDEX idx_webhook_events_next_retry_at ON webhook_events(next_retry_at) WHERE status = 'pending';
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers
CREATE TRIGGER update_webhooks_updated_at BEFORE UPDATE ON webhooks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_webhook_events_updated_at BEFORE UPDATE ON webhook_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add constraints
ALTER TABLE webhooks ADD CONSTRAINT check_webhook_url_https 
  CHECK (url LIKE 'https://%' OR (url LIKE 'http://%' AND status != 'active'));

ALTER TABLE webhooks ADD CONSTRAINT check_retry_config_valid
  CHECK (
    (retry_config->>'maxRetries')::int >= 0 AND
    (retry_config->>'maxRetries')::int <= 10 AND
    (retry_config->>'initialDelay')::int >= 100 AND
    (retry_config->>'maxDelay')::int >= 1000 AND
    (retry_config->>'timeout')::int >= 1000
  );

-- Add comments
COMMENT ON TABLE webhooks IS 'Stores webhook configurations for async event notifications';
COMMENT ON TABLE webhook_events IS 'Stores webhook event delivery attempts and status';

COMMENT ON COLUMN webhooks.secret IS 'HMAC secret for webhook signature validation';
COMMENT ON COLUMN webhooks.events IS 'Array of event types this webhook is subscribed to';
COMMENT ON COLUMN webhooks.ip_whitelist IS 'Optional IP addresses allowed to receive webhooks';
COMMENT ON COLUMN webhooks.retry_config IS 'Configuration for retry behavior';

COMMENT ON COLUMN webhook_events.event_id IS 'Unique identifier for deduplication';
COMMENT ON COLUMN webhook_events.signature IS 'HMAC signature for this specific event';
COMMENT ON COLUMN webhook_events.next_retry_at IS 'When to retry delivery if status is pending';