import type { AssignmentSummary, AssignmentStatus } from '@kanjiscribe/shared';
import { interleaveUnfinished, isUnfinishedStatus } from '@kanjiscribe/shared';
import type { Database } from 'better-sqlite3';

import {
  deleteKanjiAttributionForAssignment,
  writeKanjiAttributionForAssignment
} from '../attribution.js';
import { nowIso } from '../config.js';
import { dayAssignmentOrderRows } from './queries.js';

export type AssignmentLifecycleResult =
  | { kind: 'ok'; assignment: AssignmentSummary }
  | { kind: 'not_found' }
  | { kind: 'conflict'; message: string };

export type AssignmentReorderResult = { kind: 'ok' } | { kind: 'bad_request'; message: string };

function fetchStatus(db: Database, id: number): AssignmentStatus | undefined {
  const row = db.prepare(`SELECT status FROM daily_assignment WHERE id = ?`).get(id) as
    | { status: AssignmentStatus }
    | undefined;
  return row?.status;
}

function fetchAssignment(db: Database, id: number): AssignmentSummary | undefined {
  return db
    .prepare(`SELECT id, status, time_spent_ms, completed_at FROM daily_assignment WHERE id = ?`)
    .get(id) as AssignmentSummary | undefined;
}

/**
 * Transition an assignment to `completed`, recording its time spent and
 * (when a time is present) the kanji-attribution rows for that completion.
 * Permissive by design: any non-archived status may be completed.
 */
export function completeAssignment(
  db: Database,
  id: number,
  timeSpentMs?: number
): AssignmentLifecycleResult {
  if (fetchStatus(db, id) === 'archived') {
    return { kind: 'conflict', message: 'Assignment is archived' };
  }

  const meta = db
    .prepare(
      `
      SELECT id, study_item_id, time_spent_ms
      FROM daily_assignment
      WHERE id = ?
      `
    )
    .get(id) as { id: number; study_item_id: number; time_spent_ms: number | null } | undefined;

  if (!meta) {
    return { kind: 'not_found' };
  }

  // Attribution is written against the provided time, falling back to the
  // assignment's previous time (e.g. completing a skipped assignment that
  // already carried a time).
  const effectiveTimeMs = timeSpentMs ?? meta.time_spent_ms;

  const transaction = db.transaction(() => {
    db.prepare(
      `
      UPDATE daily_assignment
      SET
        status = 'completed',
        completed_at = ?,
        time_spent_ms = COALESCE(?, time_spent_ms)
      WHERE id = ?
      `
    ).run(nowIso(), timeSpentMs ?? null, id);

    deleteKanjiAttributionForAssignment(db, id);

    if (typeof effectiveTimeMs === 'number') {
      writeKanjiAttributionForAssignment(db, id, meta.study_item_id, effectiveTimeMs);
    }
  });

  transaction();

  return { kind: 'ok', assignment: fetchAssignment(db, id)! };
}

/**
 * Transition an assignment to `skipped`. Permissive by design: any
 * non-archived status may be skipped. No attribution side effects.
 */
export function skipAssignment(
  db: Database,
  id: number,
  timeSpentMs?: number
): AssignmentLifecycleResult {
  if (fetchStatus(db, id) === 'archived') {
    return { kind: 'conflict', message: 'Assignment is archived' };
  }

  const result = db
    .prepare(
      `
      UPDATE daily_assignment
      SET
        status = 'skipped',
        completed_at = NULL,
        time_spent_ms = COALESCE(?, time_spent_ms)
      WHERE id = ?
      `
    )
    .run(timeSpentMs ?? null, id);

  if (result.changes === 0) {
    return { kind: 'not_found' };
  }

  return { kind: 'ok', assignment: fetchAssignment(db, id)! };
}

/**
 * Transition an assignment back to `pending`, clearing its completion data
 * and deleting its kanji-attribution rows inside the same transaction.
 */
