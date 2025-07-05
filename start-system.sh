#!/bin/bash

echo "🚀 Starting Off-Chain Settlement System"
echo "===================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating from template...${NC}"
    cp .env.test .env
    echo -e "${GREEN}✅ Created .env file${NC}"
fi

# Check PostgreSQL
echo -e "\n${YELLOW}1. Checking PostgreSQL...${NC}"
if command -v psql &> /dev/null; then
    echo -e "${GREEN}✅ PostgreSQL is installed${NC}"
    
    # Try to create database
    createdb trading_platform 2>/dev/null && echo -e "${GREEN}✅ Database created${NC}" || echo -e "${YELLOW}ℹ️  Database already exists${NC}"
    
    # Run schema
    if [ -f src/database/schema.sql ]; then
        psql -d trading_platform < src/database/schema.sql 2>/dev/null && echo -e "${GREEN}✅ Schema loaded${NC}" || echo -e "${YELLOW}ℹ️  Schema already exists${NC}"
    fi
else
    echo -e "${RED}❌ PostgreSQL not installed${NC}"
    echo "   For macOS: brew install postgresql && brew services start postgresql"
    echo "   For Ubuntu: sudo apt-get install postgresql"
    echo ""
    echo -e "${YELLOW}Running in MOCK mode (no database)${NC}"
fi

# Install dependencies if needed
echo -e "\n${YELLOW}2. Checking dependencies...${NC}"
if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi
echo -e "${GREEN}✅ Dependencies ready${NC}"

# Start the system
echo -e "\n${YELLOW}3. Starting services...${NC}"
echo -e "${GREEN}Starting Next.js development server...${NC}"
echo ""
echo "📍 Application URLs:"
echo "   - Frontend: http://localhost:3000"
echo "   - API: http://localhost:3000/api"
echo "   - WebSocket: http://localhost:3001"
echo ""
echo "📚 API Endpoints:"
echo "   - POST /api/submitOrder - Submit trading orders"
echo "   - GET  /api/orderStatus/[id] - Check order status"
echo "   - POST /api/trading/quote - Get aggregated quotes"
echo "   - GET  /api/websocket - WebSocket server info"
echo ""
echo -e "${GREEN}System is starting...${NC}"
echo "Press Ctrl+C to stop"
echo ""

# Start Next.js
npm run dev