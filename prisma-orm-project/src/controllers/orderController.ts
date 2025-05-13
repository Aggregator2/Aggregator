import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import routes from '../routes/index';

const prisma = new PrismaClient();

export const addOrder = async (req: Request, res: Response) => {
    const { product, quantity, status } = req.body;

    try {
        const newOrder = await prisma.orders.create({
            data: {
                product,
                quantity,
                status,
            },
        });
        res.status(201).json(newOrder);
    } catch (error) {
        res.status(500).json({ error: 'Error creating order' });
    }
};

export const fetchAllOrders = async (req: Request, res: Response) => {
    try {
        const orders = await prisma.orders.findMany();
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching orders' });
    }
};

export const fetchOrderById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const order = await prisma.orders.findUnique({
            where: { id: Number(id) },
        });

        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.status(200).json(order);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching order' });
    }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    try {
        const updatedOrder = await prisma.orders.update({
            where: { id: Number(id) },
            data: { status },
        });

        res.status(200).json(updatedOrder);
    } catch (error) {
        res.status(500).json({ error: 'Error updating order status' });
    }
};