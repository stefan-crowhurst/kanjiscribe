import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sqlite } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, './sql');

const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
  sqlite.exec(sql);
  console.log(`Applied migration ${file}`);
}

console.log('Migrations complete.');
