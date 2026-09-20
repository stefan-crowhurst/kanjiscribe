import type { Database } from 'better-sqlite3';

import { ensureEntryReadingRomajiSchema, toRomajiForm } from '@kanjiscribe/shared';

const TABLE = 'entry_reading';
const COLUMN = 'romaji';

/**
 * Adds the nullable `romaji` column and index to `entry_reading` (schema shared
 * with the importer) and backfills each reading's Romaji form (ADR 0011);
 * degenerate readings (bare ー, 〜, iteration marks) stay NULL. Re-run every
 * boot, so only rows with `romaji` IS NULL are touched — idempotent, and no
 * stored value ever changes.
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
