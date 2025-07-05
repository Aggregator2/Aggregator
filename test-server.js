const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('Starting test server to check environment...');

// Check for critical modules
const modules = ['next', 'react', 'react-dom', 'ethers', '@lifi/sdk'];
const missingModules = [];

modules.forEach(mod => {
  try {
    require.resolve(mod);
    console.log(`✓ ${mod} is available`);
  } catch (e) {
    console.log(`✗ ${mod} is missing`);
    missingModules.push(mod);
  }
});

if (missingModules.length > 0) {
  console.log('\nMissing critical modules:', missingModules.join(', '));
  console.log('\nTrying to start simple HTTP server instead...');
  
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>SwappiQ - Dependencies Missing</title></head>
        <body>
          <h1>SwappiQ - Dependencies Installation Required</h1>
          <p>The following critical modules are missing:</p>
          <ul>
            ${missingModules.map(m => `<li>${m}</li>`).join('')}
          </ul>
          <p>Please run: <code>npm install</code></p>
        </body>
      </html>
    `);
  });
  
  server.listen(3000, () => {
    console.log('Test server running on http://localhost:3000');
  });
} else {
  console.log('\nAll critical modules are available! Trying to start Next.js...');
  // Try to start Next.js
  const next = require('next');
  const app = next({ dev: true });
  const handle = app.getRequestHandler();
  
  app.prepare().then(() => {
    http.createServer((req, res) => {
      handle(req, res);
    }).listen(3000, () => {
      console.log('Next.js running on http://localhost:3000');
    });
  });
}