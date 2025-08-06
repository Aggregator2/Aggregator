-- =============================================
-- SwappiQ Protocol Data Consistency Constraints
-- =============================================
-- This script implements comprehensive data consistency
-- including foreign keys, check constraints, and triggers
-- =============================================

-- =============================================
-- 1. FOREIGN KEY CONSTRAINTS WITH CASCADES
-- =============================================

-- User relations
ALTER TABLE "Session" 
    DROP CONSTRAINT IF EXISTS fk_session_user,
    ADD CONSTRAINT fk_session_user 
    FOREIGN KEY ("userId") 
    REFERENCES "User"(id) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS fk_order_user,
    ADD CONSTRAINT fk_order_user 
    FOREIGN KEY ("userId") 
    REFERENCES "User"(id) 
    ON DELETE RESTRICT 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS fk_order_pair,
    ADD CONSTRAINT fk_order_pair 
    FOREIGN KEY ("pairId") 
    REFERENCES "TradingPair"(id) 
    ON DELETE RESTRICT 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Trade" 
    DROP CONSTRAINT IF EXISTS fk_trade_buy_order,
    ADD CONSTRAINT fk_trade_buy_order 
    FOREIGN KEY ("buyOrderId") 
    REFERENCES "Order"(id) 
    ON DELETE RESTRICT 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Trade" 
    DROP CONSTRAINT IF EXISTS fk_trade_sell_order,
    ADD CONSTRAINT fk_trade_sell_order 
    FOREIGN KEY ("sellOrderId") 
    REFERENCES "Order"(id) 
    ON DELETE RESTRICT 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Balance" 
    DROP CONSTRAINT IF EXISTS fk_balance_user,
    ADD CONSTRAINT fk_balance_user 
    FOREIGN KEY ("userId") 
    REFERENCES "User"(id) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ApiKey" 
    DROP CONSTRAINT IF EXISTS fk_apikey_user,
    ADD CONSTRAINT fk_apikey_user 
    FOREIGN KEY ("userId") 
    REFERENCES "User"(id) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "Notification" 
    DROP CONSTRAINT IF EXISTS fk_notification_user,
    ADD CONSTRAINT fk_notification_user 
    FOREIGN KEY ("userId") 
    REFERENCES "User"(id) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
    DEFERRABLE INITIALLY IMMEDIATE;

-- =============================================
-- 2. CHECK CONSTRAINTS FOR BUSINESS RULES
-- =============================================

-- User constraints
ALTER TABLE "User" 
    DROP CONSTRAINT IF EXISTS chk_user_wallet_address,
    ADD CONSTRAINT chk_user_wallet_address 
    CHECK (LENGTH("walletAddress") = 42 AND "walletAddress" ~ '^0x[a-fA-F0-9]{40}$');

ALTER TABLE "User" 
    DROP CONSTRAINT IF EXISTS chk_user_trading_tier,
    ADD CONSTRAINT chk_user_trading_tier 
    CHECK ("tradingTier" BETWEEN 1 AND 5);

ALTER TABLE "User" 
    DROP CONSTRAINT IF EXISTS chk_user_daily_volume_limit,
    ADD CONSTRAINT chk_user_daily_volume_limit 
    CHECK ("dailyVolumeLimit" >= 0);

