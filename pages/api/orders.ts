// filepath: c:\Users\joeri\OneDrive\Desktop\Meta Aggregator 2.0\pages\api\orders.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { product, quantity } = req.body;

    try {
      const order = await prisma.orders.create({
        data: { product, quantity }, // Ensure the fields match the updated schema
      });
      res.status(201).json(order);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create order', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}