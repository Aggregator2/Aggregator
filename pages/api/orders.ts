// filepath: c:\Users\joeri\OneDrive\Desktop\Meta Aggregator 2.0\pages\api\orders.ts
import { PrismaClient } from '@prisma/client';
import { hashOrder } from '../../utils/hashOrder';
import { ethers } from 'ethers';

const prisma = new PrismaClient();

// Example for Next.js API route
export default async function handler(req, res) {
    try {
        if (req.method === 'POST') {
            const { order: reqOrder, signature } = req.body;

            // Validate required fields
            if (!reqOrder || !signature) {
                return res.status(400).json({ error: 'Missing order or signature' });
            }

            // Destructure and set default values for order fields
            const {
                sellToken = "0x0000000000000000000000000000000000000000",
                buyToken = "0x0000000000000000000000000000000000000000",
                sellAmount = "0",
                buyAmount = "0",
                validTo,
                user = "0x0000000000000000000000000000000000000000",
                receiver = "0x0000000000000000000000000000000000000000",
                appData = "0x",
                feeAmount = "0",
                partiallyFillable = false,
                kind = "sell",
                signingScheme = "eip712",
            } = reqOrder;

            // Create order object
            const order = {
                sellToken,
                buyToken,
                sellAmount: ethers.utils.parseUnits(sellAmount, 18).toString(),
                buyAmount: ethers.utils.parseUnits(buyAmount, 18).toString(),
                validTo: validTo ? Math.floor(new Date(validTo).getTime() / 1000) : Math.floor(Date.now() / 1000) + 600,
                user,
                receiver,
                appData,
                feeAmount,
                partiallyFillable,
                kind,
                signingScheme,
            };

            console.log("Order for validation:", order);
            console.log("Order field types and values:");
            Object.entries(order).forEach(([key, value]) => {
              console.log(`${key}:`, value, `(type: ${typeof value})`);
            });
            
            if (
              !order.sellToken ||
              !order.buyToken ||
              !order.sellAmount ||
              !order.buyAmount ||
              !order.validTo ||
              !order.user ||
              !order.receiver
            ) {
              return res.status(400).json({ error: "Missing required fields in order" });
            }

            // Hash the order
            const orderHash = hashOrder(order);

            // Verify the signature
            const recovered = ethers.utils.verifyMessage(ethers.utils.arrayify(orderHash), signature);

            // Check if the recovered address matches the wallet in the order
            if (recovered.toLowerCase() !== order.wallet.toLowerCase()) {
                return res.status(400).json({ error: 'Invalid signature' });
            }

            // Log the order
            console.log("Valid order received:", order);

            // Submit the order to the /api/submitOrder endpoint
            await fetch("/api/submitOrder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order, signature })
            });

            // Return success response
            return res.status(200).json({ ok: true });
        } else if (req.method === 'GET') {
            try {
                const orders = await prisma.orders.findMany(); // Fetch all orders
                return res.status(200).json(orders);
            } catch (error) {
                return res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
            }
        } else {
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
        }
    } catch (err) {
        res.status(400).json({ error: err.message || "Unknown error" }); // Error as JSON
    }
}