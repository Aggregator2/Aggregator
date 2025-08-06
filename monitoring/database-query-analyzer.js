/**
 * Database Query Performance Analyzer
 * Monitors query execution times, identifies slow queries, and provides optimization recommendations
 */

const { getMetricsCollector } = require('./metrics-collector');
const EventEmitter = require('events');
const { Pool } = require('pg');

class DatabaseQueryAnalyzer extends EventEmitter {
  constructor(poolConfig, config = {}) {
    super();
    this.pool = new Pool(poolConfig);
    this.metrics = getMetricsCollector();
    
    this.config = {
      // Performance thresholds
      thresholds: {
        slowQuery: 100,           // ms - queries slower than this are logged
        criticalQuery: 1000,      // ms - queries requiring immediate attention
        indexHitRate: 0.95,       // 95% index hit rate target
        cacheHitRate: 0.90,       // 90% cache hit rate target
        lockWaitTime: 100,        // ms - maximum acceptable lock wait
        deadTupleRatio: 0.1       // 10% dead tuple threshold
      },
      // Monitoring intervals
      intervals: {
        queryStats: 30000,        // 30 seconds
        tableStats: 300000,       // 5 minutes
        indexStats: 600000,       // 10 minutes
        systemStats: 60000        // 1 minute
      },
      // Analysis settings
      analysis: {
        topSlowQueries: 20,       // Number of slow queries to track
        sampleRate: 0.1,          // Sample 10% of queries for detailed analysis
        explainAnalyze: true,     // Run EXPLAIN ANALYZE on slow queries
        captureQueryPlans: true   // Store query execution plans
      },
      ...config
    };

    // Query tracking
    this.queryStats = {
      totalQueries: 0,
      slowQueries: [],
      queryPatterns: new Map(),
      tableUsage: new Map(),
      indexUsage: new Map()
    };

    // System performance metrics
    this.systemStats = {
      connections: {
        active: 0,
        idle: 0,
        idleInTransaction: 0,
        waiting: 0
      },
      cache: {
        hitRate: 0,
        diskReads: 0,
        bufferHits: 0
      },
      locks: {
        waiting: 0,
        exclusive: 0,
        deadlocks: 0
      }
    };

    this.initialize();
  }

  async initialize() {
    try {
      // Enable pg_stat_statements if not already enabled
      await this.enableQueryStats();
      
      // Start monitoring loops
      this.startMonitoring();
      
      console.log('🔍 Database Query Analyzer initialized');
    } catch (error) {
      console.error('Failed to initialize Database Query Analyzer:', error);
      throw error;
    }
  }

  /**
   * Enable query statistics collection
   */
  async enableQueryStats() {
    try {
      // Check if pg_stat_statements is available
      const result = await this.pool.query(`
        SELECT * FROM pg_available_extensions 
        WHERE name = 'pg_stat_statements'
      `);

      if (result.rows.length === 0) {
        console.warn('pg_stat_statements extension not available');
        return;
      }

      // Create extension if not exists
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
      
      console.log('✅ Query statistics enabled');
    } catch (error) {
      console.error('Failed to enable query stats:', error);
    }
  }

  /**
   * Start monitoring loops
   */
  startMonitoring() {
    // Monitor query statistics
    this.queryStatsInterval = setInterval(() => {
      this.analyzeQueryStats();
    }, this.config.intervals.queryStats);

    // Monitor table statistics
    this.tableStatsInterval = setInterval(() => {
      this.analyzeTableStats();
    }, this.config.intervals.tableStats);

    // Monitor index usage
    this.indexStatsInterval = setInterval(() => {
      this.analyzeIndexUsage();
    }, this.config.intervals.indexStats);

    // Monitor system performance
    this.systemStatsInterval = setInterval(() => {
      this.analyzeSystemStats();
    }, this.config.intervals.systemStats);
  }

