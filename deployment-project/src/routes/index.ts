import { Request, Response } from 'express';

export const indexController = (req: Request, res: Response) => {
    res.send("Welcome to the API!");
};