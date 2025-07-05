const Redis = require('ioredis');

// Create Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB || 0
});

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function monitorRateLimits() {
  log('🔍 Rate Limit Monitor', 'bright');
  log('====================\n', 'bright');

  try {
    // Get all rate limit keys
    const patterns = [
      'rl:general:*',
      'rl:sensitive:*',
      'rl:trading:*',
      'rl:auth:*',
      'rl:ws:*',
      'rl:public:*',
      'rl:custom:*'
    ];

    const allKeys = [];
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      allKeys.push(...keys);
    }

    if (allKeys.length === 0) {
      log('No active rate limits found in Redis.', 'yellow');
      return;
    }

    log(`Found ${allKeys.length} active rate limit keys:\n`, 'green');

    // Group keys by type
    const grouped = {};
    for (const key of allKeys) {
      const [, type] = key.split(':');
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(key);
    }

    // Display grouped keys
    for (const [type, keys] of Object.entries(grouped)) {
      log(`\n${type.toUpperCase()} Rate Limits (${keys.length})`, 'cyan');
      log('─'.repeat(40), 'dim');

      for (const key of keys) {
        const value = await redis.get(key);
        const ttl = await redis.ttl(key);
        
        // Parse the key to extract client info
        const parts = key.split(':');
        const clientInfo = parts.slice(2, -1).join(':');
        const window = parts[parts.length - 1];

        log(`  Client: ${clientInfo}`, 'yellow');
        log(`    Requests: ${value}`, 'green');
        log(`    TTL: ${ttl}s (${Math.ceil(ttl / 60)}m)`, 'blue');
        log(`    Window: ${window}`, 'dim');
        
        // Check if near limit
        const limits = {
          general: 100,
          sensitive: 10,
          trading: 20,
          auth: 5,
          ws: 50,
          public: 200,
          custom: 25
        };
        
        const limit = limits[type] || 100;
        const percentage = (parseInt(value) / limit) * 100;
        
        if (percentage >= 90) {
          log(`    ⚠️  Near limit! (${percentage.toFixed(1)}%)`, 'red');
        } else if (percentage >= 70) {
          log(`    ⚡ High usage (${percentage.toFixed(1)}%)`, 'yellow');
        }
        
        log('', 'reset');
      }
    }

    // Summary statistics
    log('\n📊 Summary', 'bright');
    log('─'.repeat(40), 'dim');
    
    let totalRequests = 0;
    for (const key of allKeys) {
      const value = await redis.get(key);
      totalRequests += parseInt(value) || 0;
    }
    
    log(`  Total active limits: ${allKeys.length}`, 'green');
    log(`  Total requests tracked: ${totalRequests}`, 'green');
    log(`  Types in use: ${Object.keys(grouped).join(', ')}`, 'blue');

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
  } finally {
    redis.disconnect();
  }
}

// Clear rate limits for a specific pattern
async function clearRateLimits(pattern) {
  try {
    const keys = await redis.keys(`rl:${pattern}:*`);
    
    if (keys.length === 0) {
      log(`No keys found matching pattern: rl:${pattern}:*`, 'yellow');
      return;
    }

    log(`Found ${keys.length} keys to delete`, 'yellow');
    
    for (const key of keys) {
      await redis.del(key);
      log(`  Deleted: ${key}`, 'green');
    }
    
    log(`\n✅ Cleared ${keys.length} rate limit keys`, 'green');
    
  } catch (error) {
    log(`❌ Error clearing rate limits: ${error.message}`, 'red');
  } finally {
    redis.disconnect();
  }
}

// Show rate limit info for a specific client
async function showClientLimits(clientId) {
  try {
    const patterns = [
      `rl:*:${clientId}:*`,
      `rl:*:ip:${clientId}:*`,
      `rl:*:user:${clientId}:*`
    ];

    const allKeys = [];
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      allKeys.push(...keys);
    }

    if (allKeys.length === 0) {
      log(`No rate limits found for client: ${clientId}`, 'yellow');
      return;
    }

    log(`\nRate limits for client: ${clientId}`, 'cyan');
    log('─'.repeat(40), 'dim');

    for (const key of allKeys) {
      const value = await redis.get(key);
      const ttl = await redis.ttl(key);
      const [, type] = key.split(':');

      log(`  ${type}: ${value} requests, TTL: ${ttl}s`, 'green');
    }

  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
  } finally {
    redis.disconnect();
  }
}

// Main execution
const command = process.argv[2];
const arg = process.argv[3];

if (command === 'clear' && arg) {
  clearRateLimits(arg);
} else if (command === 'client' && arg) {
  showClientLimits(arg);
} else if (command === 'monitor' || !command) {
  monitorRateLimits();
} else {
  log('Rate Limit Monitor - Usage:', 'yellow');
  log('  node monitor-rate-limits.js                # Monitor all rate limits', 'dim');
  log('  node monitor-rate-limits.js client <id>    # Show limits for specific client', 'dim');
  log('  node monitor-rate-limits.js clear <type>   # Clear rate limits by type', 'dim');
  log('    Types: general, sensitive, trading, auth, ws, public, custom', 'dim');
  log('\nExamples:', 'yellow');
  log('  node monitor-rate-limits.js client 192.168.1.1', 'dim');
  log('  node monitor-rate-limits.js clear sensitive', 'dim');
  process.exit(1);
}