  /**
   * Analyze query statistics
   */
  async analyzeQueryStats() {
    try {
      // Get slow queries from pg_stat_statements
      const slowQueries = await this.pool.query(`
        SELECT 
          query,
          calls,
          total_exec_time as total_time,
          mean_exec_time as mean_time,
          stddev_exec_time as stddev_time,
          rows,
          100.0 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0) as cache_hit_ratio,
          blk_read_time + blk_write_time as io_time
        FROM pg_stat_statements
        WHERE mean_exec_time > $1
        ORDER BY mean_exec_time DESC
        LIMIT $2
      `, [this.config.thresholds.slowQuery, this.config.analysis.topSlowQueries]);

      // Process slow queries
      for (const query of slowQueries.rows) {
        await this.processSlowQuery(query);
      }

      // Get query pattern statistics
      const patterns = await this.pool.query(`
        SELECT 
          regexp_replace(query, '\\$\\d+|''[^'']*''|\\d+', '?', 'g') as pattern,
          COUNT(*) as count,
          AVG(mean_exec_time) as avg_time,
          SUM(calls) as total_calls
        FROM pg_stat_statements
        GROUP BY pattern
        HAVING COUNT(*) > 10
        ORDER BY avg_time DESC
        LIMIT 50
      `);

      // Update query patterns
      patterns.rows.forEach(pattern => {
        this.queryStats.queryPatterns.set(pattern.pattern, {
          count: pattern.count,
          avgTime: pattern.avg_time,
          totalCalls: pattern.total_calls
        });
      });

      // Record metrics
      await this.recordQueryMetrics(slowQueries.rows);

    } catch (error) {
      console.error('Failed to analyze query stats:', error);
    }
  }

  /**
   * Process individual slow query
   */
  async processSlowQuery(queryData) {
    const { query, mean_time, calls, cache_hit_ratio } = queryData;

    // Check if query needs immediate attention
    if (mean_time > this.config.thresholds.criticalQuery) {
      this.emit('alert', {
        type: 'critical_slow_query',
        severity: 'critical',
        query: query.substring(0, 200),
        meanTime: mean_time,
        calls,
        message: `Critical slow query detected: ${mean_time.toFixed(2)}ms average`
      });
    }

    // Analyze query plan if enabled
    if (this.config.analysis.explainAnalyze && Math.random() < this.config.analysis.sampleRate) {
      await this.analyzeQueryPlan(query);
    }

    // Check cache hit ratio
    if (cache_hit_ratio < this.config.thresholds.cacheHitRate * 100) {
      this.emit('alert', {
        type: 'low_cache_hit_ratio',
        severity: 'medium',
        query: query.substring(0, 200),
        cacheHitRatio: cache_hit_ratio,
        message: `Low cache hit ratio: ${cache_hit_ratio.toFixed(2)}% for frequently executed query`
      });
    }

    // Store in slow query list
    this.queryStats.slowQueries.push({
      query,
      meanTime: mean_time,
      calls,
      cacheHitRatio: cache_hit_ratio,
      timestamp: new Date()
    });

    // Keep only recent slow queries
    if (this.queryStats.slowQueries.length > 100) {
      this.queryStats.slowQueries = this.queryStats.slowQueries.slice(-50);
    }
  }

