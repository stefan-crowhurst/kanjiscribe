import {
  type DashboardResponse,
  type KanjiStatsResponse,
  type SlowestWordsResponse,
  type StudyItemStatsResponse,
  type TopKanjiResponse,
  type TopWordsResponse
} from '@kanjiscribe/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { todayIsoDate } from '../config.js';
import { sqlite } from '../db/client.js';
import { badRequest, notFound, parseIdParam, safeJsonParse } from '../http.js';

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get('/stats/dashboard', async (request): Promise<DashboardResponse> => {
    const query = request.query as { from?: string; to?: string };
    const to = query.to ?? todayIsoDate();
    const fromDate = query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const today = todayIsoDate();
    const todayRow = sqlite
      .prepare(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('pending', 'skipped') THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms,
          AVG(CASE WHEN status = 'completed' THEN time_spent_ms END) AS avg_time_per_assignment_ms
        FROM daily_assignment
        WHERE assigned_for_date = ? AND status != 'archived'
        `
      )
      .get(today) as {
      total: number;
      pending: number | null;
      completed: number | null;
      total_time_ms: number | null;
      avg_time_per_assignment_ms: number | null;
    };

    const overdueRow = sqlite
      .prepare(
        `
        SELECT
          COUNT(*) AS total_pending,
          MIN(assigned_for_date) AS oldest_date,
          COUNT(DISTINCT assigned_for_date) AS incomplete_days
        FROM daily_assignment
        WHERE status IN ('pending', 'skipped') AND assigned_for_date < ?
        `
      )
      .get(today) as { total_pending: number; oldest_date: string | null; incomplete_days: number };

    const totalRow = sqlite
      .prepare(
        `
        SELECT
          SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS total_completed,
          AVG(CASE WHEN status = 'completed' THEN time_spent_ms END) AS avg_time_per_assignment_ms
        FROM daily_assignment
        WHERE status != 'archived'
        `
      )
      .get() as {
      total_time_ms: number | null;
      total_completed: number | null;
      avg_time_per_assignment_ms: number | null;
    };

    // Day estimate delta gate (see CONTEXT.md: day estimate delta).
    //
    // The day verdict is present only when the day is strictly fully completed
    // (`v_day_summary.is_fully_completed`: no pending, no skipped, at least one
    // completed) AND every completed assignment of the day carries a non-null
    // estimate snapshot (full coverage). The value is the signed sum over the
    // day's completed snapshotted rows of `time_spent_ms − estimated_ms`.
    //
    // `NULL` for any gate failure: pending remaining, skipped present, mixed
    // legacy/snapshot coverage, all-legacy day, empty day. Completed
    // assignments are never archived (the state machine forbids the
    // completed → archived transition), so the per-date aggregation below over
    // `status = 'completed'` rows aligns exactly with the v_day_summary set.
    //
    // The day estimate (see CONTEXT.md: day estimate) is separate: it is the sum
    // of `estimated_ms` over the day's non-archived assignments and is present
    // whenever every non-archived assignment carries a snapshot (full coverage),
    // whether or not the day is done. That makes the planned total plot-able for
    // in-progress and fully-pending days as soon as the estimate exists.
    const heatmap = sqlite
      .prepare(
        `
        WITH day_estimate AS (
          SELECT
            assigned_for_date,
            SUM(estimated_ms) AS estimated_total_ms,
            SUM(CASE WHEN estimated_ms IS NULL THEN 1 ELSE 0 END) AS null_count,
            COUNT(*) AS non_archived_count
          FROM daily_assignment
          WHERE status != 'archived'
          GROUP BY assigned_for_date
        ),
        day_completed AS (
          SELECT
            assigned_for_date,
            SUM(time_spent_ms - estimated_ms) AS delta_ms,
            SUM(CASE WHEN estimated_ms IS NULL THEN 1 ELSE 0 END) AS null_count,
            COUNT(*) AS completed_count
          FROM daily_assignment
          WHERE status = 'completed'
          GROUP BY assigned_for_date
        )
        SELECT
          vds.assigned_for_date AS date,
          vds.total_assignments,
          vds.completed_count,
          vds.pending_count,
          vds.skipped_count,
          vds.total_time_ms,
          vds.is_fully_completed,
          CASE
            WHEN vds.is_fully_completed = 1
             AND dc.completed_count > 0
             AND dc.null_count = 0
            THEN dc.delta_ms
            ELSE NULL
          END AS estimate_delta_ms,
          CASE
            WHEN de.non_archived_count > 0
             AND de.null_count = 0
            THEN de.estimated_total_ms
            ELSE NULL
          END AS estimated_total_ms
        FROM v_day_summary vds
        LEFT JOIN day_estimate de ON de.assigned_for_date = vds.assigned_for_date
        LEFT JOIN day_completed dc ON dc.assigned_for_date = vds.assigned_for_date
        WHERE vds.assigned_for_date BETWEEN ? AND ?
        ORDER BY vds.assigned_for_date ASC
        `
      )
      .all(fromDate, to) as Array<{
      date: string;
      total_assignments: number;
      completed_count: number;
      pending_count: number;
      skipped_count: number;
      total_time_ms: number;
      is_fully_completed: number;
      estimate_delta_ms: number | null;
      estimated_total_ms: number | null;
      }>;

    return {
      today: {
        total: todayRow.total,
        pending: todayRow.pending ?? 0,
        completed: todayRow.completed ?? 0,
        total_time_ms: todayRow.total_time_ms ?? 0,
        avg_time_per_assignment_ms: Math.round(todayRow.avg_time_per_assignment_ms ?? 0)
      },
      overdue: {
        total_pending: overdueRow.total_pending,
        oldest_date: overdueRow.oldest_date,
        incomplete_days: overdueRow.incomplete_days
      },
      totals: {
        total_time_ms: totalRow.total_time_ms ?? 0,
        total_completed: totalRow.total_completed ?? 0,
        avg_time_per_assignment_ms: Math.round(totalRow.avg_time_per_assignment_ms ?? 0)
      },
      heatmap: heatmap.map((day) => ({
        ...day,
        is_fully_completed: Boolean(day.is_fully_completed)
      }))
    };
  });

  app.get('/stats/study-items/:id', async (request, reply): Promise<StudyItemStatsResponse | FastifyReply | undefined> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid study item id');
    }

    const studyItem = sqlite
      .prepare(`SELECT id, surface_form, selected_reading FROM study_item WHERE id = ?`)
      .get(id) as { id: number; surface_form: string; selected_reading: string } | undefined;

    if (!studyItem) {
      return notFound(reply, 'Study item not found');
    }

    const stats = sqlite
      .prepare(
        `
        SELECT
          total_assignments,
          times_completed,
          total_time_ms,
          avg_completion_time_ms,
          first_assigned,
          last_assigned
        FROM v_study_item_stats
        WHERE study_item_id = ?
        `
      )
      .get(id) as
      | {
          total_assignments: number;
          times_completed: number;
          total_time_ms: number;
          avg_completion_time_ms: number | null;
          first_assigned: string | null;
          last_assigned: string | null;
        }
      | undefined;

    const recentAssignments = sqlite
      .prepare(
        `
        SELECT id, assigned_for_date, status, time_spent_ms, completed_at
        FROM daily_assignment
        WHERE study_item_id = ?
        ORDER BY assigned_for_date DESC, created_at DESC
        LIMIT 10
        `
      )
      .all(id) as Array<{
      id: number;
      assigned_for_date: string;
      status: 'pending' | 'completed' | 'skipped' | 'archived';
      time_spent_ms: number | null;
      completed_at: string | null;
    }>;

    return {
      study_item: studyItem,
      stats: {
        total_assignments: stats?.total_assignments ?? 0,
        times_completed: stats?.times_completed ?? 0,
        total_time_ms: stats?.total_time_ms ?? 0,
        avg_completion_time_ms: Math.round(stats?.avg_completion_time_ms ?? 0),
        first_assigned: stats?.first_assigned ?? null,
        last_assigned: stats?.last_assigned ?? null
      },
      recent_assignments: recentAssignments
    };
  });

  app.get('/stats/kanji/:literal', async (request, reply): Promise<KanjiStatsResponse | FastifyReply | undefined> => {
    const literal = decodeURIComponent((request.params as { literal: string }).literal);
    if (!literal) {
      return badRequest(reply, 'Invalid kanji literal');
    }

    const row = sqlite
      .prepare(
        `
        SELECT
          k.literal,
          k.meanings_json,
          k.onyomi_json,
          k.kunyomi_json,
          k.stroke_count,
          k.grade,
          k.jlpt_level,
          k.frequency_rank,
          ksa.asset_path
        FROM kanji k
        LEFT JOIN kanji_stroke_asset ksa ON ksa.kanji_literal = k.literal
        WHERE k.literal = ?
        `
      )
      .get(literal) as
      | {
          literal: string;
          meanings_json: string;
          onyomi_json: string;
          kunyomi_json: string;
          stroke_count: number;
          grade: number | null;
          jlpt_level: number | null;
          frequency_rank: number | null;
          asset_path: string | null;
        }
      | undefined;

    if (!row) {
      return notFound(reply, 'Kanji not found');
    }

    const stats = sqlite
      .prepare(
        `
        SELECT word_count, total_assignments, times_drilled
        FROM v_kanji_stats
        WHERE kanji_literal = ?
        `
      )
      .get(literal) as { word_count: number; total_assignments: number; times_drilled: number } | undefined;

    const studyItems = sqlite
      .prepare(
        `
        SELECT DISTINCT si.id, si.surface_form, si.selected_reading
        FROM study_item_kanji sik
        JOIN study_item si ON si.id = sik.study_item_id
        WHERE sik.kanji_literal = ?
        ORDER BY si.created_at DESC
        LIMIT 50
        `
      )
      .all(literal) as Array<{ id: number; surface_form: string; selected_reading: string }>;

    return {
      kanji: {
        literal: row.literal,
        meanings: safeJsonParse<string[]>(row.meanings_json),
        onyomi: safeJsonParse<string[]>(row.onyomi_json),
        kunyomi: safeJsonParse<string[]>(row.kunyomi_json),
        stroke_count: row.stroke_count,
        grade: row.grade,
        jlpt_level: row.jlpt_level,
        frequency_rank: row.frequency_rank,
        stroke_asset_url: row.asset_path ? `/static/${row.asset_path}` : null
      },
      stats: {
        word_count: stats?.word_count ?? 0,
        total_assignments: stats?.total_assignments ?? 0,
        times_drilled: stats?.times_drilled ?? 0
      },
      study_items: studyItems
    };
  });

  app.get('/stats/top-words', async (): Promise<TopWordsResponse> => {
    const rows = sqlite
      .prepare(
        `
        SELECT
          vsis.study_item_id,
          vsis.surface_form,
          vsis.selected_reading,
          vsis.times_completed,
          vsis.total_time_ms,
          vsis.avg_completion_time_ms
        FROM v_study_item_stats vsis
        WHERE vsis.times_completed > 0
        ORDER BY vsis.times_completed DESC, vsis.total_time_ms DESC
        LIMIT 10
        `
      )
      .all() as Array<{
      study_item_id: number;
      surface_form: string;
      selected_reading: string;
      times_completed: number;
      total_time_ms: number;
      avg_completion_time_ms: number | null;
    }>;

    return {
      words: rows.map((row) => ({
        study_item_id: row.study_item_id,
        surface_form: row.surface_form,
        selected_reading: row.selected_reading,
        times_completed: row.times_completed,
        total_time_ms: row.total_time_ms,
        avg_completion_time_ms: Math.round(row.avg_completion_time_ms ?? 0)
      }))
    };
  });

  app.get('/stats/slowest-words', async (): Promise<SlowestWordsResponse> => {
    const rows = sqlite
      .prepare(
        `
        SELECT
          vsis.study_item_id,
          vsis.surface_form,
          vsis.selected_reading,
          vsis.times_completed,
          vsis.total_time_ms,
          vsis.avg_completion_time_ms
        FROM v_study_item_stats vsis
        WHERE vsis.times_completed >= 2 AND vsis.avg_completion_time_ms IS NOT NULL
        ORDER BY vsis.avg_completion_time_ms DESC
        LIMIT 10
        `
      )
      .all() as Array<{
      study_item_id: number;
      surface_form: string;
      selected_reading: string;
      times_completed: number;
      total_time_ms: number;
      avg_completion_time_ms: number | null;
    }>;

    return {
      words: rows.map((row) => ({
        study_item_id: row.study_item_id,
        surface_form: row.surface_form,
        selected_reading: row.selected_reading,
        times_completed: row.times_completed,
        total_time_ms: row.total_time_ms,
        avg_completion_time_ms: Math.round(row.avg_completion_time_ms ?? 0)
      }))
    };
  });

  app.get('/stats/top-kanji', async (): Promise<TopKanjiResponse> => {
    const rows = sqlite
      .prepare(
        `
        SELECT
          vks.kanji_literal,
          vks.word_count,
          vks.total_assignments,
          vks.times_drilled,
          k.onyomi_json,
          k.kunyomi_json,
          k.stroke_count,
          k.grade
        FROM v_kanji_stats vks
        JOIN kanji k ON k.literal = vks.kanji_literal
        ORDER BY vks.times_drilled DESC, vks.total_assignments DESC
        LIMIT 10
        `
      )
      .all() as Array<{
      kanji_literal: string;
      word_count: number;
      total_assignments: number;
      times_drilled: number;
      onyomi_json: string;
      kunyomi_json: string;
      stroke_count: number;
      grade: number | null;
    }>;

    return {
      kanji: rows.map((row) => ({
        literal: row.kanji_literal,
        word_count: row.word_count,
        total_assignments: row.total_assignments,
        times_drilled: row.times_drilled,
        onyomi: safeJsonParse<string[]>(row.onyomi_json),
        kunyomi: safeJsonParse<string[]>(row.kunyomi_json),
        stroke_count: row.stroke_count,
        grade: row.grade
      }))
    };
  });
}
