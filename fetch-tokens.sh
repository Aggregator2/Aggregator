#!/bin/bash

# Create temp directory for results
TEMP_DIR="./temp-token-data"
mkdir -p "$TEMP_DIR"

echo "Fetching supported tokens from various DEX aggregators..."
echo "Results will be saved to: $TEMP_DIR"
echo ""

# Function to fetch and save data
fetch_tokens() {
    local url=$1
    local filename=$2
    local api_name=$3
    
    echo "Fetching tokens from $api_name: $url"
    
    # Fetch data with curl
    if curl -s "$url" | jq '.' > "$TEMP_DIR/$filename" 2>/dev/null; then
        echo "✓ Saved to: $TEMP_DIR/$filename"
        
        # Show token count
        if [ -f "$TEMP_DIR/$filename" ]; then
            # Try different JSON structures
            count=$(jq 'length' "$TEMP_DIR/$filename" 2>/dev/null)
            if [ -z "$count" ] || [ "$count" = "null" ]; then
                count=$(jq '.records | length' "$TEMP_DIR/$filename" 2>/dev/null)
            fi
            if [ -z "$count" ] || [ "$count" = "null" ]; then
                count=$(jq '.tokens | keys | length' "$TEMP_DIR/$filename" 2>/dev/null)
            fi
            if [ -z "$count" ] || [ "$count" = "null" ]; then
                count=$(jq '.data | length' "$TEMP_DIR/$filename" 2>/dev/null)
            fi
            
            if [ ! -z "$count" ] && [ "$count" != "null" ]; then
                echo "  Total tokens: $count"
            fi
        fi
    else
        echo "✗ Failed to fetch from $api_name"
    fi
    echo ""
}

# 1. Fetch from 0x API (Ethereum)
fetch_tokens "https://api.0x.org/swap/v1/tokens" "0x-ethereum-tokens.json" "0x API"

# 2. Fetch from Jupiter API (Solana)
fetch_tokens "https://token.jup.ag/all" "jupiter-solana-tokens.json" "Jupiter"

# 3. Fetch from OpenOcean (BSC)
fetch_tokens "https://open-api.openocean.finance/v3/bsc/tokenList" "openocean-bsc-tokens.json" "OpenOcean BSC"

# 4. Fetch from OpenOcean (Ethereum)
fetch_tokens "https://open-api.openocean.finance/v3/eth/tokenList" "openocean-ethereum-tokens.json" "OpenOcean Ethereum"

# Create summary file
echo "Creating summary file..."
cat > "$TEMP_DIR/fetch-summary.json" << EOF
{
  "fetchedAt": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "apis": [
    {
      "name": "0x",
      "url": "https://api.0x.org/swap/v1/tokens",
      "file": "0x-ethereum-tokens.json"
    },
    {
      "name": "Jupiter",
      "url": "https://token.jup.ag/all",
      "file": "jupiter-solana-tokens.json"
    },
    {
      "name": "OpenOcean BSC",
      "url": "https://open-api.openocean.finance/v3/bsc/tokenList",
      "file": "openocean-bsc-tokens.json"
    },
    {
      "name": "OpenOcean Ethereum",
      "url": "https://open-api.openocean.finance/v3/eth/tokenList",
      "file": "openocean-ethereum-tokens.json"
    }
  ]
}
EOF

echo "✅ All token lists fetched successfully!"
echo ""
echo "Analyze the results in: $TEMP_DIR"
echo ""
echo "Quick summary:"
for file in "$TEMP_DIR"/*.json; do
    if [ -f "$file" ] && [ "$(basename "$file")" != "fetch-summary.json" ]; then
        echo "- $(basename "$file"):"
        # Show first few tokens as example
        jq -r 'if type == "array" then .[0:3] | .[] | "    \(.symbol // .name // "unknown")" elif .records then .records[0:3] | .[] | "    \(.symbol // .name // "unknown")" elif .tokens then .tokens | to_entries[0:3] | .[] | "    \(.value.symbol // .key)" elif .data then .data[0:3] | .[] | "    \(.symbol // .name // "unknown")" else "    (unknown structure)" end' "$file" 2>/dev/null || echo "    (unable to parse)"
    fi
done