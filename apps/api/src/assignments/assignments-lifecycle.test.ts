import { beforeEach, describe, expect, it } from 'vitest';

import {
  archiveAssignment,
  completeAssignment,
  reopenAssignment,
  skipAssignment,
  unarchiveAssignment
} from './lifecycle.js';
import { app } from '../server.js';
import { sqlite } from '../test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedKanji,
  seedStudyItem,
  seedStudyItemKanji
} from '../test-helpers.js';

type AttributionRow = {
  kanji_literal: string;
  attributed_time_ms: number;
};

function attributionRows(assignmentId: number): AttributionRow[] {
  return sqlite
    .prepare(
      `SELECT kanji_literal, attributed_time_ms
       FROM kanji_attribution
       WHERE assignment_id = ?
       ORDER BY kanji_literal ASC`
    )
    .all(assignmentId) as AttributionRow[];
}

function seedAttributableWord(): number {
  // A single-kanji word with a known attribution math: 山 written 10 times,
  // kana time 2 s (reading やま), so a 12000 ms completion leaves a kanji
  // pool of 10000 ms fully attributed to 山.
  seedKanji('山', 3);
  const studyItemId = seedStudyItem(sqlite, 1, {
    surface_form: '山',
    selected_reading: 'やま'
  });
  seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);
  return studyItemId;
}

describe('completeAssignment', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('transitions a pending assignment to completed and returns its summary', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const result = completeAssignment(sqlite, assignment.id, 5000);

    expect(result).toEqual({
      kind: 'ok',
      assignment: {
        id: assignment.id,
        status: 'completed',
        time_spent_ms: 5000,
        completed_at: expect.any(String)
      }
    });
  });

  it('permissively completes an assignment from skipped', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'skipped', time_spent_ms: 3000 });

    const result = completeAssignment(sqlite, assignment.id, 4000);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.assignment.status).toBe('completed');
      expect(result.assignment.time_spent_ms).toBe(4000);
    }
  });

  it('returns not_found for an unknown id', () => {
    expect(completeAssignment(sqlite, 9999)).toEqual({ kind: 'not_found' });
  });

  it('rejects an archived assignment with a conflict', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    expect(completeAssignment(sqlite, assignment.id)).toEqual({
      kind: 'conflict',
      message: 'Assignment is archived'
    });
  });

  it('writes kanji_attribution rows when a time is present', () => {
    const studyItemId = seedAttributableWord();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const result = completeAssignment(sqlite, assignment.id, 12000);

    expect(result.kind).toBe('ok');
    const rows = attributionRows(assignment.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kanji_literal).toBe('山');
    expect(rows[0]!.attributed_time_ms).toBeCloseTo(10000, 5);
  });

  it('writes no attribution rows when completing without a time', () => {
    const studyItemId = seedAttributableWord();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const result = completeAssignment(sqlite, assignment.id);

    expect(result.kind).toBe('ok');
    expect(attributionRows(assignment.id)).toHaveLength(0);
  });
});

describe('skipAssignment', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('transitions a pending assignment to skipped and returns its summary', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const result = skipAssignment(sqlite, assignment.id, 2000);

    expect(result).toEqual({
      kind: 'ok',
      assignment: { id: assignment.id, status: 'skipped', time_spent_ms: 2000, completed_at: null }
    });
  });

  it('permissively skips an assignment from completed', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      status: 'completed',
      time_spent_ms: 5000
    });

    const result = skipAssignment(sqlite, assignment.id, 1000);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.assignment.status).toBe('skipped');
      expect(result.assignment.time_spent_ms).toBe(1000);
    }
  });

  it('returns not_found for an unknown id', () => {
    expect(skipAssignment(sqlite, 9999)).toEqual({ kind: 'not_found' });
  });

  it('rejects an archived assignment with a conflict', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    expect(skipAssignment(sqlite, assignment.id)).toEqual({
      kind: 'conflict',
      message: 'Assignment is archived'
    });
  });
});

