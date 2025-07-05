/**
 * Jest configuration for HFT feature tests
 */

module.exports = {
  displayName: 'HFT Features',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: [
    '**/*.test.ts',
    '**/*.test.js'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        target: 'ES2020',
        module: 'commonjs',
        lib: ['ES2020'],
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        allowJs: true,
        strict: true
      }
    }]
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  setupFilesAfterEnv: ['<rootDir>/setup.ts'],
  testTimeout: 30000, // 30 seconds for performance tests
  maxWorkers: 1, // Run serially to avoid resource contention
  collectCoverage: true,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    '../../src/stateChannels/**/*.ts',
    '../../src/services/mevProtection/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  // Performance test specific settings
  globals: {
    'ts-jest': {
      isolatedModules: true, // Faster compilation
    }
  },
  // Reporter for performance metrics
  reporters: [
    'default',
    ['<rootDir>/performanceReporter.js', {
      outputFile: 'performance-results.json'
    }]
  ]
};