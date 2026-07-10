import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

type Assignment = {
  id: number;
  status: string;
  assigned_for_date: string;
};

describe('GET /assignments excludes archived items by default', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns pending, completed, and skipped but not archived for a date', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'pending', assigned_for_date: '2024-01-01' });
    seedAssignment({ study_item_id: studyItemId, status: 'completed', assigned_for_date: '2024-01-01', time_spent_ms: 1000 });
    seedAssignment({ study_item_id: studyItemId, status: 'skipped', assigned_for_date: '2024-01-01' });
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: '2024-01-01' });

    const res = await app.inject({
      method: 'GET',
      url: '/assignments?date=2024-01-01'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { assignments: Assignment[] };
    const statuses = body.assignments.map((a) => a.status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('completed');
    expect(statuses).toContain('skipped');
    expect(statuses).not.toContain('archived');
  });

  it('still returns archived items when explicitly requested via status=archived', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'pending', assigned_for_date: '2024-01-01' });
    seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: '2024-01-01' });

    const res = await app.inject({
      method: 'GET',
      url: '/assignments?status=archived&date=2024-01-01'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { assignments: Assignment[] };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0]!.status).toBe('archived');
  });
});