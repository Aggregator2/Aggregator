"use strict";
// Wallet-related type definitions
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOrder = isOrder;
exports.isOrderArray = isOrderArray;
exports.isQuote = isQuote;
// Type guards
function isOrder(obj) {
    return (obj &&
        typeof obj === 'object' &&
        typeof obj.sellToken === 'string' &&
        typeof obj.buyToken === 'string' &&
        typeof obj.sellAmount === 'string' &&
        typeof obj.buyAmount === 'string' &&
        typeof obj.user === 'string');
}
function isOrderArray(obj) {
    return Array.isArray(obj) && obj.every(isOrder);
}
function isQuote(obj) {
    return (obj &&
        typeof obj === 'object' &&
        typeof obj.sellToken === 'string' &&
        typeof obj.buyToken === 'string' &&
        typeof obj.sellAmount === 'string' &&
        typeof obj.buyAmount === 'string');
}
