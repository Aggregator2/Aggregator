// Test to verify environment variables are loaded correctly

describe('Environment Variables Test', () => {
  test('should have all required environment variables', () => {
    // Critical variables that should be set
    const requiredVars = [
      'NODE_ENV',
      'JWT_SECRET', 
      'DATABASE_URL',
      'PRIVATE_KEY',
      'CHAIN_ID',
      'REDIS_URL',
      'ETHEREUM_RPC_URL'
    ];

    requiredVars.forEach(varName => {
      expect(process.env[varName]).toBeDefined();
      expect(process.env[varName]).not.toBe('');
    });
  });

  test('should have NODE_ENV set to test', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('should have proper test database URL', () => {
    expect(process.env.DATABASE_URL).toContain('test');
  });

  test('should have test JWT secret', () => {
    expect(process.env.JWT_SECRET).toContain('test');
    // JWT secret should be at least 15 characters for testing
    expect(process.env.JWT_SECRET.length).toBeGreaterThanOrEqual(15);
  });

  test('should have Hardhat test chain ID', () => {
    expect(process.env.CHAIN_ID).toBe('31337');
  });

  test('should have test private key', () => {
    expect(process.env.PRIVATE_KEY).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });

  test('should have localhost URLs for services', () => {
    expect(process.env.REDIS_URL).toContain('localhost');
    expect(process.env.ETHEREUM_RPC_URL).toContain('127.0.0.1');
  });

  test('should have feature flags set for testing', () => {
    expect(process.env.MOCK_EXTERNAL_APIS).toBe('true');
    expect(process.env.DISABLE_RATE_LIMIT).toBe('true');
  });
});