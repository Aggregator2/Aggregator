# SettlementQueue API Gateway

Enterprise-grade API Gateway for the SettlementQueueV5 DEX with comprehensive features including GraphQL, REST, WebSocket support, API versioning, authentication, caching, and analytics.

## 🚀 Features

### Core API Features
- **GraphQL API** with real-time subscriptions
- **REST API** with comprehensive versioning (v1, v2)
- **WebSocket** real-time data streaming
- **API Versioning** with backward compatibility
- **Request Validation** and sanitization
- **Response Compression** and caching
- **Rate Limiting** with tier-based controls

### Authentication & Security
- **JWT Authentication** with refresh tokens
- **API Key Management** with permissions
- **Web3 Signature** authentication
- **Multi-factor Authentication** support
- **Request Sanitization** and security headers
- **CORS** and security middleware

### Performance & Monitoring
- **Multi-level Caching** (Memory + Redis)
- **Response Compression** (gzip, deflate)
- **Performance Monitoring** with metrics
- **Usage Analytics** and billing
- **Prometheus Metrics** export
- **Health Checks** and diagnostics

### Enterprise Features
- **Usage Billing** with tier management
- **Analytics Dashboard** with insights
- **Admin Panel** for management
- **Monitoring & Alerting** integration
- **Audit Logging** for compliance
- **Backup & Recovery** procedures

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │────│   API Gateway   │────│   Microservices │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────▼────────┐   ┌────────▼────────┐   ┌───────▼────────┐
│   PostgreSQL   │   │      Redis      │   │   Blockchain   │
│   (Primary DB) │   │   (Cache/Pub)   │   │   (Settlement) │
└────────────────┘   └─────────────────┘   └────────────────┘
```

## 📋 Requirements

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 13
- **Redis** >= 6.0
- **Docker** (optional)

## 🛠️ Installation

### Local Development

```bash
# Clone the repository
git clone https://github.com/settlement-queue/api-gateway.git
cd api-gateway

# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Edit configuration
nano .env

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api-gateway
```

## ⚙️ Configuration

### Environment Variables

```bash
# Server Configuration
NODE_ENV=production
HOST=0.0.0.0
PORT=3000

# Database Configuration
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=settlement_queue
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Blockchain Configuration
ETHEREUM_RPC_URL=https://eth-mainnet.alchemyapi.io/v2/your-api-key
SETTLEMENT_CONTRACT_ADDRESS=0x...

# External Services
COINMARKETCAP_API_KEY=your_cmc_api_key
```

### Configuration Files

The API Gateway uses a hierarchical configuration system:

- `src/config/index.js` - Main configuration
- `.env` - Environment variables
- `claude.config.json` - Claude CLI configuration

## 🚀 Usage

### GraphQL API

```javascript
// GraphQL endpoint
POST /graphql

// Example query
query GetOrders($userAddress: Address!) {
  orders(filter: { userAddress: $userAddress }) {
    edges {
      node {
        id
        tokenIn
        tokenOut
        amountIn
        status
        createdAt
      }
    }
  }
}

// Example subscription
subscription OrderUpdates($userAddress: Address!) {
  orderUpdates(filter: { userAddress: $userAddress }) {
    id
    status
    updatedAt
  }
}
```

### REST API

```bash
# Get orders (v1)
GET /api/v1/orders?page=1&limit=20
Authorization: Bearer jwt_token

# Submit order (v2)
POST /api/v2/orders
Content-Type: application/json
X-API-Key: sq_your_api_key_here

{
  "tokenIn": "0x...",
  "tokenOut": "0x...",
  "amountIn": "1000000000000000000",
  "minAmountOut": "950000000000000000",
  "deadline": "2025-07-12T12:00:00Z",
  "signature": "0x...",
  "nonce": "123456"
}
```

### WebSocket API

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3000/ws?token=jwt_token');

// Subscribe to order updates
ws.send(JSON.stringify({
  type: 'SUBSCRIBE',
  channel: 'orders',
  params: {
    userAddress: '0x...'
  }
}));

// Handle incoming messages
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.type === 'ORDER_UPDATE') {
    console.log('Order updated:', message.data);
  }
};
```

## 🔐 Authentication

### JWT Authentication

```bash
# Login with Web3 signature
POST /api/v1/auth/login
Content-Type: application/json

{
  "address": "0x...",
  "signature": "0x...",
  "message": "Login to SettlementQueue",
  "nonce": "random_nonce"
}

# Response
{
  "success": true,
  "data": {
    "token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "abc123...",
    "expiresAt": "2025-07-12T13:00:00Z",
    "user": {
      "address": "0x...",
      "tier": "pro"
    }
  }
}
```

### API Key Authentication

```bash
# Create API key
POST /api/v1/auth/api-keys
Authorization: Bearer jwt_token

{
  "name": "My API Key",
  "permissions": ["read", "write"],
  "expiresIn": "1y"
}

# Use API key
GET /api/v1/orders
X-API-Key: sq_abc123def456ghi789jkl012mno345pq
```

## 📊 Monitoring & Analytics

### Health Checks

```bash
# Basic health check
GET /health

# Detailed health check
GET /health/detailed

# Prometheus metrics
GET /metrics
```

### Analytics Dashboard

```bash
# Get dashboard data
GET /api/v1/analytics/dashboard?timeRange=24h
Authorization: Bearer jwt_token

# Get user usage
GET /api/v1/analytics/usage
Authorization: Bearer jwt_token
```

### Admin Endpoints

