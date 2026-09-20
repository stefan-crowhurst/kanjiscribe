import type { Database } from 'better-sqlite3';

import { ensureColumn } from '@kanjiscribe/shared';

const COLUMN = 'queue_position';
const TABLE = 'daily_assignment';

/**
 * Adds the nullable `queue_position` column to `daily_assignment`.
 *
 * The column stores the per-day position for a user's Day's queue. Existing
 * assignments keep `NULL`, preserving their `created_at` fallback order until
 * the day is actively reordered.
 */
export function run(db: Database): void {
  ensureColumn(db, TABLE, COLUMN, 'INTEGER');
}
