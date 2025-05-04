# Meta Aggregator – Backend

This is the backend API for the Meta Aggregator decentralized trading app. It is built with Node.js and Express and provides endpoints for fetching trading quotes and executing signed orders on a deployed smart contract.

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