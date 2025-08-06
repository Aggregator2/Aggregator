/**
 * Redis Configuration Helper
 * Provides optimized configurations for different deployment scenarios
 */

class RedisConfigurationHelper {
  /**
   * Get Redis Cluster configuration for production
   */
  static getClusterConfig() {
    return {
      enableCluster: true,
      clusterNodes: [
        { host: process.env.REDIS_CLUSTER_NODE_1 || 'redis-cluster-1', port: 7000 },
        { host: process.env.REDIS_CLUSTER_NODE_2 || 'redis-cluster-2', port: 7001 },
        { host: process.env.REDIS_CLUSTER_NODE_3 || 'redis-cluster-3', port: 7002 },
        { host: process.env.REDIS_CLUSTER_NODE_4 || 'redis-cluster-4', port: 7003 },
        { host: process.env.REDIS_CLUSTER_NODE_5 || 'redis-cluster-5', port: 7004 },
        { host: process.env.REDIS_CLUSTER_NODE_6 || 'redis-cluster-6', port: 7005 }
      ],
      natMap: process.env.REDIS_NAT_MAP ? JSON.parse(process.env.REDIS_NAT_MAP) : {},
      password: process.env.REDIS_PASSWORD,
      
      // Connection pool settings for cluster
      connectionPool: {
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableOfflineQueue: true,
        lazyConnect: false,
        keepAlive: 10000,
        noDelay: true,
        connectionPoolSize: 20, // Higher for cluster
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true; // Reconnect when slave becomes read-only
          }
          return false;
        }
      },
      
      // Cluster-specific options
      clusterRetryStrategy: (times) => {
        if (times > 10) return null; // Stop retrying after 10 attempts
        return Math.min(100 * times, 3000);
      },
      enableOfflineQueue: true,
      enableReadyCheck: true,
      maxRedirections: 16,
      retryDelayOnFailover: 100,
      retryDelayOnClusterDown: 300,
      slotsRefreshTimeout: 2000,
      slotsRefreshInterval: 5000,
      
      // Performance optimizations
      scaleReads: 'slave', // Read from slaves for better performance
      
