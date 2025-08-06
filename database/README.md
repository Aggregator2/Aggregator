# SwappiQ Protocol Database Schema

This directory contains the complete PostgreSQL database schema for the SwappiQ Protocol decentralized exchange.

## Overview

The schema is designed for high-performance trading with:
- **Table partitioning** for scalability
- **Comprehensive indexes** for query optimization
- **Row-level security** for multi-tenant isolation
- **Audit logging** for compliance
- **Automated maintenance** procedures

## Schema Files

1. **001_create_orders_table.sql**
   - Core orders table with time-based partitioning
   - Supports limit, market, stop, and stop-limit orders
   - Automatic partition management

2. **002_create_trades_table.sql**
   - Executed trades with settlement tracking
   - Partitioned by execution time
   - Links to maker/taker orders

3. **003_create_users_table.sql**
   - User accounts with tier-based fee structure
   - Balance tracking with optimistic locking
   - API key management with rate limiting

4. **004_create_market_data_tables.sql**
   - Trading pairs configuration
   - OHLCV candles with multiple timeframes
   - Real-time market statistics
   - Order book snapshots

5. **005_create_settlement_tables.sql**
   - Settlement batch management
   - Queue system for reliable processing
   - Gas price tracking for optimization

6. **006_create_audit_tables.sql**
   - Comprehensive audit logging
   - System events and monitoring
   - Performance metrics collection
   - Failed job tracking

7. **007_create_views_and_functions.sql**
   - Helper views for common queries
   - Business logic functions
   - Market statistics calculations

8. **008_create_maintenance_procedures.sql**
   - Automated partition management
   - Data cleanup procedures
   - Statistics updates
   - Scheduled maintenance jobs

9. **009_create_security_policies.sql**
   - Row-level security policies
   - Role-based access control
   - Audit triggers
   - Data masking functions

10. **010_performance_indexes.sql**
    - Optimized composite indexes
    - Covering indexes for index-only scans
    - BRIN indexes for time-series data
    - Index analysis functions

## Installation

1. Create the database:
```sql
CREATE DATABASE swappiq;
\c swappiq;
```

2. Install required extensions:
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_cron"; -- Optional, for scheduled jobs
```

3. Run schema files in order:
```bash
for i in {001..010}; do
    psql -d swappiq -f database/schema/${i}_*.sql
done
```

## Key Features

### Partitioning Strategy

- **Orders**: Monthly partitions, 12 months retention
- **Trades**: Monthly partitions, 12 months retention
- **Candles**: Monthly partitions, unlimited retention
- **Audit Logs**: Monthly partitions, 6 months retention
- **Order Book Snapshots**: Daily partitions, 30 days retention

### Performance Optimizations

- Composite indexes for common query patterns
- Partial indexes for filtered queries
- BRIN indexes for time-series data
- Covering indexes to enable index-only scans
- Materialized views for expensive aggregations

### Security Features

- Row-level security for multi-tenant isolation
- API key authentication with permissions
- Comprehensive audit logging
- Data masking for sensitive information
- Rate limiting support

### Maintenance

The schema includes automated maintenance procedures:
- Partition creation (scheduled daily)
- Expired order cleanup (every 15 minutes)
- Market statistics updates (every minute)
- Old partition removal (weekly)
- Vacuum and analyze (daily)

## Configuration

### Environment Variables

```bash
# Database connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=swappiq
DB_USER=swappiq_user
DB_PASSWORD=secure_password

# Connection pool
DB_POOL_MIN=5
DB_POOL_MAX=20
DB_IDLE_TIMEOUT=30000

# Maintenance
DB_PARTITION_RETENTION_MONTHS=12
DB_SNAPSHOT_RETENTION_DAYS=30
```

### Performance Tuning

Recommended PostgreSQL configuration:
```ini
# Memory
shared_buffers = 25% of RAM
effective_cache_size = 75% of RAM
work_mem = 64MB
maintenance_work_mem = 256MB

# Checkpoints
checkpoint_completion_target = 0.9
wal_buffers = 16MB
min_wal_size = 2GB
max_wal_size = 8GB

# Query planning
random_page_cost = 1.1  # For SSD storage
effective_io_concurrency = 200  # For SSD storage

# Parallel queries
max_worker_processes = 8
max_parallel_workers_per_gather = 4
max_parallel_workers = 8
```

## Monitoring

Use the provided functions to monitor database health:

```sql
-- Check table sizes and statistics
SELECT * FROM update_table_statistics();

-- Analyze index efficiency
SELECT * FROM analyze_index_efficiency();

-- Check for missing indexes
SELECT * FROM suggest_missing_indexes();

-- View partition information
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE tablename LIKE '%_2024_%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Backup Strategy

1. **Continuous archiving** with WAL-E or pgBackRest
2. **Daily logical backups** of active partitions
3. **Weekly full backups**
4. **Partition-level backups** before dropping old partitions

## Migration Guide

For migrating from the previous schema:

1. Create new database with this schema
2. Use `pg_dump` with `--data-only` flag
3. Transform data as needed
4. Load into new schema
5. Update application configuration
6. Run verification queries

## Support

For issues or questions about the database schema:
1. Check the query performance using `EXPLAIN ANALYZE`
2. Review the PostgreSQL logs
3. Monitor long-running queries
4. Analyze index usage statistics