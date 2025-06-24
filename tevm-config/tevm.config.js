export default {
  chainId: 1,
  forkUrl: process.env.RPC_URL || 'https://eth-mainnet.alchemyapi.io/v2/YOUR_KEY',
  enableTracing: true,
  logLevel: 'debug',
  contracts: [
    './src/contracts/FixedEscrow.sol',
    './contracts/**/*.sol'
  ],
  deployCreate2: true,
  miningConfig: {
    type: 'manual'
  }
}
