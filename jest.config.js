const nextJest = require('next/jest')

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Use Node.js environment for all tests to avoid setImmediate issues
  testEnvironment: 'node',
  
  // testEnvironment: '<rootDir>/jest-jsdom-fix.js', // Uncomment if jsdom issues persist
  
  // Setup files after environment is set up
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  
  // Module name mapper for path aliases and static assets
  moduleNameMapper: {
    // Handle CSS imports (with CSS modules)
    '^.+\\.module\\.(css|sass|scss)$': 'identity-obj-proxy',
    
    // Handle CSS imports (without CSS modules)
    '^.+\\.(css|sass|scss)$': '<rootDir>/__mocks__/styleMock.js',
    
    // Handle image imports
    '^.+\\.(png|jpg|jpeg|gif|webp|avif|ico|bmp|svg)$': '<rootDir>/__mocks__/fileMock.js',
    
    // Handle module aliases
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@components/(.*)$': '<rootDir>/components/$1',
    '^@hooks/(.*)$': '<rootDir>/hooks/$1',
    '^@utils/(.*)$': '<rootDir>/utils/$1',
    '^@services/(.*)$': '<rootDir>/src/services/$1',
    '^@types/(.*)$': '<rootDir>/types/$1',
  },
  
  // Module directories to resolve modules from
  moduleDirectories: ['node_modules', '<rootDir>'],
  
  // Resolver options to handle missing modules
  resolver: '<rootDir>/jest.resolver.js',
  
  // Test path patterns
  testMatch: [
    '<rootDir>/**/__tests__/**/*.{js,jsx,ts,tsx}',
    '<rootDir>/**/*.{spec,test}.{js,jsx,ts,tsx}'
  ],
  
  // Ignore patterns
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/out/',
    '<rootDir>/dist/',
    '<rootDir>/build/',
  ],
  
  // Transform files
  transform: {
    // Use babel-jest to transpile tests with the babel config
    '^.+\\.(js|jsx|ts|tsx)$': ['babel-jest', { presets: ['next/babel'] }],
  },
  
  // Module file extensions
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  
  // Coverage configuration
  collectCoverage: false,
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    'components/**/*.{js,jsx,ts,tsx}',
    'pages/**/*.{js,jsx,ts,tsx}',
    'hooks/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
    '!**/out/**',
    '!**/coverage/**',
    '!**/*.config.js',
    '!**/middleware.ts',
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  
  // Roots
  roots: ['<rootDir>'],
  
  // Test timeout
  testTimeout: 10000,
  
  // Transform ignore patterns - include packages that need to be transformed
  transformIgnorePatterns: [
    'node_modules/(?!(formidable|@paralleldrive|@noble|socket.io-client)/)',
    '^.+\\.module\\.(css|sass|scss)$',
  ],
  
  // Global setup/teardown
  globalSetup: undefined,
  globalTeardown: undefined,
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig)