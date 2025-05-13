# Escrow Contract

## Overview
The Escrow contract facilitates secure token escrow, trade execution, and refunds. It is designed to handle token deposits, trade confirmations, and refunds in a decentralized manner. The contract integrates with Uniswap V2 for token swaps and ensures security through access control and reentrancy protection.

### Key Features:
- **Token Escrow**: Securely holds tokens until trade conditions are met.
- **Trade Execution**: Executes token swaps via Uniswap V2.
- **Refund Mechanism**: Allows refunds to the depositor under specific conditions.
- **Access Control**: Restricts function calls to specific roles (depositor, counterparty, arbiter).

---

## Deployment Instructions

### Prerequisites:
- Node.js and npm installed.
- Hardhat development environment set up.
- A funded Ethereum wallet for deployment.

### Steps:
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd <repository-folder>