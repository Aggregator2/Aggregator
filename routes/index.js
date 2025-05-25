// Main server entry point. Sets up routes, database connections, and API endpoints.
// index.js (only fixing POST /orders part)
require('dotenv').config();

const express = require('express'); // Declare express once
const Database = require('better-sqlite3');
const cors = require('cors');
const { ethers } = require('ethers');
const errorHandler = require('../Backend server/routes/controllers/services/tests/middleware/errorHandler');
import ordersController from './controllers/ordersController';

const app = express();

app.use(cors());
app.use(express.json());

const db = new Database('offchain_dex.db');

app.post('/orders', async (req, res) => {
    // Processes incoming orders, verifies signatures, and matches them with existing orders.
    const { sellToken, buyToken, sellAmount, buyAmount, validTo, user, side, signature } = req.body;

    if (!sellToken || !buyToken || !sellAmount || !buyAmount || !validTo || !user || !signature || !side) {
        return res.status(400).json({ error: 'Missing fields in order' });
    }

    try {
        const reconstructedHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                [
                    "address", // sellToken
                    "address", // buyToken
                    "uint256", // sellAmount
                    "uint256", // buyAmount
                    "uint256", // validTo
                    "address", // user
                    "address", // receiver
                    "bytes",   // appData
                    "uint256", // feeAmount
                    "bool",    // partiallyFillable
                    "string",  // kind
                    "string",  // signingScheme
                ],
                [
                    sellToken,
                    buyToken,
                    sellAmount,
                    buyAmount,
                    validTo,
                    user,
                    receiver,
                    appData,
                    feeAmount,
                    partiallyFillable,
                    kind,
                    signingScheme,
                ]
            )
        );

        const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(reconstructedHash), signature);

        if (recoveredAddress.toLowerCase() !== user.toLowerCase()) {
            return res.status(400).json({ error: 'Invalid signature' });
        }

        if (Math.floor(Date.now() / 1000) > validTo) {
            return res.status(400).json({ error: 'Order expired' });
        }

        const insert = db.prepare(`
      INSERT INTO orders (user, base_token, quote_token, side, amount, price)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

        const result = insert.run(user, sellToken, buyToken, side, sellAmount, buyAmount);

        const insertedOrder = {
            id: result.lastInsertRowid,
            user,
            base_token: sellToken,
            quote_token: buyToken,
            side,
            amount: sellAmount,
            price: buyAmount
        };

        const { trades, remainingAmount } = matchOrder(insertedOrder);

        res.status(201).json({ message: 'Order processed', trades, remainingAmount });
    } catch (err) {
        console.error('POST /orders error:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// matchOrder function remains same (but assumes passed order has id)

// server.listen... remains same



// Order matching function
function matchOrder(order) {
    const { side, base_token, quote_token, amount, price } = order;
    const opposite = side === 'buy' ? 'sell' : 'buy';

    const matches = db.prepare(`
    SELECT * FROM orders
    WHERE side = ? AND base_token = ? AND quote_token = ?
    AND price <= ?
    ORDER BY price ASC, created_at ASC
  `).all(opposite, base_token, quote_token, price);

    let remainingAmount = amount;
    let trades = [];

    for (const match of matches) {
        if (remainingAmount <= 0) break;

        const tradedAmount = Math.min(remainingAmount, match.amount);

        db.prepare(`
      INSERT INTO trades (buy_order_id, sell_order_id, base_token, quote_token, amount, price)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
            side === 'buy' ? order.id : match.id,
            side === 'buy' ? match.id : order.id,
            base_token,
            quote_token,
            tradedAmount,
            match.price
        );

        if (tradedAmount === match.amount) {
            db.prepare(`DELETE FROM orders WHERE id = ?`).run(match.id);
        } else {
            db.prepare(`UPDATE orders SET amount = amount - ? WHERE id = ?`).run(tradedAmount, match.id);
        }

        trades.push({
            matchedOrderId: match.id,
            amount: tradedAmount,
            price: match.price
        });

        remainingAmount -= tradedAmount;
    }

    return { trades, remainingAmount };
}

