import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from '../test-helpers.js';

describe('POST /assignments/:id/unarchive', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('restores an archived assignment to pending', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/unarchive`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assignment).toEqual({
      id: assignment.id,
      status: 'pending',
      time_spent_ms: null,
      completed_at: null
    });
  });

  it('clears queue_position so the restored assignment lands at the end of the day', async () => {
    const studyItemId = seedStudyItem();
    const restored = seedAssignment({
      study_item_id: studyItemId,
      status: 'archived',
      assigned_for_date: '2024-01-01',
      queue_position: 1
    });
    const existing = seedAssignment({
      study_item_id: studyItemId,
      status: 'pending',
      assigned_for_date: '2024-01-01',
      queue_position: 2
    });

    const unarchiveRes = await app.inject({
      method: 'POST',
      url: `/assignments/${restored.id}/unarchive`
    });
    const listRes = await app.inject({
      method: 'GET',
      url: '/assignments?date=2024-01-01'
    });

    expect(unarchiveRes.statusCode).toBe(200);
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).assignments.map((assignment: { id: number }) => assignment.id)).toEqual([
      existing.id,
      restored.id
    ]);
  });

  it('rejects unarchiving a pending assignment with 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/unarchive`
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects unarchiving a completed assignment with 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'completed', time_spent_ms: 1000 });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/unarchive`
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects unarchiving a skipped assignment with 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'skipped' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/unarchive`
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for an unknown assignment id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assignments/9999/unarchive'
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assignments/abc/unarchive'
    });

    expect(res.statusCode).toBe(400);
  });
});
