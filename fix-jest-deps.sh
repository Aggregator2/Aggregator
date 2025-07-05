#!/bin/bash

echo "Fixing Jest and jsdom dependencies..."

# Clean up problematic modules
echo "Step 1: Cleaning up old modules..."
rm -rf node_modules/jsdom node_modules/tough-cookie node_modules/@jest node_modules/jest* 2>/dev/null

# Clear npm cache
echo "Step 2: Clearing npm cache..."
npm cache clean --force

# Install specific versions that work together
echo "Step 3: Installing compatible versions..."
npm install --save-dev jest@29.7.0 jest-environment-jsdom@29.7.0 @types/jest@29.5.12 ts-jest@29.1.2 @testing-library/jest-dom@6.4.2 --legacy-peer-deps

# If that fails, try yarn
if [ $? -ne 0 ]; then
    echo "npm install failed, trying with yarn..."
    yarn add -D jest@29.7.0 jest-environment-jsdom@29.7.0 @types/jest@29.5.12 ts-jest@29.1.2 @testing-library/jest-dom@6.4.2
fi

echo "Step 4: Verifying installation..."
npm list jsdom tough-cookie

echo "Done! Try running 'npx jest' now."