// Utility functions for precise decimal calculations using BigInt
// Solves the fundamental precision limit when converting very small rates

const { BigNumber } = require('ethers');

/**
 * Safely converts a decimal number to a scaled BigInt without precision loss
 * @param {number|string} value - The decimal value to convert
 * @param {number} decimals - The number of decimal places in the target unit
 * @returns {bigint} The scaled BigInt value
 */
function toScaledBigInt(value, decimals) {
  // Convert to string to avoid scientific notation issues
  let valueStr = value.toString();
  
  // Handle scientific notation
  if (valueStr.includes('e')) {
    valueStr = Number(value).toFixed(decimals + 10); // Extra precision
  }
  
  // Find decimal point position
  const decimalIndex = valueStr.indexOf('.');
  
  if (decimalIndex === -1) {
    // No decimal point, just multiply by 10^decimals
    return BigInt(valueStr) * BigInt(10 ** decimals);
  }
  
  // Split into integer and decimal parts
  const integerPart = valueStr.slice(0, decimalIndex) || '0';
  let decimalPart = valueStr.slice(decimalIndex + 1);
  
  // Pad or truncate decimal part to match target decimals
  if (decimalPart.length > decimals) {
    // Truncate excess decimals
    decimalPart = decimalPart.slice(0, decimals);
  } else if (decimalPart.length < decimals) {
    // Pad with zeros
    decimalPart = decimalPart.padEnd(decimals, '0');
  }
  
  // Combine and convert to BigInt
  const combined = integerPart + decimalPart;
  return BigInt(combined);
}

/**
 * Converts a rate to a scaled BigInt for precise calculations
 * @param {number} rate - The exchange rate (e.g., 0.000285714)
 * @param {number} scaleFactor - The scale factor (e.g., 27 for 1e27)
 * @returns {bigint} The scaled rate as BigInt
 */
function rateToScaledBigInt(rate, scaleFactor = 27) {
  // Use string manipulation to preserve all digits
  const rateStr = rate.toString();
  
  // Handle scientific notation
  if (rateStr.includes('e')) {
    // Convert to fixed notation with high precision
    const fixedStr = Number(rate).toFixed(scaleFactor);
    return toScaledBigInt(fixedStr, scaleFactor);
  }
  
  return toScaledBigInt(rate, scaleFactor);
}

/**
 * Calculates token swap amount with full precision
 * @param {string} sellAmount - The sell amount in smallest unit (wei)
 * @param {number} rate - The exchange rate
 * @param {number} sellDecimals - Decimals of sell token
 * @param {number} buyDecimals - Decimals of buy token
 * @returns {string} The buy amount in smallest unit with full precision
 */
function calculateTokenSwap(sellAmount, rate, sellDecimals, buyDecimals) {
  const sellAmountBN = BigInt(sellAmount);
  
  // Use a very large scale factor to preserve precision
  const scaleFactor = 27; // 1e27 for maximum precision
  const scaledRate = rateToScaledBigInt(rate, scaleFactor);
  
  // Calculate: (sellAmount * scaledRate * 10^buyDecimals) / (10^sellDecimals * 10^scaleFactor)
  const numerator = sellAmountBN * scaledRate * BigInt(10 ** buyDecimals);
  const denominator = BigInt(10 ** sellDecimals) * BigInt(10 ** scaleFactor);
  
  const buyAmountBN = numerator / denominator;
  
  return buyAmountBN.toString();
}

/**
 * Calculates token swap with USD prices (more intuitive approach)
 * @param {string} sellAmount - The sell amount in smallest unit
 * @param {number} sellPriceUSD - USD price of sell token
 * @param {number} buyPriceUSD - USD price of buy token
 * @param {number} sellDecimals - Decimals of sell token
 * @param {number} buyDecimals - Decimals of buy token
 * @returns {string} The buy amount in smallest unit
 */
function calculateTokenSwapViaUSD(sellAmount, sellPriceUSD, buyPriceUSD, sellDecimals, buyDecimals) {
  const sellAmountBN = BigInt(sellAmount);
  
  // Scale prices to avoid decimals (use 1e18 for USD precision)
  const usdScale = 18;
  const sellPriceScaled = toScaledBigInt(sellPriceUSD, usdScale);
  const buyPriceScaled = toScaledBigInt(buyPriceUSD, usdScale);
  
  // Calculate USD value: (sellAmount * sellPrice) / 10^sellDecimals
  const usdValue = (sellAmountBN * sellPriceScaled) / BigInt(10 ** sellDecimals);
  
  // Calculate buy amount: (usdValue * 10^buyDecimals) / buyPrice
  const buyAmountBN = (usdValue * BigInt(10 ** buyDecimals)) / buyPriceScaled;
  
  return buyAmountBN.toString();
}

/**
 * Ensures a BigInt string has the expected number of digits for a token
 * @param {string} amount - The amount as a string
 * @param {number} expectedDecimals - Expected decimals for the token
 * @returns {string} The amount, potentially padded with leading zeros
 */
function ensureMinimumDigits(amount, expectedDecimals) {
  // For very small amounts, the significant digits might be less than decimals
  // This is actually correct - it just means the value is less than 1 whole token
  // But we should log it for debugging
  
  if (amount === '0') {
    return '0';
  }
  
  // No need to pad - the number of digits can be less than decimals
  // Example: 0.01 WETH = 10000000000000000 (16 digits, not 18)
  return amount;
}

// Export for both CommonJS and ES modules
module.exports = {
  toScaledBigInt,
  rateToScaledBigInt,
  calculateTokenSwap,
  calculateTokenSwapViaUSD,
  ensureMinimumDigits
};

