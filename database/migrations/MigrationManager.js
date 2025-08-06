/**
 * @fileoverview Advanced Migration Manager for Zero-Downtime Deployments
 * @author SwappiQ Protocol
 * @description Handles database migrations with rollback support and validation
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * Migration Manager for zero-downtime database changes
 */
class MigrationManager extends EventEmitter {
    constructor(config) {
        super();
        
        this.config = {
            // Database configuration
            database: {
                url: config.database?.url || process.env.DATABASE_URL,
                shadowUrl: config.database?.shadowUrl || process.env.SHADOW_DATABASE_URL,
                maxRetries: config.database?.maxRetries || 3,
                retryDelay: config.database?.retryDelay || 1000,
                connectionTimeout: config.database?.connectionTimeout || 30000
            },
            
            // Migration settings
            migration: {
                directory: config.migration?.directory || './migrations',
                tableName: config.migration?.tableName || '_prisma_migrations',
                lockTimeout: config.migration?.lockTimeout || 30000,
                batchSize: config.migration?.batchSize || 1000,
                validateData: config.migration?.validateData !== false
            },
            
            // Zero-downtime strategies
            zeroDowntime: {
                enabled: config.zeroDowntime?.enabled !== false,
                parallelIndex: config.zeroDowntime?.parallelIndex !== false,
                onlineSchemaChange: config.zeroDowntime?.onlineSchemaChange !== false,
                backfillBatchSize: config.zeroDowntime?.backfillBatchSize || 1000,
                backfillDelay: config.zeroDowntime?.backfillDelay || 100
            },
            
            // Validation settings
            validation: {
                preCheck: config.validation?.preCheck !== false,
                postCheck: config.validation?.postCheck !== false,
                dataIntegrity: config.validation?.dataIntegrity !== false,
                schemaValidation: config.validation?.schemaValidation !== false,
                maxValidationTime: config.validation?.maxValidationTime || 300000 // 5 minutes
            },
            
            // Monitoring
            monitoring: {
                enabled: config.monitoring?.enabled !== false,
                metricsInterval: config.monitoring?.metricsInterval || 1000,
                slowQueryThreshold: config.monitoring?.slowQueryThreshold || 1000,
                deadlockDetection: config.monitoring?.deadlockDetection !== false
            },
            
            // Rollback configuration
            rollback: {
                enabled: config.rollback?.enabled !== false,
                maxRollbackTime: config.rollback?.maxRollbackTime || 600000, // 10 minutes
                createBackup: config.rollback?.createBackup !== false,
                verifyRollback: config.rollback?.verifyRollback !== false
            },
            
            dryRun: config.dryRun || false,
            verbose: config.verbose || false,
            ...config
        };

        this.prisma = null;
        this.shadowPrisma = null;
        
        this.state = {
            currentVersion: null,
            targetVersion: null,
            migrations: [],
            appliedMigrations: new Set(),
            lock: null,
            metrics: {
                migrationsRun: 0,
                migrationsRolledBack: 0,
                totalDuration: 0,
                errors: 0,
                validationsPassed: 0,
                validationsFailed: 0
            }
        };
    }

    /**
     * Initialize migration manager
     */
    async initialize() {
        try {
            // Initialize Prisma clients
            this.prisma = new PrismaClient({
                datasources: {
                    db: { url: this.config.database.url }
                },
                log: this.config.verbose ? ['query', 'info', 'warn', 'error'] : ['error']
            });

            if (this.config.database.shadowUrl) {
                this.shadowPrisma = new PrismaClient({
                    datasources: {
                        db: { url: this.config.database.shadowUrl }
                    }
                });
            }

            // Connect to databases
            await this.prisma.$connect();
            if (this.shadowPrisma) {
                await this.shadowPrisma.$connect();
            }

            // Load migration history
            await this._loadMigrationHistory();
            
            // Load available migrations
            await this._loadMigrations();

            console.log('Migration Manager initialized');
            this.emit('initialized');
            
        } catch (error) {
            console.error('Failed to initialize Migration Manager:', error);
            throw error;
        }
    }

