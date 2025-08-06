-- Users table with comprehensive constraints
CREATE TABLE users (
    id VARCHAR(42) PRIMARY KEY, -- Ethereum address
    nonce VARCHAR(32) NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
    tier VARCHAR(20) NOT NULL DEFAULT 'basic' 
        CHECK (tier IN ('basic', 'silver', 'gold', 'platinum', 'vip')),
    maker_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0010 CHECK (maker_fee_rate >= 0 AND maker_fee_rate <= 1),
    taker_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0020 CHECK (taker_fee_rate >= 0 AND taker_fee_rate <= 1),
    volume_30d DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (volume_30d >= 0),
    trade_count_30d INTEGER NOT NULL DEFAULT 0 CHECK (trade_count_30d >= 0),
    kyc_status VARCHAR(20) DEFAULT 'none' 
        CHECK (kyc_status IN ('none', 'pending', 'approved', 'rejected')),
    kyc_level INTEGER DEFAULT 0 CHECK (kyc_level >= 0 AND kyc_level <= 3),
    referrer_id VARCHAR(42) REFERENCES users(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    settings JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT valid_ethereum_address CHECK (id ~ '^0x[a-fA-F0-9]{40}$')
);

-- Create indexes for users
CREATE INDEX idx_users_status ON users (status) WHERE status = 'active';
CREATE INDEX idx_users_created_at ON users (created_at DESC);
CREATE INDEX idx_users_volume_30d ON users (volume_30d DESC);
CREATE INDEX idx_users_tier ON users (tier);
CREATE INDEX idx_users_referrer ON users (referrer_id) WHERE referrer_id IS NOT NULL;
CREATE INDEX idx_users_kyc_status ON users (kyc_status) WHERE kyc_status != 'none';

-- User balances table
CREATE TABLE user_balances (
    user_id VARCHAR(42) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(42) NOT NULL,
    available DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (available >= 0),
    locked DECIMAL(36,18) NOT NULL DEFAULT 0 CHECK (locked >= 0),
    total DECIMAL(36,18) GENERATED ALWAYS AS (available + locked) STORED,
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, token),
    CONSTRAINT valid_token_address CHECK (token ~ '^0x[a-fA-F0-9]{40}$')
);

-- Create indexes for balances
CREATE INDEX idx_user_balances_token ON user_balances (token);
CREATE INDEX idx_user_balances_total ON user_balances (user_id, total DESC);

-- API keys table with rate limiting
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(42) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(64) NOT NULL UNIQUE, -- SHA256 hash of the API key
    name VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    rate_limit INTEGER NOT NULL DEFAULT 100, -- requests per second
    daily_limit INTEGER NOT NULL DEFAULT 100000, -- requests per day
    ip_whitelist INET[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'suspended', 'revoked')),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Create indexes for API keys
CREATE INDEX idx_api_keys_user_id ON api_keys (user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys (key_hash) WHERE status = 'active';
CREATE INDEX idx_api_keys_expires_at ON api_keys (expires_at) 
    WHERE expires_at IS NOT NULL AND status = 'active';

-- Update trigger for users
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();