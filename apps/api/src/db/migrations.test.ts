import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { sqlite } from './client.js';
import { runMigrationsOnDb } from './run-migrations.js';
import { run as runQueuePositionMigration } from './sql/0007_queue_position.js';

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

    const columns = db.prepare('PRAGMA table_info(daily_assignment)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toContain('queue_position');
    expect(
      db.prepare('SELECT queue_position FROM daily_assignment WHERE id = 1').get()
    ).toEqual({ queue_position: null });

    db.close();
  });
});
