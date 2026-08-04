import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

type HeatmapRow = {
  date: string;
  total_assignments: number;
  completed_count: number;
  pending_count: number;
  skipped_count: number;
  total_time_ms: number;
  is_fully_completed: boolean;
  estimate_delta_ms: number | null;
  estimated_total_ms: number | null;
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

describe('GET /stats/dashboard estimated_total_ms day estimate gate', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  describe('fully completed fully snapshotted day', () => {
    it('estimated_total_ms equals the sum of per-word estimated_ms (over case)', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-06-01',
        status: 'completed',
        time_spent_ms: 30000,
        estimated_ms: 20000
      });
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
      expect(row!.estimated_total_ms).toBe(35000);
      // estimate_delta_ms === total_time_ms - estimated_total_ms (over).
      expect(row!.estimate_delta_ms).toBe(row!.total_time_ms - row!.estimated_total_ms!);
    });

    it('estimated_total_ms equals the sum of per-word estimated_ms (under case)', async () => {
      const a = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-06-02',
        status: 'completed',
        time_spent_ms: 5000,
        estimated_ms: 20000
      });

      const row = await dashboardOn('2024-06-02');
      expect(row!.estimated_total_ms).toBe(20000);
      // -15000 under estimate: 5000 - 20000 = -15000.
      expect(row!.estimate_delta_ms).toBe(-15000);
      expect(row!.estimate_delta_ms).toBe(row!.total_time_ms - row!.estimated_total_ms!);
    });

    it('agrees with the sum of per-word estimated_ms from /assignments', async () => {
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
        .reduce((acc, asg) => acc + (asg.estimated_ms ?? 0), 0);

      expect(row!.estimated_total_ms).toBe(perWordSum);
      expect(perWordSum).toBe(53000);
      expect(row!.estimate_delta_ms).toBe(row!.total_time_ms - row!.estimated_total_ms!);
    });

    it('exact-zero day delta still exposes the day estimate (estimate neutral, not null)', async () => {
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
      expect(row!.estimated_total_ms).toBe(12345);
      expect(row!.estimate_delta_ms).toBe(row!.total_time_ms - row!.estimated_total_ms!);
    });
  });

  describe('full snapshot coverage over the non-archived set', () => {
    it('in-progress day with pending remaining still exposes the day estimate', async () => {
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
      // The estimate covers the whole non-archived set; the verdict stays null.
      expect(row!.estimated_total_ms).toBe(14000);
      expect(row!.estimate_delta_ms).toBeNull();
    });

    it('skipped present with a snapshot still exposes the day estimate', async () => {
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
      expect(row!.estimated_total_ms).toBe(14000);
      expect(row!.estimate_delta_ms).toBeNull();
    });

    it('fully-pending fully-snapshotted day exposes its planned total', async () => {
      const a = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-06',
        status: 'pending',
        estimated_ms: 25000
      });

      const row = await dashboardOn('2024-07-06');
      expect(row!.is_fully_completed).toBe(false);
      expect(row!.estimated_total_ms).toBe(25000);
      expect(row!.estimate_delta_ms).toBeNull();
    });
  });

  describe('partial snapshot coverage (legacy rows) yields null', () => {
    it('mixed legacy/snapshot coverage → null', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-03',
        status: 'completed',
        time_spent_ms: 10000,
        estimated_ms: 9000
      });
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-07-03',
        status: 'completed',
        time_spent_ms: 12000,
        estimated_ms: null
      });

      const row = await dashboardOn('2024-07-03');
      expect(row!.is_fully_completed).toBe(true);
      expect(row!.estimated_total_ms).toBeNull();
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
      expect(row!.estimated_total_ms).toBeNull();
    });

    it('legacy pending row makes an otherwise snapshotted day partial → null', async () => {
      const a = seedStudyItem();
      const b = seedStudyItem();
      seedAssignment({
        study_item_id: a,
        assigned_for_date: '2024-07-07',
        status: 'completed',
        time_spent_ms: 10000,
        estimated_ms: 9000
      });
      seedAssignment({
        study_item_id: b,
        assigned_for_date: '2024-07-07',
        status: 'pending',
        estimated_ms: null
      });

      const row = await dashboardOn('2024-07-07');
      expect(row!.is_fully_completed).toBe(false);
      expect(row!.estimated_total_ms).toBeNull();
    });

    it('empty day → no heatmap row', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/stats/dashboard?from=2024-07-05&to=2024-07-05'
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { heatmap: HeatmapRow[] };
      expect(body.heatmap).toHaveLength(0);
    });
  });
});