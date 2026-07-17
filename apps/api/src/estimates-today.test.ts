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

function seedAttributionRow(
  assignmentId: number,
  kanjiLiteral: string,
  strokeCount: number,
  writesCount: number,
  attributedTimeMs: number
): void {
  sqlite
    .prepare(
      `INSERT INTO kanji_attribution (assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(assignmentId, kanjiLiteral, strokeCount, writesCount, attributedTimeMs);
}

describe('GET /estimates/today', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 0 when today has no assignments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('sums avg_completion_time_ms for previously-drilled pending words', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const studyItemA = seedStudyItem();
    const studyItemB = seedStudyItem();

    // Drill both words on a previous day so they have recorded averages.
    seedAssignment({
      study_item_id: studyItemA,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 20000
    });
    seedAssignment({
      study_item_id: studyItemB,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 40000
    });

    // Add both words to today as pending.
    seedAssignment({ study_item_id: studyItemA, assigned_for_date: today, status: 'pending' });
    seedAssignment({ study_item_id: studyItemB, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(60000);
  });

  it('uses Level-1 per-kanji timing when the kanji has been drilled in another word', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('山', 3);

    // Drill a different word containing 山 to populate v_kanji_timing.
    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '山' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 12000
    });
    // 山 written 10 times with a kanji pool of 10000 ms -> 1000 ms per write.
    seedAttributionRow(drilledAssignment.id, '山', 3, 10, 10000);

    // A new, never-drilled study item that shares the same kanji.
    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 10 kanji writes at 1000 ms/write + 2 reading-writing kana writes at 1000 ms/write.
    expect(body.estimated_remaining_ms).toBe(12000);
  });

  it('uses Level-2 stroke-count bucket when the kanji is not drilled but a sibling stroke count is', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('山', 3);
    seedKanji('川', 3);

    // Drill 川 so the stroke_count=3 bucket gets a mean per-write time.
    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '川', selected_reading: 'かわ' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '川' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 14000
    });
    // 川 written 10 times with a kanji pool of 12000 ms -> 1200 ms per write.
    seedAttributionRow(drilledAssignment.id, '川', 3, 10, 12000);

    // 山 shares stroke_count=3 but is not itself in v_kanji_timing.
    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 10 kanji writes at 1200 ms/write + 2 reading-writing kana writes.
    expect(body.estimated_remaining_ms).toBe(14000);
  });

  it('uses Level-3 global per-stroke slope when only a different stroke count has been drilled', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('山', 3);
    seedKanji('高', 10);

    // Drill 高 (10 strokes) so a global slope exists, but no stroke_count=3 bucket.
    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '高', selected_reading: 'たか' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '高' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 22000
    });
    // 高 written 10 times with a kanji pool of 20000 ms -> ms_per_stroke = 20000 / 100 = 200.
    seedAttributionRow(drilledAssignment.id, '高', 10, 10, 20000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 10 kanji writes at (200 ms/stroke * 3 strokes) + 2 reading-writing kana writes.
    expect(body.estimated_remaining_ms).toBe(8000);
  });

  it('uses Level-4 per-stroke floor when no kanji have been drilled anywhere', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('山', 3);

    const undrilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 10 kanji writes at (500 ms/stroke * 3 strokes) + 2 reading-writing kana writes.
    expect(body.estimated_remaining_ms).toBe(17000);
  });

  it('uses Level-1 per-write times for remainder-cell tie-breaking in multi-kanji words', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('高', 10);
    seedKanji('山', 3);

    // Drill 高 and 山 in separate words to populate v_kanji_timing.
    const drilledTall = seedStudyItem(sqlite, 1, { surface_form: '高', selected_reading: 'たか' });
    seedStudyItemKanji(drilledTall, [{ position: 0, literal: '高' }]);
    const assignmentTall = seedAssignment({
      study_item_id: drilledTall,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 12000
    });
    // 高 written 10 times with kanji pool 10000 ms -> 1000 ms per write.
    seedAttributionRow(assignmentTall.id, '高', 10, 10, 10000);

    const drilledMountain = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(drilledMountain, [{ position: 0, literal: '山' }]);
    const assignmentMountain = seedAssignment({
      study_item_id: drilledMountain,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 22000
    });
    // 山 written 10 times with kanji pool 20000 ms -> 2000 ms per write.
    seedAttributionRow(assignmentMountain.id, '山', 3, 10, 20000);

    // 高い山: 2 kanji + 1 kana -> cell_cost=3 -> N=3, remainder=1.
    // 山 has the longer known per-write time, so it should receive the remainder cell.
    const undrilledItem = seedStudyItem(sqlite, 3, {
      surface_form: '高い山',
      selected_reading: 'たかいやま'
    });
    seedStudyItemKanji(undrilledItem, [
      { position: 0, literal: '高' },
      { position: 2, literal: '山' }
    ]);
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 高: 3 writes * 1000 ms/write = 3000
    // 山: 4 writes * 2000 ms/write = 8000
    // Kana: surface い (3 writes) + reading たかいやま (5) = 8 kana writes * 1000 = 8000
    expect(body.estimated_remaining_ms).toBe(19000);
  });

  it('picks the fallback level independently for each kanji in a multi-kanji word', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('山', 3);
    seedKanji('田', 5);

    // Drill 山 to give it Level-1 data and create a global slope.
    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '山' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 12000
    });
    seedAttributionRow(drilledAssignment.id, '山', 3, 10, 10000);

    // 山田 has never been drilled; 山 should use Level-1, 田 should use Level-3.
    const undrilledItem = seedStudyItem(sqlite, 2, {
      surface_form: '山田',
      selected_reading: 'やまだ'
    });
    seedStudyItemKanji(undrilledItem, [
      { position: 0, literal: '山' },
      { position: 1, literal: '田' }
    ]);
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 2 cells -> N=5, remainder=0; each kanji written 5 times.
    // 山 Level-1: 5 * 1000 = 5000.
    // 田 Level-3: global slope = 10000 / (10 * 3) = 1000/3 ms/stroke.
    //   5 writes * (1000/3 * 5 strokes) = 25000/3 ≈ 8333.33.
    // Reading-writing: 3 kana writes * 1000 = 3000.
    expect(body.estimated_remaining_ms).toBeCloseTo(5000 + 25000 / 3 + 3000, 5);
  });

  it('estimates kana-only never-drilled words using kana writes total', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const undrilledItem = seedStudyItem(sqlite, 1, {
      surface_form: 'ありがとう',
      selected_reading: 'ありがとう'
    });
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 5 kana -> 3 cells -> N=3, remainder=1 cell -> 17 surface kana writes + 5 reading-writing.
    expect(body.estimated_remaining_ms).toBe(22000);
  });

  it('sums fallback estimates for multiple never-drilled pending words', async () => {
    const today = new Date().toISOString().slice(0, 10);
    seedKanji('山', 3);

    const kanjiItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(kanjiItem, [{ position: 0, literal: '山' }]);
    seedAssignment({ study_item_id: kanjiItem, assigned_for_date: today, status: 'pending' });

    const kanaItem = seedStudyItem(sqlite, 2, {
      surface_form: 'ありがとう',
      selected_reading: 'ありがとう'
    });
    seedAssignment({ study_item_id: kanaItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // Level-4 floor for 山: 10 * (500 * 3) + 2 * 1000 = 17000.
    // Kana-only: 22 * 1000 = 22000.
    expect(body.estimated_remaining_ms).toBe(39000);
  });

  it('adds actual time_spent_ms for completed assignments on today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const drilledItem = seedStudyItem();
    const completedTodayItem = seedStudyItem();

    // Previously drilled with a 30s average.
    seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 30000
    });
    // Today: one pending estimate (30s) plus one already completed in 20s.
    seedAssignment({ study_item_id: drilledItem, assigned_for_date: today, status: 'pending' });
    seedAssignment({
      study_item_id: completedTodayItem,
      assigned_for_date: today,
      status: 'completed',
      time_spent_ms: 20000
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(50000);
  });

  it('excludes archived assignments from the sum', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const studyItem = seedStudyItem();

    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 30000
    });
    seedAssignment({ study_item_id: studyItem, assigned_for_date: today, status: 'archived' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('includes skipped assignments as remaining items using level-0 estimates', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const studyItem = seedStudyItem();

    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 25000
    });
    seedAssignment({ study_item_id: studyItem, assigned_for_date: today, status: 'skipped' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(25000);
  });

  it('sets no HTTP cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
  });
});