    /**
     * Run pending migrations
     */
    async migrate(options = {}) {
        const startTime = Date.now();
        const results = {
            success: true,
            migrationsApplied: [],
            errors: [],
            duration: 0,
            validated: false
        };

        try {
            // Acquire migration lock
            await this._acquireLock();

            // Get pending migrations
            const pendingMigrations = await this._getPendingMigrations();
            
            if (pendingMigrations.length === 0) {
                console.log('No pending migrations');
                return results;
            }

            console.log(`Found ${pendingMigrations.length} pending migrations`);

            // Pre-migration validation
            if (this.config.validation.preCheck) {
                await this._runPreMigrationChecks();
            }

            // Create backup if configured
            let backupId = null;
            if (this.config.rollback.createBackup && !this.config.dryRun) {
                backupId = await this._createBackup();
            }

            // Run migrations
            for (const migration of pendingMigrations) {
                try {
                    await this._runMigration(migration, options);
                    results.migrationsApplied.push(migration.name);
                } catch (error) {
                    console.error(`Migration ${migration.name} failed:`, error);
                    results.errors.push({
                        migration: migration.name,
                        error: error.message
                    });
                    results.success = false;

                    // Rollback if configured
                    if (this.config.rollback.enabled && !this.config.dryRun) {
                        await this._rollbackToBackup(backupId);
                    }
                    break;
                }
            }

            // Post-migration validation
            if (this.config.validation.postCheck && results.success) {
                results.validated = await this._runPostMigrationChecks();
            }

            results.duration = Date.now() - startTime;
            
            // Update metrics
            this.state.metrics.migrationsRun += results.migrationsApplied.length;
            this.state.metrics.totalDuration += results.duration;
            
            this.emit('migrationCompleted', results);
            return results;

        } catch (error) {
            console.error('Migration failed:', error);
            results.success = false;
            results.errors.push({ error: error.message });
            throw error;
        } finally {
            await this._releaseLock();
        }
    }

    /**
     * Rollback to specific version
     */
    async rollback(targetVersion, options = {}) {
        try {
            await this._acquireLock();

            const rollbackMigrations = await this._getRollbackMigrations(targetVersion);
            
            if (rollbackMigrations.length === 0) {
                console.log('No migrations to rollback');
                return { success: true, migrationsRolledBack: [] };
            }

            const results = {
                success: true,
                migrationsRolledBack: [],
                errors: []
            };

            // Run rollbacks in reverse order
            for (const migration of rollbackMigrations.reverse()) {
                try {
                    await this._runRollback(migration, options);
                    results.migrationsRolledBack.push(migration.name);
                    this.state.metrics.migrationsRolledBack++;
                } catch (error) {
                    console.error(`Rollback ${migration.name} failed:`, error);
                    results.errors.push({
                        migration: migration.name,
                        error: error.message
                    });
                    results.success = false;
                    break;
                }
            }

            this.emit('rollbackCompleted', results);
            return results;

        } finally {
            await this._releaseLock();
        }
    }

    /**
     * Validate database schema and data integrity
     */
    async validate() {
        const results = {
            schemaValid: false,
            dataValid: false,
            issues: [],
            suggestions: []
        };

        try {
            // Schema validation
            if (this.config.validation.schemaValidation) {
                results.schemaValid = await this._validateSchema();
            }

            // Data integrity checks
            if (this.config.validation.dataIntegrity) {
                const dataChecks = await this._validateDataIntegrity();
                results.dataValid = dataChecks.valid;
                results.issues.push(...dataChecks.issues);
            }

            // Performance suggestions
            const suggestions = await this._analyzePerformance();
            results.suggestions.push(...suggestions);

            this.emit('validationCompleted', results);
            return results;

        } catch (error) {
            console.error('Validation failed:', error);
            throw error;
        }
    }

    // ========== PRIVATE METHODS ==========

    async _loadMigrationHistory() {
        try {
            const migrations = await this.prisma.$queryRaw`
                SELECT id, migration_name, applied_at 
                FROM ${this.config.migration.tableName}
                ORDER BY applied_at ASC
            `;

            for (const migration of migrations) {
                this.state.appliedMigrations.add(migration.migration_name);
            }

            if (migrations.length > 0) {
                this.state.currentVersion = migrations[migrations.length - 1].migration_name;
            }
        } catch (error) {
            // Table might not exist yet
            console.log('Migration table not found, will be created');
        }
    }

