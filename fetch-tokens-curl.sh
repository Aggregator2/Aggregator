#!/bin/bash

# Create temp directory for results
TEMP_DIR="./temp-token-data"
mkdir -p "$TEMP_DIR"

echo "Fetching supported tokens from various DEX aggregators..."
echo "Results will be saved to: $TEMP_DIR"
echo ""

# 1. Fetch from Jupiter API (Solana)
echo "Fetching tokens from Jupiter (Solana)..."
curl -s "https://token.jup.ag/all" -o "$TEMP_DIR/jupiter-solana-tokens.json"
echo "✓ Saved to: $TEMP_DIR/jupiter-solana-tokens.json"

# 2. Fetch from OpenOcean for multiple chains
chains=("eth" "bsc" "polygon" "arbitrum" "optimism")
for chain in "${chains[@]}"; do
    echo ""
    echo "Fetching tokens from OpenOcean ($chain)..."
    curl -s "https://open-api.openocean.finance/v3/$chain/tokenList" -o "$TEMP_DIR/openocean-$chain-tokens.json"
    echo "✓ Saved to: $TEMP_DIR/openocean-$chain-tokens.json"
done

# 3. Fetch from CoinGecko (Ethereum)
echo ""
echo "Fetching tokens from CoinGecko (Ethereum)..."
curl -s "https://tokens.coingecko.com/ethereum/all.json" -o "$TEMP_DIR/coingecko-ethereum-tokens.json"
echo "✓ Saved to: $TEMP_DIR/coingecko-ethereum-tokens.json"

echo ""
echo "✅ All token lists fetched successfully!"
echo ""
echo "To analyze the results, you can use jq:"
echo "  jq '.data | length' $TEMP_DIR/openocean-eth-tokens.json    # Count OpenOcean tokens"
echo "  jq 'length' $TEMP_DIR/jupiter-solana-tokens.json           # Count Jupiter tokens"
echo "  jq '.tokens | length' $TEMP_DIR/coingecko-ethereum-tokens.json  # Count CoinGecko tokens"