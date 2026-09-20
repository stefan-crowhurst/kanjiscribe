import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Database } from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Candidate locations of the migration files, relative to this module's
 * directory. Two layouts exist by build design: the unbundled layout (tsx
 * dev server, migrate CLI, vitest) keeps this file beside `sql/` in
 * `src/db/`, while the production esbuild bundle inlines this module into
 * `dist/server.js`, whose directory holds the migrations under `db/sql/`
 * (see apps/api/build.js). Resolving both candidates explicitly is what
 * keeps the bundled runner from silently looking in the wrong place.
 */
export function migrationsDirCandidates(baseDir: string): string[] {
  return [path.resolve(baseDir, './sql'), path.resolve(baseDir, './db/sql')];
}

/** The first candidate that exists, or null when none do. */
export function findMigrationsDir(baseDir: string): string | null {
  return migrationsDirCandidates(baseDir).find((dir) => fs.existsSync(dir)) ?? null;
}

/** The initial schema is fresh-database-only; upgrades land in numbered migrations. */
const INITIAL_SCHEMA_FILE = '0001_initial.sql';

export async function runMigrationsOnDb(db: Database, log = false): Promise<void> {
  const migrationsDir = findMigrationsDir(__dirname);
  if (!migrationsDir) {
    // Fail loudly: a missing migrations directory means the deployment is
    // broken or mispackaged. Serving an unmigrated database surfaces later
    // as opaque "no such column" 500s, which is strictly worse than
    // refusing to boot.
    throw new Error(
      `Migrations directory not found (tried ${migrationsDirCandidates(__dirname).join(', ')}) — refusing to start on an unmigrated database`
    );
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') || file.endsWith('.ts') || file.endsWith('.js'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);

    if (file.endsWith('.sql')) {
      // Skip 0001 on non-fresh databases: its idx_entry_reading_romaji index
      // targets a column only 0008 adds. Its other statements are all
      // CREATE ... IF NOT EXISTS, already no-ops on an existing database.
      if (file === INITIAL_SCHEMA_FILE && !isFreshDatabase(db)) {
        continue;
      }
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

/** A fresh database has no tables yet; anything else is an existing install. */
function isFreshDatabase(db: Database): boolean {
  const row = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1`
    )
    .get();
  return row === undefined;
}
