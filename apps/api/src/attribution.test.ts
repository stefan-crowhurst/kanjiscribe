import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { sqlite } from './test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedKanji,
  seedStudyItem,
  seedStudyItemKanji
} from './test-helpers.js';

type AttributionRow = {
  assignment_id: number;
  kanji_literal: string;
  stroke_count: number;
  writes_count: number;
  attributed_time_ms: number;
};

function getAttributionRows(assignmentId: number): AttributionRow[] {
  return sqlite
    .prepare(
      `SELECT assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms
       FROM kanji_attribution
       WHERE assignment_id = ?
       ORDER BY kanji_literal ASC`
    )
    .all(assignmentId) as AttributionRow[];
}

function getAllAttributionRows(): AttributionRow[] {
  return sqlite
    .prepare(
      `SELECT assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms
       FROM kanji_attribution
       ORDER BY kanji_literal ASC`
    )
    .all() as AttributionRow[];
}

describe('Attribution write path', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('completing a multi-kanji word inserts rows whose attributed times sum to the kanji pool', async () => {
    seedKanji('山', 3);
    seedKanji('田', 5);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山田',
      selected_reading: 'やまだ'
    });
    seedStudyItemKanji(studyItemId, [
      { position: 0, literal: '山' },
      { position: 1, literal: '田' }
    ]);

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const timeSpentMs = 12000;
    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: { time_spent_ms: timeSpentMs }
    });

    expect(res.statusCode).toBe(200);

    const rows = getAttributionRows(assignment.id);
    expect(rows).toHaveLength(2);

    const yama = rows.find((r) => r.kanji_literal === '山');
    const ta = rows.find((r) => r.kanji_literal === '田');

    expect(yama).toBeDefined();
    expect(ta).toBeDefined();

    // 山田: 2 cells -> N=5, remainder=0. Each kanji written 5 times.
    // kana_writes_total = 3 (reading やまだ), kana_time = 3000, kanji_pool = 9000.
    // stroke_weight_total = 5*3 + 5*5 = 40.
    expect(yama!.writes_count).toBe(5);
    expect(ta!.writes_count).toBe(5);
    expect(yama!.attributed_time_ms).toBeCloseTo((9000 * 15) / 40, 5);
    expect(ta!.attributed_time_ms).toBeCloseTo((9000 * 25) / 40, 5);
    expect(rows.reduce((sum, r) => sum + r.attributed_time_ms, 0)).toBeCloseTo(9000, 5);
  });

  it('completing a single-kanji word attributes 100% of the kanji pool to that kanji', async () => {
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const timeSpentMs = 12000;
    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: { time_spent_ms: timeSpentMs }
    });

    expect(res.statusCode).toBe(200);

    const rows = getAttributionRows(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kanji_literal).toBe('山');
    expect(rows[0]!.writes_count).toBe(10);
    // kana_time = 2 * 1000 = 2000, kanji_pool = 10000.
    expect(rows[0]!.attributed_time_ms).toBeCloseTo(10000, 5);
  });

  it('completing a kana-only word writes no attribution rows', async () => {
    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: 'ありがとう',
      selected_reading: 'ありがとう'
    });

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: { time_spent_ms: 30000 }
    });

    expect(res.statusCode).toBe(200);
    expect(getAttributionRows(assignment.id)).toHaveLength(0);
  });

  it('completing with a fast timing writes no attribution rows', async () => {
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    // kana_time = 2 * 1000 = 2000, so 1000 ms leaves no kanji pool.
    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: { time_spent_ms: 1000 }
    });

    expect(res.statusCode).toBe(200);
    expect(getAttributionRows(assignment.id)).toHaveLength(0);
  });

  it('skipping an assignment writes no attribution rows', async () => {
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/skip`,
      payload: { time_spent_ms: 30000 }
    });

    expect(res.statusCode).toBe(200);
    expect(getAttributionRows(assignment.id)).toHaveLength(0);
  });

  it('reopening a completed assignment deletes its attribution rows', async () => {
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: { time_spent_ms: 12000 }
    });
    expect(getAttributionRows(assignment.id)).toHaveLength(1);

    const reopenRes = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/reopen`
    });

    expect(reopenRes.statusCode).toBe(200);
    expect(getAttributionRows(assignment.id)).toHaveLength(0);
  });

  it('archive and unarchive do not touch kanji_attribution', async () => {
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    // Complete an assignment and leave its attribution rows in place.
    const completed = seedAssignment({ study_item_id: studyItemId, status: 'completed', time_spent_ms: 12000 });

    // Simulate the attribution rows having been written (the DB seed bypassed the handler).
    sqlite
      .prepare(
        `INSERT INTO kanji_attribution (assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(completed.id, '山', 3, 10, 10000);

    // Archive is rejected for completed assignments, so it cannot touch rows.
    const archiveRes = await app.inject({
      method: 'POST',
      url: `/assignments/${completed.id}/archive`
    });
    expect(archiveRes.statusCode).toBe(409);
    expect(getAttributionRows(completed.id)).toHaveLength(1);

    // Unarchive only applies to archived assignments, so it also cannot touch rows.
    const unarchiveRes = await app.inject({
      method: 'POST',
      url: `/assignments/${completed.id}/unarchive`
    });
    expect(unarchiveRes.statusCode).toBe(409);
    expect(getAttributionRows(completed.id)).toHaveLength(1);
  });

  it('kanji not linked via study_item_kanji are excluded from attribution', async () => {
    // Surface form contains 山 and 田, but only 山 is linked in study_item_kanji.
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山田',
      selected_reading: 'やまだ'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: { time_spent_ms: 12000 }
    });

    expect(res.statusCode).toBe(200);

    const rows = getAttributionRows(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kanji_literal).toBe('山');
  });
});

describe('Attribution rollup views', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('v_kanji_timing, v_stroke_count_bucket, and v_kanji_global_slope roll up seeded rows', () => {
    seedKanji('山', 3);
    seedKanji('川', 3);

    const studyItemA = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemA, [{ position: 0, literal: '山' }]);

    const studyItemB = seedStudyItem(sqlite, 2, {
      surface_form: '川',
      selected_reading: 'かわ'
    });
    seedStudyItemKanji(studyItemB, [{ position: 0, literal: '川' }]);

    const assignmentA = seedAssignment({
      study_item_id: studyItemA,
      status: 'completed',
      time_spent_ms: 12000
    });
    const assignmentB = seedAssignment({
      study_item_id: studyItemB,
      status: 'completed',
      time_spent_ms: 14000
    });

    // Seed attribution rows directly.
    // 山: 10 writes, attributed 10000 ms -> per-write = 1000 ms.
    // 川: 10 writes, attributed 12000 ms -> per-write = 1200 ms.
    sqlite
      .prepare(
        `INSERT INTO kanji_attribution (assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(assignmentA.id, '山', 3, 10, 10000);
    sqlite
      .prepare(
        `INSERT INTO kanji_attribution (assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(assignmentB.id, '川', 3, 10, 12000);

    const kanjiTiming = sqlite
      .prepare(`SELECT kanji_literal, mean_per_write_time_ms FROM v_kanji_timing ORDER BY kanji_literal ASC`)
      .all() as Array<{ kanji_literal: string; mean_per_write_time_ms: number }>;
    expect(kanjiTiming).toHaveLength(2);
    expect(kanjiTiming[0]!.kanji_literal).toBe('山');
    expect(kanjiTiming[0]!.mean_per_write_time_ms).toBeCloseTo(1000, 5);
    expect(kanjiTiming[1]!.kanji_literal).toBe('川');
    expect(kanjiTiming[1]!.mean_per_write_time_ms).toBeCloseTo(1200, 5);

    const strokeBucket = sqlite
      .prepare(`SELECT stroke_count, mean_per_write_time_ms FROM v_stroke_count_bucket`)
      .get() as { stroke_count: number; mean_per_write_time_ms: number };
    expect(strokeBucket.stroke_count).toBe(3);
    expect(strokeBucket.mean_per_write_time_ms).toBeCloseTo(1100, 5);

    const globalSlope = sqlite
      .prepare(`SELECT ms_per_stroke FROM v_kanji_global_slope`)
      .get() as { ms_per_stroke: number };
    // total attributed = 22000, total writes*stroke = 10*3 + 10*3 = 60.
    expect(globalSlope.ms_per_stroke).toBeCloseTo(22000 / 60, 5);
  });
});

describe('Attribution backfill migration', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('populates kanji_attribution for pre-existing completed assignments and is gated to run once', async () => {
    seedKanji('山', 3);

    const studyItemId = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);

    seedAssignment({
      study_item_id: studyItemId,
      status: 'completed',
      time_spent_ms: 12000
    });

    // At this point resetDb has removed any previously-applied backfill flag and
    // the kanji_attribution table is empty. Re-running migrations triggers the
    // backfill just like a first deploy.
    const { runMigrationsOnDb } = await import('./db/run-migrations.js');
    await runMigrationsOnDb(sqlite);

    const rows = getAllAttributionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kanji_literal).toBe('山');
    expect(rows[0]!.attributed_time_ms).toBeCloseTo(10000, 5);

    // Running migrations again should be a no-op (gated by app_config flag).
    const beforeSecondRun = getAllAttributionRows();
    await runMigrationsOnDb(sqlite);
    expect(getAllAttributionRows()).toEqual(beforeSecondRun);
  });
});
