module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFilesAfterEnv: ['./jest.setup.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.jsx?$': ['babel-jest', {
      presets: [
        ['@babel/preset-env', {
          targets: { node: 'current' },
          modules: 'commonjs'
        }]
      ]
    }]
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/../src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(socket\\.io-client|engine\\.io-client)/)'
  ],
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: false,
      tsconfig: {
        allowJs: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }
  }
};