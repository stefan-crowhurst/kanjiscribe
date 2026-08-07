import { describe, expect, it } from 'vitest';

import { sqlite } from './client.js';
import { runMigrationsOnDb } from './run-migrations.js';

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
});
