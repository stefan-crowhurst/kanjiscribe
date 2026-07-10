import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';
import { sqlite } from './db/client.js';

function daySummary(date: string): { is_fully_completed: number; total_assignments: number; completed_count: number } {
  return sqlite
    .prepare(
      `SELECT total_assignments, completed_count, is_fully_completed FROM v_day_summary WHERE assigned_for_date = ?`
    )
    .get(date) as { is_fully_completed: number; total_assignments: number; completed_count: number };
}

describe('v_day_summary.is_fully_completed requires at least one completion', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('marks a day with only completed assignments as fully completed', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'completed', time_spent_ms: 5000 });

    const summary = daySummary('2024-01-01');
    expect(summary.is_fully_completed).toBe(1);
    expect(summary.completed_count).toBe(1);
  });

  it('does NOT mark a day fully completed when only pending remain', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const summary = daySummary('2024-01-01');
    expect(summary.is_fully_completed).toBe(0);
  });

  it('does NOT mark a day fully completed when only skipped remain', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'skipped' });

    const summary = daySummary('2024-01-01');
    expect(summary.is_fully_completed).toBe(0);
  });

  it('does NOT produce a ghost-completed day when everything has been archived (empty day)', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'archived' });
    seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    // An all-archived day is an empty day: it drops out of v_day_summary entirely,
    // rather than appearing as `is_fully_completed=1` with zero completions (the legacy bug).
    const summary = sqlite
      .prepare(`SELECT is_fully_completed FROM v_day_summary WHERE assigned_for_date = ?`)
      .get('2024-01-01') as { is_fully_completed: number } | undefined;
    expect(summary).toBeUndefined();
  });

  it('marks a single-completed day with no pending/skipped as fully completed', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'completed', time_spent_ms: 1000 });

    expect(daySummary('2024-01-01').is_fully_completed).toBe(1);
  });

  it('marks a day NOT fully completed when completed + pending both exist', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'completed', time_spent_ms: 1000 });
    seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    expect(daySummary('2024-01-01').is_fully_completed).toBe(0);
  });

  it('dashboard heatmap omits an all-archived day (no false green)', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: '2024-05-05' });
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: '2024-05-05' });

    const res = await app.inject({
      method: 'GET',
      url: '/stats/dashboard?from=2024-05-05&to=2024-05-05'
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const day = body.heatmap.find((d: { date: string }) => d.date === '2024-05-05');
    // The day is omitted entirely: no false "fully completed" green on the heatmap.
    expect(day).toBeUndefined();
  });
});