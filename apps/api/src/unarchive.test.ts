import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

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