ALTER TABLE "User" 
    DROP CONSTRAINT IF EXISTS chk_user_email_format,
    ADD CONSTRAINT chk_user_email_format 
    CHECK (email IS NULL OR email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Trading pair constraints
ALTER TABLE "TradingPair" 
    DROP CONSTRAINT IF EXISTS chk_pair_tick_size,
    ADD CONSTRAINT chk_pair_tick_size 
    CHECK ("tickSize" > 0 AND "tickSize" <= 1);

ALTER TABLE "TradingPair" 
    DROP CONSTRAINT IF EXISTS chk_pair_step_size,
    ADD CONSTRAINT chk_pair_step_size 
    CHECK ("stepSize" > 0 AND "stepSize" <= 1);

ALTER TABLE "TradingPair" 
    DROP CONSTRAINT IF EXISTS chk_pair_order_limits,
    ADD CONSTRAINT chk_pair_order_limits 
    CHECK ("minOrderValue" > 0 AND "minOrderValue" < "maxOrderValue");

ALTER TABLE "TradingPair" 
    DROP CONSTRAINT IF EXISTS chk_pair_fees,
    ADD CONSTRAINT chk_pair_fees 
    CHECK ("makerFee" >= 0 AND "makerFee" <= 0.01 AND "takerFee" >= 0 AND "takerFee" <= 0.01);

ALTER TABLE "TradingPair" 
    DROP CONSTRAINT IF EXISTS chk_pair_24h_stats,
    ADD CONSTRAINT chk_pair_24h_stats 
    CHECK (
        "volume24h" >= 0 AND 
        ("high24h" IS NULL OR "low24h" IS NULL OR "high24h" >= "low24h") AND
        ("lastPrice" IS NULL OR "lastPrice" > 0)
    );

-- Order constraints
ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS chk_order_price_quantity,
    ADD CONSTRAINT chk_order_price_quantity 
    CHECK ("price" > 0 AND "quantity" > 0);

ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS chk_order_filled_quantity,
    ADD CONSTRAINT chk_order_filled_quantity 
    CHECK (
        "filledQuantity" >= 0 AND 
        "filledQuantity" <= "quantity" AND
        "remainingQuantity" >= 0 AND
        "remainingQuantity" = "quantity" - "filledQuantity"
    );

ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS chk_order_commission,
    ADD CONSTRAINT chk_order_commission 
    CHECK ("commission" >= 0);

ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS chk_order_stop_price,
    ADD CONSTRAINT chk_order_stop_price 
    CHECK (
        ("type" IN ('STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT') AND "stopPrice" IS NOT NULL AND "stopPrice" > 0) OR
        ("type" NOT IN ('STOP_LOSS', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT', 'TAKE_PROFIT_LIMIT') AND "stopPrice" IS NULL)
    );

ALTER TABLE "Order" 
    DROP CONSTRAINT IF EXISTS chk_order_time_in_force,
    ADD CONSTRAINT chk_order_time_in_force 
    CHECK (
        ("timeInForce" != 'GTX' OR "expireTime" IS NOT NULL) AND
        ("expireTime" IS NULL OR "expireTime" > "createdAt")
    );

-- Trade constraints
ALTER TABLE "Trade" 
    DROP CONSTRAINT IF EXISTS chk_trade_price_quantity,
    ADD CONSTRAINT chk_trade_price_quantity 
    CHECK ("price" > 0 AND "quantity" > 0 AND "quoteQuantity" > 0);

ALTER TABLE "Trade" 
    DROP CONSTRAINT IF EXISTS chk_trade_commissions,
    ADD CONSTRAINT chk_trade_commissions 
    CHECK ("buyerCommission" >= 0 AND "sellerCommission" >= 0);

ALTER TABLE "Trade" 
    DROP CONSTRAINT IF EXISTS chk_trade_different_orders,
    ADD CONSTRAINT chk_trade_different_orders 
    CHECK ("buyOrderId" != "sellOrderId");

-- Balance constraints
ALTER TABLE "Balance" 
    DROP CONSTRAINT IF EXISTS chk_balance_amounts,
    ADD CONSTRAINT chk_balance_amounts 
    CHECK (
        "available" >= 0 AND 
        "locked" >= 0 AND 
        "total" >= 0 AND
        "total" = "available" + "locked"
    );

-- Transaction constraints
ALTER TABLE "Transaction" 
    DROP CONSTRAINT IF EXISTS chk_transaction_amount,
    ADD CONSTRAINT chk_transaction_amount 
    CHECK ("amount" > 0 AND "fee" >= 0);

ALTER TABLE "Transaction" 
    DROP CONSTRAINT IF EXISTS chk_transaction_addresses,
    ADD CONSTRAINT chk_transaction_addresses 
    CHECK (
        ("type" IN ('DEPOSIT', 'WITHDRAWAL') AND "toAddress" IS NOT NULL) OR
        ("type" NOT IN ('DEPOSIT', 'WITHDRAWAL'))
    );

ALTER TABLE "Transaction" 
    DROP CONSTRAINT IF EXISTS chk_transaction_confirmations,
    ADD CONSTRAINT chk_transaction_confirmations 
    CHECK ("confirmations" >= 0);

-- Price history constraints
ALTER TABLE "PriceHistory" 
    DROP CONSTRAINT IF EXISTS chk_price_history_ohlc,
    ADD CONSTRAINT chk_price_history_ohlc 
    CHECK (
        "open" > 0 AND "high" > 0 AND "low" > 0 AND "close" > 0 AND
        "high" >= "open" AND "high" >= "close" AND
        "low" <= "open" AND "low" <= "close" AND
        "high" >= "low"
    );

ALTER TABLE "PriceHistory" 
    DROP CONSTRAINT IF EXISTS chk_price_history_volume,
    ADD CONSTRAINT chk_price_history_volume 
    CHECK ("volume" >= 0 AND "quoteVolume" >= 0 AND "trades" >= 0);

ALTER TABLE "PriceHistory" 
    DROP CONSTRAINT IF EXISTS chk_price_history_time,
    ADD CONSTRAINT chk_price_history_time 
    CHECK ("closeTime" > "openTime");

-- API Key constraints
ALTER TABLE "ApiKey" 
    DROP CONSTRAINT IF EXISTS chk_apikey_permissions,
    ADD CONSTRAINT chk_apikey_permissions 
    CHECK (
        array_length(permissions, 1) > 0 AND
        permissions <@ ARRAY['trading', 'reading', 'withdrawal', 'admin']::text[]
    );

-- =============================================
-- 3. CUSTOM DOMAIN TYPES
-- =============================================

-- Ethereum address type
CREATE DOMAIN ethereum_address AS VARCHAR(42)
    CHECK (VALUE ~ '^0x[a-fA-F0-9]{40}$');

-- Positive decimal type
CREATE DOMAIN positive_decimal AS DECIMAL(20, 8)
    CHECK (VALUE > 0);

-- Non-negative decimal type
CREATE DOMAIN non_negative_decimal AS DECIMAL(20, 8)
    CHECK (VALUE >= 0);

-- Percentage type (0-1)
CREATE DOMAIN percentage AS DECIMAL(10, 6)
    CHECK (VALUE >= 0 AND VALUE <= 1);

-- =============================================
-- 4. COMPOSITE UNIQUE CONSTRAINTS
-- =============================================

-- Ensure unique active orders per user and pair
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_order_client_id 
ON "Order"("userId", "clientOrderId") 
WHERE status IN ('NEW', 'PARTIALLY_FILLED');

-- Ensure single balance per user per asset
ALTER TABLE "Balance" 
    DROP CONSTRAINT IF EXISTS uniq_user_asset_balance,
    ADD CONSTRAINT uniq_user_asset_balance 
    UNIQUE ("userId", asset);

-- Ensure unique trading pair symbols
ALTER TABLE "TradingPair" 
    DROP CONSTRAINT IF EXISTS uniq_trading_pair_symbol,
    ADD CONSTRAINT uniq_trading_pair_symbol 
    UNIQUE (symbol);

-- =============================================
-- 5. DEFERRED CONSTRAINT CHECKS
-- =============================================

-- Enable deferred constraint checking for complex transactions
ALTER TABLE "Order" 
    ALTER CONSTRAINT fk_order_user DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Trade" 
    ALTER CONSTRAINT fk_trade_buy_order DEFERRABLE INITIALLY DEFERRED,
    ALTER CONSTRAINT fk_trade_sell_order DEFERRABLE INITIALLY DEFERRED;

-- =============================================
-- 6. EXCLUSION CONSTRAINTS
-- =============================================

-- Prevent overlapping price history records
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "PriceHistory" 
    DROP CONSTRAINT IF EXISTS excl_price_history_overlap,
    ADD CONSTRAINT excl_price_history_overlap 
    EXCLUDE USING gist (
        "pairId" WITH =,
        interval WITH =,
        tsrange("openTime", "closeTime", '[)') WITH &&
    );

-- =============================================
-- 7. BUSINESS RULE FUNCTIONS
-- =============================================

-- Function to validate order placement
CREATE OR REPLACE FUNCTION validate_order_placement()
RETURNS TRIGGER AS $$
DECLARE
    v_user_balance RECORD;
    v_required_amount DECIMAL(20, 8);
    v_asset VARCHAR(10);
BEGIN
    -- Get the trading pair
    SELECT * INTO STRICT NEW.pair FROM "TradingPair" WHERE id = NEW."pairId";
    
    -- Determine required asset and amount
    IF NEW.side = 'BUY' THEN
        v_asset := NEW.pair."quoteAsset";
        v_required_amount := NEW.quantity * NEW.price;
    ELSE
        v_asset := NEW.pair."baseAsset";
        v_required_amount := NEW.quantity;
    END IF;
    
    -- Check user balance
    SELECT * INTO v_user_balance 
    FROM "Balance" 
    WHERE "userId" = NEW."userId" AND asset = v_asset
    FOR UPDATE;
    
    IF v_user_balance IS NULL OR v_user_balance.available < v_required_amount THEN
        RAISE EXCEPTION 'Insufficient balance for order placement';
    END IF;
    
    -- Check order size limits
    IF NEW.quantity * NEW.price < NEW.pair."minOrderValue" THEN
        RAISE EXCEPTION 'Order value below minimum';
    END IF;
    
    IF NEW.quantity * NEW.price > NEW.pair."maxOrderValue" THEN
        RAISE EXCEPTION 'Order value above maximum';
    END IF;
    
    -- Check tick size
    IF MOD(NEW.price::numeric, NEW.pair."tickSize"::numeric) != 0 THEN
        RAISE EXCEPTION 'Price does not match tick size';
    END IF;
    
    -- Check step size
    IF MOD(NEW.quantity::numeric, NEW.pair."stepSize"::numeric) != 0 THEN
        RAISE EXCEPTION 'Quantity does not match step size';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to prevent self-trading
CREATE OR REPLACE FUNCTION prevent_self_trading()
RETURNS TRIGGER AS $$
DECLARE
    v_buy_user_id UUID;
    v_sell_user_id UUID;
BEGIN
    -- Get user IDs from orders
    SELECT "userId" INTO v_buy_user_id FROM "Order" WHERE id = NEW."buyOrderId";
    SELECT "userId" INTO v_sell_user_id FROM "Order" WHERE id = NEW."sellOrderId";
    
    IF v_buy_user_id = v_sell_user_id THEN
        RAISE EXCEPTION 'Self-trading is not allowed';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to maintain balance consistency
CREATE OR REPLACE FUNCTION update_balance_total()
RETURNS TRIGGER AS $$
BEGIN
    NEW.total := NEW.available + NEW.locked;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 8. ROW-LEVEL SECURITY
-- =============================================

-- Enable RLS on sensitive tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Balance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;

-- User can only see their own data
CREATE POLICY user_isolation ON "User"
    FOR ALL
    USING (id = current_setting('app.current_user_id')::uuid);

CREATE POLICY balance_isolation ON "Balance"
    FOR ALL
    USING ("userId" = current_setting('app.current_user_id')::uuid);

CREATE POLICY order_isolation ON "Order"
    FOR ALL
    USING ("userId" = current_setting('app.current_user_id')::uuid);

CREATE POLICY apikey_isolation ON "ApiKey"
    FOR ALL
    USING ("userId" = current_setting('app.current_user_id')::uuid);

-- =============================================
-- 9. INTEGRITY MAINTENANCE PROCEDURES
-- =============================================

-- Procedure to check and fix balance inconsistencies
CREATE OR REPLACE PROCEDURE fix_balance_inconsistencies()
LANGUAGE plpgsql AS $$
DECLARE
    v_balance RECORD;
    v_calculated_locked DECIMAL(20, 8);
BEGIN
    FOR v_balance IN 
        SELECT * FROM "Balance" 
        WHERE total != available + locked
    LOOP
        UPDATE "Balance" 
        SET total = available + locked
        WHERE id = v_balance.id;
        
        RAISE NOTICE 'Fixed balance % for user % asset %', 
            v_balance.id, v_balance."userId", v_balance.asset;
    END LOOP;
    
    -- Check locked amounts against open orders
    FOR v_balance IN SELECT * FROM "Balance" LOOP
        -- Calculate expected locked amount from open orders
        IF EXISTS (
            SELECT 1 FROM "TradingPair" 
            WHERE "quoteAsset" = v_balance.asset
        ) THEN
            -- This asset is used as quote (for BUY orders)
            SELECT COALESCE(SUM(o."remainingQuantity" * o.price), 0)
            INTO v_calculated_locked
            FROM "Order" o
            JOIN "TradingPair" tp ON o."pairId" = tp.id
            WHERE o."userId" = v_balance."userId"
                AND o.side = 'BUY'
                AND o.status IN ('NEW', 'PARTIALLY_FILLED')
                AND tp."quoteAsset" = v_balance.asset;
        ELSE
            -- This asset is used as base (for SELL orders)
            SELECT COALESCE(SUM(o."remainingQuantity"), 0)
            INTO v_calculated_locked
            FROM "Order" o
            JOIN "TradingPair" tp ON o."pairId" = tp.id
            WHERE o."userId" = v_balance."userId"
                AND o.side = 'SELL'
                AND o.status IN ('NEW', 'PARTIALLY_FILLED')
                AND tp."baseAsset" = v_balance.asset;
        END IF;
        
        IF v_balance.locked != v_calculated_locked THEN
            RAISE WARNING 'Locked balance mismatch for user % asset %: expected %, actual %',
                v_balance."userId", v_balance.asset, v_calculated_locked, v_balance.locked;
        END IF;
    END LOOP;
END;
$$;

-- =============================================
-- 10. MONITORING VIEWS
-- =============================================

-- View to monitor constraint violations
CREATE OR REPLACE VIEW v_constraint_violations AS
WITH violation_counts AS (
    SELECT 
        conname as constraint_name,
        conrelid::regclass as table_name,
        CASE contype
            WHEN 'c' THEN 'CHECK'
            WHEN 'f' THEN 'FOREIGN KEY'
            WHEN 'p' THEN 'PRIMARY KEY'
            WHEN 'u' THEN 'UNIQUE'
            WHEN 'x' THEN 'EXCLUSION'
        END as constraint_type
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
)
SELECT * FROM violation_counts
ORDER BY table_name, constraint_type;

-- View to monitor data integrity issues
CREATE OR REPLACE VIEW v_data_integrity_issues AS
SELECT 'Orphaned orders' as issue_type, COUNT(*) as count
FROM "Order" o
LEFT JOIN "User" u ON o."userId" = u.id
WHERE u.id IS NULL
UNION ALL
SELECT 'Invalid balance totals', COUNT(*)
FROM "Balance"
WHERE total != available + locked
UNION ALL
SELECT 'Negative balances', COUNT(*)
FROM "Balance"
WHERE available < 0 OR locked < 0 OR total < 0;