import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

describe('POST /assignments/:id/archive', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('archives a pending assignment, returns 200 with archived status', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/archive`
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.assignment).toEqual({
      id: assignment.id,
      status: 'archived',
      time_spent_ms: null,
      completed_at: null
    });
  });

  it('archives a skipped assignment', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'skipped' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/archive`
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).assignment.status).toBe('archived');
  });

  it('rejects archiving a completed assignment with 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      status: 'completed',
      time_spent_ms: 5000
    });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/archive`
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/archived|completed/i);
  });

  it('rejects archiving an already-archived assignment with 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/archive`
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for an unknown assignment id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assignments/9999/archive'
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for an invalid id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/assignments/not-an-id/archive'
    });

    expect(res.statusCode).toBe(400);
  });
});