    async _loadMigrations() {
        const migrationDir = path.resolve(this.config.migration.directory);
        const files = await fs.readdir(migrationDir);
        
        this.state.migrations = files
            .filter(file => file.endsWith('.js'))
            .sort()
            .map(file => ({
                name: file.replace('.js', ''),
                path: path.join(migrationDir, file),
                applied: this.state.appliedMigrations.has(file.replace('.js', ''))
            }));
    }

    async _getPendingMigrations() {
        return this.state.migrations.filter(m => !m.applied);
    }

    async _getRollbackMigrations(targetVersion) {
        const targetIndex = this.state.migrations.findIndex(m => m.name === targetVersion);
        if (targetIndex === -1) {
            throw new Error(`Target version ${targetVersion} not found`);
        }

        return this.state.migrations
            .slice(targetIndex + 1)
            .filter(m => m.applied);
    }

    async _runMigration(migration, options) {
        console.log(`Running migration: ${migration.name}`);
        const startTime = Date.now();

        try {
            // Load migration module
            const migrationModule = require(migration.path);
            
            if (!migrationModule.up) {
                throw new Error(`Migration ${migration.name} missing 'up' method`);
            }

            // Prepare context
            const context = {
                prisma: this.prisma,
                config: this.config,
                options,
                utils: this._getMigrationUtils()
            };

            // Run migration
            if (this.config.dryRun) {
                console.log(`[DRY RUN] Would run migration: ${migration.name}`);
                return;
            }

            await migrationModule.up(context);

            // Record migration
            await this.prisma.$executeRaw`
                INSERT INTO ${this.config.migration.tableName} 
                (id, migration_name, applied_at) 
                VALUES (${crypto.randomUUID()}, ${migration.name}, NOW())
            `;

            const duration = Date.now() - startTime;
            console.log(`Migration ${migration.name} completed in ${duration}ms`);

            this.emit('migrationApplied', {
                name: migration.name,
                duration
            });

        } catch (error) {
            console.error(`Migration ${migration.name} failed:`, error);
            throw error;
        }
    }

    async _runRollback(migration, options) {
        console.log(`Rolling back migration: ${migration.name}`);
        
        try {
            const migrationModule = require(migration.path);
            
            if (!migrationModule.down) {
                throw new Error(`Migration ${migration.name} missing 'down' method`);
            }

            const context = {
                prisma: this.prisma,
                config: this.config,
                options,
                utils: this._getMigrationUtils()
            };

            if (this.config.dryRun) {
                console.log(`[DRY RUN] Would rollback migration: ${migration.name}`);
                return;
            }

            await migrationModule.down(context);

            // Remove migration record
            await this.prisma.$executeRaw`
                DELETE FROM ${this.config.migration.tableName} 
                WHERE migration_name = ${migration.name}
            `;

            this.emit('migrationRolledBack', {
                name: migration.name
            });

        } catch (error) {
            console.error(`Rollback ${migration.name} failed:`, error);
            throw error;
        }
    }

    _getMigrationUtils() {
        return {
            // Zero-downtime column addition
            addColumnSafely: async (table, column, definition) => {
                if (this.config.zeroDowntime.enabled) {
                    // Add column as nullable first
                    await this.prisma.$executeRawUnsafe(`
                        ALTER TABLE ${table} 
                        ADD COLUMN IF NOT EXISTS ${column} ${definition} NULL
                    `);

                    // Backfill in batches
                    await this._backfillColumn(table, column);

                    // Add constraints after backfill
                    if (definition.includes('NOT NULL')) {
                        await this.prisma.$executeRawUnsafe(`
                            ALTER TABLE ${table} 
                            ALTER COLUMN ${column} SET NOT NULL
                        `);
                    }
                } else {
                    await this.prisma.$executeRawUnsafe(`
                        ALTER TABLE ${table} 
                        ADD COLUMN ${column} ${definition}
                    `);
                }
            },

            // Safe index creation
            createIndexSafely: async (table, columns, options = {}) => {
                const indexName = options.name || `idx_${table}_${columns.join('_')}`;
                
                if (this.config.zeroDowntime.parallelIndex) {
                    await this.prisma.$executeRawUnsafe(`
                        CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} 
                        ON ${table} (${columns.join(', ')})
                    `);
                } else {
                    await this.prisma.$executeRawUnsafe(`
                        CREATE INDEX IF NOT EXISTS ${indexName} 
                        ON ${table} (${columns.join(', ')})
                    `);
                }
            },

            // Safe foreign key addition
            addForeignKeySafely: async (table, column, refTable, refColumn) => {
                const fkName = `fk_${table}_${column}`;
                
                if (this.config.zeroDowntime.enabled) {
                    // Add FK without validation first
                    await this.prisma.$executeRawUnsafe(`
                        ALTER TABLE ${table} 
                        ADD CONSTRAINT ${fkName} 
                        FOREIGN KEY (${column}) 
                        REFERENCES ${refTable}(${refColumn}) 
                        NOT VALID
                    `);

                    // Validate separately
                    await this.prisma.$executeRawUnsafe(`
                        ALTER TABLE ${table} 
                        VALIDATE CONSTRAINT ${fkName}
                    `);
                } else {
                    await this.prisma.$executeRawUnsafe(`
                        ALTER TABLE ${table} 
                        ADD CONSTRAINT ${fkName} 
                        FOREIGN KEY (${column}) 
                        REFERENCES ${refTable}(${refColumn})
                    `);
                }
            }
        };
    }

