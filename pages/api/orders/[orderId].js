export default async function handler(req, res) {
  const { orderId } = req.query;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID required' });
  }

  // For now, return a mock order status
  // In production, this would query the database or order matching service
  const mockOrder = {
    orderId,
    status: 'pending', // pending, filled, cancelled, expired
    filledAmount: '0',
    remainingAmount: '1000000',
    createdAt: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
    updatedAt: new Date().toISOString(),
    estimatedSettlement: new Date(Date.now() + 270000).toISOString(), // 4.5 minutes from now
    settlementBatch: null,
    matches: []
  };

  // Simulate order progression
  const orderAge = Date.now() - parseInt(orderId.split('-')[0]);
  
  if (orderAge > 300000) { // 5 minutes
    mockOrder.status = 'filled';
    mockOrder.filledAmount = mockOrder.remainingAmount;
    mockOrder.remainingAmount = '0';
    mockOrder.settlementBatch = `batch-${Date.now()}`;
  } else if (orderAge > 60000) { // 1 minute
    // Partially filled
    mockOrder.status = 'pending';
    mockOrder.filledAmount = '500000';
    mockOrder.remainingAmount = '500000';
    mockOrder.matches = [{
      matchId: `match-${Date.now()}`,
      amount: '500000',
      price: '0.0002',
      timestamp: new Date(Date.now() - 10000).toISOString()
    }];
  }

  return res.status(200).json(mockOrder);
}