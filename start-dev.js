#!/usr/bin/env node

console.log('🚀 Starting development server...\n');

// Skip the problematic startup checks
process.env.SKIP_STARTUP_CHECKS = 'true';

// Use child_process to run Next.js
const { spawn } = require('child_process');
const path = require('path');

// Try to find Next.js
const nextPaths = [
  'node_modules/.bin/next',
  'node_modules/next/dist/bin/next',
  path.join(process.cwd(), 'node_modules/.bin/next')
];

let nextPath = null;
for (const p of nextPaths) {
  try {
    require.resolve(p);
    nextPath = p;
    break;
  } catch (e) {
    // Continue to next path
  }
}

if (!nextPath) {
  console.log('Using npx to run Next.js...');
  const npx = spawn('npx', ['next', 'dev'], {
    stdio: 'inherit',
    shell: true
  });
  
  npx.on('error', (err) => {
    console.error('Failed to start:', err);
  });
  
  npx.on('exit', (code) => {
    process.exit(code);
  });
} else {
  console.log(`Found Next.js at: ${nextPath}`);
  const next = spawn('node', [nextPath, 'dev'], {
    stdio: 'inherit'
  });
  
  next.on('error', (err) => {
    console.error('Failed to start:', err);
  });
  
  next.on('exit', (code) => {
    process.exit(code);
  });
}