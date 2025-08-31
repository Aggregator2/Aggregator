// Test to trace decimal precision warnings

const { spawn } = require('child_process');

// Start the server
const server = spawn('npm', ['run', 'dev'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true
});

// Wait for server to start
setTimeout(async () => {
  console.log('Testing small amount quote to trigger precision warnings...\n');
  
  try {
    const response = await fetch('http://localhost:3000/api/quote-profitable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
        buyToken: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
        sellAmount: '100', // 0.0001 USDC (very small amount)
        chainId: 1,
        toChainId: 1,
        slippageTolerance: '0.5'
      })
    });

    const data = await response.json();
    console.log('Response:', data);
    
    // Kill server after test
    setTimeout(() => {
      server.kill();
      process.exit(0);
    }, 1000);
    
  } catch (error) {
    console.error('Error:', error);
    server.kill();
    process.exit(1);
  }
}, 3000);

// Capture server output
server.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('Precision warning') || output.includes('Quote Request') || output.includes('quote received')) {
    console.log('Server:', output.trim());
  }
});

server.stderr.on('data', (data) => {
  const output = data.toString();
  if (output.includes('Precision warning') || output.includes('Quote Request') || output.includes('quote received')) {
    console.log('Server Error:', output.trim());
  }
});