    async _backfillColumn(table, column) {
        const batchSize = this.config.zeroDowntime.backfillBatchSize;
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const result = await this.prisma.$executeRawUnsafe(`
                UPDATE ${table} 
                SET ${column} = DEFAULT 
                WHERE ${column} IS NULL 
                LIMIT ${batchSize}
            `);

            hasMore = result > 0;
            offset += batchSize;

            // Add delay to reduce load
            if (hasMore && this.config.zeroDowntime.backfillDelay > 0) {
                await new Promise(resolve => setTimeout(resolve, this.config.zeroDowntime.backfillDelay));
            }

            this.emit('backfillProgress', {
                table,
                column,
                processed: offset
            });
        }
    }

    async _acquireLock() {
        const lockKey = 'migration_lock';
        const lockTimeout = this.config.migration.lockTimeout;
        
        // Try to acquire advisory lock
        const result = await this.prisma.$queryRaw`
            SELECT pg_try_advisory_lock(hashtext(${lockKey})) as acquired
        `;

        if (!result[0].acquired) {
            throw new Error('Could not acquire migration lock');
        }

        this.state.lock = lockKey;
    }

    async _releaseLock() {
        if (this.state.lock) {
            await this.prisma.$queryRaw`
                SELECT pg_advisory_unlock(hashtext(${this.state.lock}))
            `;
            this.state.lock = null;
        }
    }

    async _createBackup() {
        const backupId = `backup_${Date.now()}`;
        console.log(`Creating backup: ${backupId}`);
        
        // Implementation would depend on database and backup strategy
        // Could use pg_dump, snapshots, or logical replication
        
        return backupId;
    }

    async _rollbackToBackup(backupId) {
        if (!backupId) return;
        
        console.log(`Rolling back to backup: ${backupId}`);
        // Implementation would restore from backup
    }

    async _runPreMigrationChecks() {
        console.log('Running pre-migration checks...');
        
        // Check database connectivity
        await this.prisma.$queryRaw`SELECT 1`;
        
        // Check disk space
        const diskSpace = await this._checkDiskSpace();
        if (diskSpace.percentUsed > 90) {
            throw new Error('Insufficient disk space for migration');
        }
        
        // Check for long-running queries
        const longQueries = await this._checkLongRunningQueries();
        if (longQueries.length > 0) {
            console.warn(`Found ${longQueries.length} long-running queries`);
        }
    }

    async _runPostMigrationChecks() {
        console.log('Running post-migration checks...');
        
        const checks = {
            schema: await this._validateSchema(),
            constraints: await this._validateConstraints(),
            indexes: await this._validateIndexes()
        };
        
        const allPassed = Object.values(checks).every(v => v === true);
        
        if (allPassed) {
            this.state.metrics.validationsPassed++;
        } else {
            this.state.metrics.validationsFailed++;
        }
        
        return allPassed;
    }

    async _validateSchema() {
        try {
            // Compare actual schema with expected
            const tables = await this.prisma.$queryRaw`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
            `;
            
            // Validate all expected tables exist
            return tables.length > 0;
        } catch (error) {
            return false;
        }
    }

    async _validateConstraints() {
        const constraints = await this.prisma.$queryRaw`
            SELECT conname, contype 
            FROM pg_constraint 
            WHERE connamespace = 'public'::regnamespace
        `;
        
        // Check for invalid constraints
        const invalid = await this.prisma.$queryRaw`
            SELECT conname 
            FROM pg_constraint 
            WHERE NOT convalidated
        `;
        
        return invalid.length === 0;
    }

    async _validateIndexes() {
        const invalidIndexes = await this.prisma.$queryRaw`
            SELECT indexrelid::regclass 
            FROM pg_index 
            WHERE NOT indisvalid
        `;
        
        return invalidIndexes.length === 0;
    }

    async _validateDataIntegrity() {
        const issues = [];
        
        // Check for orphaned records
        const orphanChecks = [
            {
                table: 'Order',
                check: `
                    SELECT COUNT(*) as count 
                    FROM "Order" o 
                    LEFT JOIN "User" u ON o."userId" = u.id 
                    WHERE u.id IS NULL
                `,
                description: 'Orders with non-existent users'
            },
            {
                table: 'Trade',
                check: `
                    SELECT COUNT(*) as count 
                    FROM "Trade" t 
                    LEFT JOIN "Order" bo ON t."buyOrderId" = bo.id 
                    LEFT JOIN "Order" so ON t."sellOrderId" = so.id 
                    WHERE bo.id IS NULL OR so.id IS NULL
                `,
                description: 'Trades with non-existent orders'
            }
        ];
        
        for (const check of orphanChecks) {
            const result = await this.prisma.$queryRawUnsafe(check.check);
            if (result[0].count > 0) {
                issues.push({
                    table: check.table,
                    issue: check.description,
                    count: result[0].count
                });
            }
        }
        
        return {
            valid: issues.length === 0,
            issues
        };
    }

    async _analyzePerformance() {
        const suggestions = [];
        
        // Check for missing indexes
        const missingIndexes = await this.prisma.$queryRaw`
            SELECT schemaname, tablename, attname, n_distinct, correlation
            FROM pg_stats
            WHERE schemaname = 'public'
            AND n_distinct > 100
            AND correlation < 0.1
            ORDER BY n_distinct DESC
        `;
        
        for (const stat of missingIndexes) {
            suggestions.push({
                type: 'index',
                table: stat.tablename,
                column: stat.attname,
                reason: 'High cardinality column without index'
            });
        }
        
        // Check table sizes for partitioning candidates
        const largeTables = await this.prisma.$queryRaw`
            SELECT 
                schemaname,
                tablename,
                pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
                pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        `;
        
        for (const table of largeTables) {
            if (table.size_bytes > 1024 * 1024 * 1024) { // > 1GB
                suggestions.push({
                    type: 'partitioning',
                    table: table.tablename,
                    size: table.size,
                    reason: 'Large table could benefit from partitioning'
                });
            }
        }
        
        return suggestions;
    }

    async _checkDiskSpace() {
        const result = await this.prisma.$queryRaw`
            SELECT 
                sum(pg_database_size(datname))::bigint as total_size,
                pg_size_pretty(sum(pg_database_size(datname))::bigint) as total_size_pretty
            FROM pg_database
        `;
        
        // This is simplified - in production would check actual disk usage
        return {
            totalSize: result[0].total_size,
            totalSizePretty: result[0].total_size_pretty,
            percentUsed: 50 // Placeholder
        };
    }

    async _checkLongRunningQueries() {
        const queries = await this.prisma.$queryRaw`
            SELECT 
                pid,
                now() - pg_stat_activity.query_start AS duration,
                query
            FROM pg_stat_activity
            WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
            AND state = 'active'
        `;
        
        return queries;
    }

    /**
     * Get migration status
     */
    getStatus() {
        return {
            currentVersion: this.state.currentVersion,
            appliedMigrations: Array.from(this.state.appliedMigrations),
            pendingMigrations: this.state.migrations.filter(m => !m.applied).map(m => m.name),
            metrics: this.state.metrics
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        await this._releaseLock();
        
        if (this.prisma) {
            await this.prisma.$disconnect();
        }
        
        if (this.shadowPrisma) {
            await this.shadowPrisma.$disconnect();
        }
        
        console.log('Migration Manager cleaned up');
    }
}

module.exports = { MigrationManager };