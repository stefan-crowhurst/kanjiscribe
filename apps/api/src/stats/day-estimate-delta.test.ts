import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from '../test-helpers.js';

type HeatmapRow = {
  date: string;
  total_assignments: number;
  completed_count: number;
  pending_count: number;
  skipped_count: number;
  total_time_ms: number;
  is_fully_completed: boolean;
  estimate_delta_ms: number | null;
};

async function dashboardOn(date: string): Promise<HeatmapRow | undefined> {
  const res = await app.inject({
    method: 'GET',
    url: `/stats/dashboard?from=${date}&to=${date}`
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { heatmap: HeatmapRow[] };
  return body.heatmap.find((d) => d.date === date);
}

type AssignmentRow = {
  id: number;
  status: string;
  time_spent_ms: number | null;
  estimated_ms: number | null;
};

async function assignmentsOn(date: string): Promise<AssignmentRow[]> {
  const res = await app.inject({ method: 'GET', url: `/assignments?date=${date}` });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body) as { assignments: AssignmentRow[] };
  return body.assignments;
}

describe('GET /stats/dashboard estimate_delta_ms day verdict gate', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('fully completed fully snapshotted day yields the signed sum (over + under mix)', async () => {
    const a = seedStudyItem();
    const b = seedStudyItem();
    // Word A: over estimate (slower) — time_spent 30000 vs estimated 20000 → +10000.
    seedAssignment({
      study_item_id: a,
      assigned_for_date: '2024-06-01',
      status: 'completed',
      time_spent_ms: 30000,
      estimated_ms: 20000
    });
    // Word B: under estimate (faster) — time_spent 8000 vs estimated 15000 → -7000.
    seedAssignment({
      study_item_id: b,
      assigned_for_date: '2024-06-01',
      status: 'completed',
      time_spent_ms: 8000,
      estimated_ms: 15000
    });

    const row = await dashboardOn('2024-06-01');
    expect(row).toBeDefined();
    expect(row!.is_fully_completed).toBe(true);
    // +10000 + (-7000) = +3000 (over estimate for the day).
    expect(row!.estimate_delta_ms).toBe(3000);
  });

  it('fully snapshotted day all over estimate yields an all-positive signed sum', async () => {
    const a = seedStudyItem();
    const b = seedStudyItem();
    seedAssignment({
      study_item_id: a,
      assigned_for_date: '2024-06-02',
      status: 'completed',
      time_spent_ms: 25000,
      estimated_ms: 10000
    });
    seedAssignment({
      study_item_id: b,
      assigned_for_date: '2024-06-02',
      status: 'completed',
      time_spent_ms: 18000,
      estimated_ms: 12000
    });

    const row = await dashboardOn('2024-06-02');
    // (25000 - 10000) + (18000 - 12000) = 15000 + 6000 = 21000.
    expect(row!.estimate_delta_ms).toBe(21000);
  });

  it('fully snapshotted day all under estimate yields an all-negative signed sum', async () => {
    const a = seedStudyItem();
    seedAssignment({
      study_item_id: a,
      assigned_for_date: '2024-06-03',
      status: 'completed',
      time_spent_ms: 5000,
      estimated_ms: 20000
    });

    const row = await dashboardOn('2024-06-03');
    // 5000 - 20000 = -15000.
    expect(row!.estimate_delta_ms).toBe(-15000);
  });

  it('exact-zero day delta renders as 0 (neutral indicator data — server returns 0, not null)', async () => {
    const a = seedStudyItem();
    seedAssignment({
      study_item_id: a,
      assigned_for_date: '2024-06-04',
      status: 'completed',
      time_spent_ms: 12345,
      estimated_ms: 12345
    });

    const row = await dashboardOn('2024-06-04');
    expect(row!.estimate_delta_ms).toBe(0);
  });

  describe('gate failures all yield null', () => {
    it('pending remaining → null', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-01',
        status: 'completed',
        time_spent_ms: 10000,
        estimated_ms: 9000
      });
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-07-01',
        status: 'pending',
        estimated_ms: 5000
      });

      const row = await dashboardOn('2024-07-01');
      expect(row!.is_fully_completed).toBe(false);
      expect(row!.estimate_delta_ms).toBeNull();
    });

    it('skipped present → null', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-02',
        status: 'completed',
        time_spent_ms: 10000,
        estimated_ms: 9000
      });
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-07-02',
        status: 'skipped',
        time_spent_ms: 2000,
        estimated_ms: 5000
      });

      const row = await dashboardOn('2024-07-02');
      expect(row!.is_fully_completed).toBe(false);
      expect(row!.estimate_delta_ms).toBeNull();
    });

    it('mixed legacy/snapshot coverage → null', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      // Snapshotted completed word.
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-03',
        status: 'completed',
        time_spent_ms: 10000,
        estimated_ms: 9000
      });
      // Legacy (no snapshot) completed word — NULL estimated_ms.
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-07-03',
        status: 'completed',
        time_spent_ms: 12000,
        estimated_ms: null
      });

      const row = await dashboardOn('2024-07-03');
      expect(row!.is_fully_completed).toBe(true);
      // Full-coverage gate fails because one completed word has no snapshot.
      expect(row!.estimate_delta_ms).toBeNull();
    });

    it('all-legacy fully completed day → null', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-04',
        status: 'completed',
        time_spent_ms: 10000,
        estimated_ms: null
      });
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-07-04',
        status: 'completed',
        time_spent_ms: 8000,
        estimated_ms: null
      });

      const row = await dashboardOn('2024-07-04');
      expect(row!.is_fully_completed).toBe(true);
      expect(row!.estimate_delta_ms).toBeNull();
    });

    it('empty day → no heatmap row (omitted, not a false green)', async () => {
      // No assignments at all for this date.
      const res = await app.inject({
        method: 'GET',
        url: '/stats/dashboard?from=2024-07-05&to=2024-07-05'
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { heatmap: HeatmapRow[] };
      expect(body.heatmap).toHaveLength(0);
    });
  });

  describe('agreement with per-word data', () => {
    it('day delta equals the sum of per-word deltas from /assignments', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      const c = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-08-01',
        status: 'completed',
        time_spent_ms: 22000,
        estimated_ms: 20000
      });
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-08-01',
        status: 'completed',
        time_spent_ms: 9000,
        estimated_ms: 15000
      });
      seedAssignment({
        study_item_id: c,
        assigned_for_date: '2024-08-01',
        status: 'completed',
        time_spent_ms: 18000,
        estimated_ms: 18000
      });

      const row = await dashboardOn('2024-08-01');
      const assignments = await assignmentsOn('2024-08-01');

      const perWordSum = assignments
        .filter((asg) => asg.status === 'completed' && asg.estimated_ms !== null)
        .reduce((acc, asg) => acc + ((asg.time_spent_ms ?? 0) - (asg.estimated_ms ?? 0)), 0);

      expect(row!.estimate_delta_ms).toBe(perWordSum);
      // (22000-20000) + (9000-15000) + (18000-18000) = 2000 - 6000 + 0 = -4000.
      expect(perWordSum).toBe(-4000);
    });
  });
});