```bash
# Cache statistics
GET /admin/cache/stats
Authorization: Bearer admin_token

# Clear cache
DELETE /admin/cache?pattern=user:*
Authorization: Bearer admin_token

# WebSocket statistics
GET /ws/stats
Authorization: Bearer admin_token
```

## 📈 API Versioning

The API Gateway supports multiple versioning strategies:

### URL Path Versioning
```bash
GET /api/v1/orders  # Version 1
GET /api/v2/orders  # Version 2
```

### Header Versioning
```bash
GET /api/orders
X-API-Version: 2.0
```

### Content Negotiation
```bash
GET /api/orders
Accept: application/vnd.settlementqueue.v2+json
```

### Version Information
```bash
GET /api/versions  # Get all supported versions
```

## 💰 Billing & Usage

### Tier Management

| Tier | Requests/Month | Rate Limit | Features | Price |
|------|----------------|------------|----------|-------|
| Free | 10,000 | 100/min | Basic API | $0 |
| Pro | 1,000,000 | 1,000/min | GraphQL, WebSocket | $99 |
| Enterprise | Unlimited | 10,000/min | All features | $999 |

### Usage Tracking

```bash
# Get current usage
GET /api/v1/billing/usage
Authorization: Bearer jwt_token

# Get billing report
GET /api/v1/billing/report?period=current_month
Authorization: Bearer admin_token
```

## 🔧 Development

### Project Structure

```
api-gateway/
├── src/
│   ├── config/           # Configuration files
│   ├── middleware/       # Custom middleware
│   ├── plugins/          # Fastify plugins
│   ├── routes/           # API routes
│   ├── services/         # Business logic services
│   ├── schemas/          # Validation schemas
│   ├── utils/            # Utility functions
│   └── server.js         # Main server file
├── test/                 # Test files
├── docs/                 # Documentation
├── scripts/              # Deployment scripts
└── docker/               # Docker configuration
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run start        # Start production server
npm run test         # Run test suite
npm run test:watch   # Run tests in watch mode
npm run lint         # Run ESLint
npm run lint:fix     # Fix ESLint issues
npm run build        # Build for production
```

### Testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --grep "Authentication"

# Run with coverage
npm run test:coverage

# Integration tests
npm run test:integration
```

## 🚀 Deployment

### Production Deployment

```bash
# Build Docker image
docker build -t settlement-queue-api:latest .

# Deploy with Docker Compose
docker-compose -f docker-compose.prod.yml up -d

# Scale services
docker-compose -f docker-compose.prod.yml up -d --scale api=3
```

### Kubernetes Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-gateway
  template:
    metadata:
      labels:
        app: api-gateway
    spec:
      containers:
      - name: api-gateway
        image: settlement-queue-api:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        # ... other environment variables
```

### Monitoring Setup

```bash
# Start monitoring stack
docker-compose -f docker-compose.monitoring.yml up -d

# Access dashboards
# Grafana: http://localhost:3001
# Prometheus: http://localhost:9090
```

## 📚 API Documentation

### Interactive Documentation

- **GraphQL Playground**: http://localhost:3000/graphiql
- **REST API Docs**: http://localhost:3000/docs
- **WebSocket Docs**: http://localhost:3000/ws-docs

### API Reference

Detailed API documentation is available at:
- [GraphQL Schema](./docs/graphql-schema.md)
- [REST API Reference](./docs/rest-api.md)
- [WebSocket Events](./docs/websocket-events.md)
- [Authentication Guide](./docs/authentication.md)
- [Rate Limiting](./docs/rate-limiting.md)

## 🔒 Security

### Security Features

- **HTTPS** enforcement in production
- **CORS** configuration
- **Rate limiting** with IP blocking
- **Input validation** and sanitization
- **SQL injection** prevention
- **XSS protection** with CSP headers
- **JWT** token security
- **API key** encryption

### Security Configuration

```javascript
// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"]
    }
  }
}));

// Rate limiting
app.use(rateLimit({
  windowMs: 60000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
}));
```

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Issues**
   ```bash
   # Check PostgreSQL status
   docker-compose ps postgres
   
   # View database logs
   docker-compose logs postgres
   ```

2. **Redis Connection Issues**
   ```bash
   # Test Redis connection
   redis-cli ping
   
   # Check Redis configuration
   redis-cli config get '*'
   ```

3. **High Memory Usage**
   ```bash
   # Monitor memory usage
   docker stats
   
   # Clear cache if needed
   curl -X DELETE http://localhost:3000/admin/cache
   ```

### Debug Mode

```bash
# Enable debug logging
DEBUG=* npm run dev

# Enable specific debug namespaces
DEBUG=api:* npm run dev
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes
4. Add tests for new functionality
5. Run the test suite: `npm test`
6. Commit your changes: `git commit -m 'Add amazing feature'`
7. Push to the branch: `git push origin feature/amazing-feature`
8. Open a Pull Request

### Code Style

- Use ESLint configuration provided
- Write tests for new features
- Follow conventional commit messages
- Update documentation for API changes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 📞 Support

- **Documentation**: [docs.settlementqueue.com](https://docs.settlementqueue.com)
- **Issues**: [GitHub Issues](https://github.com/settlement-queue/api-gateway/issues)
- **Discord**: [Settlement Queue Community](https://discord.gg/settlement-queue)
- **Email**: support@settlementqueue.com

## 🗺️ Roadmap

- [ ] **Q3 2025**: GraphQL Federation support
- [ ] **Q4 2025**: gRPC API implementation
- [ ] **Q1 2026**: Multi-chain support expansion
- [ ] **Q2 2026**: Advanced analytics and ML insights
- [ ] **Q3 2026**: Edge computing deployment

---

Built with ❤️ by the SettlementQueue team