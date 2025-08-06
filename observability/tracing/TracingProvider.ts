import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { 
  BasicTracerProvider, 
  BatchSpanProcessor, 
  SimpleSpanProcessor,
  ConsoleSpanExporter,
  SpanExporter
} from '@opentelemetry/sdk-trace-base';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { RedisInstrumentation } from '@opentelemetry/instrumentation-redis';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { 
  trace, 
  context, 
  SpanStatusCode, 
  SpanKind,
  Span,
  Tracer,
  Context,
  Attributes,
  Link
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { EventEmitter } from 'events';

export interface TracingConfig {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  exporters: {
    jaeger?: {
      endpoint: string;
      username?: string;
      password?: string;
    };
    zipkin?: {
      url: string;
      headers?: Record<string, string>;
    };
    otlp?: {
      url: string;
      headers?: Record<string, string>;
    };
    console?: boolean;
  };
  sampling: {
    probability: number;
    rules?: SamplingRule[];
  };
  propagators?: string[];
  instrumentations?: {
    http?: boolean;
    express?: boolean;
    redis?: boolean;
    database?: boolean;
    custom?: CustomInstrumentation[];
  };
}

export interface SamplingRule {
  name: string;
  match: (spanName: string, attributes: Attributes) => boolean;
  sampleRate: number;
}

export interface CustomInstrumentation {
  name: string;
  modules: string[];
  patch: (moduleExports: any, tracer: Tracer) => any;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
  traceState?: string;
}

export class TracingProvider extends EventEmitter {
  private config: TracingConfig;
  private sdk?: NodeSDK;
  private tracerProvider?: BasicTracerProvider;
  private tracer?: Tracer;
  private initialized: boolean = false;
  private activeSpans: Map<string, Span> = new Map();
  private spanMetrics: {
    total: number;
    errors: number;
    byOperation: Record<string, number>;
  } = {
    total: 0,
    errors: 0,
    byOperation: {}
  };

  constructor(config: TracingConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('🔍 Initializing OpenTelemetry tracing...');

    try {
      // Create resource
      const resource = Resource.default().merge(
        new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: this.config.serviceName,
          [SemanticResourceAttributes.SERVICE_VERSION]: this.config.serviceVersion,
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: this.config.environment,
          [SemanticResourceAttributes.HOST_NAME]: require('os').hostname(),
          [SemanticResourceAttributes.PROCESS_PID]: process.pid,
        })
      );

      // Create tracer provider
      this.tracerProvider = new BasicTracerProvider({
        resource,
        sampler: this.createSampler()
      });

      // Add exporters
      const exporters = this.createExporters();
      for (const exporter of exporters) {
        this.tracerProvider.addSpanProcessor(
          new BatchSpanProcessor(exporter, {
            maxQueueSize: 2048,
            maxExportBatchSize: 512,
            scheduledDelayMillis: 5000,
            exportTimeoutMillis: 30000
          })
        );
      }

      // Register provider
      this.tracerProvider.register({
        propagator: new W3CTraceContextPropagator()
      });

      // Get tracer
      this.tracer = trace.getTracer(
        this.config.serviceName,
        this.config.serviceVersion
      );

      // Setup instrumentations
      this.setupInstrumentations();

      this.initialized = true;
      console.log('✅ OpenTelemetry tracing initialized');
      this.emit('initialized');

    } catch (error) {
      console.error('❌ Tracing initialization failed:', error);
      throw error;
    }
  }

  private createSampler(): any {
    // Would implement custom sampler with rules
    return {
      shouldSample: (context: Context, traceId: string, spanName: string, spanKind: SpanKind, attributes: Attributes) => {
        // Check sampling rules
        if (this.config.sampling.rules) {
          for (const rule of this.config.sampling.rules) {
            if (rule.match(spanName, attributes)) {
              return {
                decision: Math.random() < rule.sampleRate ? 1 : 0,
                attributes
              };
            }
          }
        }

        // Default sampling
        return {
          decision: Math.random() < this.config.sampling.probability ? 1 : 0,
          attributes
        };
      },
      toString: () => `CustomSampler(${this.config.sampling.probability})`
    };
  }

  private createExporters(): SpanExporter[] {
    const exporters: SpanExporter[] = [];

    // Jaeger exporter
    if (this.config.exporters.jaeger) {
      exporters.push(new JaegerExporter({
        endpoint: this.config.exporters.jaeger.endpoint,
        username: this.config.exporters.jaeger.username,
        password: this.config.exporters.jaeger.password,
      }));
      console.log('✅ Jaeger exporter configured');
    }

    // Zipkin exporter
    if (this.config.exporters.zipkin) {
      exporters.push(new ZipkinExporter({
        url: this.config.exporters.zipkin.url,
        headers: this.config.exporters.zipkin.headers
      }));
      console.log('✅ Zipkin exporter configured');
    }

    // OTLP exporter
    if (this.config.exporters.otlp) {
      exporters.push(new OTLPTraceExporter({
        url: this.config.exporters.otlp.url,
        headers: this.config.exporters.otlp.headers
      }));
      console.log('✅ OTLP exporter configured');
    }

    // Console exporter (for debugging)
    if (this.config.exporters.console) {
      exporters.push(new ConsoleSpanExporter());
      console.log('✅ Console exporter configured');
    }

    return exporters;
  }

  private setupInstrumentations(): void {
    const instrumentations: any[] = [];

    if (this.config.instrumentations?.http) {
      instrumentations.push(new HttpInstrumentation({
        requestHook: (span, request) => {
          span.setAttributes({
            'http.request.body.size': request.headers['content-length'] || 0,
            'http.user_agent': request.headers['user-agent'] || 'unknown'
          });
        },
        responseHook: (span, response) => {
          span.setAttributes({
            'http.response.body.size': response.headers['content-length'] || 0
          });
        }
      }));
    }

    if (this.config.instrumentations?.express) {
      instrumentations.push(new ExpressInstrumentation({
        requestHook: (span, info) => {
          span.setAttributes({
            'express.route': info.route,
            'express.type': info.layerType
          });
        }
      }));
    }

    if (this.config.instrumentations?.redis) {
      instrumentations.push(new RedisInstrumentation());
      instrumentations.push(new IORedisInstrumentation());
    }

    // Register instrumentations
    registerInstrumentations({
      instrumentations
    });

    console.log(`✅ Registered ${instrumentations.length} instrumentations`);
  }

  // Tracing operations
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
      links?: Link[];
      parent?: Context;
    }
  ): Span {
    if (!this.tracer) {
      throw new Error('Tracer not initialized');
    }

    const span = this.tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: {
        ...options?.attributes,
        'service.name': this.config.serviceName,
        'service.version': this.config.serviceVersion
      },
      links: options?.links
    }, options?.parent);

    // Track span
    const spanContext = span.spanContext();
    if (spanContext) {
      this.activeSpans.set(spanContext.spanId, span);
      this.spanMetrics.total++;
      this.spanMetrics.byOperation[name] = (this.spanMetrics.byOperation[name] || 0) + 1;
    }

    return span;
  }

  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T,
    options?: {
      kind?: SpanKind;
      attributes?: Attributes;
    }
  ): T {
    if (!this.tracer) {
      throw new Error('Tracer not initialized');
    }

    return this.tracer.startActiveSpan(name, options || {}, (span) => {
      try {
        const result = fn(span);
        
        // Handle async functions
        if (result instanceof Promise) {
          return result
            .then((value) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return value;
            })
            .catch((error) => {
              span.recordException(error);
              span.setStatus({ 
                code: SpanStatusCode.ERROR, 
                message: error.message 
              });
              span.end();
              this.spanMetrics.errors++;
              throw error;
            }) as any;
        }
        
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
        
      } catch (error) {
        span.recordException(error);
        span.setStatus({ 
          code: SpanStatusCode.ERROR, 
          message: error.message 
        });
        span.end();
        this.spanMetrics.errors++;
        throw error;
      }
    });
  }

  // Order lifecycle tracing
  async traceOrder(orderId: string, fn: () => Promise<any>): Promise<any> {
    return this.startActiveSpan('order.process', async (span) => {
      span.setAttributes({
        'order.id': orderId,
        'order.timestamp': Date.now()
      });

      try {
        // Trace order validation
        await this.startActiveSpan('order.validate', async (validateSpan) => {
          validateSpan.setAttributes({ 'order.id': orderId });
          // Validation logic
        });

        // Trace order matching
        await this.startActiveSpan('order.match', async (matchSpan) => {
          matchSpan.setAttributes({ 'order.id': orderId });
          // Matching logic
        });

        // Trace order execution
        const result = await this.startActiveSpan('order.execute', async (executeSpan) => {
          executeSpan.setAttributes({ 'order.id': orderId });
          return await fn();
        });

        // Trace order settlement
        await this.startActiveSpan('order.settle', async (settleSpan) => {
          settleSpan.setAttributes({ 'order.id': orderId });
          // Settlement logic
        });

        span.setAttributes({
          'order.status': 'completed',
          'order.duration': Date.now() - parseInt(span.attributes['order.timestamp'] as string)
        });

        return result;

      } catch (error) {
        span.setAttributes({
          'order.status': 'failed',
          'order.error': error.message
        });
        throw error;
      }
    }, { kind: SpanKind.SERVER });
  }

  // WebSocket tracing
  traceWebSocketConnection(connectionId: string): Span {
    const span = this.startSpan('websocket.connection', {
      kind: SpanKind.SERVER,
      attributes: {
        'websocket.connection.id': connectionId,
        'websocket.protocol': 'wss'
      }
    });

    return span;
  }

  traceWebSocketMessage(
    connectionId: string,
    messageType: string,
    direction: 'in' | 'out'
  ): Span {
    const span = this.startSpan(`websocket.message.${direction}`, {
      kind: direction === 'in' ? SpanKind.SERVER : SpanKind.CLIENT,
      attributes: {
        'websocket.connection.id': connectionId,
        'websocket.message.type': messageType,
        'websocket.message.direction': direction
      }
    });

    return span;
  }

  // Database tracing
  async traceDatabase<T>(
    operation: string,
    query: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.startActiveSpan(`db.${operation}`, async (span) => {
      span.setAttributes({
        'db.system': 'postgresql',
        'db.operation': operation,
        'db.statement': this.sanitizeQuery(query)
      });

      const startTime = Date.now();
      
      try {
        const result = await fn();
        
        span.setAttributes({
          'db.rows_affected': (result as any)?.rowCount || 0,
          'db.duration': Date.now() - startTime
        });
        
        return result;
        
      } catch (error) {
        span.setAttributes({
          'db.error': error.message,
          'db.duration': Date.now() - startTime
        });
        throw error;
      }
    }, { kind: SpanKind.CLIENT });
  }

  // Settlement tracing
  async traceSettlement(settlementId: string, fn: () => Promise<any>): Promise<any> {
    return this.startActiveSpan('settlement.process', async (span) => {
      span.setAttributes({
        'settlement.id': settlementId,
        'settlement.timestamp': Date.now()
      });

      try {
        // Trace settlement validation
        await this.startActiveSpan('settlement.validate', async (validateSpan) => {
          validateSpan.setAttributes({ 'settlement.id': settlementId });
        });

        // Trace blockchain interaction
        const result = await this.startActiveSpan('settlement.blockchain', async (blockchainSpan) => {
          blockchainSpan.setAttributes({ 
            'settlement.id': settlementId,
            'blockchain.network': 'ethereum'
          });
          return await fn();
        });

        // Trace confirmation
        await this.startActiveSpan('settlement.confirm', async (confirmSpan) => {
          confirmSpan.setAttributes({ 'settlement.id': settlementId });
        });

        span.setAttributes({
          'settlement.status': 'completed',
          'settlement.transaction_hash': result.transactionHash
        });

        return result;

      } catch (error) {
        span.setAttributes({
          'settlement.status': 'failed',
          'settlement.error': error.message
        });
        throw error;
      }
    }, { kind: SpanKind.CLIENT });
  }

  // Context propagation
  extractContext(headers: Record<string, string>): Context {
    const propagator = new W3CTraceContextPropagator();
    return propagator.extract(context.active(), headers, {
      get: (carrier, key) => carrier[key as string] || undefined,
      keys: (carrier) => Object.keys(carrier)
    });
  }

  injectContext(context: Context, headers: Record<string, string>): void {
    const propagator = new W3CTraceContextPropagator();
    propagator.inject(context, headers, {
      set: (carrier, key, value) => {
        carrier[key as string] = value;
      }
    });
  }

  getCurrentTraceContext(): TraceContext | null {
    const span = trace.getSpan(context.active());
    if (!span) return null;

    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
      traceState: spanContext.traceState?.serialize()
    };
  }

  // Correlation
  createCorrelationId(): string {
    const traceContext = this.getCurrentTraceContext();
    if (traceContext) {
      return `${traceContext.traceId}-${traceContext.spanId}`;
    }
    return `standalone-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Performance analysis
  findSlowSpans(thresholdMs: number = 1000): Span[] {
    const slowSpans: Span[] = [];
    
    for (const span of this.activeSpans.values()) {
      const duration = this.getSpanDuration(span);
      if (duration > thresholdMs) {
        slowSpans.push(span);
      }
    }
    
    return slowSpans;
  }

  private getSpanDuration(span: Span): number {
    // This would calculate actual span duration
    // For now, returning mock value
    return 0;
  }

  private sanitizeQuery(query: string): string {
    // Remove sensitive data from queries
    return query
      .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
      .replace(/secret\s*=\s*'[^']*'/gi, "secret='***'")
      .replace(/token\s*=\s*'[^']*'/gi, "token='***'");
  }

  // Metrics
  getMetrics(): {
    totalSpans: number;
    errorRate: number;
    spansByOperation: Record<string, number>;
    activeSpans: number;
  } {
    return {
      totalSpans: this.spanMetrics.total,
      errorRate: this.spanMetrics.total > 0 
        ? (this.spanMetrics.errors / this.spanMetrics.total) * 100 
        : 0,
      spansByOperation: this.spanMetrics.byOperation,
      activeSpans: this.activeSpans.size
    };
  }

  // Shutdown
  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down tracing...');
    
    // End all active spans
    for (const span of this.activeSpans.values()) {
      span.end();
    }
    this.activeSpans.clear();
    
    // Shutdown provider
    if (this.tracerProvider) {
      await this.tracerProvider.shutdown();
    }
    
    this.initialized = false;
    this.emit('shutdown');
  }
}