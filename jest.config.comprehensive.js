module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/tests/**/*.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/tests/',
    '/__tests__/',
  ],
  testTimeout: 120000, // 2 minutes for complex integration tests
  globals: {
    'ts-jest': {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Separate test suites
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'matching-engine',
      testMatch: ['<rootDir>/tests/matching-engine/**/*.test.ts'],
      testEnvironment: 'node',
    },
    {
      displayName: 'settlement',
      testMatch: ['<rootDir>/tests/settlement/**/*.test.ts'],
      testEnvironment: 'node',
    },
  ],
};