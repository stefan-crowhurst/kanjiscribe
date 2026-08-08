import { beforeEach, describe, expect, it } from 'vitest';

import { timeToFinish } from './time-to-finish.js';
import { sqlite } from '../test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedStudyItem
} from '../test-helpers.js';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

describe('timeToFinish({ kind: "today" })', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('sums estimate snapshots of pending/skipped + actuals of completed', () => {
    const today = todayIso();
    const pendingItem = seedStudyItem(sqlite, 1);
    const skippedItem = seedStudyItem(sqlite, 2);
    const completedItem = seedStudyItem(sqlite, 3);

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
    // Completed rows contribute their actual recorded time, not the snapshot.
    seedAssignment({
      study_item_id: completedItem,
      assigned_for_date: today,
      status: 'completed',
      time_spent_ms: 20000,
      estimated_ms: 99999
    });

    expect(timeToFinish(sqlite, { kind: 'today' })).toBe(62000);
  });

  it('falls back to a live estimate for NULL-snapshot (legacy) rows', () => {
    const today = todayIso();
    const legacyItem = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: legacyItem,
      assigned_for_date: today,
      status: 'pending'
    });

    // Level-4 floor + pad live estimate, same known-good literal as the
    // estimates-today HTTP suite.
    expect(timeToFinish(sqlite, { kind: 'today' })).toBe(33000);
  });

  it('excludes archived assignments from the sum', () => {
    const today = todayIso();
    const studyItem = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: studyItem,
      assigned_for_date: today,
      status: 'archived',
      estimated_ms: 30000
    });

    expect(timeToFinish(sqlite, { kind: 'today' })).toBe(0);
  });

  it('excludes pending rows scheduled for other days', () => {
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

    expect(timeToFinish(sqlite, { kind: 'today' })).toBe(12000);
  });
});

describe('timeToFinish({ kind: "backlog" })', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('sums snapshots of strictly-past pending/skipped and excludes today', () => {
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

    expect(timeToFinish(sqlite, { kind: 'backlog' })).toBe(15000);
  });

  it('aggregates snapshots across multiple past days and both statuses', () => {
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

    expect(timeToFinish(sqlite, { kind: 'backlog' })).toBe(30000);
  });

  it('excludes completed rows: a fully completed day contributes zero', () => {
    const item = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'completed',
      time_spent_ms: 15000,
      estimated_ms: 99999
    });

    expect(timeToFinish(sqlite, { kind: 'backlog' })).toBe(0);
  });

  it('falls back to a live estimate for NULL-snapshot (legacy) rows', () => {
    const item = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    expect(timeToFinish(sqlite, { kind: 'backlog' })).toBe(33000);
  });
});

describe('timeToFinish({ kind: "day" })', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 0 for a date with no remaining assignments', () => {
    expect(timeToFinish(sqlite, { kind: 'day', date: daysAgoIso(1) })).toBe(0);
  });

  it('returns the snapshot sum for that date pending/skipped only', () => {
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

    expect(timeToFinish(sqlite, { kind: 'day', date: daysAgoIso(2) })).toBe(10000);
  });

  it('sums snapshots for both pending and skipped on the requested date', () => {
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

    expect(timeToFinish(sqlite, { kind: 'day', date: daysAgoIso(1) })).toBe(12000);
  });

  it('excludes completed rows on the requested date', () => {
    const item = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'completed',
      time_spent_ms: 15000,
      estimated_ms: 99999
    });

    expect(timeToFinish(sqlite, { kind: 'day', date: daysAgoIso(1) })).toBe(0);
  });

  it('falls back to a live estimate for a legacy day whose rows have no snapshot', () => {
    const item = seedStudyItem(sqlite, 1);

    seedAssignment({
      study_item_id: item,
      assigned_for_date: daysAgoIso(1),
      status: 'pending'
    });

    expect(timeToFinish(sqlite, { kind: 'day', date: daysAgoIso(1) })).toBe(33000);
  });
});
