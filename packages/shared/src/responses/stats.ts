import { z } from 'zod';

import { assignmentStatusSchema, dateSchema, timestampSchema } from '../schemas.js';

/**
 * Heatmap day — one cell of the dashboard progress heatmap. The superset the
 * api actually returns: every count/time field plus the day verdict
 * (`estimate_delta_ms`) and the day estimate (`estimated_total_ms`). All five
 * hand-declared web shapes (DashboardPage, ProgressCharts, Heatmap, TodayPage,
 * DayDetailPage) collapsed onto this one (issue 13) — the drift where some
 * declarations omitted `estimated_total_ms` is gone.
 */
export const heatmapDaySchema = z.object({
  date: dateSchema,
  total_assignments: z.number(),
  completed_count: z.number(),
  pending_count: z.number(),
  skipped_count: z.number(),
  total_time_ms: z.number(),
  is_fully_completed: z.boolean(),
  estimate_delta_ms: z.number().nullable(),
  estimated_total_ms: z.number().nullable()
});

export type HeatmapDay = z.infer<typeof heatmapDaySchema>;

/**
 * Dashboard response (`GET /stats/dashboard`) — today's counts, the overdue
 * snapshot, lifetime totals, and the heatmap over the requested range.
 */
export const dashboardResponseSchema = z.object({
  today: z.object({
    total: z.number(),
    pending: z.number(),
    completed: z.number(),
    total_time_ms: z.number(),
    avg_time_per_assignment_ms: z.number()
  }),
  overdue: z.object({
    total_pending: z.number(),
    oldest_date: dateSchema.nullable(),
    incomplete_days: z.number()
  }),
  totals: z.object({
    total_time_ms: z.number(),
    total_completed: z.number(),
    avg_time_per_assignment_ms: z.number()
  }),
  heatmap: z.array(heatmapDaySchema)
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

/**
 * Study-item stats response (`GET /stats/study-items/:id`) — per-word summary
 * counts plus the ten most recent assignments of the study item.
 */
export const studyItemStatsResponseSchema = z.object({
  study_item: z.object({
    id: z.number(),
    surface_form: z.string(),
    selected_reading: z.string()
  }),
  stats: z.object({
    total_assignments: z.number(),
    times_completed: z.number(),
    total_time_ms: z.number(),
    avg_completion_time_ms: z.number(),
    first_assigned: dateSchema.nullable(),
    last_assigned: dateSchema.nullable()
  }),
  recent_assignments: z.array(
    z.object({
      id: z.number(),
      assigned_for_date: dateSchema,
      status: assignmentStatusSchema,
      time_spent_ms: z.number().nullable(),
      completed_at: timestampSchema.nullable()
    })
  )
});

export type StudyItemStatsResponse = z.infer<typeof studyItemStatsResponseSchema>;

/**
 * Kanji stats response (`GET /stats/kanji/:literal`) — the kanji's dictionary
 * profile, drill counts, and the study items that contain it.
 */
export const kanjiStatsResponseSchema = z.object({
  kanji: z.object({
    literal: z.string(),
    meanings: z.array(z.string()),
    onyomi: z.array(z.string()),
    kunyomi: z.array(z.string()),
    stroke_count: z.number(),
    grade: z.number().nullable(),
    jlpt_level: z.number().nullable(),
    frequency_rank: z.number().nullable(),
    stroke_asset_url: z.string().nullable()
  }),
  stats: z.object({
    word_count: z.number(),
    total_assignments: z.number(),
    times_drilled: z.number()
  }),
  study_items: z.array(
    z.object({
      id: z.number(),
      surface_form: z.string(),
      selected_reading: z.string()
    })
  )
});

export type KanjiStatsResponse = z.infer<typeof kanjiStatsResponseSchema>;

const wordRankingSchema = z.object({
  study_item_id: z.number(),
  surface_form: z.string(),
  selected_reading: z.string(),
  times_completed: z.number(),
  total_time_ms: z.number(),
  avg_completion_time_ms: z.number()
});

/**
 * Word leaderboards — `GET /stats/top-words` (most drilled) and
 * `GET /stats/slowest-words` (slowest average completion), both ranked
 * `{ words }` lists of the same row shape.
 */
export const topWordsResponseSchema = z.object({ words: z.array(wordRankingSchema) });

export type TopWordsResponse = z.infer<typeof topWordsResponseSchema>;

export const slowestWordsResponseSchema = z.object({ words: z.array(wordRankingSchema) });

export type SlowestWordsResponse = z.infer<typeof slowestWordsResponseSchema>;

/**
 * Top-kanji response (`GET /stats/top-kanji`) — most drilled kanji with their
 * reading info and drill counts.
 */
export const topKanjiResponseSchema = z.object({
  kanji: z.array(
    z.object({
      literal: z.string(),
      word_count: z.number(),
      total_assignments: z.number(),
      times_drilled: z.number(),
      onyomi: z.array(z.string()),
      kunyomi: z.array(z.string()),
      stroke_count: z.number(),
      grade: z.number().nullable()
    })
  )
});

export type TopKanjiResponse = z.infer<typeof topKanjiResponseSchema>;
