#!/bin/bash

echo "Starting production build..."

# Clean previous build
rm -rf .next

# Set production environment
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1

# Build with increased memory
NODE_OPTIONS="--max-old-space-size=4096" npm run build

echo "Build completed!"