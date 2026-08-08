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
import { badRequest, notFound, parseIdParam } from '../http.js';
import { safeJsonParse } from '../util.js';

import {
  getDashboardTodayRow,
  getHeatmapRows,
  getKanjiByLiteral,
  getKanjiStats,
  getKanjiStudyItems,
  getOverdueRow,
  getRecentAssignments,
  getSlowestWords,
  getStudyItemById,
  getStudyItemStats,
  getTopKanji,
  getTopWords,
  getTotalsRow
} from './queries.js';

export function registerStatsRoutes(app: FastifyInstance): void {
  app.get('/stats/dashboard', async (request): Promise<DashboardResponse> => {
    const query = request.query as { from?: string; to?: string };
    const to = query.to ?? todayIsoDate();
    const fromDate = query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const today = todayIsoDate();
    const todayRow = getDashboardTodayRow(today);
    const overdueRow = getOverdueRow(today);
    const totalRow = getTotalsRow();
    const heatmap = getHeatmapRows(fromDate, to);

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

    const studyItem = getStudyItemById(id);

    if (!studyItem) {
      return notFound(reply, 'Study item not found');
    }

    const stats = getStudyItemStats(id);
    const recentAssignments = getRecentAssignments(id);

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

    const row = getKanjiByLiteral(literal);

    if (!row) {
      return notFound(reply, 'Kanji not found');
    }

    const stats = getKanjiStats(literal);
    const studyItems = getKanjiStudyItems(literal);

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
    const rows = getTopWords();

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
    const rows = getSlowestWords();

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
    const rows = getTopKanji();

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
