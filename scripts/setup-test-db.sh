#!/bin/bash

echo "🔧 Setting up test database..."

# Check if PostgreSQL is running
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Please install it first."
    echo "   macOS: brew install postgresql"
    echo "   Ubuntu: sudo apt-get install postgresql"
    exit 1
fi

# Create test database
echo "Creating test database..."
createdb trading_platform_test 2>/dev/null || echo "Database already exists"

# Run schema
echo "Running database schema..."
psql -d trading_platform_test < src/database/schema.sql 2>/dev/null || {
    echo "❌ Failed to run schema. Make sure PostgreSQL is running."
    echo "   Try: brew services start postgresql (macOS)"
    echo "   Or: sudo service postgresql start (Ubuntu)"
    exit 1
}

echo "✅ Test database ready!"