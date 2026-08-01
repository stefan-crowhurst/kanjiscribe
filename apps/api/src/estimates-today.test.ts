import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { sqlite } from './test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedStudyItem
} from './test-helpers.js';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('GET /estimates/today', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 0 when today has no assignments', async () => {
    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('sums estimate snapshots of pending/skipped + actuals of completed on today', async () => {
    const today = todayIso();
    const pendingItem = seedStudyItem(sqlite, 1);
    const skippedItem = seedStudyItem(sqlite, 2);
    const completedItem = seedStudyItem(sqlite, 3);

    // Pending with a stored snapshot of 30s, skipped with 12s.
    seedAssignment({
      study_item_id: pendingItem,
      assigned_for_date: today,
      status: 'pending',
      estimated_ms: 30000
    });
    seedAssignment({
      study_item_id: skippedItem,
      assigned_for_date: today,
      status: 'skipped',
      estimated_ms: 12000
    });
    // Completed with 20s of recorded drilling time (snapshots are not used
    // for completed rows — actuals are).
    seedAssignment({
      study_item_id: completedItem,
      assigned_for_date: today,
      status: 'completed',
      time_spent_ms: 20000,
      estimated_ms: 99999
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    // 30000 (pending snapshot) + 12000 (skipped snapshot) + 20000 (completed actual).
    expect(body.estimated_remaining_ms).toBe(62000);
  });

  it('falls back to a live estimate for NULL-snapshot pending rows (legacy)', async () => {
    const today = todayIso();
    const legacyItem = seedStudyItem(sqlite, 1);

    // Legacy pending row: no snapshot. A SUM-of-snapshots-only read path
    // would report 0:00; the live Level-4 estimate must be returned instead.
    seedAssignment({
      study_item_id: legacyItem,
      assigned_for_date: today,
      status: 'pending'
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(33000);
  });

  it('excludes archived assignments from the sum', async () => {
    const today = todayIso();
    const studyItem = seedStudyItem(sqlite, 1);

    // An archived row that, were it counted, would add 30000.
    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: today,
      status: 'archived',
      estimated_ms: 30000
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('does not include pending rows scheduled for other days', async () => {
    const today = todayIso();
    const otherItem = seedStudyItem(sqlite, 1);
    const todayItem = seedStudyItem(sqlite, 2);

    seedAssignment({
      study_item_id: otherItem,
      assigned_for_date: '2024-01-01',
      status: 'pending',
      estimated_ms: 30000
    });
    seedAssignment({
      study_item_id: todayItem,
      assigned_for_date: today,
      status: 'pending',
      estimated_ms: 12000
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { estimated_remaining_ms: number };
    expect(body.estimated_remaining_ms).toBe(12000);
  });

  it('sets no HTTP cache headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('keeps the response shape { estimated_remaining_ms: number }', async () => {
    const res = await app.inject({ method: 'GET', url: '/estimates/today' });

    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['estimated_remaining_ms']);
    expect(typeof body.estimated_remaining_ms).toBe('number');
  });
});