# Meta Aggregator 2.0

A decentralized exchange aggregator with escrow functionality, built on Ethereum with Next.js frontend and smart contract integration.

## Overview

Meta Aggregator 2.0 provides a secure trading platform that aggregates liquidity from multiple DEXs while providing escrow services for secure fund management. The platform features EIP-712 signature-based order verification and automated settlement through smart contracts.

## Key Features

- **Multi-DEX Aggregation**: Integrates with 0x Protocol and Uniswap for optimal trade execution
- **Escrow Services**: Smart contract-based escrow for secure fund management
- **EIP-712 Signatures**: Cryptographic order verification and security
- **Real-time Order Book**: Live order matching and settlement
- **Responsive UI**: Modern React-based trading interface

## Architecture

### Core Components
- **Smart Contracts**: `contracts/Escrow.sol` - Manages fund escrow and releases
- **Next.js Frontend**: React-based user interface with Web3 integration
- **API Layer**: RESTful endpoints for order management and escrow operations
- **Backend Services**: Express.js services for order verification and settlement

### Technology Stack
- **Blockchain**: Ethereum, Hardhat development environment
- **Frontend**: Next.js, React, ethers.js
- **Backend**: Node.js, Express.js, SQLite
- **External APIs**: 0x Protocol, Uniswap V2/V3

## Quick Start

### Prerequisites
- Node.js v16+
- Git

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd "Meta Aggregator 2.0"

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration
```

### Development Setup

```bash
# Terminal 1: Start Hardhat local network
npx hardhat node

# Terminal 2: Deploy contracts
npx hardhat run scripts/deployWithCorrectArbiter.js --network localhost

# Terminal 3: Start Next.js development server
npm run dev
```

Visit `http://localhost:3000` to access the application.

### Testing

```bash
# Run all tests
npm test

# Smart contract tests
npx hardhat test

# Integration tests
npm run test:integration

# E2E tests with Cypress
npx cypress run
```

## Core Functionality

### Order Management
- Create and submit buy/sell orders
- EIP-712 signature verification
- Real-time order book updates
- Automatic order matching

### Escrow Services
- Secure fund deposits
- Multi-signature release mechanisms
- Automated settlement
- Emergency pause functionality

### API Endpoints

- `GET /api/orders` - Retrieve order book
- `POST /api/orders` - Submit new order
- `POST /api/signRelease` - Generate EIP-712 release signature
- `POST /api/releaseFund` - Execute escrow fund release
- `GET /api/quote` - Get trade quotes from aggregated sources

## Deployment

### Local Development
```bash
npx hardhat node                                    # Start local blockchain
npx hardhat run scripts/deployWithCorrectArbiter.js --network localhost
npm run dev                                         # Start frontend
```

### Testnet Deployment
```bash
# Deploy to Sepolia testnet
npx hardhat run scripts/deployWithCorrectArbiter.js --network sepolia
npm run build
npm run deploy:staging
```

### Production Deployment
```bash
# Deploy to mainnet
npx hardhat run scripts/deployWithCorrectArbiter.js --network mainnet
npm run build
npm run deploy:production
```

## Configuration

### Environment Variables
```env
# Blockchain Configuration
PRIVATE_KEY=your_private_key_here
ARBITER_PRIVATE_KEY=arbiter_private_key_here
API_URL=your_rpc_endpoint
SEPOLIA_RPC_URL=sepolia_rpc_endpoint

# API Keys
ZEROX_API_KEY=your_0x_api_key

# Application Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Smart Contract Configuration
- Contract addresses are automatically updated in `frontend/src/config/escrowAddress.js`
- Network configurations in `hardhat.config.js`

## Monitoring & Health Checks

### Health Check Scripts
```bash
# Complete system health check
node scripts/healthCheck.js

# Check external API dependencies
node scripts/checkExternalApis.js

# Check escrow contract status
node scripts/checkEscrowStatus.js
```

### Monitoring Endpoints
- `GET /api/health` - Basic health check
- `GET /api/status` - Detailed system status

## Documentation

### Operational Documentation
- **[Release Strategy](./RELEASE_STRATEGY.md)** - Comprehensive deployment and rollback procedures
- **[Operational Runbook](./OPERATIONAL_RUNBOOK.md)** - Day-to-day operational commands and procedures

### Technical Documentation
- Smart contract documentation in `contracts/` directory
- API documentation available at `/api/docs` (when running)
- Frontend component documentation in `components/` directory

## Security

### Smart Contract Security
- Comprehensive test coverage (>95%)
- ReentrancyGuard protection
- Access control mechanisms
- Emergency pause functionality

### API Security
- EIP-712 signature verification
- Rate limiting on all endpoints
- Input validation and sanitization
- CORS configuration

### Operational Security
- Environment variable isolation
- Secure key management
- Regular security audits
- Monitoring and alerting

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow ESLint configuration
- Maintain test coverage above 90%
- Update documentation for new features
- Follow semantic versioning

## Support

### Getting Help
- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: GitHub Discussions for questions and community support
- **Documentation**: Check the docs directory for detailed guides

### Emergency Contacts
- **Technical Issues**: See [OPERATIONAL_RUNBOOK.md](./OPERATIONAL_RUNBOOK.md)
- **Security Issues**: Please report security vulnerabilities privately

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Recent Updates

### Latest Release Features
- ✅ **EIP-712 Signature Integration** - Secure order verification
- ✅ **Escrow Contract Deployment** - Automated fund management
- ✅ **API Endpoint Testing** - Complete release fund functionality
- ✅ **Health Monitoring** - Comprehensive system health checks
- ✅ **Operational Documentation** - Release strategy and runbooks

### Current Status
- **Smart Contracts**: Deployed and tested on local network
- **API Services**: All endpoints operational
- **Frontend**: Fully functional trading interface
- **Testing**: Complete test suite with 95%+ coverage
- **Documentation**: Comprehensive operational procedures
