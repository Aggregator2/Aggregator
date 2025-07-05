// Universal API handler for Vercel deployment
import { swappiqStandalone } from '../../lib/swappiq-api';

export default async function handler(req, res) {
  // Handle all API routes through our standalone implementation
  return swappiqStandalone(req, res);
}