# Meta Aggregator 2.0

Welcome to the Meta Aggregator 2.0 project documentation. This project includes a suite of tools and applications that connect with an escrow smart contract, leveraging Supabase for database solutions and various blockchain listeners to handle transactions securely and efficiently.

## Prerequisites

- Node.js (v14.17.0 or newer)
- Yarn or npm (Package manager)
- An Ethereum node access token (e.g., Infura, Alchemy)
- A configured private key (without prefix '0x')

## Setup

1. Clone the repository:

```bash
git clone https://github.com/your-repo/meta-aggregator-2.0.git
```

2. Navigate to the project directory:

```bash
cd meta-aggregator-2.0
```

3. Install the required dependencies:

```bash
yarn install
```

## Configuration

Before running the application, you need to set up the essential configuration:

1. Create a `.env` file in the project root directory.
2. Add the following environment variables:

```
ETHERNODE_URL=https://mainnet.infura.io/v3/{your_project_id}
PRIVATE_KEY=your_private_key_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_secret_key
LISTENER_API_KEY=your_listener_api_key
```

## Running the Application

### Local Development

1. Start the development server with hot reloading enabled:

```bash
yarn start-dev
```

Access the application at http://localhost:3000.

### Staging Environment

1. Prepare a production build:

```bash
yarn build-staging
```
2. Deploy the build to your staging environment using the deployment scripts or manual upload.

### Production Deployment

1. Generate a production build:

```bash
yarn build
```
2. Deploy the production files to your server or cloud hosting service.

## Health Checks and Monitoring

Monitor application health and perform checks at `/api/health`. Ensure all systems are functioning correctly before pushing new updates to production.

## Additional Information

- **API Endpoints**:
  - `/api/signRelease`: Used for generating EIP-712 signatures for transactions.
  - `/api/releaseFund`: Used for executing fund releases with a previously obtained signature.

- **Smart Contract (`FixedEscrow`)**:
  - `deposit()`: Allows for deposit transactions, triggered by payments.
  - `releaseWithSignature()`: Facilitates fund release with a required valid signature.
  - `getBalance()`: Queries current balance of the escrow contract.
  - `currentState`: Returns the state of the contract among predefined statuses.

## Compliance and Documentation

To ensure compliance with grant-program KPIs, maintain accurate records and logs of all interactions and transactions. Regular audits and reviews should be conducted to align with program goals and regulations.