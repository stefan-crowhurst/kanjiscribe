import {
  assignmentsQuerySchema,
  queueSourceSchema,
  updateAssignmentTimeSchema,
  type AssignmentListResponse,
  type AssignmentSummaryResponse,
  type BacklogResponse,
  type DrillPayload,
  type ViewPayload
} from '@kanjiscribe/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { sqlite } from '../db/client.js';
import { badRequest, conflict, notFound, parseIdParam, parseOr400, rejectIfArchived } from '../http.js';
import { assignmentDetail } from './detail.js';
import {
  archiveAssignment,
  completeAssignment,
  reopenAssignment,
  skipAssignment,
  unarchiveAssignment,
  type AssignmentLifecycleResult
} from './lifecycle.js';
import { computeQueue, listAssignments } from './queries.js';

function sendLifecycleResult(
  reply: FastifyReply,
  result: AssignmentLifecycleResult
): AssignmentSummaryResponse | FastifyReply {
  if (result.kind === 'ok') {
    return { assignment: result.assignment };
  }
  if (result.kind === 'not_found') {
    return notFound(reply, 'Assignment not found');
  }
  return conflict(reply, result.message);
}

export function registerAssignmentsRoutes(app: FastifyInstance): void {
  app.get('/assignments', async (request, reply): Promise<AssignmentListResponse | undefined> => {
    const parsed = parseOr400(assignmentsQuerySchema, request.query, reply);
    if (parsed === null) {
      return;
    }

    const assignments = listAssignments({
      status: parsed.status,
      date: parsed.date
    });

    return { assignments };
  });

  app.get('/assignments/backlog', async (): Promise<BacklogResponse> => {
    const assignments = listAssignments({ backlogOnly: true });

    const dates = [...new Set(assignments.map((a) => a.assigned_for_date))];
    const placeholders = dates.map(() => '?').join(',');
    const dayStats = sqlite
      .prepare(
        `
        SELECT
          assigned_for_date AS date,
          total_assignments,
          completed_count,
          pending_count
        FROM v_day_summary
        WHERE assigned_for_date IN (${placeholders})
        `
      )
      .all(...dates) as Array<{
      date: string;
      total_assignments: number;
      completed_count: number;
      pending_count: number;
    }>;

    const dayStatsMap = new Map(dayStats.map((d) => [d.date, d]));

    return { assignments, dayStats: Object.fromEntries(dayStatsMap) };
  });

  app.get('/assignments/:id/drill', async (request, reply): Promise<DrillPayload | FastifyReply | undefined> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    const sourceParsed = queueSourceSchema.safeParse((request.query as { queue_source?: unknown }).queue_source);
    if (!sourceParsed.success) {
      return badRequest(reply, 'Invalid queue source');
    }

    if (await rejectIfArchived(id, reply)) {
      return;
    }

    const detail = assignmentDetail(sqlite, id);
    if (detail.kind === 'not_found') {
      return notFound(reply, detail.message);
    }

    const queue = computeQueue(id, sourceParsed.data);

    const dayTotalRow = sqlite
      .prepare(
        `
        SELECT SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms
        FROM daily_assignment
        WHERE assigned_for_date = ?
        `
      )
      .get(detail.payload.assignment.assigned_for_date) as { total_time_ms: number | null };

    return {
      ...detail.payload,
      queue,
      day_total_time_ms: dayTotalRow.total_time_ms ?? 0
    };
  });

  app.get('/assignments/:id/view', async (request, reply): Promise<ViewPayload | FastifyReply | undefined> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    if (await rejectIfArchived(id, reply)) {
      return;
    }

    const detail = assignmentDetail(sqlite, id);
    if (detail.kind === 'not_found') {
      return notFound(reply, detail.message);
    }

    return detail.payload;
  });

  app.post('/assignments/:id/complete', async (request, reply): Promise<AssignmentSummaryResponse | FastifyReply | undefined> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    const parsed = parseOr400(updateAssignmentTimeSchema, request.body ?? {}, reply);
    if (parsed === null) {
      return;
    }

    return sendLifecycleResult(reply, completeAssignment(sqlite, id, parsed.time_spent_ms));
  });

  app.post('/assignments/:id/skip', async (request, reply): Promise<AssignmentSummaryResponse | FastifyReply | undefined> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    const parsed = parseOr400(updateAssignmentTimeSchema, request.body ?? {}, reply);
    if (parsed === null) {
      return;
    }

    return sendLifecycleResult(reply, skipAssignment(sqlite, id, parsed.time_spent_ms));
  });

  app.post('/assignments/:id/reopen', async (request, reply): Promise<AssignmentSummaryResponse | FastifyReply> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    return sendLifecycleResult(reply, reopenAssignment(sqlite, id));
  });

  app.post('/assignments/:id/archive', async (request, reply): Promise<AssignmentSummaryResponse | FastifyReply> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    return sendLifecycleResult(reply, archiveAssignment(sqlite, id));
  });

  app.post('/assignments/:id/unarchive', async (request, reply): Promise<AssignmentSummaryResponse | FastifyReply> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid assignment id');
    }

    return sendLifecycleResult(reply, unarchiveAssignment(sqlite, id));
  });
}
