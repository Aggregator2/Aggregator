import type { NextApiRequest, NextApiResponse } from 'next';
import { authService } from '../../../src/services/authService';
import { ValidationError } from '../../../src/utils/errors';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password, walletAddress, firstName, lastName } = req.body;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    const result = await authService.register({
      email,
      password,
      walletAddress,
      firstName,
      lastName
    });

    res.status(201).json(result);
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return res.status(400).json({ error: error.message });
    }
    
    if (error.message.includes('already registered')) {
      return res.status(409).json({ error: error.message });
    }

    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}