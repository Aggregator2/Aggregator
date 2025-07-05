// Register TypeScript for Node.js
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    target: 'es2020',
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    resolveJsonModule: true,
    moduleResolution: 'node',
    allowJs: true,
    skipLibCheck: true
  }
});