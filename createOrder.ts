import prisma from './lib/prisma';

async function createOrder() {
  const order = await prisma.orders.create({
    data: {
      user: 'joeri',
      baseToken: 'ETH',
      quoteToken: 'USDC',
      side: 'buy',
      amount: 10,
      price: 2000,
      validTo: 1715193600, // Example timestamp
    },
  });
  console.log(order);
}

createOrder().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});