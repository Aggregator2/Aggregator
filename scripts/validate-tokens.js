#!/usr/bin/env node

/**
 * Token List Validation and Cleanup Utility
 *
 * This script validates tokens against actual API support and removes unsupported tokens.
 * Run with: node scripts/validate-tokens.js [chainId]
 */

const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

// API endpoints for token validation
const API_ENDPOINTS = {
  "0x": {
    ethereum: "https://api.0x.org/swap/v1/tokens",
    bsc: "https://bsc.api.0x.org/swap/v1/tokens",
    polygon: "https://polygon.api.0x.org/swap/v1/tokens",
    arbitrum: "https://arbitrum.api.0x.org/swap/v1/tokens",
    optimism: "https://optimism.api.0x.org/swap/v1/tokens",
  },
  jupiter: "https://token.jup.ag/all",
};

const CHAIN_MAPPINGS = {
  1: "ethereum",
  56: "bsc",
  137: "polygon",
  42161: "arbitrum",
  10: "optimism",
};

class TokenValidator {
  constructor() {
    this.supportedTokens = new Map();
    this.unsupportedTokens = [];
    this.report = {
      totalTokens: 0,
      supportedCount: 0,
      unsupportedCount: 0,
      removedTokens: [],
      errors: [],
    };
  }

  async fetchSupportedTokens(chainId) {
    try {
      if (chainId === "solana") {
        const response = await fetch(API_ENDPOINTS.jupiter);
        const tokens = await response.json();
        tokens.forEach((token) => {
          this.supportedTokens.set(token.address.toLowerCase(), token);
        });
        return;
      }

      const chain = CHAIN_MAPPINGS[chainId];
      if (!chain) {
        throw new Error(`Unsupported chain: ${chainId}`);
      }

      // Fetch from 0x API
      const zeroXEndpoint = API_ENDPOINTS["0x"][chain];
      if (zeroXEndpoint) {
        try {
          const response = await fetch(zeroXEndpoint);
          const data = await response.json();
          if (data.records) {
            data.records.forEach((token) => {
              this.supportedTokens.set(token.address.toLowerCase(), token);
            });
          }
        } catch (error) {
          this.report.errors.push(`Failed to fetch from 0x: ${error.message}`);
        }
      }

      console.log(
        `✅ Loaded ${this.supportedTokens.size} supported tokens for chain ${chainId}`
      );
    } catch (error) {
      this.report.errors.push(
        `Failed to fetch supported tokens: ${error.message}`
      );
      throw error;
    }
  }

  validateTokenList(tokenList, chainId) {
    this.report.totalTokens = tokenList.length;
    const validTokens = [];

    tokenList.forEach((token) => {
      const tokenAddress = token.address?.toLowerCase();

      // Special handling for native tokens
      if (
        tokenAddress === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
        token.symbol === "ETH" ||
        token.symbol === "BNB"
      ) {
        validTokens.push(token);
        this.report.supportedCount++;
        return;
      }

      if (this.supportedTokens.has(tokenAddress)) {
        validTokens.push(token);
        this.report.supportedCount++;
      } else {
        this.unsupportedTokens.push(token);
        this.report.unsupportedCount++;
        this.report.removedTokens.push({
          symbol: token.symbol,
          name: token.name,
          address: token.address,
          reason: "Not supported by quote APIs",
        });
      }
    });

    return validTokens;
  }

  generateReport() {
    const timestamp = new Date().toISOString();

    return {
      ...this.report,
      timestamp,
      summary:
        `Validated ${this.report.totalTokens} tokens. ` +
        `${this.report.supportedCount} supported, ` +
        `${this.report.unsupportedCount} removed.`,
    };
  }

  async saveReport(outputPath) {
    const report = this.generateReport();

    try {
      await fs.promises.writeFile(
        outputPath,
        JSON.stringify(report, null, 2),
        "utf8"
      );
      console.log(`📄 Report saved to: ${outputPath}`);
    } catch (error) {
      console.error(`❌ Failed to save report: ${error.message}`);
    }
  }

  async saveCleanedTokens(tokens, outputPath) {
    try {
      const data = {
        name: "Cleaned Token List",
        timestamp: new Date().toISOString(),
        version: {
          major: 1,
          minor: 0,
          patch: 0,
        },
        tokens,
      };

      await fs.promises.writeFile(
        outputPath,
        JSON.stringify(data, null, 2),
        "utf8"
      );
      console.log(`✅ Cleaned token list saved to: ${outputPath}`);
    } catch (error) {
      console.error(`❌ Failed to save cleaned tokens: ${error.message}`);
    }
  }
}

async function main() {
  const chainId = process.argv[2] || "42161"; // Default to Arbitrum
  const tokenListPath = process.argv[3] || "./static/tokenlists/default.json";

  console.log(`🔍 Validating tokens for chain ${chainId}...`);

  const validator = new TokenValidator();

  try {
    // Fetch supported tokens from APIs
    await validator.fetchSupportedTokens(
      chainId === "solana" ? "solana" : parseInt(chainId)
    );

    // Load local token list
    let tokenList = [];
    if (fs.existsSync(tokenListPath)) {
      const data = await fs.promises.readFile(tokenListPath, "utf8");
      const parsed = JSON.parse(data);
      tokenList = parsed.tokens || parsed;
    } else {
      console.log(
        `⚠️  Token list not found at ${tokenListPath}, using empty list`
      );
    }

    // Validate tokens
    const validTokens = validator.validateTokenList(tokenList, chainId);

    // Generate output paths
    const outputDir = path.dirname(tokenListPath);
    const basename = path.basename(tokenListPath, ".json");
    const reportPath = path.join(
      outputDir,
      `${basename}-validation-report.json`
    );
    const cleanedPath = path.join(outputDir, `${basename}-cleaned.json`);

    // Save results
    await validator.saveReport(reportPath);
    await validator.saveCleanedTokens(validTokens, cleanedPath);

    // Print summary
    const report = validator.generateReport();
    console.log("\n📊 Validation Summary:");
    console.log(`Total tokens processed: ${report.totalTokens}`);
    console.log(`✅ Supported tokens: ${report.supportedCount}`);
    console.log(`❌ Unsupported tokens removed: ${report.unsupportedCount}`);

    if (report.errors.length > 0) {
      console.log("\n⚠️  Errors encountered:");
      report.errors.forEach((error) => console.log(`  - ${error}`));
    }

    if (report.removedTokens.length > 0) {
      console.log("\n🗑️  Removed tokens:");
      report.removedTokens.slice(0, 10).forEach((token) => {
        console.log(`  - ${token.symbol} (${token.address})`);
      });
      if (report.removedTokens.length > 10) {
        console.log(`  ... and ${report.removedTokens.length - 10} more`);
      }
    }
  } catch (error) {
    console.error(`❌ Validation failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { TokenValidator };
