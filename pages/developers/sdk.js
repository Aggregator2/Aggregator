import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../../styles/SdkDocs.module.css';

const SdkDocumentation = () => {
  const [activeTab, setActiveTab] = useState('installation');
  const [selectedLanguage, setSelectedLanguage] = useState('typescript');

  const codeExamples = {
    installation: {
      typescript: `npm install @swappiq/sdk
# or
yarn add @swappiq/sdk
# or
pnpm add @swappiq/sdk`,
      python: `pip install swappiq-sdk`,
      go: `go get github.com/swappiq/sdk-go`
    },
    initialization: {
      typescript: `import { SwappiqSDK } from '@swappiq/sdk';

const sdk = new SwappiqSDK({
  apiKey: 'YOUR_API_KEY',
  network: 'mainnet', // or 'testnet'
  options: {
    timeout: 30000,
    retries: 3
  }
});`,
      python: `from swappiq import SwappiqSDK

sdk = SwappiqSDK(
    api_key="YOUR_API_KEY",
    network="mainnet",  # or "testnet"
    options={
        "timeout": 30000,
        "retries": 3
    }
)`,
      go: `import "github.com/swappiq/sdk-go"

sdk := swappiq.NewSDK(
    swappiq.WithAPIKey("YOUR_API_KEY"),
    swappiq.WithNetwork("mainnet"),
    swappiq.WithTimeout(30 * time.Second),
)`
    },
    getQuote: {
      typescript: `// Get a quote for swapping WETH to USDC
const quote = await sdk.quote.get({
  sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  buyToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
  sellAmount: '1000000000000000000', // 1 WETH
  slippageTolerance: 0.5, // 0.5%
  options: {
    excludeSources: ['Uniswap'], // Optional: exclude specific sources
    includePrice: true
  }
});

console.log('Quote:', {
  buyAmount: quote.buyAmount,
  price: quote.price,
  sources: quote.sources,
  estimatedGas: quote.estimatedGas
});`,
      python: `# Get a quote for swapping WETH to USDC
quote = await sdk.quote.get(
    sell_token="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",  # WETH
    buy_token="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",   # USDC
    sell_amount="1000000000000000000",  # 1 WETH
    slippage_tolerance=0.5,  # 0.5%
    options={
        "exclude_sources": ["Uniswap"],
        "include_price": True
    }
)

print(f"Quote: {quote.buy_amount}")
print(f"Price: {quote.price}")
print(f"Sources: {quote.sources}")`,
      go: `// Get a quote for swapping WETH to USDC
quote, err := sdk.Quote.Get(context.Background(), &swappiq.QuoteParams{
    SellToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    BuyToken:  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
    SellAmount: "1000000000000000000", // 1 WETH
    SlippageTolerance: 0.5,
    Options: &swappiq.QuoteOptions{
        ExcludeSources: []string{"Uniswap"},
        IncludePrice: true,
    },
})

if err != nil {
    log.Fatal(err)
}

fmt.Printf("Quote: %s\\n", quote.BuyAmount)
fmt.Printf("Price: %f\\n", quote.Price)`
    },
    createOrder: {
      typescript: `// Create and sign an order
const order = await sdk.orders.create({
  sellToken: quote.sellToken,
  buyToken: quote.buyToken,
  sellAmount: quote.sellAmount,
  buyAmount: quote.buyAmount,
  wallet: '0x1234...', // User's wallet address
  validTo: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
  partiallyFillable: false
});

// Sign the order using the connected wallet
const signature = await sdk.orders.sign(order, signer);

// Submit the signed order
const result = await sdk.orders.submit({
  order,
  signature
});

console.log('Order ID:', result.orderId);
console.log('Status:', result.status);`,
      python: `# Create and sign an order
order = await sdk.orders.create(
    sell_token=quote.sell_token,
    buy_token=quote.buy_token,
    sell_amount=quote.sell_amount,
    buy_amount=quote.buy_amount,
    wallet="0x1234...",  # User's wallet address
    valid_to=int(time.time()) + 1800,  # 30 minutes
    partially_fillable=False
)

# Sign the order using the connected wallet
signature = await sdk.orders.sign(order, signer)

# Submit the signed order
result = await sdk.orders.submit(
    order=order,
    signature=signature
)

print(f"Order ID: {result.order_id}")
print(f"Status: {result.status}")`,
      go: `// Create and sign an order
order, err := sdk.Orders.Create(context.Background(), &swappiq.OrderParams{
    SellToken: quote.SellToken,
    BuyToken: quote.BuyToken,
    SellAmount: quote.SellAmount,
    BuyAmount: quote.BuyAmount,
    Wallet: "0x1234...",
    ValidTo: time.Now().Add(30 * time.Minute).Unix(),
    PartiallyFillable: false,
})

// Sign the order
signature, err := sdk.Orders.Sign(order, signer)

// Submit the signed order
result, err := sdk.Orders.Submit(context.Background(), &swappiq.SubmitParams{
    Order: order,
    Signature: signature,
})

fmt.Printf("Order ID: %s\\n", result.OrderID)
fmt.Printf("Status: %s\\n", result.Status)`
    },
    orderStatus: {
      typescript: `// Check order status
const status = await sdk.orders.getStatus(orderId);

console.log('Order Status:', status.status);
console.log('Filled Amount:', status.filledAmount);
console.log('Remaining Amount:', status.remainingAmount);

// Subscribe to order updates
const unsubscribe = sdk.orders.subscribe(orderId, (update) => {
  console.log('Order Update:', update);
  
  if (update.status === 'filled') {
    console.log('Order completed!');
    unsubscribe();
  }
});`,
      python: `# Check order status
status = await sdk.orders.get_status(order_id)

print(f"Order Status: {status.status}")
print(f"Filled Amount: {status.filled_amount}")
print(f"Remaining Amount: {status.remaining_amount}")

# Subscribe to order updates
async def handle_update(update):
    print(f"Order Update: {update}")
    
    if update.status == "filled":
        print("Order completed!")

unsubscribe = await sdk.orders.subscribe(order_id, handle_update)`,
      go: `// Check order status
status, err := sdk.Orders.GetStatus(context.Background(), orderID)

fmt.Printf("Order Status: %s\\n", status.Status)
fmt.Printf("Filled Amount: %s\\n", status.FilledAmount)

// Subscribe to order updates
updates, err := sdk.Orders.Subscribe(context.Background(), orderID)

for update := range updates {
    fmt.Printf("Order Update: %+v\\n", update)
    
    if update.Status == "filled" {
        fmt.Println("Order completed!")
        break
    }
}`
    },
    crossChain: {
      typescript: `// Cross-chain swap from Ethereum WETH to Polygon USDC
const crossChainQuote = await sdk.quote.getCrossChain({
  sellToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum
  buyToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',  // USDC on Polygon
  sellAmount: '1000000000000000000',
  fromChainId: 1,    // Ethereum
  toChainId: 137,    // Polygon
  toAddress: userAddress // Recipient address on Polygon
});

// Create cross-chain order
const crossChainOrder = await sdk.orders.createCrossChain({
  quote: crossChainQuote,
  wallet: userAddress,
  validTo: Math.floor(Date.now() / 1000) + 3600 // 1 hour for cross-chain
});

// Track cross-chain progress
const tracker = sdk.crossChain.track(crossChainOrder.orderId);

tracker.on('sourceConfirmed', (data) => {
  console.log('Tokens locked on source chain:', data);
});

tracker.on('bridgeInitiated', (data) => {
  console.log('Bridge transfer initiated:', data);
});

tracker.on('destinationConfirmed', (data) => {
  console.log('Tokens received on destination:', data);
});`,
      python: `# Cross-chain swap from Ethereum WETH to Polygon USDC
cross_chain_quote = await sdk.quote.get_cross_chain(
    sell_token="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",  # WETH on Ethereum
    buy_token="0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",   # USDC on Polygon
    sell_amount="1000000000000000000",
    from_chain_id=1,     # Ethereum
    to_chain_id=137,     # Polygon
    to_address=user_address  # Recipient address on Polygon
)

# Create cross-chain order
cross_chain_order = await sdk.orders.create_cross_chain(
    quote=cross_chain_quote,
    wallet=user_address,
    valid_to=int(time.time()) + 3600  # 1 hour for cross-chain
)

# Track cross-chain progress
async def on_source_confirmed(data):
    print(f"Tokens locked on source chain: {data}")

async def on_bridge_initiated(data):
    print(f"Bridge transfer initiated: {data}")

async def on_destination_confirmed(data):
    print(f"Tokens received on destination: {data}")

tracker = sdk.cross_chain.track(
    cross_chain_order.order_id,
    on_source_confirmed=on_source_confirmed,
    on_bridge_initiated=on_bridge_initiated,
    on_destination_confirmed=on_destination_confirmed
)`,
      go: `// Cross-chain swap from Ethereum WETH to Polygon USDC
crossChainQuote, err := sdk.Quote.GetCrossChain(ctx, &swappiq.CrossChainQuoteParams{
    SellToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on Ethereum
    BuyToken:  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC on Polygon
    SellAmount: "1000000000000000000",
    FromChainID: 1,   // Ethereum
    ToChainID: 137,   // Polygon
    ToAddress: userAddress,
})

// Create cross-chain order
crossChainOrder, err := sdk.Orders.CreateCrossChain(ctx, &swappiq.CrossChainOrderParams{
    Quote: crossChainQuote,
    Wallet: userAddress,
    ValidTo: time.Now().Add(time.Hour).Unix(),
})

// Track cross-chain progress
tracker := sdk.CrossChain.Track(ctx, crossChainOrder.OrderID)

go func() {
    for event := range tracker.Events {
        switch event.Type {
        case "sourceConfirmed":
            fmt.Println("Tokens locked on source chain")
        case "bridgeInitiated":
            fmt.Println("Bridge transfer initiated")
        case "destinationConfirmed":
            fmt.Println("Tokens received on destination")
        }
    }
}()`
    }
  };

  const features = [
    {
      title: 'Type Safety',
      description: 'Full TypeScript support with comprehensive type definitions',
      icon: '🔒'
    },
    {
      title: 'Auto-retry',
      description: 'Automatic retry logic with exponential backoff',
      icon: '🔄'
    },
    {
      title: 'WebSocket Support',
      description: 'Real-time order updates via WebSocket connections',
      icon: '⚡'
    },
    {
      title: 'Cross-chain',
      description: 'Native support for cross-chain swaps and bridges',
      icon: '🌉'
    }
  ];

  return (
    <>
      <Head>
        <title>SDK Documentation - Swappiq Developer Portal</title>
        <meta name="description" content="Official SDK documentation for integrating with Swappiq protocol" />
      </Head>

      <div className={styles.sdkDocs}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerContent}>
            <Link href="/" className={styles.logo}>
              <img src="/images/swappiq-logo.png" alt="Swappiq" />
            </Link>
            <nav className={styles.nav}>
              <Link href="/developers">Overview</Link>
              <Link href="/developers/api">API</Link>
              <Link href="/developers/sdk" className={styles.active}>SDK</Link>
              <Link href="/developers/guides">Guides</Link>
              <Link href="/developers/examples">Examples</Link>
            </nav>
          </div>
        </header>

        <div className={styles.container}>
          {/* Hero */}
          <section className={styles.hero}>
            <h1>Swappiq SDK</h1>
            <p className={styles.heroDescription}>
              Official SDKs for integrating Swappiq's off-chain settlement protocol into your application. 
              Available for TypeScript, Python, and Go.
            </p>
            
            {/* Language Selector */}
            <div className={styles.languageSelector}>
              <button
                className={selectedLanguage === 'typescript' ? styles.active : ''}
                onClick={() => setSelectedLanguage('typescript')}
              >
                TypeScript
              </button>
              <button
                className={selectedLanguage === 'python' ? styles.active : ''}
                onClick={() => setSelectedLanguage('python')}
              >
                Python
              </button>
              <button
                className={selectedLanguage === 'go' ? styles.active : ''}
                onClick={() => setSelectedLanguage('go')}
              >
                Go
              </button>
            </div>
          </section>

          {/* Features */}
          <section className={styles.features}>
            <div className={styles.featureGrid}>
              {features.map((feature, index) => (
                <div key={index} className={styles.featureCard}>
                  <span className={styles.featureIcon}>{feature.icon}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Code Examples */}
          <section className={styles.codeExamples}>
            {/* Tabs */}
            <div className={styles.tabs}>
              <button
                className={activeTab === 'installation' ? styles.active : ''}
                onClick={() => setActiveTab('installation')}
              >
                Installation
              </button>
              <button
                className={activeTab === 'initialization' ? styles.active : ''}
                onClick={() => setActiveTab('initialization')}
              >
                Initialization
              </button>
              <button
                className={activeTab === 'getQuote' ? styles.active : ''}
                onClick={() => setActiveTab('getQuote')}
              >
                Get Quote
              </button>
              <button
                className={activeTab === 'createOrder' ? styles.active : ''}
                onClick={() => setActiveTab('createOrder')}
              >
                Create Order
              </button>
              <button
                className={activeTab === 'orderStatus' ? styles.active : ''}
                onClick={() => setActiveTab('orderStatus')}
              >
                Order Status
              </button>
              <button
                className={activeTab === 'crossChain' ? styles.active : ''}
                onClick={() => setActiveTab('crossChain')}
              >
                Cross-chain
              </button>
            </div>

            {/* Code Display */}
            <div className={styles.codeDisplay}>
              <pre className={styles.codeBlock}>
                <code>{codeExamples[activeTab][selectedLanguage]}</code>
              </pre>
            </div>
          </section>

          {/* Advanced Features */}
          <section className={styles.advanced}>
            <h2>Advanced Features</h2>
            <div className={styles.advancedGrid}>
              <div className={styles.advancedCard}>
                <h3>State Channels</h3>
                <p>Enable high-frequency trading with instant finality</p>
                <pre className={styles.miniCode}>
                  <code>{`const channel = await sdk.stateChannels.open({
  counterparty: '0xabc...',
  collateral: '1000000000000000000'
});`}</code>
                </pre>
              </div>
              
              <div className={styles.advancedCard}>
                <h3>MEV Protection</h3>
                <p>Built-in MEV protection for all orders</p>
                <pre className={styles.miniCode}>
                  <code>{`const order = await sdk.orders.create({
  ...params,
  mevProtection: {
    enabled: true,
    maxSlippage: 0.5
  }
});`}</code>
                </pre>
              </div>

              <div className={styles.advancedCard}>
                <h3>Batch Operations</h3>
                <p>Submit multiple orders in a single transaction</p>
                <pre className={styles.miniCode}>
                  <code>{`const results = await sdk.orders.batchSubmit([
  { order: order1, signature: sig1 },
  { order: order2, signature: sig2 }
]);`}</code>
                </pre>
              </div>
            </div>
          </section>

          {/* Reference */}
          <section className={styles.reference}>
            <h2>API Reference</h2>
            <div className={styles.referenceGrid}>
              <div className={styles.referenceSection}>
                <h3>Core Classes</h3>
                <ul>
                  <li><code>SwappiqSDK</code> - Main SDK class</li>
                  <li><code>QuoteService</code> - Quote management</li>
                  <li><code>OrderService</code> - Order operations</li>
                  <li><code>CrossChainService</code> - Cross-chain swaps</li>
                </ul>
              </div>
              
              <div className={styles.referenceSection}>
                <h3>Events</h3>
                <ul>
                  <li><code>orderCreated</code> - Order creation event</li>
                  <li><code>orderFilled</code> - Order filled event</li>
                  <li><code>orderCancelled</code> - Order cancelled event</li>
                  <li><code>orderExpired</code> - Order expired event</li>
                </ul>
              </div>
              
              <div className={styles.referenceSection}>
                <h3>Error Handling</h3>
                <ul>
                  <li><code>SwappiqError</code> - Base error class</li>
                  <li><code>QuoteError</code> - Quote-related errors</li>
                  <li><code>OrderError</code> - Order-related errors</li>
                  <li><code>NetworkError</code> - Network errors</li>
                </ul>
              </div>
            </div>
          </section>

          {/* Links */}
          <section className={styles.links}>
            <h2>Resources</h2>
            <div className={styles.linkGrid}>
              <a href="https://github.com/swappiq/sdk-typescript" className={styles.linkCard}>
                <h3>TypeScript SDK</h3>
                <p>GitHub repository with examples</p>
                <span>→</span>
              </a>
              <a href="https://github.com/swappiq/sdk-python" className={styles.linkCard}>
                <h3>Python SDK</h3>
                <p>pip package and documentation</p>
                <span>→</span>
              </a>
              <a href="https://github.com/swappiq/sdk-go" className={styles.linkCard}>
                <h3>Go SDK</h3>
                <p>Go module and examples</p>
                <span>→</span>
              </a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
};

export default SdkDocumentation;