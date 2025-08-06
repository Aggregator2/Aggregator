import { ClusterOptions } from 'ioredis';
import { logger } from '../../utils/logger';

export interface RedisClusterConfigOptions {
  nodes: Array<{ host: string; port: number }>;
  redisOptions?: {
    password?: string;
    enableReadyCheck?: boolean;
    maxRetriesPerRequest?: number;
  };
  clusterRetryStrategy?: (times: number) => number | void;
  enableOfflineQueue?: boolean;
  scaleReads?: 'master' | 'slave' | 'all';
}

export class RedisClusterConfig {
  private static defaultNodes = [
    { host: process.env.REDIS_CLUSTER_NODE1_HOST || 'localhost', port: parseInt(process.env.REDIS_CLUSTER_NODE1_PORT || '7000') },
    { host: process.env.REDIS_CLUSTER_NODE2_HOST || 'localhost', port: parseInt(process.env.REDIS_CLUSTER_NODE2_PORT || '7001') },
    { host: process.env.REDIS_CLUSTER_NODE3_HOST || 'localhost', port: parseInt(process.env.REDIS_CLUSTER_NODE3_PORT || '7002') },
    { host: process.env.REDIS_CLUSTER_NODE4_HOST || 'localhost', port: parseInt(process.env.REDIS_CLUSTER_NODE4_PORT || '7003') },
    { host: process.env.REDIS_CLUSTER_NODE5_HOST || 'localhost', port: parseInt(process.env.REDIS_CLUSTER_NODE5_PORT || '7004') },
    { host: process.env.REDIS_CLUSTER_NODE6_HOST || 'localhost', port: parseInt(process.env.REDIS_CLUSTER_NODE6_PORT || '7005') },
  ];

  static getClusterOptions(customOptions?: Partial<RedisClusterConfigOptions>): ClusterOptions {
    const nodes = customOptions?.nodes || this.defaultNodes;
    
    return {
      nodes,
      redisOptions: {
        password: process.env.REDIS_CLUSTER_PASSWORD || customOptions?.redisOptions?.password,
        enableReadyCheck: true,
        maxRetriesPerRequest: 3,
        ...customOptions?.redisOptions,
      },
      clusterRetryStrategy: customOptions?.clusterRetryStrategy || ((times: number) => {
        const delay = Math.min(times * 100, 3000);
        logger.warn(`Redis cluster retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      }),
      enableOfflineQueue: customOptions?.enableOfflineQueue ?? true,
      scaleReads: customOptions?.scaleReads || 'slave',
      natMap: process.env.REDIS_NAT_MAP ? JSON.parse(process.env.REDIS_NAT_MAP) : undefined,
    };
  }

  static getStandaloneConfig() {
    return {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    };
  }

  static isClusterMode(): boolean {
    return process.env.REDIS_CLUSTER_MODE === 'true';
  }
}