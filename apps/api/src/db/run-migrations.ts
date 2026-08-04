import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Database } from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, './sql');

export async function runMigrationsOnDb(db: Database, log = false): Promise<void> {
  if (!fs.existsSync(migrationsDir)) {
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') || file.endsWith('.ts') || file.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);

    if (file.endsWith('.sql')) {
      const sql = fs.readFileSync(filePath, 'utf-8');
      db.exec(sql);
    } else {
      const module_ = (await import(pathToFileURL(filePath).href)) as {
        run?: (db: Database) => void | Promise<void>;
      };
      if (typeof module_.run === 'function') {
        await module_.run(db);
      }
    }

    if (log) {
      console.log(`Applied migration ${file}`);
    }
  }
}
