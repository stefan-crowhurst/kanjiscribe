import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { sqlite } from '../test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedStudyItem
} from '../test-helpers.js';

type EstimateResponse = {
  estimated_remaining_ms: number;
};

function parseEstimate(body: string): EstimateResponse {
  return JSON.parse(body) as EstimateResponse;
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
    const res = await app.inject({ method: 'GET', url: '/estimates/backlog-days' });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('sums estimate snapshots of strictly-past pending/skipped and excludes today', async () => {
    const pastItem = seedStudyItem(sqlite, 1);
    const todayItem = seedStudyItem(sqlite, 2);

    seedAssignment({
      study_item_id: pastItem,
      assigned_for_date: daysAgoIso(1),
      status: 'pending',
      estimated_ms: 15000
    });
    seedAssignment({
      study_item_id: todayItem,
      assigned_for_date: todayIso(),
      status: 'pending',
      estimated_ms: 30000
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/backlog-days' });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(15000);
  });

  it('aggregates snapshots across multiple past days and pending/skipped statuses', async () => {
    const itemA = seedStudyItem(sqlite, 1);
    const itemB = seedStudyItem(sqlite, 2);

    seedAssignment({
      study_item_id: itemA,
      assigned_for_date: daysAgoIso(2),
      status: 'pending',
      estimated_ms: 10000
    });
    seedAssignment({
      study_item_id: itemB,
      assigned_for_date: daysAgoIso(1),
      status: 'skipped',
      estimated_ms: 20000
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/backlog-days' });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(30000);
  });

  it('excludes completed assignments from the backlog sum', async () => {
    const item = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'completed',
      time_spent_ms: 15000,
      estimated_ms: 99999
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/backlog-days' });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('falls back to a live estimate for NULL-snapshot (legacy) pending rows', async () => {
    const item = seedStudyItem(sqlite, 1);

    // Legacy pending row with no snapshot: a SUM-of-snapshots-only read path
    // would report 0:00 for this overdue day; the live Level-4 estimate must
    // be returned instead.
    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({ method: 'GET', url: '/estimates/backlog-days' });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(33000);
  });

  it('sets no HTTP cache headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/estimates/backlog-days' });

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

  it('returns the snapshot sum for that date pending/skipped only', async () => {
    const itemA = seedStudyItem(sqlite, 1);
    const itemB = seedStudyItem(sqlite, 2);

    seedAssignment({
      study_item_id: itemA,
      assigned_for_date: daysAgoIso(2),
      status: 'pending',
      estimated_ms: 10000
    });
    seedAssignment({
      study_item_id: itemB,
      assigned_for_date: daysAgoIso(1),
      status: 'pending',
      estimated_ms: 20000
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(2)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(10000);
  });

  it('sums snapshots for both pending and skipped on the requested date', async () => {
    const itemA = seedStudyItem(sqlite, 1);
    const itemB = seedStudyItem(sqlite, 2);

    seedAssignment({
      study_item_id: itemA,
      assigned_for_date: daysAgoIso(1),
      status: 'pending',
      estimated_ms: 8000
    });
    seedAssignment({
      study_item_id: itemB,
      assigned_for_date: daysAgoIso(1),
      status: 'skipped',
      estimated_ms: 4000
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(12000);
  });

  it('excludes completed rows on the requested date', async () => {
    const item = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'completed',
      time_spent_ms: 15000,
      estimated_ms: 99999
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(0);
  });

  it('falls back to a live estimate for a legacy day whose rows have no snapshot', async () => {
    const item = seedStudyItem(sqlite, 1);

    // The exact user symptom: a previously-missed day whose pending rows
    // predate the estimate-snapshot feature (NULL estimated_ms). Under
    // SUM-of-snapshots-only semantics this returns 0:00.
    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    const res = await app.inject({
      method: 'GET',
      url: `/estimates/backlog-day?date=${daysAgoIso(1)}`
    });

    expect(res.statusCode).toBe(200);
    const body = parseEstimate(res.body);
    expect(body.estimated_remaining_ms).toBe(33000);
  });

  it('returns 400 for an invalid date parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/estimates/backlog-day?date=not-a-date'
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid date' });
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
