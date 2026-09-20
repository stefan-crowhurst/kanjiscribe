import type { Database } from 'better-sqlite3';

import { ensureColumn } from '@kanjiscribe/shared';

const COLUMN = 'estimated_ms';
const TABLE = 'daily_assignment';

/**
 * Adds the nullable `estimated_ms` column to `daily_assignment`.
 *
 * The column holds the **estimate snapshot** for each assignment (see
 * `CONTEXT.md`): milliseconds rounded to an integer, written once at
 * assignment creation by `POST /study-items/intake` and never recomputed by
 * any status transition. All pre-existing rows keep `NULL` — there is no
 * backfill of any kind (per the estimate-performance-delta PRD).
 *
 * Implemented in TypeScript (rather than SQL) so it is idempotent across
 * repeated boot-time migration runs: SQLite's `ALTER TABLE ... ADD COLUMN`
 * lacks an `IF NOT EXISTS` clause.
 */
export function run(db: Database): void {
  ensureColumn(db, TABLE, COLUMN, 'INTEGER');
}
