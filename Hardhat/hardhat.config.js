require("@nomiclabs/hardhat-ethers");
require("dotenv").config({ path: "../.env.local" }); // Load .env.local from the parent directory

const { API_URL, PRIVATE_KEY } = process.env;

console.log("Loaded API_URL:", API_URL || "Not Loaded");
console.log("Loaded PRIVATE_KEY:", PRIVATE_KEY || "Not Loaded");

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.0" },
      { version: "0.8.20" }, // Add this if needed
    ],
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    goerli: {
      url: API_URL || "", // e.g., Infura/Alchemy endpoint for Goerli
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 5,
    },
  },
};
