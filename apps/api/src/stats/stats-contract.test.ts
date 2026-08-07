import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  dashboardResponseSchema,
  kanjiStatsResponseSchema,
  slowestWordsResponseSchema,
  studyItemStatsResponseSchema,
  topKanjiResponseSchema,
  topWordsResponseSchema
} from '@kanjiscribe/shared';

import { app } from '../server.js';
import { sqlite } from '../db/client.js';
import { resetCounters, resetDb, seedAssignment, seedKanji, seedStudyItem, seedStudyItemKanji } from '../test-helpers.js';

/**
 * Contract test (ADR-0006): the bytes each `/stats/*` route actually
 * serializes must parse through the shared response schema. The shared
 * schemas are the single source of truth — a route drifting from its schema
 * fails here, not in the browser.
 */
function parseWith<T extends z.ZodTypeAny>(schema: T, body: string): z.infer<T> {
  const parsed = schema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`Response rejected by shared schema: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  return parsed.data;
}

describe('stats response contract — api bytes parse through the shared schemas', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
    seedKanji('永', 5);
    seedKanji('日', 4);
  });

  /**
   * Item A: drilled twice (completed, snapshotted) on 2024-01-01 and
   * 2024-01-02. Item B: pending / skipped / archived rows spread over
   * 2024-01-02 and 2024-01-03.
   */
  function seedStatsData(): { itemA: number; itemB: number } {
    const itemA = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    const itemB = seedStudyItem(sqlite, 2, { surface_form: '明日', selected_reading: 'あした' });
    seedStudyItemKanji(itemA, [{ position: 0, literal: '永' }]);
    seedStudyItemKanji(itemB, [
      { position: 0, literal: '永' },
      { position: 1, literal: '日' }
    ]);
    seedAssignment({
      study_item_id: itemA,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 30000,
      estimated_ms: 20000
    });
    seedAssignment({
      study_item_id: itemA,
      assigned_for_date: '2024-01-02',
      status: 'completed',
      time_spent_ms: 25000,
      estimated_ms: 20000
    });
    seedAssignment({
      study_item_id: itemB,
      assigned_for_date: '2024-01-02',
      status: 'pending',
      estimated_ms: 15000
    });
    seedAssignment({
      study_item_id: itemB,
      assigned_for_date: '2024-01-03',
      status: 'skipped',
      time_spent_ms: 2000,
      estimated_ms: 15000
    });
    seedAssignment({ study_item_id: itemB, assigned_for_date: '2024-01-03', status: 'archived' });
    return { itemA, itemB };
  }

  it('dashboard response carries the superset heatmap day (all count/time fields plus verdict and estimate)', async () => {
    seedStatsData();

    const res = await app.inject({
      method: 'GET',
      url: '/stats/dashboard?from=2024-01-01&to=2024-01-05'
    });
    expect(res.statusCode).toBe(200);

    const dashboard = parseWith(dashboardResponseSchema, res.body);
    // 2024-01-01: one completed snapshotted word → fully completed, verdict +10000, estimate 20000.
    const firstDay = dashboard.heatmap.find((d) => d.date === '2024-01-01');
    expect(firstDay).toBeDefined();
    expect(firstDay!.total_assignments).toBe(1);
    expect(firstDay!.completed_count).toBe(1);
    expect(firstDay!.pending_count).toBe(0);
    expect(firstDay!.skipped_count).toBe(0);
    expect(firstDay!.total_time_ms).toBe(30000);
    expect(firstDay!.is_fully_completed).toBe(true);
    expect(firstDay!.estimate_delta_ms).toBe(10000);
    expect(firstDay!.estimated_total_ms).toBe(20000);

    // 2024-01-02: completed + pending → verdict gated to null, estimate covers the whole set.
    const secondDay = dashboard.heatmap.find((d) => d.date === '2024-01-02');
    expect(secondDay).toBeDefined();
    expect(secondDay!.is_fully_completed).toBe(false);
    expect(secondDay!.estimate_delta_ms).toBeNull();
    expect(secondDay!.estimated_total_ms).toBe(35000);

    // 2024-01-03: skipped + archived → the archived row drops out of the day.
    const thirdDay = dashboard.heatmap.find((d) => d.date === '2024-01-03');
    expect(thirdDay).toBeDefined();
    expect(thirdDay!.total_assignments).toBe(1);
    expect(thirdDay!.skipped_count).toBe(1);
    expect(thirdDay!.estimated_total_ms).toBe(15000);

    expect(dashboard.heatmap).toHaveLength(3);
    expect(dashboard.today.total).toBe(0);
    expect(dashboard.overdue.total_pending).toBe(2);
    expect(dashboard.overdue.oldest_date).toBe('2024-01-02');
    expect(dashboard.overdue.incomplete_days).toBe(2);
    expect(dashboard.totals.total_time_ms).toBe(57000);
    expect(dashboard.totals.total_completed).toBe(2);
    expect(dashboard.totals.avg_time_per_assignment_ms).toBe(27500);
  });

  it('study-item stats response parses and reflects the seeded assignments', async () => {
    const { itemA } = seedStatsData();

    const res = await app.inject({
      method: 'GET',
      url: `/stats/study-items/${itemA}`
    });
    expect(res.statusCode).toBe(200);

    const stats = parseWith(studyItemStatsResponseSchema, res.body);
    expect(stats.study_item.surface_form).toBe('山');
    expect(stats.stats.total_assignments).toBe(2);
    expect(stats.stats.times_completed).toBe(2);
    expect(stats.stats.total_time_ms).toBe(55000);
    expect(stats.stats.avg_completion_time_ms).toBe(27500);
    expect(stats.stats.first_assigned).toBe('2024-01-01');
    expect(stats.stats.last_assigned).toBe('2024-01-02');
    expect(stats.recent_assignments).toHaveLength(2);
    expect(stats.recent_assignments.every((a) => a.status === 'completed')).toBe(true);
  });

  it('kanji stats response parses and rolls up both containing study items', async () => {
    seedStatsData();

    const res = await app.inject({
      method: 'GET',
      url: `/stats/kanji/${encodeURIComponent('永')}`
    });
    expect(res.statusCode).toBe(200);

    const stats = parseWith(kanjiStatsResponseSchema, res.body);
    expect(stats.kanji.literal).toBe('永');
    expect(stats.kanji.stroke_count).toBe(5);
    expect(stats.stats.word_count).toBe(2);
    // 2 assignments on item A + 3 on item B (pending, skipped, archived).
    expect(stats.stats.total_assignments).toBe(5);
    expect(stats.stats.times_drilled).toBe(2);
    expect(stats.study_items).toHaveLength(2);
  });

  it('top-words and slowest-words responses parse and rank item A first', async () => {
    const { itemA } = seedStatsData();

    const topRes = await app.inject({ method: 'GET', url: '/stats/top-words' });
    expect(topRes.statusCode).toBe(200);
    const top = parseWith(topWordsResponseSchema, topRes.body);
    expect(top.words[0]).toMatchObject({ study_item_id: itemA, times_completed: 2 });
    expect(top.words).toHaveLength(1);

    const slowestRes = await app.inject({ method: 'GET', url: '/stats/slowest-words' });
    expect(slowestRes.statusCode).toBe(200);
    const slowest = parseWith(slowestWordsResponseSchema, slowestRes.body);
    expect(slowest.words[0]).toMatchObject({
      study_item_id: itemA,
      avg_completion_time_ms: 27500
    });
  });

  it('top-kanji response parses and ranks 永 by times drilled', async () => {
    seedStatsData();

    const res = await app.inject({ method: 'GET', url: '/stats/top-kanji' });
    expect(res.statusCode).toBe(200);

    const top = parseWith(topKanjiResponseSchema, res.body);
    expect(top.kanji[0]).toMatchObject({ literal: '永', word_count: 2, times_drilled: 2 });
  });
});
