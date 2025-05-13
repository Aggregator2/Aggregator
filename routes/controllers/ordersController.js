const prisma = require('../../lib/prisma').default; // Import the default export from prisma.ts

// Create a new order
exports.createOrder = async (req, res) => {
  try {
    const { maker, taker, amount } = req.body;
    if (!maker || !taker || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const order = await prisma.order.create({
      data: { maker, taker, amount },
    });
    res.status(201).json({ message: 'Order created successfully', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get all orders
exports.getOrders = async (req, res) => {
  try {
    const orders = await prisma.order.findMany();
    res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const order = await prisma.Order.create({
  data: { maker, taker, amount },
});