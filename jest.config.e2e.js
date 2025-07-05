// Jest config for end-to-end tests
module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.integration.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
  },
  testMatch: [
    '<rootDir>/tests/integration/end-to-end*.{js,ts}',
    '<rootDir>/tests/e2e/**/*.{js,ts}',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/__tests__/',
    '<rootDir>/test/unit/',
  ],
  testTimeout: 60000,
  maxWorkers: 1,
  forceExit: true,
  detectOpenHandles: true,
}
