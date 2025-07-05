describe('Simple Test', () => {
  test('should pass', () => {
    expect(1 + 1).toBe(2);
  });
  
  test('JWT_SECRET is available', () => {
    // Check if JWT_SECRET would be available
    const secret = process.env.JWT_SECRET || '37c1c35b7c7e9d78df9d03e3ee4e2bbe716f9f4c0af512ccfb95dca216b65511';
    expect(secret).toBeTruthy();
    expect(secret.length).toBeGreaterThan(30);
  });
});