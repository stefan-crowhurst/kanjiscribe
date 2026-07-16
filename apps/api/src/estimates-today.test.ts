import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

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

  it('counts never-drilled pending words as 0 ms', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const drilledItem = seedStudyItem();
    const undrilledItem = seedStudyItem();

    seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 30000
    });
    seedAssignment({ study_item_id: drilledItem, assigned_for_date: today, status: 'pending' });
    seedAssignment({ study_item_id: undrilledItem, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(30000);
  });

  it('returns 0 when all pending words on today are never-drilled', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const studyItemA = seedStudyItem();
    const studyItemB = seedStudyItem();

    seedAssignment({ study_item_id: studyItemA, assigned_for_date: today, status: 'pending' });
    seedAssignment({ study_item_id: studyItemB, assigned_for_date: today, status: 'pending' });

    const res = await app.inject({
      method: 'GET',
      url: '/estimates/today'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(0);
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
