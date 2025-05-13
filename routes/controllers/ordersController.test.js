const { createOrder } = require('../routes/controllers/ordersController');

test('createOrder should return 400 if required fields are missing', async () => {
  const req = { body: { maker: '', taker: '', amount: '' } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
  };

  await createOrder(req, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res.json).toHaveBeenCalledWith({ error: 'Missing required fields' });
});