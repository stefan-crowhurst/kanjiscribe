import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureSchema } from './schema.js';

// Mirrors the API's 0001_initial.sql; the importer's schema contract is this local copy.
const INITIAL_SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/initial-schema.sql'
);

const JMDICT_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<JMdict>
  <entry>
    <ent_seq>9000001</ent_seq>
    <r_ele><reb>たべる</reb></r_ele>
    <sense><gloss>to eat</gloss></sense>
  </entry>
  <entry>
    <ent_seq>9000002</ent_seq>
    <r_ele><reb>コーヒー</reb></r_ele>
    <r_ele><reb>ー</reb></r_ele>
    <sense><gloss>coffee</gloss></sense>
  </entry>
</JMdict>
`;

describe('importer schema-ensure on a pre-feature database', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanjiscribe-importer-'));
    dbPath = path.join(tempDir, 'kanjiscribe.db');
    process.env.KANJISCRIBE_DB_PATH = dbPath;

    // Pre-feature database: the schema before `entry_reading.romaji` existed
    // (no column or index), with a reading that has no romaji.
    const schema = fs
      .readFileSync(INITIAL_SCHEMA_PATH, 'utf8')
      .replace(/^\s*romaji TEXT,\n/m, '')
      .replace(/^CREATE INDEX IF NOT EXISTS idx_entry_reading_romaji [^\n]*\n/m, '');
    const preFeatureDb = new Database(dbPath);
    preFeatureDb.exec(schema);
    const columns = preFeatureDb.prepare('PRAGMA table_info(entry_reading)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).not.toContain('romaji');

    preFeatureDb
      .prepare(
        `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(9000001, 0, null, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
    preFeatureDb
      .prepare(
        `INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji) VALUES (?, ?, ?, ?)`
      )
      .run(9000001, 'たべる', 1, 0);
    preFeatureDb.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds the romaji schema to a pre-feature database and imports romaji', async () => {
    const fixturePath = path.join(tempDir, 'jmdict-fixture.xml');
    fs.writeFileSync(fixturePath, JMDICT_FIXTURE, 'utf8');

    const schemaDb = new Database(dbPath);
    ensureSchema(schemaDb, INITIAL_SCHEMA_PATH);
    ensureSchema(schemaDb, INITIAL_SCHEMA_PATH);
    schemaDb.close();

    // Schema-ensure fixes the shape only; the pre-existing reading's romaji is
    // backfilled later, when the import rewrites the entry's readings.
    const schemaOnlyDb = new Database(dbPath, { readonly: true });
    expect(
      schemaOnlyDb.prepare(`SELECT romaji FROM entry_reading WHERE entry_id = 9000001`).get()
    ).toEqual({ romaji: null });
    schemaOnlyDb.close();

    // The importer opens its database at import time, so the environment must
    // be set first and the module imported dynamically.
    const importer = await import('./index.js');
    await importer.importJmdict(fixturePath);

    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT entry_id, text, romaji FROM entry_reading
         WHERE entry_id IN (9000001, 9000002)
         ORDER BY entry_id, text`
      )
      .all();
    const index = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_entry_reading_romaji'`
      )
      .get();
    db.close();

    expect(rows).toEqual([
      { entry_id: 9000001, text: 'たべる', romaji: 'taberu' },
      { entry_id: 9000002, text: 'コーヒー', romaji: 'koohii' },
      { entry_id: 9000002, text: 'ー', romaji: null }
    ]);
    expect(index).toBeDefined();
  });
});
