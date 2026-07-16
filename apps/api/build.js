#!/usr/bin/env node
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

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

// Copy SQL migration files and bundle TypeScript migration files.
const sqlSrcDir = 'src/db/sql';
const sqlOutDir = 'dist/db/sql';
fs.mkdirSync(sqlOutDir, { recursive: true });

const migrationFiles = fs.readdirSync(sqlSrcDir);
const tsMigrations = migrationFiles.filter((file) => file.endsWith('.ts'));
const sqlMigrations = migrationFiles.filter((file) => file.endsWith('.sql'));

for (const file of sqlMigrations) {
  fs.copyFileSync(path.join(sqlSrcDir, file), path.join(sqlOutDir, file));
}

for (const file of tsMigrations) {
  const outFile = file.replace(/\.ts$/, '.js');
  await build({
    entryPoints: [path.join(sqlSrcDir, file)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: path.join(sqlOutDir, outFile),
    external: ['better-sqlite3']
  });
}

console.log('API bundle complete: dist/server.js');
