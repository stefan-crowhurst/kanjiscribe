import type { Database } from 'better-sqlite3';

import { todayIsoDate } from '../config.js';
import { estimateAssignment } from './estimates.js';

/**
 * The set of assignments whose remaining drilling time is being estimated:
 *
 * - `today`: today's non-archived assignments (completed, pending, skipped).
 * - `backlog`: strictly-past pending/skipped assignments (unfinished work).
 * - `day`: one date's pending/skipped assignments.
 */
export type TimeToFinishScope =
  | { kind: 'today' }
  | { kind: 'backlog' }
  | { kind: 'day'; date: string };

type TimeToFinishRow = {
  id: number;
  status: string;
  time_spent_ms: number | null;
  estimated_ms: number | null;
};

/**
 * Time-to-finish estimate for a scope of assignments (see CONTEXT.md:
 * time-to-finish estimate): the predicted drilling time remaining, in
 * milliseconds.
 *
 * - Completed rows contribute their actual recorded `time_spent_ms`.
 * - Pending/skipped rows contribute their estimate snapshot (`estimated_ms`);
 *   legacy rows with a NULL snapshot (created before snapshots existed) fall
 *   back to a live `estimateAssignment` so they don't report 0:00.
 * - Archived rows are excluded from every scope.
 *
 * The backlog and day scopes never hit the completed branch — their row
 * selection excludes completed rows, so a fully completed day contributes
 * zero, as it does via the today scope.
 */
export function timeToFinish(db: Database, scope: TimeToFinishScope): number {
  const today = todayIsoDate();

  let rows: TimeToFinishRow[];
  if (scope.kind === 'today') {
    rows = db
      .prepare(
        `
        SELECT id, status, time_spent_ms, estimated_ms
        FROM daily_assignment
        WHERE assigned_for_date = ? AND status != 'archived'
        `
      )
      .all(today) as TimeToFinishRow[];
  } else if (scope.kind === 'backlog') {
    rows = db
      .prepare(
        `
        SELECT id, status, time_spent_ms, estimated_ms
        FROM daily_assignment
        WHERE assigned_for_date < ? AND status IN ('pending', 'skipped')
        `
      )
      .all(today) as TimeToFinishRow[];
  } else {
    rows = db
      .prepare(
        `
        SELECT id, status, time_spent_ms, estimated_ms
        FROM daily_assignment
        WHERE assigned_for_date = ? AND status IN ('pending', 'skipped')
        `
      )
      .all(scope.date) as TimeToFinishRow[];
  }

  let estimatedRemainingMs = 0;
  for (const row of rows) {
    if (row.status === 'completed') {
      estimatedRemainingMs += row.time_spent_ms ?? 0;
    } else {
      estimatedRemainingMs += row.estimated_ms ?? estimateAssignment(db, row.id);
    }
  }

  return estimatedRemainingMs;
}
