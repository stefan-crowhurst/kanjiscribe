import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { sqlite } from '../test-setup.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from '../test-helpers.js';

const date = '2024-01-01';

function positionsForDate(day = date): Array<{ id: number; queue_position: number | null }> {
  return sqlite
    .prepare(
      `
      SELECT id, queue_position
      FROM daily_assignment
      WHERE assigned_for_date = ?
      ORDER BY id
      `
    )
    .all(day) as Array<{ id: number; queue_position: number | null }>;
}

async function getAssignmentIds(day = date): Promise<number[]> {
  const response = await app.inject({ method: 'GET', url: `/assignments?date=${day}` });
  expect(response.statusCode).toBe(200);
  return (JSON.parse(response.body) as { assignments: Array<{ id: number }> }).assignments.map(
    (assignment) => assignment.id
  );
}

describe('PUT /assignments/:date/order', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('persists the requested unfinished order', async () => {
    const studyItemId = seedStudyItem();
    const first = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 1
    });
    const second = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 2
    });
    const third = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 3
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [third.id, first.id, second.id] }
    });

    expect(response.statusCode).toBe(204);
    await expect(getAssignmentIds()).resolves.toEqual([third.id, first.id, second.id]);
  });

  it('keeps completed assignments as anchors when unfinished assignments cross them', async () => {
    const studyItemId = seedStudyItem();
    const first = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      status: 'pending',
      queue_position: 1
    });
    const completed = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      status: 'completed',
      time_spent_ms: 1000,
      queue_position: 2
    });
    const second = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      status: 'skipped',
      queue_position: 3
    });
    const third = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      status: 'pending',
      queue_position: 4
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [third.id, first.id, second.id] }
    });

    expect(response.statusCode).toBe(204);
    await expect(getAssignmentIds()).resolves.toEqual([
      third.id,
      completed.id,
      first.id,
      second.id
    ]);
    expect(positionsForDate()).toEqual([
      { id: first.id, queue_position: 3 },
      { id: completed.id, queue_position: 2 },
      { id: second.id, queue_position: 4 },
      { id: third.id, queue_position: 1 }
    ]);
  });

  it('renumbers every non-archived assignment from 1 through n', async () => {
    const studyItemId = seedStudyItem();
    const assignments = [
      seedAssignment({
        study_item_id: studyItemId,
        assigned_for_date: date,
        status: 'pending',
        queue_position: 4
      }),
      seedAssignment({
        study_item_id: studyItemId,
        assigned_for_date: date,
        status: 'completed',
        queue_position: 1,
        time_spent_ms: 1000
      }),
      seedAssignment({
        study_item_id: studyItemId,
        assigned_for_date: date,
        status: 'skipped',
        queue_position: 3
      }),
      seedAssignment({
        study_item_id: studyItemId,
        assigned_for_date: date,
        status: 'completed',
        queue_position: 2,
        time_spent_ms: 1000
      })
    ];

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [assignments[2]!.id, assignments[0]!.id] }
    });

    expect(response.statusCode).toBe(204);
    expect(
      sqlite
        .prepare(
          `SELECT queue_position FROM daily_assignment WHERE assigned_for_date = ? AND status != 'archived' ORDER BY queue_position`
        )
        .all(date)
        .map((row) => (row as { queue_position: number }).queue_position)
    ).toEqual([1, 2, 3, 4]);
  });

  it('rejects a payload whose ids do not match the unfinished set without changing anything', async () => {
    const studyItemId = seedStudyItem();
    const first = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 1
    });
    const second = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 2
    });
    const before = positionsForDate();

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [first.id] }
    });

    expect(response.statusCode).toBe(400);
    expect(positionsForDate()).toEqual(before);
    expect(await getAssignmentIds()).toEqual([first.id, second.id]);
  });

  it('rejects an id assigned to a different date without changing either day', async () => {
    const studyItemId = seedStudyItem();
    const target = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 1
    });
    const otherDay = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-02',
      queue_position: 1
    });
    const before = positionsForDate('2024-01-02');

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [otherDay.id] }
    });

    expect(response.statusCode).toBe(400);
    expect(positionsForDate()).toEqual([{ id: target.id, queue_position: 1 }]);
    expect(positionsForDate('2024-01-02')).toEqual(before);
  });

  it('rejects malformed and unknown ids with 400', async () => {
    const studyItemId = seedStudyItem();
    seedAssignment({ study_item_id: studyItemId, assigned_for_date: date });

    for (const assignment_ids of [3, [1.5], [9999]]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/assignments/${date}/order`,
        payload: { assignment_ids }
      });

      expect(response.statusCode).toBe(400);
    }
  });

  it('lands new assignments at the end of an already-arranged day', async () => {
    const studyItemId = seedStudyItem();
    const first = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 1
    });
    const second = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 2
    });

    const reorderResponse = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [second.id, first.id] }
    });
    expect(reorderResponse.statusCode).toBe(204);

    const newArrival = seedAssignment({ study_item_id: studyItemId, assigned_for_date: date });

    await expect(getAssignmentIds()).resolves.toEqual([second.id, first.id, newArrival.id]);
  });

  it('rejects a day with no unfinished assignments without renumbering the completed anchors', async () => {
    const studyItemId = seedStudyItem();
    const completed = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      status: 'completed',
      time_spent_ms: 1000,
      queue_position: 2
    });
    const before = positionsForDate();

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [] }
    });

    expect(response.statusCode).toBe(400);
    expect(positionsForDate()).toEqual(before);
    expect(completed.status).toBe('completed');
  });

  it('rejects a date with no non-archived assignments', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [] }
    });

    expect(response.statusCode).toBe(400);
  });

  it('is idempotent when the same payload is applied twice', async () => {
    const studyItemId = seedStudyItem();
    const first = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 1
    });
    const second = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 2
    });
    const payload = { assignment_ids: [second.id, first.id] };

    const firstResponse = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload
    });
    const afterFirst = positionsForDate();
    const secondResponse = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload
    });

    expect(firstResponse.statusCode).toBe(204);
    expect(secondResponse.statusCode).toBe(204);
    expect(positionsForDate()).toEqual(afterFirst);
    await expect(getAssignmentIds()).resolves.toEqual([second.id, first.id]);
  });

  it('does not change another day when reordering this day', async () => {
    const studyItemId = seedStudyItem();
    const first = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 1
    });
    const second = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: date,
      queue_position: 2
    });
    const otherFirst = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-02',
      queue_position: 1
    });
    const otherSecond = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-02',
      queue_position: 2
    });
    const before = positionsForDate('2024-01-02');

    const response = await app.inject({
      method: 'PUT',
      url: `/assignments/${date}/order`,
      payload: { assignment_ids: [second.id, first.id] }
    });

    expect(response.statusCode).toBe(204);
    expect(positionsForDate('2024-01-02')).toEqual(before);
    expect(await getAssignmentIds('2024-01-02')).toEqual([otherFirst.id, otherSecond.id]);
  });
});
