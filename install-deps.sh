#!/bin/bash
set -e

echo "Installing critical dependencies for Next.js app..."

# Clean up existing node_modules
rm -rf node_modules package-lock.json

# Install core dependencies first
echo "Installing Next.js core..."
npm install --no-audit --no-fund next@15.3.2 react@18.3.1 react-dom@18.3.1

# Install ethers
echo "Installing ethers..."
npm install --no-audit --no-fund ethers@6.14.4

# Install LiFi SDK
echo "Installing LiFi SDK..."
npm install --no-audit --no-fund @lifi/sdk@3.7.9

# Install other critical dependencies
echo "Installing other dependencies..."
npm install --no-audit --no-fund \
  @prisma/client@6.10.1 \
  axios@1.10.0 \
  dotenv@16.5.0 \
  express@4.18.2 \
  styled-components@6.1.18

echo "Installation complete!"