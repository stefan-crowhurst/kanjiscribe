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

type EstimateResponse = {
  estimated_remaining_ms: number;
};

function parseEstimate(body: string): EstimateResponse {
  return JSON.parse(body) as EstimateResponse;
}

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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

describe('GET /estimates/backlog-days', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 0 when there are no overdue assignments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('sums strictly past overdue assignments and excludes today', async () => {
    const studyItem = seedStudyItem();

    seedAssignment({ study_item_id: studyItem, assigned_for_date: todayIso(), status: 'pending' });
    seedAssignment({ study_item_id: studyItem, assigned_for_date: daysAgoIso(1), status: 'pending' });

    // Drill the word once so the past pending row has a Level-0 estimate.
    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: daysAgoIso(2),
      status: 'completed',
      time_spent_ms: 15000
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(15000);
  });

  it('excludes completed assignments from the backlog sum', async () => {
    const studyItem = seedStudyItem();

    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: daysAgoIso(1),
      status: 'completed',
      time_spent_ms: 15000
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('aggregates estimates across multiple past days', async () => {
    const studyItemA = seedStudyItem(sqlite, 1);
    const studyItemB = seedStudyItem(sqlite, 2);

    // Drill each word once so past pending rows have Level-0 estimates.
    seedAssignment({
      study_item_id: studyItemA,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 10000
    });
    seedAssignment({
      study_item_id: studyItemB,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 20000
    });

    seedAssignment({
      study_item_id: studyItemA,
      assigned_for_date: daysAgoIso(2),
      status: 'pending'
    });
    seedAssignment({
      study_item_id: studyItemB,
      assigned_for_date: daysAgoIso(1),
      status: 'skipped'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(30000);
  });

  it('uses Level-1 per-kanji timing for past never-drilled words', async () => {
    seedKanji('山', 3);

    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '山' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 12000
    });
    seedAttributionRow(drilledAssignment.id, '山', 3, 10, 10000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(12000);
  });

  it('uses Level-2 stroke-count bucket for past never-drilled words', async () => {
    seedKanji('山', 3);
    seedKanji('川', 3);

    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '川', selected_reading: 'かわ' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '川' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 14000
    });
    seedAttributionRow(drilledAssignment.id, '川', 3, 10, 12000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(14000);
  });

  it('uses Level-3 global per-stroke slope for past never-drilled words', async () => {
    seedKanji('山', 3);
    seedKanji('高', 10);

    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '高', selected_reading: 'たか' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '高' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 22000
    });
    seedAttributionRow(drilledAssignment.id, '高', 10, 10, 20000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(8000);
  });

  it('uses Level-4 per-stroke floor for past never-drilled words when no completions exist', async () => {
    seedKanji('山', 3);

    const undrilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    // Level-4 floor: 10 kanji writes at (600 ms/stroke * 3 strokes) + 2 reading-writing
    // kana writes + 10s per-card padding (no completions anywhere).
    expect(body.estimated_remaining_ms).toBe(30000);
  });

  it('sets no HTTP cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-days'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
  });
});

describe('GET /estimates/backlog-day', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 0 for a date with no remaining assignments', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('returns the estimate for a single days remaining assignments', async () => {
    const studyItem = seedStudyItem();

    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: daysAgoIso(2),
      status: 'completed',
      time_spent_ms: 15000
    });
    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(15000);
  });

  it('only counts assignments on the requested date', async () => {
    const studyItemA = seedStudyItem(sqlite, 1);
    const studyItemB = seedStudyItem(sqlite, 2);

    seedAssignment({
      study_item_id: studyItemA,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 10000
    });
    seedAssignment({
      study_item_id: studyItemB,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 20000
    });

    seedAssignment({
      study_item_id: studyItemA,
      assigned_for_date: daysAgoIso(2),
      status: 'pending'
    });
    seedAssignment({
      study_item_id: studyItemB,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(2)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(10000);
  });

  it('uses Level-0 estimate for a previously-drilled word on that day', async () => {
    const studyItem = seedStudyItem();

    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: daysAgoIso(2),
      status: 'completed',
      time_spent_ms: 15000
    });
    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(15000);
  });

  it('uses Level-1 per-kanji timing for a never-drilled word on that day', async () => {
    seedKanji('山', 3);

    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '山' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 12000
    });
    seedAttributionRow(drilledAssignment.id, '山', 3, 10, 10000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(12000);
  });

  it('uses Level-2 stroke-count bucket for a never-drilled word on that day', async () => {
    seedKanji('山', 3);
    seedKanji('川', 3);

    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '川', selected_reading: 'かわ' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '川' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 14000
    });
    seedAttributionRow(drilledAssignment.id, '川', 3, 10, 12000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(14000);
  });

  it('uses Level-3 global per-stroke slope for a never-drilled word on that day', async () => {
    seedKanji('山', 3);
    seedKanji('高', 10);

    const drilledItem = seedStudyItem(sqlite, 1, { surface_form: '高', selected_reading: 'たか' });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '高' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: daysAgoIso(3),
      status: 'completed',
      time_spent_ms: 22000
    });
    seedAttributionRow(drilledAssignment.id, '高', 10, 10, 20000);

    const undrilledItem = seedStudyItem(sqlite, 2, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(8000);
  });

  it('uses Level-4 per-stroke floor for a never-drilled word on that day when no completions exist', async () => {
    seedKanji('山', 3);

    const undrilledItem = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(undrilledItem, [{ position: 0, literal: '山' }]);
    seedAssignment({
      study_item_id: undrilledItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    // Level-4 floor: 10 kanji writes at (600 ms/stroke * 3 strokes) + 2 reading-writing
    // kana writes + 10s per-card padding (no completions anywhere).
    expect(body.estimated_remaining_ms).toBe(30000);
  });

  it('returns 400 for an invalid date parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-day?date=not-a-date'
    });

    expect(res.statusCode).toBe(400);
  });

  it('sets no HTTP cache headers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
  });
});
