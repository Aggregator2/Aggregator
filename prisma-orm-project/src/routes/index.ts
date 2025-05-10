import { Router } from 'express';

const router = Router();

// Define your routes here
router.get('/', (req, res) => {
    res.send('Routes working');
});

// Export the router
export default router;