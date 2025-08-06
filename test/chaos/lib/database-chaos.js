/**
 * Database Chaos Engineering
 * PostgreSQL-specific chaos scenarios
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class DatabaseChaos {
  constructor(config = {}) {
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 5432,
      database: config.database || 'swappiq',
      user: config.user || 'postgres',
      password: config.password,
      replicaHosts: config.replicaHosts || [],
      ...config
    };
    
    this.activeFailures = [];
  }

  /**
   * Get psql command with auth
   */
  getPsqlCommand(additionalParams = '') {
    const pgpass = this.config.password ? `PGPASSWORD="${this.config.password}"` : '';
    return `${pgpass} psql -h ${this.config.host} -p ${this.config.port} -U ${this.config.user} -d ${this.config.database} ${additionalParams}`;
  }

  /**
   * Kill random database connections
   */
  async killConnections(pattern = '%') {
    console.log(`💀 Killing database connections matching: ${pattern}`);
    
    const query = `
      SELECT pg_terminate_backend(pid), pid, application_name 
      FROM pg_stat_activity 
      WHERE datname = '${this.config.database}' 
      AND pid <> pg_backend_pid()
      AND application_name LIKE '${pattern}'
      AND state != 'idle';
    `;
    
    try {
      const result = await execAsync(`${this.getPsqlCommand()} -c "${query}"`);
      
      this.activeFailures.push({
        type: 'connection_kill',
        pattern,
        timestamp: Date.now()
      });
      
      return { success: true, output: result.stdout };
    } catch (error) {
      console.error(`Failed to kill connections: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Lock critical tables
   */
  async lockTables(tables = ['orders', 'trades']) {
    console.log(`🔒 Locking tables: ${tables.join(', ')}`);
    
    const lockStatements = tables.map(table => 
      `LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE;`
    ).join(' ');
    
    try {
      // Start a transaction that holds locks
      const lockProcess = exec(
        `${this.getPsqlCommand()} -c "BEGIN; ${lockStatements} SELECT pg_sleep(60); ROLLBACK;"`
      );
      
      this.activeFailures.push({
        type: 'table_lock',
        tables,
        process: lockProcess,
        timestamp: Date.now(),
        recovery: async () => {
          lockProcess.kill();
        }
      });
      
      return { success: true, tables };
    } catch (error) {
      console.error(`Failed to lock tables: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fill connection pool
   */
  async exhaustConnectionPool(numConnections = 100) {
    console.log(`🌊 Exhausting connection pool with ${numConnections} connections`);
    
    const connections = [];
    
    try {
      for (let i = 0; i < numConnections; i++) {
        const conn = exec(
          `${this.getPsqlCommand()} -c "SELECT pg_sleep(300);"` // Hold for 5 minutes
        );
        connections.push(conn);
      }
      
      this.activeFailures.push({
        type: 'connection_pool_exhaustion',
        connections,
        timestamp: Date.now(),
        recovery: async () => {
          connections.forEach(conn => conn.kill());
        }
      });
      
      return { success: true, numConnections };
    } catch (error) {
      console.error(`Failed to exhaust connection pool: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create long-running queries
   */
  async createSlowQueries(numQueries = 5) {
    console.log(`🐌 Creating ${numQueries} slow queries`);
    
    const queries = [];
    const slowQueryTemplates = [
      // Cartesian join
      `SELECT COUNT(*) FROM orders o1, orders o2 WHERE o1.created_at > NOW() - INTERVAL '1 day';`,
      
      // Expensive aggregation
      `SELECT user_id, COUNT(*) as cnt FROM trades GROUP BY user_id ORDER BY cnt DESC;`,
      
      // Recursive CTE
      `WITH RECURSIVE t(n) AS (
        VALUES (1)
        UNION ALL
        SELECT n+1 FROM t WHERE n < 1000000
      ) SELECT COUNT(*) FROM t;`,
      
      // Large sort
      `SELECT * FROM trades ORDER BY RANDOM() LIMIT 10000;`,
      
      // Nested subqueries
      `SELECT * FROM orders WHERE user_id IN (
        SELECT user_id FROM trades WHERE pair IN (
          SELECT pair FROM market_stats WHERE volume_24h > 1000
        )
      );`
    ];
    
    try {
      for (let i = 0; i < numQueries; i++) {
        const query = slowQueryTemplates[i % slowQueryTemplates.length];
        const proc = exec(`${this.getPsqlCommand()} -c "${query}"`);
        queries.push(proc);
      }
      
      this.activeFailures.push({
        type: 'slow_queries',
        queries,
        timestamp: Date.now(),
        recovery: async () => {
          queries.forEach(q => q.kill());
        }
      });
      
      return { success: true, numQueries };
    } catch (error) {
      console.error(`Failed to create slow queries: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger database failover
   */
  async triggerFailover() {
    console.log(`🔄 Triggering database failover`);
    
    if (this.config.replicaHosts.length === 0) {
      throw new Error('No replica hosts configured');
    }
    
    try {
      // Promote replica (PostgreSQL specific)
      const replica = this.config.replicaHosts[0];
      
      if (replica.promotionCommand) {
        await execAsync(replica.promotionCommand);
      } else {
        // Default promotion for PostgreSQL
        await execAsync(
          `ssh ${replica.host} "touch /var/lib/postgresql/data/promote.signal"`
        );
      }
      
      this.activeFailures.push({
        type: 'database_failover',
        oldMaster: this.config.host,
        newMaster: replica.host,
        timestamp: Date.now()
      });
      
      return { success: true, newMaster: replica.host };
    } catch (error) {
      console.error(`Failed to trigger failover: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fill database disk space
   */
  async fillDiskSpace(tableName = 'chaos_fill', sizeMB = 1000) {
    console.log(`💾 Filling database disk with ${sizeMB}MB`);
    
    try {
      // Create a large table
      await execAsync(
        `${this.getPsqlCommand()} -c "CREATE TABLE IF NOT EXISTS ${tableName} (id SERIAL, data TEXT);"`
      );
      
      // Insert large amounts of data
      const rowSize = 1024; // 1KB per row
      const numRows = (sizeMB * 1024) / rowSize;
      
      await execAsync(
        `${this.getPsqlCommand()} -c "INSERT INTO ${tableName} (data) SELECT repeat('X', ${rowSize}) FROM generate_series(1, ${numRows});"`
      );
      
      this.activeFailures.push({
        type: 'disk_fill',
        tableName,
        sizeMB,
        timestamp: Date.now(),
        recovery: async () => {
          await execAsync(
            `${this.getPsqlCommand()} -c "DROP TABLE IF EXISTS ${tableName};"`
          );
        }
      });
      
      return { success: true, tableName, sizeMB };
    } catch (error) {
      console.error(`Failed to fill disk space: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Corrupt indexes
   */
  async corruptIndex(indexName) {
    console.log(`💥 Corrupting index: ${indexName}`);
    
    try {
      // Mark index as invalid (safer than actual corruption)
      await execAsync(
        `${this.getPsqlCommand()} -c "UPDATE pg_index SET indisvalid = false WHERE indexrelid = '${indexName}'::regclass;"`
      );
      
      this.activeFailures.push({
        type: 'index_corruption',
        indexName,
        timestamp: Date.now(),
        recovery: async () => {
          await execAsync(
            `${this.getPsqlCommand()} -c "REINDEX INDEX ${indexName};"`
          );
        }
      });
      
      return { success: true, indexName };
    } catch (error) {
      console.error(`Failed to corrupt index: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create deadlocks
   */
  async createDeadlock() {
    console.log(`🔀 Creating database deadlock`);
    
    try {
      // Transaction 1: Lock orders then trades
      const tx1 = exec(
        `${this.getPsqlCommand()} -c "
          BEGIN;
          UPDATE orders SET updated_at = NOW() WHERE id = (SELECT id FROM orders LIMIT 1);
          SELECT pg_sleep(2);
          UPDATE trades SET settlement_status = 'pending' WHERE id = (SELECT id FROM trades LIMIT 1);
          COMMIT;
        "`
      );
      
      // Transaction 2: Lock trades then orders (opposite order)
      const tx2 = exec(
        `${this.getPsqlCommand()} -c "
          BEGIN;
          UPDATE trades SET settlement_status = 'pending' WHERE id = (SELECT id FROM trades LIMIT 1);
          SELECT pg_sleep(2);
          UPDATE orders SET updated_at = NOW() WHERE id = (SELECT id FROM orders LIMIT 1);
          COMMIT;
        "`
      );
      
      this.activeFailures.push({
        type: 'deadlock',
        processes: [tx1, tx2],
        timestamp: Date.now()
      });
      
      return { success: true };
    } catch (error) {
      console.error(`Failed to create deadlock: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Bloat tables with dead tuples
   */
  async createTableBloat(tableName = 'orders', operations = 10000) {
    console.log(`🗑️ Creating table bloat in ${tableName}`);
    
    try {
      // Disable autovacuum temporarily
      await execAsync(
        `${this.getPsqlCommand()} -c "ALTER TABLE ${tableName} SET (autovacuum_enabled = false);"`
      );
      
      // Perform many updates to create dead tuples
      for (let i = 0; i < operations / 1000; i++) {
        await execAsync(
          `${this.getPsqlCommand()} -c "UPDATE ${tableName} SET updated_at = NOW() WHERE id IN (SELECT id FROM ${tableName} LIMIT 1000);"`
        );
      }
      
      this.activeFailures.push({
        type: 'table_bloat',
        tableName,
        operations,
        timestamp: Date.now(),
        recovery: async () => {
          // Re-enable autovacuum and run vacuum
          await execAsync(
            `${this.getPsqlCommand()} -c "ALTER TABLE ${tableName} SET (autovacuum_enabled = true);"`
          );
          await execAsync(
            `${this.getPsqlCommand()} -c "VACUUM FULL ${tableName};"`
          );
        }
      });
      
      return { success: true, tableName, operations };
    } catch (error) {
      console.error(`Failed to create table bloat: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check database health
   */
  async checkHealth() {
    const health = {
      connected: false,
      activeConnections: 0,
      lockedQueries: 0,
      replicationLag: null,
      cacheHitRatio: 0
    };
    
    try {
      // Check basic connectivity
      const pingResult = await execAsync(
        `${this.getPsqlCommand()} -c "SELECT 1;"`
      );
      health.connected = true;
      
      // Get connection count
      const connResult = await execAsync(
        `${this.getPsqlCommand()} -c "SELECT COUNT(*) FROM pg_stat_activity WHERE state != 'idle';"`
      );
      health.activeConnections = parseInt(connResult.stdout.match(/(\d+)/)[1]);
      
      // Check for locks
      const lockResult = await execAsync(
        `${this.getPsqlCommand()} -c "SELECT COUNT(*) FROM pg_locks WHERE granted = false;"`
      );
      health.lockedQueries = parseInt(lockResult.stdout.match(/(\d+)/)[1]);
      
      // Check cache hit ratio
      const cacheResult = await execAsync(
        `${this.getPsqlCommand()} -c "SELECT ROUND(100.0 * sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)), 2) as cache_hit_ratio FROM pg_statio_user_tables;"`
      );
      const cacheMatch = cacheResult.stdout.match(/(\d+\.\d+)/);
      if (cacheMatch) {
        health.cacheHitRatio = parseFloat(cacheMatch[1]);
      }
      
      // Check replication lag if replicas exist
      if (this.config.replicaHosts.length > 0) {
        const lagResult = await execAsync(
          `${this.getPsqlCommand()} -c "SELECT EXTRACT(EPOCH FROM (NOW() - pg_last_xact_replay_timestamp())) as lag;"`
        );
        const lagMatch = lagResult.stdout.match(/(\d+\.\d+)/);
        if (lagMatch) {
          health.replicationLag = parseFloat(lagMatch[1]);
        }
      }
      
    } catch (error) {
      health.error = error.message;
    }
    
    return health;
  }

  /**
   * Recover all active failures
   */
  async recoverAll() {
    console.log('🔧 Recovering all database chaos...');
    
    for (const failure of this.activeFailures) {
      if (failure.recovery) {
        try {
          await failure.recovery();
          console.log(`Recovered: ${failure.type}`);
        } catch (error) {
          console.error(`Failed to recover ${failure.type}: ${error.message}`);
        }
      }
    }
    
    this.activeFailures = [];
  }
}

module.exports = DatabaseChaos;