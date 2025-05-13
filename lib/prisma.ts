import { PrismaClient } from '@prisma/client';
import routes from '../routes/index.js';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

async function createOrder() {
  const order = await prisma.orders.create({
    data: {
      user: 'joeri',
      baseToken: 'ETH',
      quoteToken: 'USDC',
      side: 'buy',
      quantity: 1, // Ensure this field is included
      amount: 10,
      price: 2000,
      validTo: 1715193600,
    },
  });
  console.log(order);
}

createOrder();

export default prisma;

export const indexController = (req: Request, res: Response) => {
    res.send("Welcome to the API!");
};
