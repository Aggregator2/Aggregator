# Meta Aggregator – Backend

This is the backend API for the Meta Aggregator decentralized trading app. It is built with Node.js and Express and provides endpoints for fetching trading quotes and executing signed orders on a deployed smart contract. The system aggregates using off chain signed orders via RFQ. 

## Features
- **`/api/quote`**: Accepts trading pair information and returns a mock or real quote.
- **`/api/execute`**: Processes a signed order and broadcasts it to a deployed smart contract.

## How to Run Locally

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- A deployed smart contract (address required in `.env`)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/meta-aggregator-backend.git
   cd meta-aggregator-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the required environment variables (see below).

4. Start the server:
   ```bash
   npm start
   ```

### Environment Variables
Create a `.env` file with the following variables:
```env
PORT=3000
SMART_CONTRACT_ADDRESS=0xYourSmartContractAddress
PRIVATE_KEY=your-private-key
INFURA_PROJECT_ID=your-infura-project-id
```

### Usage Notes
- Use `/api/quote` to fetch trading quotes.
- Use `/api/execute` to execute signed orders.

For more details, refer to the [GitHub repository](https://github.com/your-repo/meta-aggregator-backend).