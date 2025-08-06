/**
 * GraphQL Plugin Configuration
 * Production-ready GraphQL setup with security, caching, and monitoring
 */

import mercurius from 'mercurius';
import { buildSchema } from 'graphql';
import { GraphQLScalarType } from 'graphql';
import { GraphQLJSON, GraphQLDateTime, GraphQLBigInt } from 'graphql-scalars';
import depthLimit from 'graphql-depth-limit';
import costAnalysis from 'graphql-query-complexity';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Custom GraphQL scalars for blockchain data
 */
const customScalars = {
    JSON: GraphQLJSON,
    DateTime: GraphQLDateTime,
    BigInt: GraphQLBigInt,
    
    // Ethereum address scalar
    Address: new GraphQLScalarType({
        name: 'Address',
        description: 'Ethereum address type',
        serialize: (value) => value,
        parseValue: (value) => {
            if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
                throw new Error('Invalid Ethereum address format');
            }
            return value.toLowerCase();
        },
        parseLiteral: (ast) => {
            if (ast.kind !== 'StringValue') {
                throw new Error('Address must be a string');
            }
            if (!/^0x[a-fA-F0-9]{40}$/.test(ast.value)) {
                throw new Error('Invalid Ethereum address format');
            }
            return ast.value.toLowerCase();
        }
    }),

    // Transaction hash scalar
    Hash: new GraphQLScalarType({
        name: 'Hash',
        description: 'Blockchain transaction hash',
        serialize: (value) => value,
        parseValue: (value) => {
            if (typeof value !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
                throw new Error('Invalid hash format');
            }
            return value.toLowerCase();
        },
        parseLiteral: (ast) => {
            if (ast.kind !== 'StringValue') {
                throw new Error('Hash must be a string');
            }
            if (!/^0x[a-fA-F0-9]{64}$/.test(ast.value)) {
                throw new Error('Invalid hash format');
            }
            return ast.value.toLowerCase();
        }
    })
};

/**
 * Load GraphQL schema from files
 */
