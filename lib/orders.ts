import prisma from './prisma';

export async function fetchOrders() {
    const orders = await prisma.orders.findMany();
    return orders;
}