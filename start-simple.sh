#!/bin/bash

# Simple start script that bypasses the verify-startup checks

echo "🚀 Starting Next.js development server directly..."
echo "⚠️  Skipping dependency checks due to Node.js v24 compatibility issues"
echo ""

# Kill any existing processes on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start Next.js directly without the predev script
NODE_ENV=development npx next dev --port 3000

echo "✅ Server should be running at http://localhost:3000"