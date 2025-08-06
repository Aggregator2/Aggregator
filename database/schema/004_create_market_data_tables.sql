-- Trading pairs configuration
CREATE TABLE trading_pairs (
    pair VARCHAR(20) PRIMARY KEY,
    base_asset VARCHAR(42) NOT NULL,
    quote_asset VARCHAR(42) NOT NULL,
    base_decimals INTEGER NOT NULL CHECK (base_decimals >= 0 AND base_decimals <= 18),
    quote_decimals INTEGER NOT NULL CHECK (quote_decimals >= 0 AND quote_decimals <= 18),
    min_price DECIMAL(36,18) NOT NULL CHECK (min_price > 0),
    max_price DECIMAL(36,18) NOT NULL CHECK (max_price > min_price),
    min_amount DECIMAL(36,18) NOT NULL CHECK (min_amount > 0),
    tick_size DECIMAL(36,18) NOT NULL CHECK (tick_size > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'paused', 'delisted')),
    maker_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0010 CHECK (maker_fee_rate >= 0 AND maker_fee_rate <= 1),
    taker_fee_rate DECIMAL(6,4) NOT NULL DEFAULT 0.0020 CHECK (taker_fee_rate >= 0 AND taker_fee_rate <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT valid_base_asset CHECK (base_asset ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT valid_quote_asset CHECK (quote_asset ~ '^0x[a-fA-F0-9]{40}$'),
    CONSTRAINT different_assets CHECK (base_asset != quote_asset)
);

-- Create indexes for trading pairs
CREATE INDEX idx_trading_pairs_status ON trading_pairs (status);
CREATE INDEX idx_trading_pairs_assets ON trading_pairs (base_asset, quote_asset);

-- OHLCV candles with partitioning
CREATE TABLE candles (
    pair VARCHAR(20) NOT NULL,
    interval VARCHAR(10) NOT NULL CHECK (interval IN ('1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w')),
    time TIMESTAMPTZ NOT NULL,
    open DECIMAL(36,18) NOT NULL CHECK (open > 0),
    high DECIMAL(36,18) NOT NULL CHECK (high >= open AND high >= close AND high >= low),
    low DECIMAL(36,18) NOT NULL CHECK (low <= open AND low <= close AND low <= high AND low > 0),
    close DECIMAL(36,18) NOT NULL CHECK (close > 0),
    volume DECIMAL(36,18) NOT NULL CHECK (volume >= 0),
    trade_count INTEGER NOT NULL CHECK (trade_count >= 0),
    PRIMARY KEY (pair, interval, time)
) PARTITION BY RANGE (time);

-- Create indexes for candles
CREATE INDEX idx_candles_pair_interval_time ON candles (pair, interval, time DESC);

-- Create candle partitions
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create monthly partitions for last 12 months and next 3 months
    FOR i IN -11..3 LOOP
        start_date := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month' * i);
        end_date := start_date + INTERVAL '1 month';
        partition_name := 'candles_' || TO_CHAR(start_date, 'YYYY_MM');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF candles
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;

-- Market statistics table (24h rolling)
CREATE TABLE market_stats (
    pair VARCHAR(20) PRIMARY KEY REFERENCES trading_pairs(pair),
    high_24h DECIMAL(36,18),
    low_24h DECIMAL(36,18),
    volume_24h DECIMAL(36,18) NOT NULL DEFAULT 0,
    volume_quote_24h DECIMAL(36,18) NOT NULL DEFAULT 0,
    trade_count_24h INTEGER NOT NULL DEFAULT 0,
    last_price DECIMAL(36,18),
    last_trade_at TIMESTAMPTZ,
    price_change_24h DECIMAL(36,18),
    price_change_percent_24h DECIMAL(8,4),
    bid DECIMAL(36,18),
    ask DECIMAL(36,18),
    spread DECIMAL(36,18) GENERATED ALWAYS AS (
        CASE 
            WHEN bid IS NOT NULL AND ask IS NOT NULL AND bid > 0 
            THEN ((ask - bid) / bid * 100)
            ELSE NULL 
        END
    ) STORED,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for market stats
CREATE INDEX idx_market_stats_volume ON market_stats (volume_24h DESC);
CREATE INDEX idx_market_stats_updated ON market_stats (updated_at);

-- Order book snapshots for historical analysis
CREATE TABLE orderbook_snapshots (
    id BIGSERIAL PRIMARY KEY,
    pair VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bids JSONB NOT NULL DEFAULT '[]'::jsonb,
    asks JSONB NOT NULL DEFAULT '[]'::jsonb,
    spread DECIMAL(36,18),
    mid_price DECIMAL(36,18),
    total_bid_volume DECIMAL(36,18),
    total_ask_volume DECIMAL(36,18),
    imbalance DECIMAL(8,4), -- (bid_volume - ask_volume) / (bid_volume + ask_volume)
    metadata JSONB DEFAULT '{}'::jsonb
) PARTITION BY RANGE (timestamp);

-- Create indexes for snapshots
CREATE INDEX idx_orderbook_snapshots_pair_time ON orderbook_snapshots (pair, timestamp DESC);

-- Create snapshot partitions (daily)
DO $$
DECLARE
    start_date DATE;
    end_date DATE;
    partition_name TEXT;
BEGIN
    -- Create daily partitions for last 7 days and next 3 days
    FOR i IN -6..3 LOOP
        start_date := CURRENT_DATE + i;
        end_date := start_date + 1;
        partition_name := 'orderbook_snapshots_' || TO_CHAR(start_date, 'YYYY_MM_DD');
        
        EXECUTE format('
            CREATE TABLE IF NOT EXISTS %I PARTITION OF orderbook_snapshots
            FOR VALUES FROM (%L) TO (%L)',
            partition_name, start_date, end_date
        );
    END LOOP;
END $$;

-- Update trigger for trading pairs
CREATE TRIGGER update_trading_pairs_updated_at
    BEFORE UPDATE ON trading_pairs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();