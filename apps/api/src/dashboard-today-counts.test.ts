import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

describe('GET /stats/dashboard today counts exclude archived assignments', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('counts pending, completed, and skipped but not archived in today.total', async () => {
    const studyItemId = seedStudyItem();
    const today = new Date().toISOString().slice(0, 10);
    seedAssignment({ study_item_id: studyItemId, status: 'pending', assigned_for_date: today });
    seedAssignment({ study_item_id: studyItemId, status: 'completed', assigned_for_date: today, time_spent_ms: 1000 });
    seedAssignment({ study_item_id: studyItemId, status: 'skipped', assigned_for_date: today });
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: today });

    const res = await app.inject({
      method: 'GET',
      url: `/stats/dashboard?from=${today}&to=${today}`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      today: { total: number; pending: number; completed: number };
    };
    // 3 non-archived rows (pending + completed + skipped), archived excluded.
    expect(body.today.total).toBe(3);
    expect(body.today.completed).toBe(1);
    // "pending" on the dashboard card means today's unfinished work
    // (pending + skipped) — matches the "incomplete" definition from grilling Q2.
    expect(body.today.pending).toBe(2);
  });

  it('today.pending counts only pending (not skipped) when no skipped rows exist', async () => {
    const studyItemId = seedStudyItem();
    const today = new Date().toISOString().slice(0, 10);
    seedAssignment({ study_item_id: studyItemId, status: 'pending', assigned_for_date: today });
    seedAssignment({ study_item_id: studyItemId, status: 'completed', assigned_for_date: today, time_spent_ms: 1000 });

    const res = await app.inject({
      method: 'GET',
      url: `/stats/dashboard?from=${today}&to=${today}`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { today: { pending: number } };
    expect(body.today.pending).toBe(1);
  });

  it('reports today.total=0 when all assignments for today are archived', async () => {
    const studyItemId = seedStudyItem();
    const today = new Date().toISOString().slice(0, 10);
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: today });
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: today });

    const res = await app.inject({
      method: 'GET',
      url: `/stats/dashboard?from=${today}&to=${today}`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { today: { total: number } };
    expect(body.today.total).toBe(0);
  });

  it('totals exclude archived assignments', async () => {
    const studyItemId = seedStudyItem();
    const today = new Date().toISOString().slice(0, 10);
    seedAssignment({ study_item_id: studyItemId, status: 'completed', assigned_for_date: today, time_spent_ms: 1000 });
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: today, time_spent_ms: 9999 });

    const res = await app.inject({
      method: 'GET',
      url: `/stats/dashboard?from=${today}&to=${today}`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      totals: { total_time_ms: number; total_completed: number };
    };
    expect(body.totals.total_time_ms).toBe(1000);
    expect(body.totals.total_completed).toBe(1);
  });
});