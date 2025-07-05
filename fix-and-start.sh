#!/bin/bash

echo "🚀 SwappiQ Application Startup Script"
echo "===================================="

# Check if we can use the standalone server
if [ -f "swappiq-standalone.js" ]; then
    echo "✅ Starting SwappiQ Full Application (Standalone Mode)"
    node swappiq-standalone.js
    exit 0
fi

# Try to fix dependencies
echo "🔧 Attempting to fix dependencies..."

# Check for critical packages
if [ ! -d "node_modules/react" ] || [ ! -d "node_modules/next" ]; then
    echo "📦 Critical packages missing. Attempting minimal install..."
    
    # Try npm with different registries
    echo "Trying npm install with default registry..."
    timeout 30s npm install react react-dom next --no-save 2>/dev/null
    
    if [ $? -ne 0 ]; then
        echo "Trying with npmjs registry..."
        timeout 30s npm install react react-dom next --registry https://registry.npmjs.org --no-save 2>/dev/null
    fi
    
    if [ $? -ne 0 ]; then
        echo "Trying with npm mirror..."
        timeout 30s npm install react react-dom next --registry https://registry.npm.taobao.org --no-save 2>/dev/null
    fi
fi

# Check if Next.js is available
if [ -f "node_modules/.bin/next" ]; then
    echo "✅ Next.js found. Starting development server..."
    node_modules/.bin/next dev
elif command -v npx &> /dev/null; then
    echo "📦 Attempting to run with npx..."
    npx next dev
else
    echo "❌ Unable to start Next.js application"
    echo "✅ Starting standalone server instead..."
    node swappiq-standalone.js
fi