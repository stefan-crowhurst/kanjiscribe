import type { Database } from 'better-sqlite3';

const COLUMN = 'queue_position';
const TABLE = 'daily_assignment';

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  return rows.some((row) => row.name === column);
}

/**
 * Adds the nullable `queue_position` column to `daily_assignment`.
 *
 * The column stores the per-day position for a user's Day's queue. Existing
 * assignments keep `NULL`, preserving their `created_at` fallback order until
 * the day is actively reordered.
 */
export function run(db: Database): void {
  if (hasColumn(db, TABLE, COLUMN)) {
    return;
  }

  db.exec(`ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} INTEGER;`);
}
