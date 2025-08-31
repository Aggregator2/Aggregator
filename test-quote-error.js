const http = require('http');

const postData = JSON.stringify({
  sellToken: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  buyToken: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  sellAmount: '1000000',
  chainId: 1,
  slippageTolerance: '0.5'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/quote-profitable',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': postData.length
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('BODY:', data);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();