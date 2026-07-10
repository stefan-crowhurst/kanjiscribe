import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from './test-helpers.js';

type IntakeResponse = {
  study_item: { id: number; surface_form: string };
  assignment: { id: number; status: string; assigned_for_date: string };
};

async function intake(payload: {
  surface_form: string;
  selected_reading: string;
  dictionary_entry_id: number;
  assigned_for_date?: string;
}): Promise<{ status: number; body: IntakeResponse | { error: string } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/study-items/intake',
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' }
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

describe('POST /study-items/intake unarchives a previously-removed assignment', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 200 (not 409) and restores status to pending when re-adding an archived word', async () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived', assigned_for_date: '2024-01-01' });

    // Note: seedStudyItem inserts surface_form `形N`. Mirror that for intake.
    const res = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-01'
    });

    expect(res.status).toBe(200);
    const body = res.body as IntakeResponse;
    expect(body.assignment.id).toBe(assignment.id);
    expect(body.assignment.status).toBe('pending');
  });

  it('still returns 409 when re-adding a word whose assignment is pending', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'pending', assigned_for_date: '2024-01-01' });

    const res = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-01'
    });

    expect(res.status).toBe(409);
  });

  it('still returns 409 when re-adding a word whose assignment is completed', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'completed', assigned_for_date: '2024-01-01', time_spent_ms: 1000 });

    const res = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-01'
    });

    expect(res.status).toBe(409);
  });

  it('still returns 409 when re-adding a word whose assignment is skipped', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, status: 'skipped', assigned_for_date: '2024-01-01' });

    const res = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-01'
    });

    expect(res.status).toBe(409);
  });
});