import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sqlite } from './client.js';
import { findMigrationsDir, runMigrationsOnDb } from './run-migrations.js';
import { run as runQueuePositionMigration } from './sql/0007_queue_position.js';
import { run as runRomajiMigration } from './sql/0008_entry_reading_romaji.js';

function viewExists(name: string): boolean {
  return (
    sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'view' AND name = ?`).get(name) !==
    undefined
  );
}

function tableExists(name: string): boolean {
  return (
    sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
    undefined
  );
}

describe('migrations', () => {
  it('never creates v_backlog_summary on a fresh database', () => {
    expect(viewExists('v_backlog_summary')).toBe(false);
  });

  it('drops a pre-existing v_backlog_summary on boot and keeps the rest intact', async () => {
    // Simulate a database created before the view was retired.
    sqlite.exec('DROP VIEW IF EXISTS v_backlog_summary;');
    sqlite.exec('CREATE VIEW v_backlog_summary AS SELECT 1 AS marker;');
    expect(viewExists('v_backlog_summary')).toBe(true);

    await runMigrationsOnDb(sqlite);

    expect(viewExists('v_backlog_summary')).toBe(false);

    // Kept tables and views survive the boot migration run untouched.
    for (const table of ['study_session', 'study_event', 'app_config', 'importer_run']) {
      expect(tableExists(table)).toBe(true);
    }
    for (const view of [
      'v_day_summary',
      'v_study_item_stats',
      'v_kanji_stats',
      'v_kanji_timing',
      'v_stroke_count_bucket',
      'v_kanji_global_slope'
    ]) {
      expect(viewExists(view)).toBe(true);
    }
  });

  it('adds queue_position idempotently without backfilling existing assignments', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE daily_assignment (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      INSERT INTO daily_assignment (id, created_at)
      VALUES (1, '2024-01-01T00:00:00.000Z');
    `);

    runQueuePositionMigration(db);
    runQueuePositionMigration(db);

    const columns = db.prepare('PRAGMA table_info(daily_assignment)').all() as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toContain('queue_position');
    expect(db.prepare('SELECT queue_position FROM daily_assignment WHERE id = 1').get()).toEqual({
      queue_position: null
    });

    db.close();
  });

  it('boots on a pre-feature database: initial schema skipped, romaji ensured by migration 0008', async () => {
    const db = new Database(':memory:');
    // A pre-feature database is the initial schema without the romaji column
    // and its index (the committed 0001 at HEAD has neither).
    const migrationsDir = findMigrationsDir(import.meta.dirname)!;
    const preFeatureSchema = fs
      .readFileSync(path.join(migrationsDir, '0001_initial.sql'), 'utf8')
      .replace('  romaji TEXT,\n', '')
      .replace(
        'CREATE INDEX IF NOT EXISTS idx_entry_reading_romaji ON entry_reading(romaji);\n',
        ''
      );
    db.exec(preFeatureSchema);

    // Guard the fixture surgery: if 0001's formatting changes, the replaces
    // above silently no-op and this test stops exercising the pre-feature path.
    const preFeatureColumns = db
      .prepare('PRAGMA table_info(entry_reading)')
      .all() as Array<{ name: string }>;
    expect(preFeatureColumns.map((column) => column.name)).not.toContain('romaji');
    const preFeatureIndex = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_entry_reading_romaji'`
      )
      .get();
    expect(preFeatureIndex).toBeUndefined();
    db.exec(`
      INSERT INTO dictionary_entry (id, is_common, created_at, updated_at)
      VALUES (1, 0, '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
      INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji)
      VALUES (1, 'たべる', 1, 0);
    `);

    await runMigrationsOnDb(db);

    const columns = db.prepare('PRAGMA table_info(entry_reading)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('romaji');

    const index = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_entry_reading_romaji'`
      )
      .get();
    expect(index).toBeDefined();

    expect(db.prepare('SELECT romaji FROM entry_reading WHERE text = ?').get('たべる')).toEqual({
      romaji: 'taberu'
    });

    db.close();
  });

  it('adds romaji and its index idempotently, backfilling non-degenerate readings only', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE entry_reading (
        entry_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        is_primary INTEGER NOT NULL,
        no_kanji INTEGER NOT NULL,
        PRIMARY KEY (entry_id, text)
      );
      INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji)
      VALUES
        (1, 'たべる', 1, 0),
        (2, 'すゞ', 1, 0),
        (3, 'ー', 1, 0);
    `);

    runRomajiMigration(db);
    runRomajiMigration(db);

    const columns = db.prepare('PRAGMA table_info(entry_reading)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('romaji');

    const index = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_entry_reading_romaji'`
      )
      .get();
    expect(index).toBeDefined();

    const rows = db.prepare('SELECT text, romaji FROM entry_reading ORDER BY entry_id').all();
    expect(rows).toEqual([
      { text: 'たべる', romaji: 'taberu' },
      { text: 'すゞ', romaji: 'suzu' },
      { text: 'ー', romaji: null }
    ]);

    db.close();
  });
});

describe('findMigrationsDir', () => {
  function makeTempBase(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ks-migrations-'));
  }

  it('resolves the unbundled layout: module directory beside sql/', () => {
    const base = makeTempBase();
    try {
      fs.mkdirSync(path.join(base, 'sql'));
      expect(findMigrationsDir(base)).toBe(path.join(base, 'sql'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('resolves the bundled layout: server.js directory containing db/sql/', () => {
    // Regression: the esbuild bundle inlines run-migrations.ts into
    // dist/server.js, so the module directory is dist/ and the migrations
    // live at dist/db/sql/. The runner used to check only <dir>/sql,
    // silently skipping every boot migration in production.
    const base = makeTempBase();
    try {
      fs.mkdirSync(path.join(base, 'db', 'sql'), { recursive: true });
      expect(findMigrationsDir(base)).toBe(path.join(base, 'db', 'sql'));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns null when neither layout exists', () => {
    const base = makeTempBase();
    try {
      expect(findMigrationsDir(base)).toBeNull();
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