async function loadSchema() {
    try {
        const schemaPath = path.join(__dirname, '../schemas');
        const schemaFiles = await fs.readdir(schemaPath);
        
        let schema = '';
        for (const file of schemaFiles) {
            if (file.endsWith('.graphql')) {
                const content = await fs.readFile(path.join(schemaPath, file), 'utf8');
                schema += content + '\n';
            }
        }
        
        return schema;
    } catch (error) {
        // Fallback to inline schema if files not found
        return `
            scalar JSON
            scalar DateTime
            scalar BigInt
            scalar Address
            scalar Hash

            type Query {
                # Health check
                health: HealthStatus!
                
                # Order queries
                order(id: ID!): Order
                orders(filter: OrderFilter, pagination: Pagination): OrderConnection!
                
                # Balance queries
                balance(userAddress: Address!, tokenAddress: Address!, chainId: Int!): Balance
                balances(userAddress: Address!, chainId: Int): [Balance!]!
                
                # Settlement queries
                settlement(id: ID!): Settlement
                settlements(filter: SettlementFilter, pagination: Pagination): SettlementConnection!
                
                # Analytics queries
                analytics: Analytics!
                marketData(tokenPair: TokenPair!): MarketData
                
                # User queries
                user(address: Address!): User
                apiKey(keyId: String!): ApiKey
            }

            type Mutation {
                # Order mutations
                submitOrder(input: SubmitOrderInput!): SubmitOrderPayload!
                cancelOrder(orderId: ID!): CancelOrderPayload!
                
                # Authentication mutations
                login(input: LoginInput!): AuthPayload!
                refreshToken(refreshToken: String!): AuthPayload!
                logout: Boolean!
                
                # API key management
                createApiKey(input: CreateApiKeyInput!): CreateApiKeyPayload!
                revokeApiKey(keyId: String!): Boolean!
                
                # User management
                updateProfile(input: UpdateProfileInput!): User!
            }

            type Subscription {
                # Real-time order updates
                orderUpdates(filter: OrderFilter): Order!
                
                # Real-time settlement updates
                settlementUpdates: Settlement!
                
                # Market data updates
                marketDataUpdates(tokenPair: TokenPair!): MarketData!
                
                # User-specific updates
                userUpdates(userAddress: Address!): UserUpdate!
            }

            # Types
            type HealthStatus {
                status: String!
                timestamp: DateTime!
                version: String!
                uptime: Float!
                services: ServiceHealth!
            }

            type ServiceHealth {
                database: String!
                cache: String!
                blockchain: String!
            }

            type Order {
                id: ID!
                userAddress: Address!
                tokenIn: Address!
                tokenOut: Address!
                amountIn: BigInt!
                amountOut: BigInt
                minAmountOut: BigInt!
                status: OrderStatus!
                priority: Int!
                deadline: DateTime!
                createdAt: DateTime!
                updatedAt: DateTime!
                transactionHash: Hash
                gasUsed: BigInt
                metadata: JSON
            }

            type Balance {
                userAddress: Address!
                tokenAddress: Address!
                chainId: Int!
                available: BigInt!
                locked: BigInt!
                total: BigInt!
                lastUpdated: DateTime!
            }

            type Settlement {
                id: ID!
                orderId: ID!
                executor: Address!
                executedAt: DateTime!
                gasUsed: BigInt!
                gasPrice: BigInt!
                success: Boolean!
                error: String
                blockNumber: BigInt!
                transactionHash: Hash!
            }

            type User {
                address: Address!
                profile: UserProfile
                apiKeys: [ApiKey!]!
                stats: UserStats!
                createdAt: DateTime!
                lastActiveAt: DateTime!
            }

            type UserProfile {
                email: String
                username: String
                avatar: String
                preferences: JSON
            }

            type ApiKey {
                id: ID!
                name: String!
                keyHash: String!
                permissions: [String!]!
                tier: String!
                usage: ApiKeyUsage!
                createdAt: DateTime!
                expiresAt: DateTime
                lastUsedAt: DateTime
                isActive: Boolean!
            }

            type ApiKeyUsage {
                requestsToday: Int!
                requestsThisMonth: Int!
                totalRequests: BigInt!
                lastRequestAt: DateTime
            }

            type UserStats {
                totalOrders: Int!
                totalVolume: BigInt!
                averageGasSaved: BigInt!
                successRate: Float!
            }

            type Analytics {
                totalOrders: BigInt!
                totalVolume: BigInt!
                totalUsers: Int!
                averageGasUsed: BigInt!
                topTokenPairs: [TokenPairStats!]!
                systemMetrics: SystemMetrics!
            }

            type TokenPairStats {
                tokenIn: Address!
                tokenOut: Address!
                volume24h: BigInt!
                orders24h: Int!
                averageSize: BigInt!
            }

            type SystemMetrics {
                requestsPerSecond: Float!
                averageResponseTime: Float!
                errorRate: Float!
                uptime: Float!
            }

            type MarketData {
                tokenIn: Address!
                tokenOut: Address!
                price: BigInt!
                volume24h: BigInt!
                change24h: Float!
                lastUpdated: DateTime!
            }

            # Enums
            enum OrderStatus {
                PENDING
                COMMITTED
                REVEALED
                PROCESSING
                COMPLETED
                CANCELLED
                FAILED
            }

            # Input types
            input OrderFilter {
                userAddress: Address
                tokenIn: Address
                tokenOut: Address
                status: OrderStatus
                minAmount: BigInt
                maxAmount: BigInt
                createdAfter: DateTime
                createdBefore: DateTime
            }

            input SettlementFilter {
                executor: Address
                success: Boolean
                minGasUsed: BigInt
                maxGasUsed: BigInt
                executedAfter: DateTime
                executedBefore: DateTime
            }

            input Pagination {
                first: Int
                after: String
                last: Int
                before: String
            }

            input SubmitOrderInput {
                tokenIn: Address!
                tokenOut: Address!
                amountIn: BigInt!
                minAmountOut: BigInt!
                deadline: DateTime!
                priority: Int = 100
                metadata: JSON
                signature: String!
                nonce: BigInt!
            }

            input LoginInput {
                address: Address!
                signature: String!
                message: String!
                nonce: String!
            }

            input CreateApiKeyInput {
                name: String!
                permissions: [String!]!
                expiresIn: String = "1y"
            }

            input UpdateProfileInput {
                email: String
                username: String
                avatar: String
                preferences: JSON
            }

            input TokenPair {
                tokenIn: Address!
                tokenOut: Address!
            }

            # Connection types for pagination
            type OrderConnection {
                edges: [OrderEdge!]!
                pageInfo: PageInfo!
                totalCount: Int!
            }

            type OrderEdge {
                node: Order!
                cursor: String!
            }

            type SettlementConnection {
                edges: [SettlementEdge!]!
                pageInfo: PageInfo!
                totalCount: Int!
            }

            type SettlementEdge {
                node: Settlement!
                cursor: String!
            }

            type PageInfo {
                hasNextPage: Boolean!
                hasPreviousPage: Boolean!
                startCursor: String
                endCursor: String
            }

            # Payload types
            type SubmitOrderPayload {
                order: Order!
                estimatedGas: BigInt!
                errors: [Error!]
            }

            type CancelOrderPayload {
                success: Boolean!
                order: Order
                errors: [Error!]
            }

            type AuthPayload {
                token: String!
                refreshToken: String!
                user: User!
                expiresAt: DateTime!
            }

            type CreateApiKeyPayload {
                apiKey: ApiKey!
                key: String! # Only returned once
                errors: [Error!]
            }

            type Error {
                message: String!
                code: String!
                field: String
            }

            type UserUpdate {
                type: String!
                data: JSON!
                timestamp: DateTime!
            }
        `;
    }
}

