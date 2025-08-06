import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { performance } from 'perf_hooks';

export interface LoggerConfig {
  serviceName: string;
  environment: string;
  level: string;
  correlationId?: string;
  outputs: {
    console?: {
      enabled: boolean;
      level?: string;
      format?: 'json' | 'pretty';
    };
    file?: {
      enabled: boolean;
      directory: string;
      filename: string;
      maxSize: string;
      maxFiles: string;
      level?: string;
    };
    elasticsearch?: {
      enabled: boolean;
      node: string | string[];
      index: string;
      auth?: {
        username: string;
        password: string;
      };
      flushInterval?: number;
      bulkSize?: number;
    };
  };
  sampling: {
    enabled: boolean;
    rules: SamplingRule[];
    defaultRate: number;
  };
  masking: {
    enabled: boolean;
    patterns: MaskingPattern[];
  };
  retention: {
    debug: number; // days
    info: number;
    warn: number;
    error: number;
  };
}

export interface SamplingRule {
  name: string;
  match: (level: string, message: string, meta: any) => boolean;
  rate: number;
}

export interface MaskingPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

export interface LogContext {
  correlationId: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  [key: string]: any;
}

export interface PerformanceMetrics {
  duration: number;
  cpuUsage?: {
    user: number;
    system: number;
  };
  memoryUsage?: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
}

export class StructuredLogger extends EventEmitter {
  private config: LoggerConfig;
  private logger: winston.Logger;
  private elasticsearchClient?: ElasticsearchClient;
  private context: LogContext;
  private performanceTrackers: Map<string, number> = new Map();
  private logCounters: {
    total: number;
    byLevel: Record<string, number>;
    sampled: number;
    masked: number;
  } = {
    total: 0,
    byLevel: {},
    sampled: 0,
    masked: 0
  };

  constructor(config: LoggerConfig) {
    super();
    this.config = config;
    this.context = {
      correlationId: config.correlationId || this.generateCorrelationId()
    };
    this.logger = this.createLogger();
  }

