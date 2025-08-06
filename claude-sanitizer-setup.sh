#!/bin/bash

# Alternative approach: Create a preprocessing script that sanitizes files

echo "Creating Claude parsing fix..."

# Create a script that creates sanitized versions of files for Claude analysis
cat > prepare-for-claude.sh << 'EOF'
#!/bin/bash

# Create sanitized versions of files for Claude analysis
mkdir -p .claude-safe

# Function to sanitize JavaScript/TypeScript files
sanitize_js_file() {
    local input_file="$1"
    local output_file="$2"
    
    # Replace problematic patterns with safe alternatives
    sed 's/walletAddress\.toLowerCase/WALLET_ADDRESS_LOWER/g' "$input_file" | \
    sed 's/\.toLowerCase(/\.toLowerCase_SAFE(/g' | \
    sed 's/\.toUpperCase(/\.toUpperCase_SAFE(/g' | \
    sed 's/\${[^}]*\.[^}]*}/SAFE_SUBSTITUTION/g' > "$output_file"
}

# Process key files
for file in components/*.tsx src/**/*.ts src/**/*.tsx; do
    if [ -f "$file" ]; then
        safe_file=".claude-safe/${file}"
        mkdir -p "$(dirname "$safe_file")"
        sanitize_js_file "$file" "$safe_file"
        echo "Sanitized: $file -> $safe_file"
    fi
done

echo "Sanitized files created in .claude-safe/"
echo "Use: claude-code .claude-safe/ for safe analysis"
EOF

chmod +x prepare-for-claude.sh

echo "Fix scripts created!"
echo "Run: chmod +x claude-exclude-setup.sh && ./claude-exclude-setup.sh"
