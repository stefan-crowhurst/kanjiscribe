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
 * Ensures the importer's tables and the romaji schema: 0001 is CREATE TABLE IF
 * NOT EXISTS, so a pre-feature database keeps its old `entry_reading` shape
 * and the shared helper must add the romaji column before inserts can write
 * it. Backfilling stays the boot migration's job — the importer only writes
 * romaji on readings it inserts.
 */
export function ensureSchema(db: Database, initialSchemaPath: string): void {
  if (!fs.existsSync(initialSchemaPath)) {
    throw new Error(`Migration file missing: ${initialSchemaPath}`);
  }

  // 0001's CREATE INDEX for idx_entry_reading_romaji needs the romaji column,
  // so run the ensure before the schema on pre-feature databases. A fresh
  // database has no table yet, so the schema creates it with romaji in place.
  if (entryReadingTableExists(db)) {
    ensureEntryReadingRomajiSchema(db);
  }

  db.exec(fs.readFileSync(initialSchemaPath, 'utf8'));
  ensureEntryReadingRomajiSchema(db);
}
