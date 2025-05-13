import { Request, Response, NextFunction } from 'express';
import { Router } from 'express';

const router = Router();

export const exampleMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Middleware logic here
    next();
};

export const exampleRoute = () => 'Hello, this is a placeholder!';

router.get('/', (req, res) => {
    res.send('Routes working');
});

const middlewares = { exampleMiddleware };
export default { middlewares, router };