export function reopenAssignment(db: Database, id: number): AssignmentLifecycleResult {
  if (fetchStatus(db, id) === 'archived') {
    return { kind: 'conflict', message: 'Assignment is archived' };
  }

  const transaction = db.transaction(() => {
    const updateResult = db
      .prepare(
        `
        UPDATE daily_assignment
        SET status = 'pending', completed_at = NULL, time_spent_ms = NULL
        WHERE id = ?
        `
      )
      .run(id);

    deleteKanjiAttributionForAssignment(db, id);

    return updateResult;
  });

  const result = transaction();

  if (result.changes === 0) {
    return { kind: 'not_found' };
  }

  return { kind: 'ok', assignment: fetchAssignment(db, id)! };
}

/**
 * Archive (Removal): valid only from `pending` or `skipped`. Completed
 * assignments can never be archived — that would erase a study event.
 */
export function archiveAssignment(db: Database, id: number): AssignmentLifecycleResult {
  const row = fetchAssignment(db, id);
  if (!row) {
    return { kind: 'not_found' };
  }

  if (row.status === 'completed') {
    return { kind: 'conflict', message: 'Completed assignments cannot be archived' };
  }
  if (row.status === 'archived') {
    return { kind: 'conflict', message: 'Assignment is already archived' };
  }

  db.prepare(
    `
    UPDATE daily_assignment
    SET status = 'archived', completed_at = NULL, time_spent_ms = NULL
    WHERE id = ?
    `
  ).run(id);

  return { kind: 'ok', assignment: fetchAssignment(db, id)! };
}

/**
 * Restore an archived assignment to `pending`. Valid only from `archived`.
 */
export function unarchiveAssignment(db: Database, id: number): AssignmentLifecycleResult {
  const row = fetchAssignment(db, id);
  if (!row) {
    return { kind: 'not_found' };
  }

  if (row.status !== 'archived') {
    return { kind: 'conflict', message: 'Only archived assignments can be unarchived' };
  }

  // queue_position is cleared so the restored card lands at the end of the
  // day's queue (ADR 0008): new arrivals sort after positioned rows.
  db.prepare(
    `
    UPDATE daily_assignment
    SET status = 'pending', completed_at = NULL, time_spent_ms = NULL, queue_position = NULL
    WHERE id = ?
    `
  ).run(id);

  return { kind: 'ok', assignment: fetchAssignment(db, id)! };
}

export function reorderAssignments(
  db: Database,
  date: string,
  assignmentIds: number[]
): AssignmentReorderResult {
  const transaction = db.transaction((): AssignmentReorderResult => {
    const assignments = dayAssignmentOrderRows(db, date);

    if (assignments.length === 0) {
      return { kind: 'bad_request', message: 'No assignments found for date' };
    }

    const reorderable = assignments.filter((assignment) => isUnfinishedStatus(assignment.status));

    if (reorderable.length === 0) {
      return { kind: 'bad_request', message: 'No unfinished assignments for date' };
    }

    const assignmentIdSet = new Set(assignmentIds);
    const reorderableIdSet = new Set(reorderable.map((assignment) => assignment.id));

    if (
      assignmentIdSet.size !== assignmentIds.length ||
      assignmentIdSet.size !== reorderableIdSet.size ||
      assignmentIds.some((id) => !reorderableIdSet.has(id))
    ) {
      return {
        kind: 'bad_request',
        message: 'Assignment ids must match the day’s unfinished assignments'
      };
    }

    const reorderableById = new Map(reorderable.map((assignment) => [assignment.id, assignment]));
    const orderedRows = interleaveUnfinished(
      assignments,
      assignmentIds.map((id) => reorderableById.get(id)!)
    );

    const updatePosition = db.prepare(
      `UPDATE daily_assignment SET queue_position = ? WHERE id = ? AND assigned_for_date = ?`
    );
    orderedRows.forEach((row, index) => {
      updatePosition.run(index + 1, row.id, date);
    });

    return { kind: 'ok' };
  });

  return transaction();
}
