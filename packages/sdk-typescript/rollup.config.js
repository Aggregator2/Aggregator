import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { terser } from 'rollup-plugin-terser';
import dts from 'rollup-plugin-dts';

const packageJson = require('./package.json');

const external = [
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.peerDependencies || {}),
  'crypto',
  'events',
  'util'
];

export default [
  // CommonJS and ES Module builds
  {
    input: 'src/index.ts',
    output: [
      {
        file: packageJson.main,
        format: 'cjs',
        sourcemap: true,
        exports: 'named'
      },
      {
        file: packageJson.module,
        format: 'es',
        sourcemap: true
      }
    ],
    external,
    plugins: [
      resolve(),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false
      })
    ]
  },
  // Minified UMD build
  {
    input: 'src/index.ts',
    output: {
      name: 'OffchainSDK',
      file: 'dist/offchain-sdk.min.js',
      format: 'umd',
      sourcemap: true,
      globals: {
        'node-fetch': 'fetch',
        'ws': 'WebSocket'
      }
    },
    external: ['node-fetch', 'ws'],
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false
      }),
      terser()
    ]
  },
  // Type definitions
  {
    input: 'src/index.ts',
    output: {
      file: packageJson.types,
      format: 'es'
    },
    plugins: [dts()]
  }
];