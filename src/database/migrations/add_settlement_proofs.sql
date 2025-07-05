-- Settlement proofs table to store Merkle proofs for each settlement
CREATE TABLE IF NOT EXISTS settlement_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    epoch_id VARCHAR(255) NOT NULL,
    trade_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(42) NOT NULL, -- Ethereum address
    token VARCHAR(42) NOT NULL, -- Token contract address
    amount VARCHAR(78) NOT NULL, -- Store as string to handle large numbers
    merkle_proof TEXT NOT NULL, -- Compact encoded proof
    merkle_root VARCHAR(66) NOT NULL, -- 0x prefixed hex string
    leaf_index INTEGER NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes for efficient queries
    INDEX idx_settlement_proofs_trade_id (trade_id),
    INDEX idx_settlement_proofs_user_id (user_id),
    INDEX idx_settlement_proofs_epoch_id (epoch_id),
    INDEX idx_settlement_proofs_user_epoch (user_id, epoch_id),
    INDEX idx_settlement_proofs_tx_hash (transaction_hash),
    
    -- Ensure unique trade per epoch
    UNIQUE KEY unique_trade_epoch (trade_id, epoch_id)
);

-- Add merkle_root to settlement_epochs table if not exists
ALTER TABLE settlement_epochs 
ADD COLUMN IF NOT EXISTS merkle_root VARCHAR(66),
ADD COLUMN IF NOT EXISTS proof_tx_hash VARCHAR(66),
ADD COLUMN IF NOT EXISTS proof_block_number BIGINT,
ADD COLUMN IF NOT EXISTS ipfs_hash VARCHAR(255);

-- Settlement claims tracking
CREATE TABLE IF NOT EXISTS settlement_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    epoch_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(42) NOT NULL,
    token VARCHAR(42) NOT NULL,
    amount VARCHAR(78) NOT NULL,
    proof_id UUID NOT NULL,
    claim_tx_hash VARCHAR(66),
    claim_block_number BIGINT,
    claimed_at TIMESTAMP WITH TIME ZONE,
    status ENUM('pending', 'claimed', 'failed') DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (proof_id) REFERENCES settlement_proofs(id),
    INDEX idx_claims_user_id (user_id),
    INDEX idx_claims_epoch_id (epoch_id),
    INDEX idx_claims_status (status),
    UNIQUE KEY unique_user_epoch_token (user_id, epoch_id, token)
);

-- Add proof generation status to settlement_details
ALTER TABLE settlement_details
ADD COLUMN IF NOT EXISTS proof_generated BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS proof_id UUID,
ADD CONSTRAINT fk_proof_id FOREIGN KEY (proof_id) REFERENCES settlement_proofs(id);

-- View for easy proof retrieval with settlement details
CREATE OR REPLACE VIEW v_settlement_proofs_with_details AS
SELECT 
    sp.id as proof_id,
    sp.epoch_id,
    sp.trade_id,
    sp.user_id,
    sp.token,
    sp.amount,
    sp.merkle_proof,
    sp.merkle_root,
    sp.leaf_index,
    sp.transaction_hash,
    sp.block_number,
    sp.created_at as proof_created_at,
    se.epoch_number,
    se.start_time as epoch_start,
    se.end_time as epoch_end,
    se.status as epoch_status,
    sc.claimed_at,
    sc.claim_tx_hash,
    sc.status as claim_status
FROM settlement_proofs sp
JOIN settlement_epochs se ON sp.epoch_id = se.id
LEFT JOIN settlement_claims sc ON sc.proof_id = sp.id
ORDER BY sp.created_at DESC;

-- Function to get unclaimed settlements for a user
CREATE OR REPLACE FUNCTION get_unclaimed_settlements(p_user_id VARCHAR(42))
RETURNS TABLE (
    epoch_id VARCHAR(255),
    token VARCHAR(42),
    amount VARCHAR(78),
    merkle_proof TEXT,
    merkle_root VARCHAR(66),
    transaction_hash VARCHAR(66),
    block_number BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sp.epoch_id,
        sp.token,
        sp.amount,
        sp.merkle_proof,
        sp.merkle_root,
        sp.transaction_hash,
        sp.block_number
    FROM settlement_proofs sp
    LEFT JOIN settlement_claims sc ON sc.proof_id = sp.id
    WHERE sp.user_id = p_user_id
        AND (sc.id IS NULL OR sc.status != 'claimed')
    ORDER BY sp.created_at DESC;
END;
$$ LANGUAGE plpgsql;