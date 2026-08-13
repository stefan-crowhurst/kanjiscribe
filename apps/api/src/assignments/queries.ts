import type {
  Assignment,
  AssignmentOrigin,
  AssignmentStatus,
  DrillQueue
} from '@kanjiscribe/shared';
import type { Database } from 'better-sqlite3';

import { sqlite } from '../db/client.js';

export type DayAssignmentOrder = {
  id: number;
  status: AssignmentStatus;
};

/**
 * The within-day ordering key (ADR 0008): arranged position first, `NULL`
 * (never-arranged) rows last, then insertion order. Shared by the day-order
 * fetch, the list views, and both drill-queue sources. Callers in multi-table
 * queries pass their table alias (`da.`) to keep `created_at` unambiguous.
 */
const withinDayOrderSql = (alias = '') =>
  `${alias}queue_position IS NULL ASC, ${alias}queue_position ASC, ${alias}created_at ASC`;

export function dayAssignmentOrderRows(db: Database, date: string): DayAssignmentOrder[] {
  return db
    .prepare(
      `
      SELECT id, status
      FROM daily_assignment
      WHERE assigned_for_date = ? AND status != 'archived'
      ORDER BY ${withinDayOrderSql()}
      `
    )
    .all(date) as DayAssignmentOrder[];
}

export function assignmentStatusById(id: number): AssignmentStatus | undefined {
  const row = sqlite.prepare(`SELECT status FROM daily_assignment WHERE id = ?`).get(id) as
    | { status: AssignmentStatus }
    | undefined;
  return row?.status;
}

export function listAssignments(params: {
  status?: string;
  date?: string;
  backlogOnly?: boolean;
}): Assignment[] {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.backlogOnly) {
    where.push(`da.status IN ('pending', 'skipped')`);
  }

  if (params.status) {
    where.push(`da.status = ?`);
    values.push(params.status);
  } else if (!params.backlogOnly) {
    // Archived items are excluded from list views by default; callers must
    // explicitly pass status=archived to retrieve them (mirrors computeQueue's
    // "status != 'archived'" day-queue filter).
    where.push(`da.status != 'archived'`);
  }

  if (params.date) {
    where.push(`da.assigned_for_date = ?`);
    values.push(params.date);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = `ORDER BY da.assigned_for_date ASC, ${withinDayOrderSql('da.')}`;

  const rows = sqlite
    .prepare(
      `
      SELECT
        da.id,
        da.study_item_id,
        da.assigned_for_date,
        da.status,
        da.origin,
        da.time_spent_ms,
        da.estimated_ms,
        da.created_at,
        da.completed_at,
        si.surface_form,
        si.selected_reading,
        (
          SELECT json_extract(es.glosses_json, '$[0]')
          FROM entry_sense es
          WHERE es.entry_id = si.dictionary_entry_id
          ORDER BY es.sense_index ASC
          LIMIT 1
        ) AS first_gloss
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      ${whereSql}
      ${orderSql}
      `
    )
    .all(...values) as Array<{
    id: number;
    study_item_id: number;
    assigned_for_date: string;
    status: AssignmentStatus;
    origin: AssignmentOrigin;
    time_spent_ms: number | null;
    estimated_ms: number | null;
    created_at: string;
    completed_at: string | null;
    surface_form: string;
    selected_reading: string;
    first_gloss: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    study_item_id: row.study_item_id,
    assigned_for_date: row.assigned_for_date,
    status: row.status,
    origin: row.origin,
    time_spent_ms: row.time_spent_ms,
    estimated_ms: row.estimated_ms,
    created_at: row.created_at,
    completed_at: row.completed_at,
    study_item: {
      surface_form: row.surface_form,
      selected_reading: row.selected_reading,
      first_gloss: row.first_gloss
    }
  }));
}

export function computeQueue(assignmentId: number, queueSource?: 'today' | 'backlog'): DrillQueue {
  const assignmentMeta = sqlite
    .prepare(`SELECT assigned_for_date FROM daily_assignment WHERE id = ?`)
    .get(assignmentId) as { assigned_for_date: string } | undefined;

  let queue: Array<{ id: number }> = [];

  if (queueSource === 'today') {
    if (assignmentMeta) {
      queue = sqlite
        .prepare(
          `
          SELECT id
          FROM daily_assignment
          WHERE status != 'archived' AND assigned_for_date = ?
      ORDER BY ${withinDayOrderSql()}
          `
        )
        .all(assignmentMeta.assigned_for_date) as Array<{ id: number }>;
    }
  } else if (queueSource === 'backlog') {
    queue = sqlite
      .prepare(
        `
        SELECT id
        FROM daily_assignment
        WHERE status IN ('pending', 'skipped', 'completed')
         ORDER BY assigned_for_date ASC, ${withinDayOrderSql()}
        `
      )
      .all() as Array<{ id: number }>;
  } else {
    queue = [{ id: assignmentId }];
  }

  if (!queue.some((item) => item.id === assignmentId)) {
    queue.unshift({ id: assignmentId });
  }

  const currentIndex = Math.max(
    0,
    queue.findIndex((item) => item.id === assignmentId)
  );
  const prev = currentIndex > 0 ? queue[currentIndex - 1] : null;
  const next = currentIndex < queue.length - 1 ? queue[currentIndex + 1] : null;

  const dayProgress = assignmentMeta
    ? (sqlite
        .prepare(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
          FROM daily_assignment
          WHERE assigned_for_date = ? AND status != 'archived'
          `
        )
        .get(assignmentMeta.assigned_for_date) as { total: number; completed: number | null })
    : { total: 0, completed: 0 };

  return {
    current_index: currentIndex,
    total: queue.length,
    next_assignment_id: next?.id ?? null,
    prev_assignment_id: prev?.id ?? null,
    day_completed_count: dayProgress.completed ?? 0,
    day_total_count: dayProgress.total
  };
}
