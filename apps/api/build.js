#!/usr/bin/env node
import { build } from 'esbuild';
import fs from 'node:fs';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.js',
  external: ['better-sqlite3'],
  banner: {
    js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);'
  }
});

// Copy SQL migration files
fs.cpSync('src/db/sql', 'dist/db/sql', { recursive: true });

console.log('API bundle complete: dist/server.js');
