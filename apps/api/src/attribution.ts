import type { Database } from 'better-sqlite3';

import { computeCellWrites } from '@kanjiscribe/shared';

export const KANA_MS_PER_WRITE = 1000;

export type KanjiAttributionRow = {
  assignment_id: number;
  kanji_literal: string;
  stroke_count: number;
  writes_count: number;
  attributed_time_ms: number;
};

export type StudyItemKanji = {
  position: number;
  literal: string;
  stroke_count: number;
};

export function computeKanjiAttributionRows(
  assignmentId: number,
  surfaceForm: string,
  selectedReading: string,
  timeSpentMs: number,
  kanji: StudyItemKanji[]
): KanjiAttributionRow[] {
  const cellResult = computeCellWrites(
    surfaceForm,
    kanji.map((k) => ({ position: k.position, stroke_count: k.stroke_count })),
    selectedReading
  );

  const kanaTime = cellResult.kana_writes_total * KANA_MS_PER_WRITE;
  const kanjiPool = Math.max(0, timeSpentMs - kanaTime);

  if (kanjiPool === 0) {
    return [];
  }

  let strokeWeightTotal = 0;
  const kanjiWrites: Array<{ literal: string; stroke_count: number; writes_count: number }> = [];

  for (const k of kanji) {
    const writesCount = cellResult.per_char_writes.get(k.position) ?? 0;
    if (writesCount === 0) {
      continue;
    }
    strokeWeightTotal += writesCount * k.stroke_count;
    kanjiWrites.push({
      literal: k.literal,
      stroke_count: k.stroke_count,
      writes_count: writesCount
    });
  }

  if (strokeWeightTotal === 0) {
    return [];
  }

  return kanjiWrites.map((k) => ({
    assignment_id: assignmentId,
    kanji_literal: k.literal,
    stroke_count: k.stroke_count,
    writes_count: k.writes_count,
    attributed_time_ms: (kanjiPool * (k.writes_count * k.stroke_count)) / strokeWeightTotal
  }));
}

export function fetchStudyItemKanji(db: Database, studyItemId: number): StudyItemKanji[] {
  return db
    .prepare(
      `
      SELECT
        sik.position,
        k.literal,
        k.stroke_count
      FROM study_item_kanji sik
      JOIN kanji k ON k.literal = sik.kanji_literal
      WHERE sik.study_item_id = ?
      ORDER BY sik.position ASC
      `
    )
    .all(studyItemId) as StudyItemKanji[];
}

export function insertKanjiAttributionRows(db: Database, rows: KanjiAttributionRow[]): void {
  if (rows.length === 0) {
    return;
  }

  const insert = db.prepare(
    `
    INSERT INTO kanji_attribution (
      assignment_id,
      kanji_literal,
      stroke_count,
      writes_count,
      attributed_time_ms
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(assignment_id, kanji_literal) DO UPDATE SET
      stroke_count = excluded.stroke_count,
      writes_count = excluded.writes_count,
      attributed_time_ms = excluded.attributed_time_ms
    `
  );

  for (const row of rows) {
    insert.run(
      row.assignment_id,
      row.kanji_literal,
      row.stroke_count,
      row.writes_count,
      row.attributed_time_ms
    );
  }
}

export function deleteKanjiAttributionForAssignment(db: Database, assignmentId: number): void {
  db.prepare(`DELETE FROM kanji_attribution WHERE assignment_id = ?`).run(assignmentId);
}

export function writeKanjiAttributionForAssignment(
  db: Database,
  assignmentId: number,
  studyItemId: number,
  timeSpentMs: number
): void {
  const assignment = db
    .prepare(
      `
      SELECT
        si.surface_form,
        si.selected_reading
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      WHERE da.id = ?
      `
    )
    .get(assignmentId) as
    | {
        surface_form: string;
        selected_reading: string;
      }
    | undefined;

  if (!assignment) {
    return;
  }

  const kanji = fetchStudyItemKanji(db, studyItemId);
  const rows = computeKanjiAttributionRows(
    assignmentId,
    assignment.surface_form,
    assignment.selected_reading,
    timeSpentMs,
    kanji
  );
  insertKanjiAttributionRows(db, rows);
}
