import { Router } from 'express';
import {
    addOrder,
    fetchAllOrders,
    fetchOrderById,
    updateOrderStatus
} from '../controllers/orderController';

const router = Router();

router.post('/orders', addOrder);
router.get('/orders', fetchAllOrders);
router.get('/orders/:id', fetchOrderById);
router.put('/orders/:id/status', updateOrderStatus);

export default router;