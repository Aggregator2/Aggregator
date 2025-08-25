import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../../styles/ApiDocs.module.css';

const ApiDocumentation = () => {
  const [activeEndpoint, setActiveEndpoint] = useState('get-quote');
  const [apiKey, setApiKey] = useState('YOUR_API_KEY');
  const [testResponse, setTestResponse] = useState(null);

  const endpoints = [
    {
      id: 'get-quote',
      method: 'GET',
      path: '/api/quote',
      title: 'Get Quote',
      description: 'Fetch the best available quote for a token swap',
      category: 'Trading'
    },
    {
      id: 'create-order',
      method: 'POST',
      path: '/api/orders/create',
      title: 'Create Order',
      description: 'Create a new off-chain order',
      category: 'Trading'
    },
    {
      id: 'submit-order',
      method: 'POST',
      path: '/api/orders/submit',
      title: 'Submit Order',
      description: 'Submit a signed order for execution',
      category: 'Trading'
    },
    {
      id: 'order-status',
      method: 'GET',
      path: '/api/orders/:orderId',
      title: 'Get Order Status',
      description: 'Check the status of a submitted order',
      category: 'Trading'
    },
    {
      id: 'get-tokens',
      method: 'GET',
      path: '/api/tokens',
      title: 'List Tokens',
      description: 'Get list of supported tokens',
      category: 'Tokens'
    },
    {
      id: 'token-price',
      method: 'GET',
      path: '/api/tokens/:address/price',
      title: 'Get Token Price',
      description: 'Get current price for a token',
      category: 'Tokens'
    },
    {
      id: 'get-nonce',
      method: 'GET',
      path: '/api/nonce',
      title: 'Get Nonce',
      description: 'Generate a unique nonce for order creation',
      category: 'Utils'
    }
  ];

  const endpointDetails = {
    'get-quote': {
      description: 'Returns the best available quote across all integrated liquidity sources including 0x, 1inch, Paraswap, and our solver network. Note: SwappiQ charges a transparent 0.3% platform fee which is clearly shown in the response.',
      parameters: [
        { name: 'sellToken', type: 'string', required: true, description: 'Token address or symbol to sell' },
        { name: 'buyToken', type: 'string', required: true, description: 'Token address or symbol to buy' },
        { name: 'sellAmount', type: 'string', required: false, description: 'Amount to sell (in wei)' },
        { name: 'buyAmount', type: 'string', required: false, description: 'Amount to buy (in wei)' },
        { name: 'chainId', type: 'number', required: false, description: 'Source chain ID (default: 1)' },
        { name: 'toChainId', type: 'number', required: false, description: 'Destination chain ID for cross-chain swaps' },
        { name: 'slippageTolerance', type: 'string', required: false, description: 'Slippage tolerance percentage (default: 0.5)' }
      ],
      example: {
        request: `curl -X GET 'https://api.swappiq.io/v1/quote?sellToken=WETH&buyToken=USDC&sellAmount=1000000000000000000' \\
  -H 'X-API-Key: YOUR_API_KEY'`,
        response: `{
  "sellToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "buyToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "sellAmount": "1000000000000000000",
  "buyAmount": "2345000000",
  "buyAmountBeforeFee": "2352045000",
  "price": "2345.00",
  "sources": [
    { "name": "0x", "proportion": "0.6" },
    { "name": "1inch", "proportion": "0.4" }
  ],
  "estimatedGas": "150000",
  "validTo": 1704067200,
  "lpFee": "2000000000000000",
  "platformFee": {
    "amount": "7045000",
    "percentage": 0.3,
    "bps": 30
  },
  "feeBreakdown": {
    "platformFee": "7045000",
    "platformFeePercent": "0.3%",
    "buyAmountBeforeFee": "2352045000",
    "buyAmountAfterFee": "2345000000"
  }
}`
      }
    },
    'create-order': {
      description: 'Creates an unsigned order object that can be signed client-side using EIP-712.',
      parameters: [
        { name: 'sellToken', type: 'string', required: true, description: 'Token address to sell' },
        { name: 'buyToken', type: 'string', required: true, description: 'Token address to buy' },
        { name: 'sellAmount', type: 'string', required: true, description: 'Amount to sell (in wei)' },
        { name: 'buyAmount', type: 'string', required: true, description: 'Minimum amount to receive (in wei)' },
        { name: 'wallet', type: 'string', required: true, description: 'User wallet address' },
        { name: 'validTo', type: 'number', required: false, description: 'Order expiration timestamp' },
        { name: 'partiallyFillable', type: 'boolean', required: false, description: 'Allow partial fills (default: false)' }
      ],
      example: {
        request: `curl -X POST 'https://api.swappiq.io/v1/orders/create' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: YOUR_API_KEY' \\
  -d '{
    "sellToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "buyToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "sellAmount": "1000000000000000000",
    "buyAmount": "2300000000",
    "wallet": "0x1234567890123456789012345678901234567890"
  }'`,
        response: `{
  "order": {
    "sellToken": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "buyToken": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    "sellAmount": "1000000000000000000",
    "buyAmount": "2300000000",
    "validTo": 1704067200,
    "user": "0x1234567890123456789012345678901234567890",
    "receiver": "0x1234567890123456789012345678901234567890",
    "nonce": "1704063600123456",
    "feeAmount": "2000000000000000",
    "kind": "sell",
    "partiallyFillable": false,
    "signingScheme": "eip712"
  },
  "signingData": {
    "domain": {
      "name": "SwappiQ",
      "version": "1",
      "chainId": 1,
      "verifyingContract": "0x..."
    },
    "types": { ... },
    "value": { ... }
  }
}`
      }
    },
    'submit-order': {
      description: 'Submit a signed order to the Swappiq network for execution.',
      parameters: [
        { name: 'order', type: 'object', required: true, description: 'The order object from create endpoint' },
        { name: 'signature', type: 'string', required: true, description: 'EIP-712 signature of the order' }
      ],
      example: {
        request: `curl -X POST 'https://api.swappiq.io/v1/orders/submit' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: YOUR_API_KEY' \\
  -d '{
    "order": { ... },
    "signature": "0x..."
  }'`,
        response: `{
  "orderId": "0x123...abc",
  "status": "pending",
  "createdAt": "2024-01-01T12:00:00Z",
  "estimatedSettlement": "2024-01-01T12:00:30Z"
}`
      }
    }
  };

  const runTest = async () => {
    setTestResponse('loading');
    try {
      const response = await fetch('/api/quote?' + new URLSearchParams({
        sellToken: 'WETH',
        buyToken: 'USDC',
        sellAmount: '1000000000000000000'
      }));
      const data = await response.json();
      setTestResponse(JSON.stringify(data, null, 2));
    } catch (error) {
      setTestResponse(JSON.stringify({ error: error.message }, null, 2));
    }
  };

  const currentEndpointDetail = endpointDetails[activeEndpoint] || endpointDetails['get-quote'];
  const currentEndpoint = endpoints.find(e => e.id === activeEndpoint);

  // Group endpoints by category
  const groupedEndpoints = endpoints.reduce((acc, endpoint) => {
    if (!acc[endpoint.category]) acc[endpoint.category] = [];
    acc[endpoint.category].push(endpoint);
    return acc;
  }, {});

  return (
    <>
      <Head>
        <title>API Documentation - Swappiq Developer Portal</title>
        <meta name="description" content="Complete API reference for Swappiq's off-chain settlement protocol" />
      </Head>

      <div className={styles.apiDocs}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <Link href="/" className={styles.logo}>
              <img src="/images/swappiq-logo.png" alt="Swappiq" />
            </Link>
            <nav className={styles.nav}>
              <Link href="/developers">Overview</Link>
              <Link href="/developers/api" className={styles.active}>API</Link>
              <Link href="/developers/sdk">SDK</Link>
              <Link href="/developers/guides">Guides</Link>
              <Link href="/developers/examples">Examples</Link>
            </nav>
          </div>
        </header>

        <div className={styles.docsContainer}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <h3>API Reference</h3>
              <span className={styles.version}>v1.0</span>
            </div>
            
            <div className={styles.apiKeyInput}>
              <label>API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
              />
            </div>

            <div className={styles.endpointList}>
              {Object.entries(groupedEndpoints).map(([category, categoryEndpoints]) => (
                <div key={category} className={styles.endpointCategory}>
                  <h4>{category}</h4>
                  {categoryEndpoints.map(endpoint => (
                    <button
                      key={endpoint.id}
                      className={`${styles.endpointItem} ${activeEndpoint === endpoint.id ? styles.active : ''}`}
                      onClick={() => setActiveEndpoint(endpoint.id)}
                    >
                      <span className={`${styles.method} ${styles[endpoint.method.toLowerCase()]}`}>
                        {endpoint.method}
                      </span>
                      <span className={styles.endpointTitle}>{endpoint.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          {/* Main Content */}
          <main className={styles.mainContent}>
            <div className={styles.endpointHeader}>
              <h1>{currentEndpoint?.title}</h1>
              <div className={styles.endpointPath}>
                <span className={`${styles.methodBadge} ${styles[currentEndpoint?.method.toLowerCase()]}`}>
                  {currentEndpoint?.method}
                </span>
                <code>{currentEndpoint?.path}</code>
              </div>
            </div>

            <section className={styles.description}>
              <p>{currentEndpointDetail.description}</p>
            </section>

            {/* Parameters */}
            {currentEndpointDetail.parameters && (
              <section className={styles.parameters}>
                <h2>Parameters</h2>
                <table className={styles.paramTable}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentEndpointDetail.parameters.map((param, index) => (
                      <tr key={index}>
                        <td><code>{param.name}</code></td>
                        <td><span className={styles.type}>{param.type}</span></td>
                        <td>
                          <span className={param.required ? styles.required : styles.optional}>
                            {param.required ? 'Required' : 'Optional'}
                          </span>
                        </td>
                        <td>{param.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Example */}
            {currentEndpointDetail.example && (
              <section className={styles.example}>
                <h2>Example</h2>
                
                <div className={styles.codeSection}>
                  <h3>Request</h3>
                  <pre className={styles.codeBlock}>
                    <code>{currentEndpointDetail.example.request}</code>
                  </pre>
                </div>

                <div className={styles.codeSection}>
                  <h3>Response</h3>
                  <pre className={styles.codeBlock}>
                    <code>{currentEndpointDetail.example.response}</code>
                  </pre>
                </div>
              </section>
            )}

            {/* Try It */}
            <section className={styles.tryIt}>
              <h2>Try It</h2>
              <div className={styles.tryItBox}>
                <button onClick={runTest} className={styles.runButton}>
                  Run Test
                </button>
                {testResponse && (
                  <pre className={styles.responseBox}>
                    <code>{testResponse === 'loading' ? 'Loading...' : testResponse}</code>
                  </pre>
                )}
              </div>
            </section>

            {/* Rate Limits */}
            <section className={styles.rateLimits}>
              <h2>Rate Limits</h2>
              <div className={styles.infoBox}>
                <p>All API endpoints are rate limited to ensure fair usage:</p>
                <ul>
                  <li>Free tier: 100 requests per minute</li>
                  <li>Pro tier: 1,000 requests per minute</li>
                  <li>Enterprise: Custom limits available</li>
                </ul>
              </div>
            </section>

            {/* Error Codes */}
            <section className={styles.errorCodes}>
              <h2>Error Codes</h2>
              <table className={styles.errorTable}>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>400</code></td>
                    <td>Bad Request - Invalid parameters</td>
                  </tr>
                  <tr>
                    <td><code>401</code></td>
                    <td>Unauthorized - Invalid or missing API key</td>
                  </tr>
                  <tr>
                    <td><code>404</code></td>
                    <td>Not Found - Resource not found</td>
                  </tr>
                  <tr>
                    <td><code>429</code></td>
                    <td>Too Many Requests - Rate limit exceeded</td>
                  </tr>
                  <tr>
                    <td><code>500</code></td>
                    <td>Internal Server Error</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </main>
        </div>
      </div>
    </>
  );
};

export default ApiDocumentation;