  /**
   * Analyze query execution plan
   */
  async analyzeQueryPlan(query) {
    try {
      // Skip if query contains EXPLAIN already
      if (query.toLowerCase().includes('explain')) return;

      // Prepare query for EXPLAIN
      const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`;
      
      // Execute EXPLAIN with timeout
      const client = await this.pool.connect();
      try {
        await client.query('SET statement_timeout = 5000'); // 5 second timeout
        const result = await client.query(explainQuery);
        
        const plan = result.rows[0]['QUERY PLAN'][0];
        
        // Analyze plan for issues
        this.analyzePlanForIssues(plan, query);
        
      } finally {
        client.release();
      }
    } catch (error) {
      // Ignore EXPLAIN errors (query might have parameters)
      if (!error.message.includes('syntax error')) {
        console.debug('Failed to analyze query plan:', error.message);
      }
    }
  }

  /**
   * Analyze execution plan for performance issues
   */
  analyzePlanForIssues(plan, query) {
    const issues = [];

    // Check for sequential scans on large tables
    if (plan['Node Type'] === 'Seq Scan' && plan['Actual Rows'] > 10000) {
      issues.push({
        type: 'sequential_scan',
        table: plan['Relation Name'],
        rows: plan['Actual Rows'],
        recommendation: `Add index on ${plan['Relation Name']} for query conditions`
      });
    }

    // Check for missing indexes
    if (plan['Node Type'] === 'Bitmap Heap Scan' && plan['Actual Time'] > 100) {
      issues.push({
        type: 'inefficient_index',
        table: plan['Relation Name'],
        time: plan['Actual Time'],
        recommendation: 'Consider creating a covering index'
      });
    }

    // Check for nested loops with high row counts
    if (plan['Node Type'] === 'Nested Loop' && plan['Actual Rows'] > 1000) {
      issues.push({
        type: 'expensive_join',
        rows: plan['Actual Rows'],
        recommendation: 'Consider using hash join or merge join for large datasets'
      });
    }

    // Emit optimization recommendations
    if (issues.length > 0) {
      this.emit('optimization_suggestion', {
        query: query.substring(0, 200),
        issues,
        plan
      });
    }
  }

  /**
   * Analyze table statistics
   */
  async analyzeTableStats() {
    try {
      // Get table statistics
      const tableStats = await this.pool.query(`
        SELECT 
          schemaname,
          tablename,
          n_live_tup,
          n_dead_tup,
          n_mod_since_analyze,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze,
          CASE 
            WHEN n_live_tup > 0 THEN n_dead_tup::float / n_live_tup::float
            ELSE 0
          END as dead_tuple_ratio
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY n_dead_tup DESC
      `);

      // Check for tables needing maintenance
      for (const table of tableStats.rows) {
        // Check dead tuple ratio
        if (table.dead_tuple_ratio > this.config.thresholds.deadTupleRatio) {
          this.emit('alert', {
            type: 'high_dead_tuples',
            severity: 'medium',
            table: table.tablename,
            deadTupleRatio: table.dead_tuple_ratio,
            message: `Table ${table.tablename} has ${(table.dead_tuple_ratio * 100).toFixed(2)}% dead tuples`
          });
        }

        // Check if analyze is needed
        if (table.n_mod_since_analyze > table.n_live_tup * 0.1) {
          this.emit('alert', {
            type: 'analyze_needed',
            severity: 'low',
            table: table.tablename,
            modifiedRows: table.n_mod_since_analyze,
            message: `Table ${table.tablename} has ${table.n_mod_since_analyze} modifications since last analyze`
          });
        }

        // Update table usage stats
        this.queryStats.tableUsage.set(table.tablename, {
          liveRows: table.n_live_tup,
          deadRows: table.n_dead_tup,
          deadRatio: table.dead_tuple_ratio,
          lastVacuum: table.last_vacuum || table.last_autovacuum,
          lastAnalyze: table.last_analyze || table.last_autoanalyze
        });
      }

      // Record table metrics
      await this.recordTableMetrics(tableStats.rows);

    } catch (error) {
      console.error('Failed to analyze table stats:', error);
    }
  }

  /**
   * Analyze index usage
   */
  async analyzeIndexUsage() {
    try {
      // Get index usage statistics
      const indexStats = await this.pool.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan,
          idx_tup_read,
          idx_tup_fetch,
          pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
          pg_relation_size(indexrelid) as size_bytes
        FROM pg_stat_user_indexes
        WHERE schemaname = 'public'
        ORDER BY idx_scan
      `);

      // Identify unused indexes
      const unusedIndexes = indexStats.rows.filter(idx => idx.idx_scan === '0');
      
      if (unusedIndexes.length > 0) {
        this.emit('optimization_suggestion', {
          type: 'unused_indexes',
          indexes: unusedIndexes.map(idx => ({
            name: idx.indexname,
            table: idx.tablename,
            size: idx.index_size
          })),
          recommendation: 'Consider dropping unused indexes to improve write performance'
        });
      }

      // Get index hit rate
      const indexHitRate = await this.pool.query(`
        SELECT 
          SUM(idx_blks_hit) / NULLIF(SUM(idx_blks_hit + idx_blks_read), 0) as index_hit_rate
        FROM pg_statio_user_indexes
        WHERE schemaname = 'public'
      `);

      const hitRate = parseFloat(indexHitRate.rows[0]?.index_hit_rate || 0);
      
      if (hitRate < this.config.thresholds.indexHitRate) {
        this.emit('alert', {
          type: 'low_index_hit_rate',
          severity: 'medium',
          hitRate: hitRate * 100,
          threshold: this.config.thresholds.indexHitRate * 100,
          message: `Low index hit rate: ${(hitRate * 100).toFixed(2)}%`
        });
      }

      // Update index usage stats
      indexStats.rows.forEach(idx => {
        this.queryStats.indexUsage.set(idx.indexname, {
          scans: parseInt(idx.idx_scan),
          tupsRead: parseInt(idx.idx_tup_read),
          tupsFetch: parseInt(idx.idx_tup_fetch),
          sizeBytes: parseInt(idx.size_bytes)
        });
      });

      // Record index metrics
      await this.recordIndexMetrics(indexStats.rows, hitRate);

    } catch (error) {
      console.error('Failed to analyze index usage:', error);
    }
  }

  /**
   * Analyze system statistics
   */
  async analyzeSystemStats() {
    try {
      // Get connection statistics
      const connections = await this.pool.query(`
        SELECT 
          state,
          COUNT(*) as count
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY state
      `);

      // Update connection stats
      this.systemStats.connections = {
        active: 0,
        idle: 0,
        idleInTransaction: 0,
        waiting: 0
      };

      connections.rows.forEach(conn => {
        switch (conn.state) {
          case 'active':
            this.systemStats.connections.active = parseInt(conn.count);
            break;
          case 'idle':
            this.systemStats.connections.idle = parseInt(conn.count);
            break;
          case 'idle in transaction':
            this.systemStats.connections.idleInTransaction = parseInt(conn.count);
            break;
        }
      });

      // Get cache hit rate
      const cacheStats = await this.pool.query(`
        SELECT 
          SUM(blks_hit) as buffer_hits,
          SUM(blks_read) as disk_reads,
          SUM(blks_hit) / NULLIF(SUM(blks_hit + blks_read), 0) as cache_hit_rate
        FROM pg_stat_database
        WHERE datname = current_database()
      `);

      const cache = cacheStats.rows[0];
      this.systemStats.cache = {
        hitRate: parseFloat(cache.cache_hit_rate || 0),
        diskReads: parseInt(cache.disk_reads || 0),
        bufferHits: parseInt(cache.buffer_hits || 0)
      };

      // Check cache hit rate
      if (this.systemStats.cache.hitRate < this.config.thresholds.cacheHitRate) {
        this.emit('alert', {
          type: 'low_cache_hit_rate',
          severity: 'high',
          hitRate: this.systemStats.cache.hitRate * 100,
          threshold: this.config.thresholds.cacheHitRate * 100,
          message: `Low database cache hit rate: ${(this.systemStats.cache.hitRate * 100).toFixed(2)}%`
        });
      }

      // Get lock statistics
      const locks = await this.pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE NOT granted) as waiting_locks,
          COUNT(*) FILTER (WHERE mode = 'ExclusiveLock') as exclusive_locks
        FROM pg_locks
      `);

      this.systemStats.locks.waiting = parseInt(locks.rows[0].waiting_locks || 0);
      this.systemStats.locks.exclusive = parseInt(locks.rows[0].exclusive_locks || 0);

      // Check for lock contention
      if (this.systemStats.locks.waiting > 0) {
        const blockingQueries = await this.getBlockingQueries();
        
        this.emit('alert', {
          type: 'lock_contention',
          severity: 'high',
          waitingLocks: this.systemStats.locks.waiting,
          blockingQueries,
          message: `Lock contention detected: ${this.systemStats.locks.waiting} queries waiting`
        });
      }

      // Record system metrics
      await this.recordSystemMetrics();

    } catch (error) {
      console.error('Failed to analyze system stats:', error);
    }
  }

  /**
   * Get blocking queries
   */
  async getBlockingQueries() {
    try {
      const result = await this.pool.query(`
        SELECT 
          blocked.pid as blocked_pid,
          blocked.query as blocked_query,
          blocking.pid as blocking_pid,
          blocking.query as blocking_query,
          blocked.query_start as blocked_since
        FROM pg_stat_activity blocked
        JOIN pg_locks blocked_locks ON blocked.pid = blocked_locks.pid
        JOIN pg_locks blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
          AND blocked_locks.database IS NOT DISTINCT FROM blocking_locks.database
          AND blocked_locks.relation IS NOT DISTINCT FROM blocking_locks.relation
          AND blocked_locks.page IS NOT DISTINCT FROM blocking_locks.page
          AND blocked_locks.tuple IS NOT DISTINCT FROM blocking_locks.tuple
          AND blocked_locks.virtualxid IS NOT DISTINCT FROM blocking_locks.virtualxid
          AND blocked_locks.transactionid IS NOT DISTINCT FROM blocking_locks.transactionid
          AND blocked_locks.classid IS NOT DISTINCT FROM blocking_locks.classid
          AND blocked_locks.objid IS NOT DISTINCT FROM blocking_locks.objid
          AND blocked_locks.objsubid IS NOT DISTINCT FROM blocking_locks.objsubid
          AND blocked_locks.pid != blocking_locks.pid
        JOIN pg_stat_activity blocking ON blocking.pid = blocking_locks.pid
        WHERE NOT blocked_locks.granted
        LIMIT 5
      `);

      return result.rows;
    } catch (error) {
      console.error('Failed to get blocking queries:', error);
      return [];
    }
  }

  /**
   * Record metrics to metrics collector
   */
  async recordQueryMetrics(queries) {
    for (const query of queries) {
      await this.metrics.recordHistogram('database.query_time', query.mean_time, {
        calls: query.calls.toString()
      });
      
      await this.metrics.setGauge('database.query_cache_hit_rate', query.cache_hit_ratio || 0);
    }
    
    await this.metrics.setGauge('database.slow_queries_count', queries.length);
  }

  async recordTableMetrics(tables) {
    for (const table of tables) {
      await this.metrics.setGauge('database.table_live_rows', table.n_live_tup, {
        table: table.tablename
      });
      
      await this.metrics.setGauge('database.table_dead_rows', table.n_dead_tup, {
        table: table.tablename
      });
      
      await this.metrics.setGauge('database.table_dead_ratio', table.dead_tuple_ratio, {
        table: table.tablename
      });
    }
  }

  async recordIndexMetrics(indexes, hitRate) {
    await this.metrics.setGauge('database.index_hit_rate', hitRate * 100);
    
    const unusedCount = indexes.filter(idx => idx.idx_scan === '0').length;
    await this.metrics.setGauge('database.unused_indexes_count', unusedCount);
    
    const totalSize = indexes.reduce((sum, idx) => sum + parseInt(idx.size_bytes || 0), 0);
    await this.metrics.setGauge('database.index_total_size', totalSize);
  }

  async recordSystemMetrics() {
    // Connection metrics
    await this.metrics.setGauge('database.connections_active', this.systemStats.connections.active);
    await this.metrics.setGauge('database.connections_idle', this.systemStats.connections.idle);
    await this.metrics.setGauge('database.connections_idle_in_transaction', this.systemStats.connections.idleInTransaction);
    
    // Cache metrics
    await this.metrics.setGauge('database.cache_hit_rate', this.systemStats.cache.hitRate * 100);
    await this.metrics.incrementCounter('database.disk_reads', this.systemStats.cache.diskReads);
    await this.metrics.incrementCounter('database.buffer_hits', this.systemStats.cache.bufferHits);
    
    // Lock metrics
    await this.metrics.setGauge('database.locks_waiting', this.systemStats.locks.waiting);
    await this.metrics.setGauge('database.locks_exclusive', this.systemStats.locks.exclusive);
  }

  /**
   * Get optimization report
   */
  async getOptimizationReport() {
    const report = {
      summary: {
        totalQueries: this.queryStats.totalQueries,
        slowQueries: this.queryStats.slowQueries.length,
        cacheHitRate: this.systemStats.cache.hitRate * 100,
        indexHitRate: 0,
        activeConnections: this.systemStats.connections.active,
        lockContention: this.systemStats.locks.waiting > 0
      },
      topSlowQueries: this.queryStats.slowQueries.slice(0, 10),
      unusedIndexes: [],
      tableMaintenance: [],
      recommendations: []
    };

    // Get unused indexes
    for (const [indexName, stats] of this.queryStats.indexUsage) {
      if (stats.scans === 0) {
        report.unusedIndexes.push({
          name: indexName,
          sizeBytes: stats.sizeBytes
        });
      }
    }

    // Get tables needing maintenance
    for (const [tableName, stats] of this.queryStats.tableUsage) {
      if (stats.deadRatio > this.config.thresholds.deadTupleRatio) {
        report.tableMaintenance.push({
          table: tableName,
          deadRatio: stats.deadRatio,
          lastVacuum: stats.lastVacuum
        });
      }
    }

    // Generate recommendations
    if (report.summary.cacheHitRate < this.config.thresholds.cacheHitRate * 100) {
      report.recommendations.push({
        type: 'cache_tuning',
        priority: 'high',
        recommendation: 'Increase shared_buffers or optimize queries to reduce disk reads'
      });
    }

    if (report.unusedIndexes.length > 0) {
      report.recommendations.push({
        type: 'index_cleanup',
        priority: 'medium',
        recommendation: `Drop ${report.unusedIndexes.length} unused indexes to improve write performance`
      });
    }

    if (report.tableMaintenance.length > 0) {
      report.recommendations.push({
        type: 'vacuum_needed',
        priority: 'medium',
        recommendation: `Run VACUUM on ${report.tableMaintenance.length} tables with high dead tuple ratios`
      });
    }

    return report;
  }

  /**
   * Execute optimization recommendations
   */
  async executeOptimization(optimizationType) {
    const client = await this.pool.connect();
    try {
      switch (optimizationType) {
        case 'vacuum_all':
          await client.query('VACUUM ANALYZE');
          break;
          
        case 'update_statistics':
          await client.query('ANALYZE');
          break;
          
        case 'reindex_all':
          const tables = await client.query(`
            SELECT tablename FROM pg_tables WHERE schemaname = 'public'
          `);
          for (const table of tables.rows) {
            await client.query(`REINDEX TABLE CONCURRENTLY ${table.tablename}`);
          }
          break;
      }
      
      return { success: true, message: `Optimization ${optimizationType} completed` };
    } catch (error) {
      console.error(`Failed to execute optimization ${optimizationType}:`, error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }

  /**
   * Cleanup
   */
  async stop() {
    clearInterval(this.queryStatsInterval);
    clearInterval(this.tableStatsInterval);
    clearInterval(this.indexStatsInterval);
    clearInterval(this.systemStatsInterval);
    
    await this.pool.end();
    
    console.log('🛑 Database Query Analyzer stopped');
  }
}

module.exports = DatabaseQueryAnalyzer;