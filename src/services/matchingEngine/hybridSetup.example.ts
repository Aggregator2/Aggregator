import { MatchingEngine } from './MatchingEngine';
import { EnhancedHybridMatchingEngine, HybridMatchingConfig } from './EnhancedHybridMatchingEngine';
import { LiquidityMonitoringService } from './LiquidityMonitoringService';
import { CircuitBreakerManager, FallbackStrategy } from './ExternalLiquidityCircuitBreaker';
import { WebSocketIntegration } from '../websocket/WebSocketIntegration';

/**
 * Example setup for hybrid matching engine with external liquidity
 */
export async function setupHybridMatchingEngine() {
  // 1. Initialize base matching engine
  const matchingEngine = new MatchingEngine({
    tickSize: {
      'ETH/USDC': 0.01,
      'BTC/USDC': 0.01,
      'MATIC/USDC': 0.0001
    },
    fees: {
      maker: 0.001, // 0.1%
      taker: 0.002  // 0.2%
    }
  });

  // Initialize trading pairs
  const pairs = ['ETH/USDC', 'BTC/USDC', 'MATIC/USDC'];
  pairs.forEach(pair => matchingEngine.initializePair(pair));

  // 2. Configure hybrid matching
  const hybridConfig: HybridMatchingConfig = {
    enableHybridMatching: true,
    routerConfig: {
      enableExternal: true,
      externalThreshold: 100, // $100 minimum for external routing
      priceImprovementRequired: 0.1, // 0.1% better price to use external
      maxExternalSplits: 3, // Use up to 3 external sources
      smartRouting: true,
      urgencyMultiplier: 1.0
    },
    fallbackConfig: {
      maxRetries: 2,
      retryDelay: 1000,
      useInternalOnlyFallback: true
    },
    liquidityProviders: {
      lifi: true,
      uniswap: true
    }
  };

  // 3. Create enhanced hybrid matching engine
  const hybridEngine = new EnhancedHybridMatchingEngine(matchingEngine, hybridConfig);

  // 4. Setup circuit breakers for external providers
  const circuitBreakerManager = new CircuitBreakerManager();
  const mainCircuitBreaker = circuitBreakerManager.getOrCreateCircuitBreaker('main');

  // Register providers with fallback strategies
  mainCircuitBreaker.registerProvider('LiFi', {
    type: 'alternative-provider',
    alternativeProviders: ['Uniswap'],
    cacheTimeout: 30000 // 30 seconds
  });

  mainCircuitBreaker.registerProvider('Uniswap', {
    type: 'cached-quote',
    cacheTimeout: 60000 // 1 minute
  });

  // 5. Setup liquidity monitoring
  const liquidityMonitor = new LiquidityMonitoringService(
    matchingEngine,
    hybridEngine['liquidityAggregator'] // Access private property for monitoring
  );

  // Start monitoring for all pairs
  liquidityMonitor.startMonitoring(pairs);

  // 6. Setup event handlers
  setupEventHandlers(hybridEngine, liquidityMonitor, mainCircuitBreaker);

  // 7. WebSocket integration for real-time updates
  const wsIntegration = new WebSocketIntegration(
    {
      websocket: {
        port: 3001,
        path: '/ws',
        cors: { origin: '*', credentials: true },
        auth: { secret: 'your-secret', required: false },
        rateLimits: {
          connectionsPerIp: 10,
          messagesPerMinute: 100,
          subscriptionsPerConnection: 20
        },
        heartbeatInterval: 30000
      },
      updateBatchInterval: 100,
      snapshotInterval: 60000,
      marketDataInterval: 1000
    },
    matchingEngine
  );

  // Add custom handler for hybrid execution events
  hybridEngine.on('hybrid:order-executed', ({ order, report }) => {
    // Broadcast hybrid execution details
    if (report.externalExecutions && report.externalExecutions.length > 0) {
      wsIntegration['wsService'].broadcastOrderUpdate(order.pair, {
        ...order,
        hybridExecution: {
          internal: report.filledQuantity - report.externalExecutions.reduce((sum, e) => sum + (e.quantity || 0), 0),
          external: report.externalExecutions
        }
      });
    }
  });

  // 8. Start services
  await wsIntegration.start();

  return {
    matchingEngine,
    hybridEngine,
    liquidityMonitor,
    circuitBreakerManager,
    wsIntegration
  };
}

