#!/bin/bash
# Kill existing Next.js servers
pkill -f "next-server"
pkill -f "npm run dev"

# Clear Next.js cache
rm -rf .next/cache

# Ensure Redis is running
if ! pgrep -x "redis-server" > /dev/null; then
    redis-server --daemonize yes
fi

# Ensure Hardhat is running
if ! pgrep -f "hardhat node" > /dev/null; then
    npx hardhat node &
fi

echo "Environment cleaned up and services started"