// Routes
// Secure POST /orders with signature verification
app.post('/orders', (req, res) => {
    const { sellToken, buyToken, sellAmount, buyAmount, validTo, user, signature, side } = req.body;

    // Step 1: Check required fields
    if (!sellToken || !buyToken || !sellAmount || !buyAmount || !validTo || !user || !signature || !side) {
        return res.status(400).json({ error: 'Missing fields in order' });
    }

    try {
        // Step 2: Reconstruct the order hash
        const reconstructedHash = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
                [
                    "address", // sellToken
                    "address", // buyToken
                    "uint256", // sellAmount
                    "uint256", // buyAmount
                    "uint256", // validTo
                    "address", // user
                    "address", // receiver
                    "bytes",   // appData
                    "uint256", // feeAmount
                    "bool",    // partiallyFillable
                    "string",  // kind
                    "string",  // signingScheme
                ],
                [
                    sellToken,
                    buyToken,
                    sellAmount,
                    buyAmount,
                    validTo,
                    user,
                    receiver,
                    appData,
                    feeAmount,
                    partiallyFillable,
                    kind,
                    signingScheme,
                ]
            )
        );

        // Step 3: Recover address from signature
        const recoveredAddress = ethers.utils.verifyMessage(ethers.utils.arrayify(reconstructedHash), signature);

        // Step 4: Check if recovered address matches claimed user
        if (recoveredAddress.toLowerCase() !== user.toLowerCase()) {
            return res.status(400).json({ error: 'Invalid signature' });
        }

        // Step 5: Check if order is expired
        if (Date.now() / 1000 > validTo) {
            return res.status(400).json({ error: 'Order expired' });
        }

        // Step 6: Insert order into DB and match it
        const order = {
            user,
            side, // now dynamic (buy/sell)
            base_token: sellToken,
            quote_token: buyToken,
            amount: sellAmount,
            price: buyAmount
        };

        const matchResult = matchOrder(order);

        res.status(201).json(matchResult);

    } catch (err) {
        console.error('Signature verification error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/orders', (req, res) => {
    try {
        const orders = db.prepare('SELECT * FROM orders ORDER BY created_at ASC').all();
        res.json(orders);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/trades', (req, res) => {
    const trades = db.prepare('SELECT * FROM trades ORDER BY created_at ASC').all();
    res.json(trades);
});

app.post('/aggregate-quote', async (req, res) => {
    // Aggregates quotes from multiple sources (e.g., 0x, 1inch, CoW Swap) and returns the best one.
    const { fromToken, toToken, amount } = req.body;

    if (!fromToken || !toToken || !amount) {
        return res.status(400).json({ error: 'Missing fromToken, toToken, or amount' });
    }

    try {
        const [zeroX, oneInch, cowSwap] = await Promise.all([
            get0xQuote(fromToken, toToken, amount),
            get1inchQuote(fromToken, toToken, amount),
            getCowSwapQuote(fromToken, toToken, amount)
        ]);

        const allQuotes = [zeroX, oneInch, cowSwap].filter(q => q !== null);

        const bestQuote = allQuotes.sort((a, b) => a.price - b.price)[0];

        res.json({ bestQuote, allQuotes });

    } catch (err) {
        console.error('Error aggregating quotes:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/execute-trade', async (req, res) => {
    // Executes trades based on provided quote data, supporting both local and external sources.
    const { source, quoteData } = req.body;

    if (!source || !quoteData) {
        return res.status(400).json({ error: 'Missing trade execution data.' });
    }

    if (quoteData.expiresAt && Date.now() > quoteData.expiresAt) {
        return res.status(400).json({ error: '❌ Quote expired. Please request a new quote.' });
    }

    try {
        if (source === 'Local Orderbook') {
            db.prepare(`DELETE FROM orders WHERE id = ?`).run(quoteData.id);

            db.prepare(`
        INSERT INTO trades (buy_order_id, sell_order_id, price, amount)
        VALUES (?, ?, ?, ?)
      `).run(null, quoteData.id, quoteData.price, quoteData.amount);

            return res.json({ message: '✅ Local trade executed successfully.' });

        } else {
            if (Array.isArray(quoteData)) {
                for (const fill of quoteData) {
                    if (fill.source === 'Local Orderbook') {
                        db.prepare(`DELETE FROM orders WHERE id = ?`).run(fill.id);

                        db.prepare(`
              INSERT INTO trades (buy_order_id, sell_order_id, price, amount)
              VALUES (?, ?, ?, ?)
            `).run(null, fill.id, fill.price, fill.amount);
                    } else {
                        console.log(`🚀 Would send external trade to ${fill.source} for ${fill.amount} at price ${fill.price}`);
                    }
                }
                return res.json({ message: '✅ Mixed local + external fills executed (mock).' });

            } else {
                return res.json({
                    message: `🚀 Trade would be executed externally on ${source}. (mock)`
                });
            }
        }
    } catch (err) {
        console.error('Execute Trade Error:', err.message);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

// External quote fetching
async function get0xQuote(from, to, amount) {
    try {
        const params = new URLSearchParams({
            sellToken: from,
            buyToken: to,
            sellAmount: amount,
        });
        const res = await axios.get(`https://arbitrum.api.0x.org/swap/v1/quote?${params.toString()}`, {
            headers: { Authorization: 'Bearer ce875464-1d55-4097-830b-9f241b299fdb' },
        });
        const price = parseFloat(res.data.buyAmount) / parseFloat(res.data.sellAmount);
        return { source: '0x', price, amount: parseFloat(res.data.buyAmount) };
    } catch (err) {
        console.error('0x Error:', err.message);
        return null;
    }
}

async function get1inchQuote(from, to, amount) {
    try {
        const res = await axios.get('https://api.1inch.dev/swap/v5.2/1/quote', {
            params: { fromTokenAddress: from, toTokenAddress: to, amount },
            headers: { Authorization: 'Bearer cdc3902a-daef-4d26-bca5-23df95595774' },
        });
        const price = parseFloat(res.data.toTokenAmount) / parseFloat(res.data.fromTokenAmount);
        return { source: '1inch', price, amount: parseFloat(res.data.toTokenAmount) };
    } catch (err) {
        console.error('1inch Error:', err.message);
        return null;
    }
}

async function getCowSwapQuote(from, to, amount) {
    try {
        const res = await axios.post('https://arbitrum.api.0x.org/swap/v1/quote', {
            sellToken: from,
            buyToken: to,
            sellAmountBeforeFee: amount
        });
        const price = parseFloat(res.data.buyAmount) / parseFloat(res.data.sellAmount);
        return { source: 'CoW Swap', price, amount: parseFloat(res.data.buyAmount) };
    } catch (err) {
        console.error('CoW Swap Error:', err.message);
        return null;
    }
}
// ⬆️ All your other routes go here first
// app.use('/api', require('./routes/verifyOrder'));
// app.use('/api', require('./routes/orders'));
// app.use('/api', require('./routes/rfq'));
// app.use('/', require('./routes/mockRFQ')); // Or '/mock' if preferred

// ⚠️ Ensure this is before any global 404 or error-handling middleware
// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

app.use(errorHandler);

// Example: routes/verifyOrder.js
const router = express.Router();

router.get('/verify', (req, res) => {
    res.json({ message: 'Verify Order endpoint works!' });
});

module.exports = router;

const databaseUrl = process.env.DATABASE_URL;
const privateKey = process.env.PRIVATE_KEY;

console.log('Database URL:', databaseUrl);
console.log('Private Key:', privateKey);

const routes = {
    orders: ordersController,
};

export default routes;

const fetchQuote = async () => {
  try {
    const response = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sellToken, buyToken, sellAmount }),
    });
    const data = await response.json();
    setQuote(data); // Ensure this updates the state
  } catch (error) {
    console.error("Error fetching quote:", error);
  }
};

console.log("Raw buyAmount:", quote?.buyAmount);

