#!/bin/bash

# Script to run Jest tests with proper configuration

echo "🧪 Running Jest Tests..."
echo "========================"

# Default to running all tests
TEST_PATTERN="${1:-}"

if [ -z "$TEST_PATTERN" ]; then
    echo "Running all tests..."
    npx jest --no-coverage
else
    echo "Running tests matching: $TEST_PATTERN"
    npx jest "$TEST_PATTERN" --no-coverage
fi

echo ""
echo "💡 Usage examples:"
echo "  ./run-jest-tests.sh                              # Run all tests"
echo "  ./run-jest-tests.sh __tests__/setup              # Run setup tests"
echo "  ./run-jest-tests.sh src/services                 # Run service tests"
echo "  ./run-jest-tests.sh --coverage                   # Run with coverage"
echo ""
echo "📝 Available test scripts in package.json:"
echo "  npm run test:unit         # Run unit tests with coverage"
echo "  npm run test:integration  # Run integration tests with coverage"
echo "  npm run test:all          # Run all tests with coverage"
echo "  npm run test:watch        # Run tests in watch mode"