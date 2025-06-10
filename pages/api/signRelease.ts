import type { NextApiRequest, NextApiResponse } from 'next'
import { ethers } from 'ethers'

const PRIVATE_KEY = process.env.ARBITER_PRIVATE_KEY as string

const domain = {
  name: 'Escrow',
  version: '1',
  chainId: 31337, // Hardhat local network chainId
  verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
}

const types = {
  Release: [
    { name: 'escrowAddress', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ]
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const { escrowAddress, to, token, amount } = req.body

  if (!escrowAddress || !to || !token || !amount) {
    return res.status(400).json({ error: 'Missing parameters' })
  }

  if (!PRIVATE_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: PRIVATE_KEY missing' })
  }
  try {
    const wallet = new ethers.Wallet(PRIVATE_KEY)
    
    // Convert "ETH" to zero address for EIP-712 signing
    const tokenAddress = token === "ETH" ? "0x0000000000000000000000000000000000000000" : token
    
    const value = { escrowAddress, to, token: tokenAddress, amount }
    const signature = await wallet.signTypedData(
      domain,
      types,
      value
    )
    res.status(200).json({ signature })
  } catch (err) {
    res.status(500).json({ error: 'Signing failed', details: (err as Error).message })
  }
}