function setupEventHandlers(
  hybridEngine: EnhancedHybridMatchingEngine,
  liquidityMonitor: LiquidityMonitoringService,
  circuitBreaker: any
) {
  // Hybrid engine events
  hybridEngine.on('hybrid:routing-completed', ({ orderId, plan, duration }) => {
    console.log(`Order ${orderId} routed in ${duration}ms`, {
      segments: plan.route.segments.length,
      totalQuantity: plan.route.totalQuantity,
      averagePrice: plan.route.averagePrice
    });
  });

  hybridEngine.on('hybrid:external-failure', ({ provider, error }) => {
    console.error(`External provider ${provider} failed:`, error);
  });

  hybridEngine.on('hybrid:fallback-triggered', ({ orderId, reason }) => {
    console.warn(`Fallback triggered for order ${orderId}:`, reason);
  });

  // Liquidity monitoring events
  liquidityMonitor.on('liquidity:alert', (alert) => {
    console.warn('Liquidity Alert:', alert);
    
    // Take action based on alert type
    switch (alert.type) {
      case 'low_liquidity':
        // Could notify market makers or adjust fees
        break;
      case 'high_spread':
        // Could trigger market making algorithms
        break;
      case 'price_divergence':
        // Could trigger arbitrage opportunities
        break;
    }
  });

  // Circuit breaker events
  circuitBreaker.on('circuit:state-change', ({ provider, oldState, newState }) => {
    console.log(`Circuit breaker for ${provider}: ${oldState} -> ${newState}`);
    
    if (newState === 'open') {
      // Provider is down, notify administrators
      console.error(`Provider ${provider} circuit opened - failing fast`);
    }
  });

  circuitBreaker.on('provider:failure', ({ provider, error, latency }) => {
    console.error(`Provider ${provider} request failed in ${latency}ms:`, error);
  });
}

// Example usage
export async function exampleUsage() {
  const { hybridEngine, liquidityMonitor } = await setupHybridMatchingEngine();

  // Submit a hybrid order
  try {
    const order = await hybridEngine.submitOrder({
      userId: 'user123',
      pair: 'ETH/USDC',
      side: 'BUY',
      type: 'LIMIT',
      price: 2000,
      quantity: 10, // 10 ETH
      timeInForce: 'GTC'
    });

    console.log('Hybrid order executed:', {
      orderId: order.orderId,
      status: order.status,
      filledQuantity: order.filledQuantity,
      averagePrice: order.averagePrice,
      externalExecutions: order.externalExecutions
    });
  } catch (error) {
    console.error('Order failed:', error);
  }

  // Check liquidity metrics
  const liquidityTrend = liquidityMonitor.getLiquidityTrend('ETH/USDC');
  console.log('Liquidity trend:', liquidityTrend);

  // Get latest snapshot
  const snapshot = liquidityMonitor.getLatestSnapshot('ETH/USDC');
  if (snapshot) {
    console.log('Current liquidity:', {
      internal: {
        bidVolume: snapshot.internal.totalBidVolume,
        askVolume: snapshot.internal.totalAskVolume,
        spread: snapshot.internal.spreadPercent + '%'
      },
      external: {
        providers: snapshot.external.providers.length,
        bestBid: snapshot.external.bestBid,
        bestAsk: snapshot.external.bestAsk
      },
      recommendation: snapshot.comparison.recommendation
    });
  }
}

// Graceful shutdown
export async function shutdown(services: any) {
  console.log('Shutting down hybrid matching engine...');
  
  services.liquidityMonitor.stopMonitoring();
  services.circuitBreakerManager.stopAll();
  await services.wsIntegration.stop();
  
  console.log('Shutdown complete');
}