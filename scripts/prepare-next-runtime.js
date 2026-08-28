#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , configName, distDir] = process.argv;
const safeName = /^\.tsconfig-lexvoice-[0-9]+\.json$/;
const safeDistDir = /^\.next-lexvoice-[0-9]+$/;

if (!safeName.test(configName || '') || !safeDistDir.test(distDir || '')) {
  throw new Error('runtime TypeScript paths must use a numeric LexVoice window');
}

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, configName);
const runtimeConfig = {
  extends: './tsconfig.json',
  compilerOptions: {
    incremental: true,
    tsBuildInfoFile: `./${distDir}/cache/tsconfig.tsbuildinfo`,
  },
  include: [
    'next-env.d.ts',
    '**/*.ts',
    '**/*.tsx',
    `./${distDir}/types/**/*.ts`,
  ],
  exclude: ['node_modules'],
};

fs.writeFileSync(
  configPath,
  `${JSON.stringify(runtimeConfig, null, 2)}\n`,
  { mode: 0o600 },
);