      // DNS lookup caching
      dnsLookup: (address, callback) => callback(null, address)
    };
  }

  /**
   * Get Redis Sentinel configuration for high availability
   */
  static getSentinelConfig() {
    return {
      enableSentinel: true,
      sentinels: [
        { host: process.env.REDIS_SENTINEL_1 || 'sentinel-1', port: 26379 },
        { host: process.env.REDIS_SENTINEL_2 || 'sentinel-2', port: 26380 },
        { host: process.env.REDIS_SENTINEL_3 || 'sentinel-3', port: 26381 }
      ],
      masterName: process.env.REDIS_MASTER_NAME || 'mymaster',
      password: process.env.REDIS_PASSWORD,
      sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
      
      // Connection pool settings
      connectionPool: {
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableOfflineQueue: true,
        lazyConnect: false,
        keepAlive: 10000,
        noDelay: true,
        connectionPoolSize: 15
      },
      
      // Sentinel-specific options
      sentinelRetryStrategy: (times) => Math.min(times * 100, 3000),
      preferredSlaves: [
        { ip: process.env.PREFERRED_SLAVE_IP, port: process.env.PREFERRED_SLAVE_PORT || 6380 }
      ],
      sentinelCommandTimeout: 5000,
      
      // Automatic failover handling
      role: 'master', // Always connect to master
      updateSentinels: true,
      
      // Performance optimizations
      enableAutoPipelining: true,
      autoPipeliningIgnoredCommands: ['info', 'ping', 'auth'],
      
      // Connection handling
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return 2; // Reconnect to a different node
        }
        return false;
      }
    };
  }

  /**
   * Get optimized pipeline configuration
   */
  static getPipelineConfig() {
    return {
      batchSize: parseInt(process.env.REDIS_PIPELINE_BATCH_SIZE || '1000'),
      flushInterval: parseInt(process.env.REDIS_PIPELINE_FLUSH_INTERVAL || '10'),
      maxPipelineLength: parseInt(process.env.REDIS_PIPELINE_MAX_LENGTH || '10000'),
      
      // Adaptive batching based on load
      adaptiveBatching: {
        enabled: true,
        minBatchSize: 100,
        maxBatchSize: 5000,
        targetLatency: 5, // ms
        adjustmentFactor: 1.2
      }
    };
  }

  /**
   * Get circuit breaker configuration
   */
  static getCircuitBreakerConfig() {
    return {
      timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT || '3000'),
      errorThresholdPercentage: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD || '50'),
      resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '30000'),
      rollingCountTimeout: parseInt(process.env.CIRCUIT_BREAKER_ROLLING_TIMEOUT || '10000'),
      rollingCountBuckets: parseInt(process.env.CIRCUIT_BREAKER_BUCKETS || '10'),
      
      // Volume threshold
      volumeThreshold: parseInt(process.env.CIRCUIT_BREAKER_VOLUME_THRESHOLD || '20'),
      
      // Fallback function
      fallback: async (error, args) => {
        console.error('Circuit breaker fallback triggered:', error.message);
        return {
          success: false,
          error: 'Service temporarily unavailable',
          fallback: true
        };
      },
      
      // Health check function
      healthCheckInterval: 5000,
      healthCheck: async (redis) => {
        try {
          const result = await redis.ping();
          return result === 'PONG';
        } catch (error) {
          return false;
        }
      }
    };
  }

  /**
   * Get complete optimized configuration
   */
  static getOptimizedConfig(deploymentType = 'production') {
    const configs = {
      production: {
        redis: this.getClusterConfig(),
        pipeline: this.getPipelineConfig(),
        circuitBreaker: this.getCircuitBreakerConfig(),
        
        // Additional production settings
        monitoring: {
          enabled: true,
          metricsInterval: 10000,
          slowLogThreshold: 10, // ms
          memoryAlertThreshold: 0.85 // 85% memory usage
        },
        
        // Security settings
        security: {
          enableTLS: process.env.REDIS_TLS_ENABLED === 'true',
          tlsOptions: {
            rejectUnauthorized: true,
            ca: process.env.REDIS_TLS_CA,
            cert: process.env.REDIS_TLS_CERT,
            key: process.env.REDIS_TLS_KEY
          }
        }
      },
      
      staging: {
        redis: this.getSentinelConfig(),
        pipeline: {
          ...this.getPipelineConfig(),
          batchSize: 500,
          flushInterval: 20
        },
        circuitBreaker: {
          ...this.getCircuitBreakerConfig(),
          errorThresholdPercentage: 30
        }
      },
      
      development: {
        redis: {
          enableCluster: false,
          enableSentinel: false,
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
          db: parseInt(process.env.REDIS_DB || '0'),
          
          connectionPool: {
            connectionPoolSize: 5,
            enableReadyCheck: true,
            maxRetriesPerRequest: 3
          }
        },
        pipeline: {
          batchSize: 100,
          flushInterval: 50,
          maxPipelineLength: 1000
        },
        circuitBreaker: {
          timeout: 5000,
          errorThresholdPercentage: 70,
          resetTimeout: 10000
        }
      }
    };
    
    return configs[deploymentType] || configs.development;
  }

  /**
   * Validate Redis connection
   */
  static async validateConnection(redis) {
    const validations = {
      ping: false,
      info: false,
      config: false,
      memory: false
    };
    
    try {
      // Test basic connectivity
      const pingResult = await redis.ping();
      validations.ping = pingResult === 'PONG';
      
      // Test info command
      const info = await redis.info();
      validations.info = info.includes('redis_version');
      
      // Test config access
      try {
        await redis.config('GET', 'maxmemory');
        validations.config = true;
      } catch (e) {
        // Config might be disabled
        validations.config = false;
      }
      
      // Check memory usage
      const memInfo = await redis.info('memory');
      const usedMemory = parseInt(memInfo.match(/used_memory:(\d+)/)?.[1] || '0');
      const maxMemory = parseInt(memInfo.match(/maxmemory:(\d+)/)?.[1] || '0');
      
      if (maxMemory > 0) {
        validations.memory = (usedMemory / maxMemory) < 0.9; // Less than 90% usage
      } else {
        validations.memory = true; // No limit set
      }
      
      return {
        valid: Object.values(validations).every(v => v === true),
        validations
      };
      
    } catch (error) {
      return {
        valid: false,
        validations,
        error: error.message
      };
    }
  }

  /**
   * Get Redis performance tuning commands
   */
  static getPerformanceTuningCommands() {
    return [
      // Persistence settings for performance
      'CONFIG SET save ""', // Disable RDB snapshots
      'CONFIG SET appendonly no', // Disable AOF for maximum performance
      
      // Memory optimization
      'CONFIG SET maxmemory-policy allkeys-lru', // LRU eviction
      'CONFIG SET maxmemory-samples 5', // Sampling size for LRU
      
      // Network optimization
      'CONFIG SET tcp-backlog 511', // Increase TCP backlog
      'CONFIG SET tcp-keepalive 300', // TCP keepalive
      
      // Performance settings
      'CONFIG SET hz 50', // Increase server frequency
      'CONFIG SET slowlog-log-slower-than 10000', // Log slow queries (10ms)
      'CONFIG SET slowlog-max-len 128', // Slow log length
      
      // Client optimization
      'CONFIG SET timeout 0', // Disable client timeout
      'CONFIG SET client-output-buffer-limit normal 0 0 0', // No buffer limits
      'CONFIG SET client-output-buffer-limit replica 256mb 64mb 60',
      'CONFIG SET client-output-buffer-limit pubsub 32mb 8mb 60'
    ];
  }
}

module.exports = RedisConfigurationHelper;