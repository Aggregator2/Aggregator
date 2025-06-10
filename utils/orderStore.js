// Simple in-memory store for settled orders

const settledOrders = [];

/**
 * Add a settled order to the store.
 * @param {Object} orderData - { quote, order, makerSignature, takerSignature }
 */
function addSettledOrder(orderData) {
  settledOrders.push({
    ...orderData,
    settledAt: Date.now(),
  });
}

/**
 * Get all settled orders.
 * @returns {Array}
 */
function getSettledOrders() {
  return settledOrders;
}

/**
 * Clear all settled orders (for testing or reset).
 */
function clearSettledOrders() {
  settledOrders.length = 0;
}

module.exports = {
  addSettledOrder,
  getSettledOrders,
  clearSettledOrders,
};