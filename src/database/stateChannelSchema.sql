-- State Channels table
CREATE TABLE IF NOT EXISTS state_channels (
    channel_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    participants TEXT NOT NULL, -- JSON array of participant addresses
    token_address TEXT NOT NULL,
    challenge_period INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'disputing', 'settling', 'finalized', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_trades INTEGER DEFAULT 0,
    total_volume TEXT DEFAULT '0', -- Store as string for BigNumber
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(address)
);

-- Channel trades table for HFT tracking
CREATE TABLE IF NOT EXISTS channel_trades (
    trade_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount TEXT NOT NULL, -- Store as string for BigNumber
    status TEXT NOT NULL CHECK (status IN ('pending', 'executed', 'cancelled', 'reverted')),
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finality_proof TEXT, -- JSON object with proof details
    execution_time INTEGER, -- milliseconds
    signatures_count INTEGER DEFAULT 0,
    FOREIGN KEY (channel_id) REFERENCES state_channels(channel_id)
);

-- Channel states history
CREATE TABLE IF NOT EXISTS channel_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    state_root TEXT NOT NULL,
    balances TEXT NOT NULL, -- JSON object mapping addresses to balances
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    signatures TEXT, -- JSON object mapping addresses to signatures
    FOREIGN KEY (channel_id) REFERENCES state_channels(channel_id),
    UNIQUE(channel_id, nonce)
);

-- Channel settlements
CREATE TABLE IF NOT EXISTS channel_settlements (
    settlement_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    settlement_type TEXT NOT NULL CHECK (settlement_type IN ('periodic', 'final', 'emergency', 'normal')),
    nonce INTEGER NOT NULL,
    state_root TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    settlement_tx_hash TEXT,
    error_message TEXT,
    FOREIGN KEY (channel_id) REFERENCES state_channels(channel_id)
);

-- HFT performance metrics
CREATE TABLE IF NOT EXISTS hft_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    total_trades INTEGER NOT NULL,
    avg_latency REAL NOT NULL,
    p99_latency REAL NOT NULL,
    throughput REAL NOT NULL, -- trades per second
    volume_traded TEXT NOT NULL, -- Store as string for BigNumber
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES state_channels(channel_id)
);

-- Instant trade signatures for multi-party channels
CREATE TABLE IF NOT EXISTS trade_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id TEXT NOT NULL,
    signer_address TEXT NOT NULL,
    signature TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trade_id) REFERENCES channel_trades(trade_id),
    UNIQUE(trade_id, signer_address)
);

-- Channel participants with roles
CREATE TABLE IF NOT EXISTS channel_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    participant_address TEXT NOT NULL,
    role TEXT DEFAULT 'trader' CHECK (role IN ('trader', 'market_maker', 'arbitrageur')),
    is_trusted BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deposit_amount TEXT DEFAULT '0',
    FOREIGN KEY (channel_id) REFERENCES state_channels(channel_id),
    UNIQUE(channel_id, participant_address)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_channel_trades_channel_id ON channel_trades(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_trades_timestamp ON channel_trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_channel_trades_status ON channel_trades(status);
CREATE INDEX IF NOT EXISTS idx_channel_states_channel_id ON channel_states(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_settlements_channel_id ON channel_settlements(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_settlements_status ON channel_settlements(status);
CREATE INDEX IF NOT EXISTS idx_hft_metrics_channel_id ON hft_metrics(channel_id);
CREATE INDEX IF NOT EXISTS idx_hft_metrics_timestamp ON hft_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_trade_signatures_trade_id ON trade_signatures(trade_id);