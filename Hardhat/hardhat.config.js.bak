require("@nomiclabs/hardhat-ethers");
require("dotenv").config({ path: "../.env" }); // Make sure this matches your .env location

const { API_URL, PRIVATE_KEY, SEPOLIA_RPC_URL } = process.env;

console.log("Loaded SEPOLIA_RPC_URL:", SEPOLIA_RPC_URL || "Not Loaded");
console.log("Loaded PRIVATE_KEY:", PRIVATE_KEY || "Not Loaded");

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.0" },
      { version: "0.8.20" },
    ],
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    goerli: {
      url: API_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 5,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
};
