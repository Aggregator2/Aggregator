#!/bin/bash

echo "Running safe project analysis..."

# Create a temporary safe project summary
cat > PROJECT_SUMMARY.md << 'SUMMARY_EOF'
# Project Analysis Summary

## Package Information
SUMMARY_EOF

# Add package.json info safely
if [ -f package.json ]; then
    echo "### Dependencies" >> PROJECT_SUMMARY.md
    echo '```json' >> PROJECT_SUMMARY.md
    jq '.dependencies // {}' package.json >> PROJECT_SUMMARY.md
    echo '```' >> PROJECT_SUMMARY.md
fi

# Add README content
if [ -f README.md ]; then
    echo "### Project README" >> PROJECT_SUMMARY.md
    cat README.md >> PROJECT_SUMMARY.md
fi

echo "Safe project summary created in PROJECT_SUMMARY.md"
echo "Use: claude-code PROJECT_SUMMARY.md"
