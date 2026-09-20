import type { Database } from 'better-sqlite3';

import { ensureEntryReadingRomajiSchema, toRomajiForm } from '@kanjiscribe/shared';

const TABLE = 'entry_reading';
const COLUMN = 'romaji';

/**
 * Adds the nullable `romaji` column and its index to `entry_reading` (the
 * schema part is shared with the importer) and backfills the column with each
 * reading's Romaji form (ADR 0011). Degenerate readings (bare ー, 〜,
 * iteration marks) stay NULL. The migration runner re-runs every file on
 * every boot, so both the schema change and the backfill are idempotent:
 * only rows whose `romaji` is still NULL are considered each run, so a
 * degenerate reading is re-selected and recomputed to NULL, but no stored
 * value ever changes.
 */
export function run(db: Database): void {
  ensureEntryReadingRomajiSchema(db);

  const readings = db
    .prepare(`SELECT DISTINCT text FROM ${TABLE} WHERE ${COLUMN} IS NULL`)
    .all() as Array<{ text: string }>;

  if (readings.length === 0) {
    return;
  }

  const update = db.prepare(
    `UPDATE ${TABLE} SET ${COLUMN} = ? WHERE text = ? AND ${COLUMN} IS NULL`
  );

  const backfill = db.transaction(() => {
    for (const { text } of readings) {
      const romaji = toRomajiForm(text);
      if (romaji !== null) {
        update.run(romaji, text);
      }
    }
  });

  backfill();
}
