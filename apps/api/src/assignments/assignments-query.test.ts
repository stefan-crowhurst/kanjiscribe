import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { sqlite } from '../test-setup.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from '../test-helpers.js';

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

  it('returns a day in queue_position order with NULL positions last by created_at', async () => {
    const studyItemId = seedStudyItem();
    const positionTwo = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      queue_position: 2
    });
    const positionOne = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      queue_position: 1
    });
    const nullEarlier = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01'
    });
    const nullLater = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01'
    });
    sqlite
      .prepare('UPDATE daily_assignment SET created_at = ? WHERE id = ?')
      .run('2024-01-01T00:00:01.000Z', nullEarlier.id);
    sqlite
      .prepare('UPDATE daily_assignment SET created_at = ? WHERE id = ?')
      .run('2024-01-01T00:00:02.000Z', nullLater.id);

    const res = await app.inject({ method: 'GET', url: '/assignments?date=2024-01-01' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { assignments: Assignment[] };
    expect(body.assignments.map((assignment) => assignment.id)).toEqual([
      positionOne.id,
      positionTwo.id,
      nullEarlier.id,
      nullLater.id
    ]);
  });

  it('preserves arranged order within each backlog day', async () => {
    const studyItemId = seedStudyItem();
    const firstDayPositionTwo = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      queue_position: 2
    });
    const firstDayPositionOne = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      queue_position: 1
    });
    const secondDayPositionOne = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-02',
      queue_position: 1
    });

    const res = await app.inject({ method: 'GET', url: '/assignments/backlog' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { assignments: Assignment[] };
    expect(body.assignments.map((assignment) => assignment.id)).toEqual([
      firstDayPositionOne.id,
      firstDayPositionTwo.id,
      secondDayPositionOne.id
    ]);
  });

  it('uses arranged order for today and backlog drill navigation', async () => {
    const studyItemId = seedStudyItem();
    const todayPositionTwo = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-03',
      queue_position: 2
    });
    const todayPositionOne = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: todayPositionTwo.assigned_for_date,
      queue_position: 1
    });
    const backlogPositionTwo = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      queue_position: 2
    });
    const backlogPositionOne = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      queue_position: 1
    });
    const laterDayPositionOne = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-02',
      queue_position: 1
    });

    const todayRes = await app.inject({
      method: 'GET',
      url: `/assignments/${todayPositionOne.id}/drill?queue_source=today`
    });
    const backlogRes = await app.inject({
      method: 'GET',
      url: `/assignments/${backlogPositionOne.id}/drill?queue_source=backlog`
    });
    const laterBacklogRes = await app.inject({
      method: 'GET',
      url: `/assignments/${laterDayPositionOne.id}/drill?queue_source=backlog`
    });

    expect(todayRes.statusCode).toBe(200);
    expect(JSON.parse(todayRes.body).queue).toMatchObject({
      current_index: 0,
      total: 2,
      next_assignment_id: todayPositionTwo.id,
      prev_assignment_id: null
    });
    expect(backlogRes.statusCode).toBe(200);
    expect(JSON.parse(backlogRes.body).queue).toMatchObject({
      current_index: 0,
      total: 5,
      next_assignment_id: backlogPositionTwo.id,
      prev_assignment_id: null
    });
    expect(laterBacklogRes.statusCode).toBe(200);
    expect(JSON.parse(laterBacklogRes.body).queue).toMatchObject({
      current_index: 2,
      total: 5,
      next_assignment_id: todayPositionOne.id,
      prev_assignment_id: backlogPositionTwo.id
    });
  });
});