describe('reopenAssignment', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('transitions a completed assignment back to pending and clears its time', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      status: 'completed',
      time_spent_ms: 5000
    });

    const result = reopenAssignment(sqlite, assignment.id);

    expect(result).toEqual({
      kind: 'ok',
      assignment: { id: assignment.id, status: 'pending', time_spent_ms: null, completed_at: null }
    });
  });

  it('permissively reopens an assignment from pending', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const result = reopenAssignment(sqlite, assignment.id);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.assignment.status).toBe('pending');
    }
  });

  it('returns not_found for an unknown id', () => {
    expect(reopenAssignment(sqlite, 9999)).toEqual({ kind: 'not_found' });
  });

  it('rejects an archived assignment with a conflict', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    expect(reopenAssignment(sqlite, assignment.id)).toEqual({
      kind: 'conflict',
      message: 'Assignment is archived'
    });
  });

  it('deletes the assignment attribution rows', () => {
    const studyItemId = seedAttributableWord();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    expect(completeAssignment(sqlite, assignment.id, 12000).kind).toBe('ok');
    expect(attributionRows(assignment.id)).toHaveLength(1);

    const result = reopenAssignment(sqlite, assignment.id);

    expect(result.kind).toBe('ok');
    expect(attributionRows(assignment.id)).toHaveLength(0);
  });
});

describe('archiveAssignment', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('archives a pending assignment and returns its summary', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    const result = archiveAssignment(sqlite, assignment.id);

    expect(result).toEqual({
      kind: 'ok',
      assignment: { id: assignment.id, status: 'archived', time_spent_ms: null, completed_at: null }
    });
  });

  it('archives a skipped assignment', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'skipped' });

    const result = archiveAssignment(sqlite, assignment.id);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.assignment.status).toBe('archived');
    }
  });

  it('returns not_found for an unknown id', () => {
    expect(archiveAssignment(sqlite, 9999)).toEqual({ kind: 'not_found' });
  });

  it('rejects a completed assignment with a conflict', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      status: 'completed',
      time_spent_ms: 5000
    });

    expect(archiveAssignment(sqlite, assignment.id)).toEqual({
      kind: 'conflict',
      message: 'Completed assignments cannot be archived'
    });
  });

  it('rejects an already-archived assignment with a conflict', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    expect(archiveAssignment(sqlite, assignment.id)).toEqual({
      kind: 'conflict',
      message: 'Assignment is already archived'
    });
  });
});

describe('unarchiveAssignment', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('restores an archived assignment to pending and returns its summary', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'archived' });

    const result = unarchiveAssignment(sqlite, assignment.id);

    expect(result).toEqual({
      kind: 'ok',
      assignment: { id: assignment.id, status: 'pending', time_spent_ms: null, completed_at: null }
    });
  });

  it('returns not_found for an unknown id', () => {
    expect(unarchiveAssignment(sqlite, 9999)).toEqual({ kind: 'not_found' });
  });

  it('rejects a non-archived assignment with a conflict', () => {
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({ study_item_id: studyItemId, status: 'pending' });

    expect(unarchiveAssignment(sqlite, assignment.id)).toEqual({
      kind: 'conflict',
      message: 'Only archived assignments can be unarchived'
    });
  });
});

describe('assignment lifecycle routes preserve queue positions', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('complete, skip, and reopen leave the Day\'s queue order unchanged', async () => {
    const studyItemId = seedStudyItem();
    const completed = seedAssignment({
      study_item_id: studyItemId,
      status: 'completed',
      assigned_for_date: '2024-01-01',
      queue_position: 3,
      time_spent_ms: 1000
    });
    const pending = seedAssignment({
      study_item_id: studyItemId,
      status: 'pending',
      assigned_for_date: '2024-01-01',
      queue_position: 1
    });
    const skipCandidate = seedAssignment({
      study_item_id: studyItemId,
      status: 'pending',
      assigned_for_date: '2024-01-01',
      queue_position: 2
    });

    const completeRes = await app.inject({
      method: 'POST',
      url: `/assignments/${pending.id}/complete`
    });
    const skipRes = await app.inject({
      method: 'POST',
      url: `/assignments/${skipCandidate.id}/skip`
    });
    const reopenRes = await app.inject({
      method: 'POST',
      url: `/assignments/${completed.id}/reopen`
    });
    const listRes = await app.inject({
      method: 'GET',
      url: '/assignments?date=2024-01-01'
    });

    expect(completeRes.statusCode).toBe(200);
    expect(skipRes.statusCode).toBe(200);
    expect(reopenRes.statusCode).toBe(200);
    expect(listRes.statusCode).toBe(200);
    expect(JSON.parse(listRes.body).assignments.map((assignment: { id: number }) => assignment.id)).toEqual([
      pending.id,
      skipCandidate.id,
      completed.id
    ]);
  });
});
