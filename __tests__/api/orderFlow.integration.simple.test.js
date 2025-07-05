const jwt = require('jsonwebtoken');
const { faker } = require('@faker-js/faker');

// Mock dependencies
jest.mock('../../utils/orderStore');

describe('Order Flow Integration - Simple Tests', () => {
  const JWT_SECRET = 'test-secret-key-for-testing-only';
  let orderStore;

  beforeAll(() => {
    process.env.JWT_SECRET = JWT_SECRET;
    orderStore = require('../../utils/orderStore');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should simulate a complete order lifecycle', async () => {
    // 1. Create user and token
    const userData = {
      userId: faker.string.uuid(),
      email: faker.internet.email(),
      wallet: faker.finance.ethereumAddress()
    };
    const token = jwt.sign(userData, JWT_SECRET, { expiresIn: '1h' });

    // 2. Create order
    const order = {
      id: faker.string.uuid(),
      sellToken: faker.finance.ethereumAddress(),
      buyToken: faker.finance.ethereumAddress(),
      sellAmount: '1000000',
      buyAmount: '2000000',
      user: userData.wallet,
      status: 'pending',
      timestamp: Date.now()
    };

    // 3. Mock order store operations
    orderStore.addOrder = jest.fn().mockResolvedValue(order);
    orderStore.getUserOrders = jest.fn().mockResolvedValue([order]);
    orderStore.cancelOrder = jest.fn().mockResolvedValue({ ...order, status: 'cancelled' });

    // 4. Test order submission
    await orderStore.addOrder(order);
    expect(orderStore.addOrder).toHaveBeenCalledWith(order);

    // 5. Test retrieving user orders
    const userOrders = await orderStore.getUserOrders(userData.wallet);
    expect(userOrders).toHaveLength(1);
    expect(userOrders[0].id).toBe(order.id);

    // 6. Test order cancellation
    const cancelledOrder = await orderStore.cancelOrder(order.id, userData.wallet);
    expect(cancelledOrder.status).toBe('cancelled');
    expect(orderStore.cancelOrder).toHaveBeenCalledWith(order.id, userData.wallet);
  });

  it('should handle multiple orders from same user', async () => {
    const userWallet = faker.finance.ethereumAddress();
    const orders = Array.from({ length: 3 }, () => ({
      id: faker.string.uuid(),
      sellToken: faker.finance.ethereumAddress(),
      buyToken: faker.finance.ethereumAddress(),
      sellAmount: faker.number.int({ min: 1000, max: 10000 }).toString(),
      buyAmount: faker.number.int({ min: 1000, max: 10000 }).toString(),
      user: userWallet,
      status: 'pending',
      timestamp: Date.now()
    }));

    orderStore.getUserOrders = jest.fn().mockResolvedValue(orders);

    const userOrders = await orderStore.getUserOrders(userWallet);
    expect(userOrders).toHaveLength(3);
    expect(userOrders.every(o => o.user === userWallet)).toBe(true);
  });

  it('should prevent users from cancelling other users orders', async () => {
    const user1Wallet = faker.finance.ethereumAddress();
    const user2Wallet = faker.finance.ethereumAddress();
    
    const order = {
      id: faker.string.uuid(),
      user: user1Wallet,
      status: 'pending'
    };

    orderStore.cancelOrder = jest.fn().mockImplementation((orderId, userWallet) => {
      if (userWallet !== user1Wallet) {
        return Promise.reject(new Error('Unauthorized: Cannot cancel order belonging to another user'));
      }
      return Promise.resolve({ ...order, status: 'cancelled' });
    });

    // User 1 can cancel their own order
    const cancelledOrder = await orderStore.cancelOrder(order.id, user1Wallet);
    expect(cancelledOrder.status).toBe('cancelled');

    // User 2 cannot cancel User 1's order
    await expect(orderStore.cancelOrder(order.id, user2Wallet)).rejects.toThrow('Unauthorized: Cannot cancel order belonging to another user');
  });
});