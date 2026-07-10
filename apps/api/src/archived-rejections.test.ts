import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

describe('archived assignments reject study-state transitions with 409', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('POST /assignments/:id/complete on archived returns 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/archived/i);
  });

  it('POST /assignments/:id/skip on archived returns 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/skip`
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/archived/i);
  });

  it('POST /assignments/:id/reopen on archived returns 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const res = await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/reopen`
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/archived/i);
  });

  it('GET /assignments/:id/drill on archived returns 409', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const res = await app.inject({
      method: 'GET',
      url: `/assignments/${assignment.id}/drill`
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/archived/i);
  });
});