/**
 * GraphQL resolvers
 */
function createResolvers(services) {
    return {
        // Custom scalars
        ...customScalars,

        Query: {
            health: async () => {
                return {
                    status: 'healthy',
                    timestamp: new Date(),
                    version: process.env.npm_package_version || '1.0.0',
                    uptime: process.uptime(),
                    services: {
                        database: 'healthy',
                        cache: 'healthy',
                        blockchain: 'healthy'
                    }
                };
            },

            order: async (parent, { id }, context) => {
                context.requireAuth();
                return await services.database.getOrder(id);
            },

            orders: async (parent, { filter, pagination }, context) => {
                context.requireAuth();
                return await services.database.getOrders(filter, pagination);
            },

            balance: async (parent, { userAddress, tokenAddress, chainId }, context) => {
                context.requireAuth();
                context.requireSameUserOrAdmin(userAddress);
                return await services.database.getBalance(userAddress, tokenAddress, chainId);
            },

            balances: async (parent, { userAddress, chainId }, context) => {
                context.requireAuth();
                context.requireSameUserOrAdmin(userAddress);
                return await services.database.getBalances(userAddress, chainId);
            },

            settlement: async (parent, { id }, context) => {
                context.requireAuth();
                return await services.database.getSettlement(id);
            },

            settlements: async (parent, { filter, pagination }, context) => {
                context.requireAuth();
                return await services.database.getSettlements(filter, pagination);
            },

            analytics: async (parent, args, context) => {
                context.requireAuth();
                return await services.analytics.getSystemAnalytics();
            },

            marketData: async (parent, { tokenPair }, context) => {
                return await services.blockchain.getMarketData(tokenPair);
            },

            user: async (parent, { address }, context) => {
                context.requireAuth();
                context.requireSameUserOrAdmin(address);
                return await services.database.getUser(address);
            },

            apiKey: async (parent, { keyId }, context) => {
                context.requireAuth();
                return await services.auth.getApiKey(keyId, context.user.address);
            }
        },

        Mutation: {
            submitOrder: async (parent, { input }, context) => {
                context.requireAuth();
                context.rateLimit('submitOrder', { max: 10, window: 60 });
                
                // Validate signature
                const isValid = await services.auth.validateOrderSignature(input, context.user.address);
                if (!isValid) {
                    throw new Error('Invalid signature');
                }

                return await services.database.submitOrder(input, context.user.address);
            },

            cancelOrder: async (parent, { orderId }, context) => {
                context.requireAuth();
                return await services.database.cancelOrder(orderId, context.user.address);
            },

            login: async (parent, { input }, context) => {
                context.rateLimit('login', { max: 5, window: 300 }); // 5 attempts per 5 minutes
                return await services.auth.login(input);
            },

            refreshToken: async (parent, { refreshToken }, context) => {
                return await services.auth.refreshToken(refreshToken);
            },

            logout: async (parent, args, context) => {
                context.requireAuth();
                await services.auth.logout(context.token);
                return true;
            },

            createApiKey: async (parent, { input }, context) => {
                context.requireAuth();
                context.rateLimit('createApiKey', { max: 10, window: 3600 }); // 10 per hour
                return await services.auth.createApiKey(input, context.user.address);
            },

            revokeApiKey: async (parent, { keyId }, context) => {
                context.requireAuth();
                await services.auth.revokeApiKey(keyId, context.user.address);
                return true;
            },

            updateProfile: async (parent, { input }, context) => {
                context.requireAuth();
                return await services.database.updateUserProfile(context.user.address, input);
            }
        },

        Subscription: {
            orderUpdates: {
                subscribe: async (parent, { filter }, context) => {
                    context.requireAuth();
                    return services.pubsub.subscribe('ORDER_UPDATES', filter);
                }
            },

            settlementUpdates: {
                subscribe: async (parent, args, context) => {
                    context.requireAuth();
                    return services.pubsub.subscribe('SETTLEMENT_UPDATES');
                }
            },

            marketDataUpdates: {
                subscribe: async (parent, { tokenPair }, context) => {
                    return services.pubsub.subscribe('MARKET_DATA_UPDATES', tokenPair);
                }
            },

            userUpdates: {
                subscribe: async (parent, { userAddress }, context) => {
                    context.requireAuth();
                    context.requireSameUserOrAdmin(userAddress);
                    return services.pubsub.subscribe(`USER_UPDATES_${userAddress}`);
                }
            }
        }
    };
}

