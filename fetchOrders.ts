import prisma from './lib/prisma';

async function fetchOrders() {
  const orders = await prisma.orders.findMany();
  console.log(orders);
}

fetchOrders().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});