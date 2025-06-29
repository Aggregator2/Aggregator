import { OracleService, OracleConfig } from './index';

const config: OracleConfig = {
  exchanges: [
    {
      name: 'Binance',
      apiUrl: 'https://api.binance.com',
      weight: 1.2,
      rateLimit: 20,
      timeout: 5000,
      enabled: true
    },
    {
      name: 'Coinbase',
      apiUrl: 'https://api.coinbase.com',
      weight: 1.0,
      rateLimit: 10,
      timeout: 5000,
      enabled: true
    },
    {
      name: 'Kraken',
      apiUrl: 'https://api.kraken.com',
      weight: 0.8,
      rateLimit: 5,
      timeout: 5000,
      enabled: true
    }
  ],
  outlierThreshold: 0.05,
  minSources: 2,
  maxPriceAge: 60000,
  volumeWeightEnabled: true,
  reputationEnabled: true
};

async function runOracle() {
  const oracle = new OracleService(config);

  oracle.on('manipulation-alert', (alert) => {
    console.warn('🚨 Manipulation detected:', alert);
  });

  oracle.on('price-update', (price) => {
    console.log(`Price update for ${price.symbol}: $${price.price.toFixed(2)}`);
  });

  oracle.on('connector-failed', ({ name }) => {
    console.error(`❌ Connector failed: ${name}`);
  });

  oracle.on('connector-recovered', ({ name }) => {
    console.log(`✅ Connector recovered: ${name}`);
  });

  try {
    await oracle.start();
    console.log('Oracle service started');

    const subscriptionId = oracle.subscribe(
      ['BTC/USDT', 'ETH/USDT'],
      (price) => {
        console.log(`
Symbol: ${price.symbol}
Price: $${price.price.toFixed(2)}
Sources: ${price.sources.length}
Confidence: ${(price.confidence * 100).toFixed(1)}%
Outliers: ${price.outliers.length}
        `);
      },
      5000
    );

    const btcPrice = await oracle.fetchAggregatedPrice('BTC/USDT');
    console.log('BTC Price:', btcPrice);

    const health = await oracle.getHealth();
    console.log('System Health:', health);

    const reputations = oracle.getReputations();
    console.log('Exchange Reputations:');
    reputations.forEach((rep, exchange) => {
      console.log(`${exchange}: Score ${rep.score.toFixed(3)}, Accuracy ${
        (rep.accurateSubmissions / rep.totalSubmissions * 100).toFixed(1)
      }%`);
    });

    setTimeout(() => {
      oracle.unsubscribe(subscriptionId);
      oracle.stop();
      console.log('Oracle service stopped');
    }, 60000);

  } catch (error) {
    console.error('Oracle error:', error);
    await oracle.stop();
  }
}

if (require.main === module) {
  runOracle().catch(console.error);
}