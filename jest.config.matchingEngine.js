module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/matchingEngine/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/__tests__/',
  ],
};