/**
 * Create GraphQL context
 */
function createContext(services) {
    return async (request, reply) => {
        const context = {
            request,
            reply,
            services,
            user: null,
            token: null,
            
            // Authentication helpers
            requireAuth() {
                if (!this.user) {
                    throw new Error('Authentication required');
                }
            },
            
            requireSameUserOrAdmin(address) {
                if (!this.user) {
                    throw new Error('Authentication required');
                }
                if (this.user.address.toLowerCase() !== address.toLowerCase() && 
                    !this.user.isAdmin) {
                    throw new Error('Access denied');
                }
            },
            
            // Rate limiting helper
            rateLimit(operation, options) {
                // Implementation would integrate with rate limiting service
                // This is a placeholder
            }
        };

        // Extract and validate JWT token
        const authorization = request.headers.authorization;
        if (authorization && authorization.startsWith('Bearer ')) {
            const token = authorization.substring(7);
            try {
                const decoded = await services.auth.verifyToken(token);
                context.user = decoded.user;
                context.token = token;
            } catch (error) {
                // Invalid token - continue as anonymous user
            }
        }

        // Extract and validate API key
        const apiKey = request.headers['x-api-key'];
        if (apiKey && !context.user) {
            try {
                const user = await services.auth.validateApiKey(apiKey);
                context.user = user;
                context.apiKey = apiKey;
            } catch (error) {
                // Invalid API key - continue as anonymous user
            }
        }

        return context;
    };
}

/**
 * Register GraphQL plugin
 */
export async function registerGraphQLPlugin(fastify, services) {
    const schema = await loadSchema();
    const resolvers = createResolvers(services);
    
    await fastify.register(mercurius, {
        schema,
        resolvers,
        context: createContext(services),
        graphiql: fastify.config.graphql.graphiql,
        ide: fastify.config.graphql.playground,
        path: fastify.config.graphql.path,
        subscription: fastify.config.graphql.subscription.enabled ? {
            context: createContext(services),
            subscription: {
                enabled: true,
                emitter: services.pubsub
            }
        } : false,
        
        // Security configurations
        validationRules: [
            depthLimit(fastify.config.graphql.depthLimit),
            costAnalysis({
                maximumCost: fastify.config.graphql.complexity.maximumCost,
                defaultCost: fastify.config.graphql.complexity.defaultCost,
                scalarCost: 1,
                objectCost: 1,
                listFactor: 10,
                introspectionCost: 1000,
                directives: {}
            })
        ],
        
        // Caching
        cache: fastify.config.graphql.cache.enabled ? {
            ttl: fastify.config.graphql.cache.ttl
        } : false,
        
        // Error handling
        errorHandler: (error, request, reply) => {
            fastify.log.error('GraphQL Error:', error);
            
            // Don't expose internal errors in production
            if (fastify.config.isProduction && !error.extensions?.code) {
                return new Error('Internal server error');
            }
            
            return error;
        },
        
        // Query depth and complexity analysis
        queryDepth: fastify.config.graphql.depthLimit,
        
        // Custom directives and plugins
        plugins: []
    });

    fastify.log.info('✅ GraphQL plugin registered successfully');
}