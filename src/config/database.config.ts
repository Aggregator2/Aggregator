import { Pool, PoolConfig } from 'pg';
import Redis, { RedisOptions } from 'ioredis';
// import { PrismaClient } from '@prisma/client'; // Comment out until Prisma is generated

interface DatabaseConfig {
  postgres: PoolConfig;
  redis: RedisOptions;
  mongodb?: string;
}

// Database configuration based on environment
export const getDatabaseConfig = (): DatabaseConfig => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    postgres: {
      connectionString: process.env.DATABASE_URL,
      min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
      max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: isProduction && process.env.DATABASE_SSL === 'true' ? {
        rejectUnauthorized: false
      } : false,
    },
    redis: {
      host: process.env.REDIS_URL?.split('@')[1]?.split(':')[0] || 'localhost',
      port: parseInt(process.env.REDIS_URL?.split(':')[2] || '6379'),
      password: process.env.REDIS_URL?.split('@')[0]?.split('//')[1]?.split(':')[1],
      tls: isProduction && process.env.REDIS_TLS === 'true' ? {} : undefined,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    },
    mongodb: process.env.MONGODB_URI,
  };
};

// PostgreSQL connection pool
let pgPool: Pool | null = null;

export const getPostgresPool = (): Pool => {
  if (!pgPool) {
    const config = getDatabaseConfig();
    pgPool = new Pool(config.postgres);
    
    pgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
    
    pgPool.on('connect', () => {
      console.log('PostgreSQL pool connected');
    });
  }
  
  return pgPool;
};

// Redis client instances
let redisClient: Redis | null = null;
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;

export const getRedisClient = (): Redis => {
  if (!redisClient) {
    const config = getDatabaseConfig();
    redisClient = new Redis(config.redis);
    
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });
    
    redisClient.on('connect', () => {
      console.log('Redis client connected');
    });
  }
  
  return redisClient;
};

export const getRedisPubSubClients = () => {
  if (!redisPubClient || !redisSubClient) {
    const config = getDatabaseConfig();
    redisPubClient = new Redis(config.redis);
    redisSubClient = new Redis(config.redis);
    
    redisPubClient.on('error', (err) => {
      console.error('Redis Pub Client Error:', err);
    });
    
    redisSubClient.on('error', (err) => {
      console.error('Redis Sub Client Error:', err);
    });
  }
  
  return { pub: redisPubClient, sub: redisSubClient };
};

// Prisma client singleton
let prisma: PrismaClient | null = null;

export const getPrismaClient = (): PrismaClient => {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      errorFormat: process.env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
    });
  }
  
  return prisma;
};

// Health check for all databases
export const checkDatabaseHealth = async (): Promise<{
  postgres: boolean;
  redis: boolean;
  prisma: boolean;
}> => {
  const health = {
    postgres: false,
    redis: false,
    prisma: false,
  };
  
  try {
    // Check PostgreSQL
    const pool = getPostgresPool();
    const result = await pool.query('SELECT 1');
    health.postgres = result.rows.length > 0;
  } catch (error) {
    console.error('PostgreSQL health check failed:', error);
  }
  
  try {
    // Check Redis
    const redis = getRedisClient();
    await redis.ping();
    health.redis = true;
  } catch (error) {
    console.error('Redis health check failed:', error);
  }
  
  try {
    // Check Prisma
    const prismaClient = getPrismaClient();
    await prismaClient.$queryRaw`SELECT 1`;
    health.prisma = true;
  } catch (error) {
    console.error('Prisma health check failed:', error);
  }
  
  return health;
};

// Cleanup function for graceful shutdown
export const closeDatabaseConnections = async (): Promise<void> => {
  const promises: Promise<any>[] = [];
  
  if (pgPool) {
    promises.push(pgPool.end());
  }
  
  if (redisClient) {
    promises.push(redisClient.quit());
  }
  
  if (redisPubClient) {
    promises.push(redisPubClient.quit());
  }
  
  if (redisSubClient) {
    promises.push(redisSubClient.quit());
  }
  
  if (prisma) {
    promises.push(prisma.$disconnect());
  }
  
  await Promise.all(promises);
  console.log('All database connections closed');
};