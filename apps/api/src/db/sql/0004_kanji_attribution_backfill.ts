import type { Database } from 'better-sqlite3';

import {
  computeKanjiAttributionRows,
  fetchStudyItemKanji,
  insertKanjiAttributionRows
} from '../../attribution.js';

const BACKFILL_FLAG_KEY = 'attribution_backfill_complete';

function isBackfillComplete(db: Database): boolean {
  const row = db
    .prepare(`SELECT value_json FROM app_config WHERE key = ?`)
    .get(BACKFILL_FLAG_KEY) as { value_json: string } | undefined;
  if (!row) {
    return false;
  }
  try {
    return JSON.parse(row.value_json) === true;
  } catch {
    return false;
  }
}

function markBackfillComplete(db: Database, now: string): void {
  db.prepare(
    `INSERT INTO app_config (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(BACKFILL_FLAG_KEY, JSON.stringify(true), now);
}

export function run(db: Database): void {
  if (isBackfillComplete(db)) {
    return;
  }

  const assignments = db
    .prepare(
      `
      SELECT
        da.id,
        da.time_spent_ms,
        da.study_item_id,
        si.surface_form,
        si.selected_reading
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      WHERE da.status = 'completed'
        AND da.time_spent_ms IS NOT NULL
      `
    )
    .all() as Array<{
    id: number;
    time_spent_ms: number;
    study_item_id: number;
    surface_form: string;
    selected_reading: string;
  }>;

  const now = new Date().toISOString();

  const backfill = db.transaction(() => {
    for (const assignment of assignments) {
      const kanji = fetchStudyItemKanji(db, assignment.study_item_id);
      const rows = computeKanjiAttributionRows(
        assignment.id,
        assignment.surface_form,
        assignment.selected_reading,
        assignment.time_spent_ms,
        kanji
      );
      insertKanjiAttributionRows(db, rows);
    }
  });

  backfill();
  markBackfillComplete(db, now);
}