  private createLogger(): winston.Logger {
    const transports: winston.transport[] = [];

    // Console transport
    if (this.config.outputs.console?.enabled) {
      transports.push(new winston.transports.Console({
        level: this.config.outputs.console.level || this.config.level,
        format: this.config.outputs.console.format === 'pretty' 
          ? winston.format.combine(
              winston.format.colorize(),
              winston.format.timestamp(),
              winston.format.printf(({ timestamp, level, message, ...meta }) => {
                const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
                return `${timestamp} [${level}] ${message} ${metaStr}`;
              })
            )
          : winston.format.json()
      }));
    }

    // File transport with rotation
    if (this.config.outputs.file?.enabled) {
      const fileTransport = new DailyRotateFile({
        filename: `${this.config.outputs.file.filename}-%DATE%.log`,
        dirname: this.config.outputs.file.directory,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: this.config.outputs.file.maxSize,
        maxFiles: this.config.outputs.file.maxFiles,
        level: this.config.outputs.file.level || this.config.level,
        format: winston.format.json()
      });

      transports.push(fileTransport);
    }

    // Elasticsearch transport
    if (this.config.outputs.elasticsearch?.enabled) {
      this.setupElasticsearch();
      
      const esTransport = new ElasticsearchTransport({
        level: this.config.level,
        clientOpts: {
          node: this.config.outputs.elasticsearch.node,
          auth: this.config.outputs.elasticsearch.auth
        },
        index: this.config.outputs.elasticsearch.index,
        dataStream: true,
        flushInterval: this.config.outputs.elasticsearch.flushInterval || 2000,
        bulkSize: this.config.outputs.elasticsearch.bulkSize || 100
      });

      transports.push(esTransport);
    }

    return winston.createLogger({
      level: this.config.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
        winston.format.json()
      ),
      defaultMeta: {
        service: this.config.serviceName,
        environment: this.config.environment,
        ...this.context
      },
      transports
    });
  }

  private async setupElasticsearch(): Promise<void> {
    if (!this.config.outputs.elasticsearch?.enabled) return;

    this.elasticsearchClient = new ElasticsearchClient({
      node: this.config.outputs.elasticsearch.node,
      auth: this.config.outputs.elasticsearch.auth
    });

    // Create index template for structured logs
    try {
      await this.elasticsearchClient.indices.putIndexTemplate({
        name: 'logs-template',
        body: {
          index_patterns: [`${this.config.outputs.elasticsearch.index}-*`],
          template: {
            settings: {
              number_of_shards: 3,
              number_of_replicas: 1,
              'index.lifecycle.name': 'logs-policy',
              'index.lifecycle.rollover_alias': this.config.outputs.elasticsearch.index
            },
            mappings: {
              properties: {
                '@timestamp': { type: 'date' },
                level: { type: 'keyword' },
                message: { type: 'text' },
                service: { type: 'keyword' },
                environment: { type: 'keyword' },
                correlationId: { type: 'keyword' },
                traceId: { type: 'keyword' },
                spanId: { type: 'keyword' },
                userId: { type: 'keyword' },
                duration: { type: 'long' },
                error: {
                  properties: {
                    message: { type: 'text' },
                    stack: { type: 'text' },
                    code: { type: 'keyword' }
                  }
                }
              }
            }
          }
        }
      });

      // Create lifecycle policy for retention
      await this.createLifecyclePolicy();

      console.log('✅ Elasticsearch index template created');
    } catch (error) {
      console.error('Failed to create Elasticsearch template:', error);
    }
  }

  private async createLifecyclePolicy(): Promise<void> {
    if (!this.elasticsearchClient) return;

    try {
      await this.elasticsearchClient.ilm.putLifecycle({
        policy: 'logs-policy',
        body: {
          policy: {
            phases: {
              hot: {
                min_age: '0ms',
                actions: {
                  rollover: {
                    max_size: '50GB',
                    max_age: '1d'
                  }
                }
              },
              warm: {
                min_age: '7d',
                actions: {
                  shrink: {
                    number_of_shards: 1
                  },
                  forcemerge: {
                    max_num_segments: 1
                  }
                }
              },
              delete: {
                min_age: '30d',
                actions: {
                  delete: {}
                }
              }
            }
          }
        }
      });

      console.log('✅ Elasticsearch lifecycle policy created');
    } catch (error) {
      console.error('Failed to create lifecycle policy:', error);
    }
  }

  // Core logging methods
  debug(message: string, meta?: any): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: any): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: any): void {
    this.log('warn', message, meta);
  }

  error(message: string, error?: Error | any, meta?: any): void {
    const errorMeta = error instanceof Error ? {
      error: {
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      }
    } : error;

    this.log('error', message, { ...errorMeta, ...meta });
  }

  private log(level: string, message: string, meta?: any): void {
    // Apply sampling
    if (!this.shouldLog(level, message, meta)) {
      this.logCounters.sampled++;
      return;
    }

    // Apply masking
    const maskedMessage = this.maskSensitiveData(message);
    const maskedMeta = this.maskObject(meta || {});

    // Add context
    const logEntry = {
      ...this.context,
      ...maskedMeta,
      timestamp: new Date().toISOString()
    };

    // Log
    this.logger.log(level, maskedMessage, logEntry);

    // Update counters
    this.logCounters.total++;
    this.logCounters.byLevel[level] = (this.logCounters.byLevel[level] || 0) + 1;

    // Emit event
    this.emit('log', { level, message: maskedMessage, meta: logEntry });
  }

  // Context management
  setContext(context: Partial<LogContext>): void {
    this.context = { ...this.context, ...context };
    this.logger.defaultMeta = {
      ...this.logger.defaultMeta,
      ...context
    };
  }

  clearContext(): void {
    this.context = {
      correlationId: this.generateCorrelationId()
    };
    this.logger.defaultMeta = {
      service: this.config.serviceName,
      environment: this.config.environment,
      ...this.context
    };
  }

  child(context: Partial<LogContext>): StructuredLogger {
    const childConfig = { ...this.config };
    const childLogger = new StructuredLogger(childConfig);
    childLogger.setContext({ ...this.context, ...context });
    return childLogger;
  }

  // Performance tracking
  startTimer(label: string): void {
    this.performanceTrackers.set(label, performance.now());
  }

  endTimer(label: string, meta?: any): void {
    const startTime = this.performanceTrackers.get(label);
    if (!startTime) {
      this.warn(`Timer '${label}' was not started`);
      return;
    }

    const duration = performance.now() - startTime;
    this.performanceTrackers.delete(label);

    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();

    const perfMetrics: PerformanceMetrics = {
      duration: Math.round(duration),
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      memoryUsage: {
        rss: memoryUsage.rss,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal
      }
    };

    this.info(`Performance: ${label}`, {
      ...meta,
      performance: perfMetrics
    });
  }

  // Structured logging helpers
  logHttpRequest(req: any, res: any, duration: number): void {
    this.info('HTTP Request', {
      http: {
        method: req.method,
        url: req.url,
        status_code: res.statusCode,
        duration,
        remote_ip: req.ip || req.connection.remoteAddress,
        user_agent: req.headers['user-agent'],
        referer: req.headers.referer,
        request_id: req.id
      }
    });
  }

  logDatabaseQuery(query: string, duration: number, error?: Error): void {
    const level = error ? 'error' : 'debug';
    this.log(level, 'Database Query', {
      database: {
        query: this.maskSensitiveData(query),
        duration,
        error: error?.message
      }
    });
  }

  logOrderEvent(orderId: string, event: string, details?: any): void {
    this.info(`Order Event: ${event}`, {
      order: {
        id: orderId,
        event,
        ...details
      }
    });
  }

  logWebSocketEvent(connectionId: string, event: string, details?: any): void {
    this.debug(`WebSocket Event: ${event}`, {
      websocket: {
        connection_id: connectionId,
        event,
        ...details
      }
    });
  }

  logSecurityEvent(event: string, severity: 'low' | 'medium' | 'high' | 'critical', details?: any): void {
    const level = severity === 'critical' || severity === 'high' ? 'error' : 'warn';
    this.log(level, `Security Event: ${event}`, {
      security: {
        event,
        severity,
        ...details
      }
    });
  }

  // Sampling
  private shouldLog(level: string, message: string, meta: any): boolean {
    if (!this.config.sampling.enabled) return true;

    // Always log errors and warnings
    if (level === 'error' || level === 'warn') return true;

    // Check sampling rules
    for (const rule of this.config.sampling.rules) {
      if (rule.match(level, message, meta)) {
        return Math.random() < rule.rate;
      }
    }

    // Default sampling
    return Math.random() < this.config.sampling.defaultRate;
  }

  // Data masking
  private maskSensitiveData(text: string): string {
    if (!this.config.masking.enabled) return text;

    let masked = text;
    let changesMade = false;

    for (const pattern of this.config.masking.patterns) {
      const before = masked;
      masked = masked.replace(pattern.pattern, pattern.replacement);
      if (before !== masked) changesMade = true;
    }

    if (changesMade) {
      this.logCounters.masked++;
    }

    return masked;
  }

  private maskObject(obj: any): any {
    if (!this.config.masking.enabled) return obj;

    if (typeof obj !== 'object' || obj === null) {
      return typeof obj === 'string' ? this.maskSensitiveData(obj) : obj;
    }

    const masked: any = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const maskedKey = this.maskSensitiveData(key);
        
        // Check if key contains sensitive terms
        if (this.isSensitiveKey(key)) {
          masked[maskedKey] = '***MASKED***';
        } else {
          masked[maskedKey] = this.maskObject(obj[key]);
        }
      }
    }

    return masked;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveTerms = [
      'password', 'passwd', 'pwd',
      'secret', 'token', 'apikey', 'api_key',
      'private_key', 'privatekey',
      'credit_card', 'creditcard', 'cc',
      'ssn', 'social_security',
      'bank_account', 'account_number'
    ];

    const lowerKey = key.toLowerCase();
    return sensitiveTerms.some(term => lowerKey.includes(term));
  }

  // Utilities
  private generateCorrelationId(): string {
    return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  }

  // Search functionality
  async search(query: {
    startTime?: Date;
    endTime?: Date;
    level?: string | string[];
    correlationId?: string;
    traceId?: string;
    userId?: string;
    message?: string;
    limit?: number;
  }): Promise<any[]> {
    if (!this.elasticsearchClient) {
      throw new Error('Elasticsearch not configured');
    }

    const must: any[] = [];

    // Time range
    if (query.startTime || query.endTime) {
      must.push({
        range: {
          '@timestamp': {
            gte: query.startTime?.toISOString(),
            lte: query.endTime?.toISOString()
          }
        }
      });
    }

    // Level filter
    if (query.level) {
      must.push({
        terms: {
          level: Array.isArray(query.level) ? query.level : [query.level]
        }
      });
    }

    // Correlation ID
    if (query.correlationId) {
      must.push({ term: { correlationId: query.correlationId } });
    }

    // Trace ID
    if (query.traceId) {
      must.push({ term: { traceId: query.traceId } });
    }

    // User ID
    if (query.userId) {
      must.push({ term: { userId: query.userId } });
    }

    // Message search
    if (query.message) {
      must.push({
        match: {
          message: {
            query: query.message,
            operator: 'and'
          }
        }
      });
    }

    const response = await this.elasticsearchClient.search({
      index: `${this.config.outputs.elasticsearch!.index}-*`,
      body: {
        query: {
          bool: { must }
        },
        size: query.limit || 100,
        sort: [{ '@timestamp': 'desc' }]
      }
    });

    return response.hits.hits.map(hit => hit._source);
  }

  // Metrics
  getMetrics(): {
    total: number;
    byLevel: Record<string, number>;
    sampledCount: number;
    maskedCount: number;
    samplingRate: number;
  } {
    const total = this.logCounters.total + this.logCounters.sampled;
    
    return {
      total: this.logCounters.total,
      byLevel: this.logCounters.byLevel,
      sampledCount: this.logCounters.sampled,
      maskedCount: this.logCounters.masked,
      samplingRate: total > 0 ? (this.logCounters.total / total) * 100 : 100
    };
  }

  // Cleanup
  async close(): Promise<void> {
    this.logger.close();
    
    if (this.elasticsearchClient) {
      await this.elasticsearchClient.close();
    }
    
    this.performanceTrackers.clear();
    this.emit('closed');
  }
}

// Default masking patterns
export const defaultMaskingPatterns: MaskingPattern[] = [
  {
    name: 'email',
    pattern: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,
    replacement: '***@***.***'
  },
  {
    name: 'credit_card',
    pattern: /\b(\d{4}[\s-]?){3}\d{4}\b/g,
    replacement: '****-****-****-****'
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '***-**-****'
  },
  {
    name: 'api_key',
    pattern: /([a-zA-Z0-9]{32,})/g,
    replacement: '***API_KEY***'
  },
  {
    name: 'jwt',
    pattern: /Bearer\s+[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
    replacement: 'Bearer ***JWT***'
  }
];

// Sampling rules for high-volume events
export const defaultSamplingRules: SamplingRule[] = [
  {
    name: 'health_checks',
    match: (level, message) => message.includes('/health') || message.includes('/ping'),
    rate: 0.01 // 1%
  },
  {
    name: 'websocket_heartbeat',
    match: (level, message, meta) => meta?.websocket?.event === 'heartbeat',
    rate: 0.05 // 5%
  },
  {
    name: 'cache_hits',
    match: (level, message) => message.includes('cache hit'),
    rate: 0.1 // 10%
  }
];