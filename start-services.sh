#!/bin/bash

echo "🚀 Starting required services for the trading system..."

# 1. Generate Prisma client
echo "📦 Generating Prisma client..."
npx prisma generate

# 2. Run database migrations
echo "🗄️ Running database migrations..."
npx prisma migrate deploy

# 3. Start Redis (if installed)
if command -v redis-server &> /dev/null; then
    echo "🔴 Starting Redis..."
    redis-server --daemonize yes
else
    echo "⚠️  Redis not found. Install with: sudo apt-get install redis-server"
fi

# 4. Start local blockchain (optional for testing)
echo "⛓️ Starting local Hardhat node (optional)..."
npx hardhat node &

# 5. Start the main application
echo "🎯 Starting the application..."
npm run dev &

# 6. Start WebSocket server
echo "🔌 WebSocket server will start with the main app on port 3001"

echo "✅ Services starting up..."
echo "📊 Main app: http://localhost:3000"
echo "🔌 WebSocket: ws://localhost:3001"
echo "⛓️ Hardhat: http://localhost:8545"

# Wait for services
sleep 5

# Check health
echo "🏥 Checking system health..."
curl -s http://localhost:3000/api/health | jq '.' || echo "Health check pending..."