import fs from 'node:fs';

import { ensureEntryReadingRomajiSchema } from '@kanjiscribe/shared';
import type { Database } from 'better-sqlite3';

function entryReadingTableExists(db: Database): boolean {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'entry_reading'`)
      .get() !== undefined
  );
}

/**
 * Ensures the importer's tables and the romaji schema exist. 0001 is CREATE
 * TABLE IF NOT EXISTS, so a pre-feature database keeps its original
 * entry_reading shape; the shared helper adds the romaji column and index so
 * the reading insert cannot fail with "no such column". Backfilling is the
 * boot migration's job (the importer only writes the column on readings it
 * inserts).
 */
export function ensureSchema(db: Database, initialSchemaPath: string): void {
  if (!fs.existsSync(initialSchemaPath)) {
    throw new Error(`Migration file missing: ${initialSchemaPath}`);
  }

  // 0001 creates idx_entry_reading_romaji on entry_reading(romaji), so on a
  // pre-feature database the ensure must run before the schema is applied —
  // the schema's CREATE INDEX would otherwise fail on the missing column. A
  // fresh database has no table yet, so the schema creates it with romaji
  // already in place.
  if (entryReadingTableExists(db)) {
    ensureEntryReadingRomajiSchema(db);
  }

  db.exec(fs.readFileSync(initialSchemaPath, 'utf8'));
  ensureEntryReadingRomajiSchema(db);
}
